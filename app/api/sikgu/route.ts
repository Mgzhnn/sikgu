import { env } from "cloudflare:workers";
import { after } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { maskDisplayName } from "../../name-mask.mjs";
import {
  detectReceiptType,
  sanitizeReceiptImage,
  validateReceiptImageData,
} from "../../receipt-image.mjs";
import {
  isPickupId,
  isRestaurantId,
  parseDeliveryApps,
  pickupFullNames,
  restaurantMinimums,
  roomCapacities,
} from "../../sikgu-rules.mjs";

export const dynamic = "force-dynamic";

type AuthUser = {
  email: string;
  displayName: string;
};

type UploadObject = {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: {
    contentType?: string;
  };
};

type UploadBucket = {
  put: (
    key: string,
    value: ArrayBuffer,
    options: {
      httpMetadata: {
        contentType: string;
        contentDisposition: string;
        cacheControl: string;
      };
    },
  ) => Promise<unknown>;
  get: (key: string) => Promise<UploadObject | null>;
  delete: (key: string | string[]) => Promise<void>;
  list: (options: {
    prefix: string;
    cursor?: string;
    limit?: number;
  }) => Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
};

const maxReceiptBytes = 8 * 1024 * 1024;
const maxJsonBytes = 32 * 1024;
const maxOpenRoomsPerHost = 5;
const recentRoomWindowMs = 30 * 24 * 60 * 60 * 1000;
const receiptUploadCooldownMs = 30 * 1000;
const mutationLockTimeoutMs = 2 * 60 * 1000;
const receiptTypes = new Set(["image/png"]);

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, {
  status,
  headers: {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  },
});

function uploadBucket() {
  const bucket = (env as unknown as { UPLOADS?: UploadBucket }).UPLOADS;
  if (!bucket) throw new Error("영수증 저장소가 연결되지 않았습니다.");
  return bucket;
}

function receiptExtension(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function receiptKeysForRoom(id: string, storedKey?: string | null) {
  return [...new Set([
    storedKey || "",
    `receipts/${id}/a`,
    `receipts/${id}/b`,
    `receipts/${id}/current`,
  ].filter(Boolean))];
}

async function deleteReceiptObjectsForRoom(
  id: string,
  storedKey?: string | null,
  includeUncommittedCandidates = false,
) {
  if (!storedKey && !includeUncommittedCandidates) return;
  const bucket = uploadBucket();
  const allKeys = await listReceiptKeysForRoom(
    bucket,
    id,
    storedKey,
    includeUncommittedCandidates,
  );
  for (let offset = 0; offset < allKeys.length; offset += 1000) {
    await bucket.delete(allKeys.slice(offset, offset + 1000));
  }
}

async function listReceiptKeysForRoom(
  bucket: UploadBucket,
  id: string,
  storedKey?: string | null,
  includeUncommittedCandidates = false,
) {
  const keys = new Set(receiptKeysForRoom(id, storedKey));
  if (includeUncommittedCandidates) {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({
        prefix: `receipts/${id}/`,
        cursor,
        limit: 1000,
      });
      for (const object of page.objects) keys.add(object.key);
      if (page.truncated && !page.cursor) {
        throw new Error("R2 returned a truncated receipt listing without a cursor.");
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return [...keys];
}

function isRetryableD1ReadError(error: unknown) {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      messages.push(String(current));
      break;
    }
  }
  const detail = messages.join(" ");
  return [
    "Network connection lost",
    "storage caused object to be reset",
    "reset because its code was updated",
    "Cannot resolve D1 DB due to transient issue on remote node",
  ].some((fragment) => detail.includes(fragment));
}

async function withD1ReadRetry<T>(read: () => Promise<T>) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (attempt > 0 || !isRetryableD1ReadError(error)) throw error;
      const delayMs = 75 + Math.floor(Math.random() * 76);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("D1 read retry exhausted.");
}

function sameOrigin(request: Request) {
  if (request.headers.get("x-sikgu-request") !== "1") return false;
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expectedOrigin;
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function contentLength(request: Request) {
  const raw = request.headers.get("content-length");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function displayName(user: { email: string; fullName: string | null; displayName: string }) {
  const candidate = user.fullName?.trim() || user.displayName?.trim() || "";
  if (candidate && !candidate.includes("@") && candidate.toLowerCase() !== user.email.toLowerCase()) {
    return candidate;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(user.email.trim().toLowerCase()),
  );
  const suffix = Array.from(new Uint8Array(digest).slice(0, 3), (byte) =>
    byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `User-${suffix}`;
}

async function optionalUser(): Promise<AuthUser | null> {
  const user = await getChatGPTUser();
  return user
    ? { email: user.email.trim().toLowerCase(), displayName: maskDisplayName(await displayName(user)) }
    : null;
}

async function requiredUser(): Promise<AuthUser | Response> {
  const user = await optionalUser();
  return user || json({
    error: "로그인이 필요합니다.",
    signInPath: "/signin-with-chatgpt?return_to=/",
  }, 401);
}

function isResponse(value: AuthUser | Response): value is Response {
  return value instanceof Response;
}

function serverError(context: string, error: unknown) {
  const reference = crypto.randomUUID();
  console.error(`[${reference}] ${context}`, error);
  return json({ error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.", reference }, 500);
}

function roomId() {
  return `room_${crypto.randomUUID()}`;
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicDisplayName(value: unknown) {
  const name = String(value || "").trim();
  return name.includes("@") ? "사용자" : maskDisplayName(name);
}

async function acquireRoomMutation(
  id: string,
  email: string,
  mode: "update" | "delete",
) {
  const mutationToken = token();
  const now = Date.now();
  const staleBefore = now - mutationLockTimeoutMs;
  const result = mode === "delete"
    ? await env.DB.prepare(`
        UPDATE rooms
        SET status = 'deleting', mutation_token = ?, mutation_started_at = ?
        WHERE id = ? AND host_email = ?
          AND (
            (
              status = 'open'
              AND (
                mutation_token IS NULL
                OR mutation_started_at IS NULL
                OR mutation_started_at < ?
              )
            )
            OR (
              status = 'deleting'
              AND (
                mutation_token IS NULL
                OR mutation_started_at IS NULL
                OR mutation_started_at < ?
              )
            )
          )
      `).bind(mutationToken, now, id, email, staleBefore, staleBefore).run()
    : await env.DB.prepare(`
        UPDATE rooms
        SET mutation_token = ?, mutation_started_at = ?
        WHERE id = ? AND host_email = ? AND status = 'open'
          AND (
            mutation_token IS NULL
            OR mutation_started_at IS NULL
            OR mutation_started_at < ?
          )
      `).bind(mutationToken, now, id, email, staleBefore).run();
  return result.meta.changes ? mutationToken : null;
}

async function releaseRoomMutation(id: string, email: string, mutationToken: string) {
  await env.DB.prepare(`
    UPDATE rooms
    SET status = 'open', mutation_token = NULL, mutation_started_at = NULL
    WHERE id = ? AND host_email = ? AND mutation_token = ?
  `).bind(id, email, mutationToken).run();
}

async function roomForUser(id: string, email: string) {
  return withD1ReadRetry(() => env.DB.prepare(`
    SELECT r.*, m.role AS my_role, m.status AS my_status
    FROM rooms r
    JOIN room_members m ON m.room_id = r.id AND m.user_email = ?
    WHERE r.id = ? AND r.status = 'open'
  `).bind(email, id).first<Record<string, unknown>>());
}

async function approvedCount(id: string) {
  const row = await withD1ReadRetry(() => env.DB.prepare(
    "SELECT COUNT(*) AS count FROM room_members WHERE room_id = ? AND status = 'approved'",
  ).bind(id).first<{ count: number }>());
  return Number(row?.count || 0);
}

function serializeRoom(row: Record<string, unknown>, includeOrderInfo = false) {
  let rawApps: unknown = [];
  try {
    rawApps = JSON.parse(String(row.apps || "[]"));
  } catch {
    rawApps = [];
  }
  const room = {
    id: String(row.id),
    restaurantId: String(row.restaurant_id),
    host: publicDisplayName(row.host_name),
    pickup: String(row.pickup),
    pickupFull: String(row.pickup_full),
    closesAt: Number(row.closes_at),
    total: Number(row.total),
    target: Number(row.target),
    people: Number(row.people || 1),
    capacity: Number(row.capacity),
    apps: parseDeliveryApps(rawApps),
    membership: String(row.membership),
    note: String(row.note),
    myStatus: row.my_status ? String(row.my_status) : null,
    isHost: row.host_email === row.current_email,
    pendingCount: Number(row.pending_count || 0),
  };
  if (!includeOrderInfo) return room;
  return {
    ...room,
    estimatedArrival: row.estimated_arrival ? String(row.estimated_arrival) : null,
    orderTotal: row.order_total == null ? null : Number(row.order_total),
    receiptUrl: row.receipt_key
      ? `/api/sikgu?action=receipt&roomId=${encodeURIComponent(String(row.id))}&v=${Number(row.receipt_uploaded_at || 0)}`
      : null,
    receiptUploadedAt: row.receipt_uploaded_at == null ? null : Number(row.receipt_uploaded_at),
  };
}

function isUsableRoom(room: ReturnType<typeof serializeRoom>) {
  return isRestaurantId(room.restaurantId)
    && isPickupId(room.pickup)
    && room.apps.length > 0;
}

let lastRetentionSweep = 0;
let retentionSweepInFlight: Promise<void> | null = null;

async function purgeExpiredRooms(now: number) {
  if (now - lastRetentionSweep < 60 * 60 * 1000) return;
  if (retentionSweepInFlight) return retentionSweepInFlight;
  retentionSweepInFlight = (async () => {
    try {
      const legacyNames = await withD1ReadRetry(() => env.DB.prepare(`
        SELECT CASE WHEN
          EXISTS(SELECT 1 FROM rooms WHERE instr(host_name, '@') > 0)
          OR EXISTS(SELECT 1 FROM room_members WHERE instr(display_name, '@') > 0)
          OR EXISTS(SELECT 1 FROM room_messages WHERE instr(sender_name, '@') > 0)
        THEN 1 ELSE 0 END AS found
      `).first<{ found: number }>());
      if (legacyNames?.found) {
        await env.DB.batch([
          env.DB.prepare("UPDATE rooms SET host_name = '사용자' WHERE instr(host_name, '@') > 0"),
          env.DB.prepare("UPDATE room_members SET display_name = '사용자' WHERE instr(display_name, '@') > 0"),
          env.DB.prepare("UPDATE room_messages SET sender_name = '사용자' WHERE instr(sender_name, '@') > 0"),
        ]);
      }
      const staleBefore = now - mutationLockTimeoutMs;
      const candidates = await withD1ReadRetry(() => env.DB.prepare(`
        SELECT id
        FROM rooms
        WHERE (
          closes_at < ?
          AND status = 'open'
          AND (
            mutation_token IS NULL
            OR mutation_started_at IS NULL
            OR mutation_started_at < ?
          )
        )
        OR (
          status = 'deleting'
          AND (
            mutation_token IS NULL
            OR mutation_started_at IS NULL
            OR mutation_started_at < ?
          )
        )
        ORDER BY CASE status WHEN 'deleting' THEN 0 ELSE 1 END, closes_at ASC
        LIMIT 50
      `).bind(
        now - recentRoomWindowMs,
        staleBefore,
        staleBefore,
      ).all<{ id: string }>());

      if (candidates.results.length) {
        const candidateIds = candidates.results.map((room) => room.id);
        const placeholders = candidateIds.map(() => "?").join(", ");
        const sweepToken = token();
        await env.DB.prepare(`
          UPDATE rooms
          SET status = 'deleting', mutation_token = ?, mutation_started_at = ?
          WHERE id IN (${placeholders})
            AND (
              (
                closes_at < ?
                AND status = 'open'
                AND (
                  mutation_token IS NULL
                  OR mutation_started_at IS NULL
                  OR mutation_started_at < ?
                )
              )
              OR (
                status = 'deleting'
                AND (
                  mutation_token IS NULL
                  OR mutation_started_at IS NULL
                  OR mutation_started_at < ?
                )
              )
            )
        `).bind(
          sweepToken,
          now,
          ...candidateIds,
          now - recentRoomWindowMs,
          staleBefore,
          staleBefore,
        ).run();
        const claimed = await withD1ReadRetry(() => env.DB.prepare(`
          SELECT id, receipt_key
          FROM rooms
          WHERE status = 'deleting' AND mutation_token = ?
          ORDER BY closes_at ASC
        `).bind(sweepToken).all<{ id: string; receipt_key: string | null }>());
        if (!claimed.results.length) return;

        try {
          const bucket = uploadBucket();
          const receiptKeys = [...new Set((await Promise.all(
            claimed.results.map((room) =>
              listReceiptKeysForRoom(bucket, room.id, room.receipt_key, true)),
          )).flat())];
          for (let offset = 0; offset < receiptKeys.length; offset += 1000) {
            await bucket.delete(receiptKeys.slice(offset, offset + 1000));
          }
        } catch (error) {
          console.error("Deferred stale receipt cleanup", error);
          // Keep claimed rooms hidden. A later sweep can safely reclaim the stale
          // deletion token without resurrecting a partially cleaned room.
          return;
        }
        try {
          // All private room tables use ON DELETE CASCADE in the production schema.
          await env.DB.prepare(`
            DELETE FROM rooms
            WHERE status = 'deleting' AND mutation_token = ?
          `).bind(sweepToken).run();
        } catch (error) {
          console.error("Deferred stale room cleanup", error);
          // Leave the tombstone claimed; ambiguous D1 outcomes are retried later.
        }
      }
    } finally {
      // Back off even after a storage outage so new visitors do not start a cleanup storm.
      lastRetentionSweep = Date.now();
    }
  })();
  try {
    await retentionSweepInFlight;
  } finally {
    retentionSweepInFlight = null;
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "bootstrap";
    const user = await optionalUser();

    if (action === "receipt") {
      const auth = user || await requiredUser();
      if (isResponse(auth)) return auth;
      const id = url.searchParams.get("roomId") || "";
      const room = await roomForUser(id, auth.email);
      if (!room || room.my_status !== "approved" || room.status !== "open") {
        return json({ error: "승인된 주문방 구성원만 영수증을 볼 수 있습니다." }, 403);
      }
      if (Number(room.closes_at) < Date.now() - recentRoomWindowMs) {
        return json({ error: "보관 기간이 지난 주문방입니다." }, 410);
      }
      const receiptKey = String(room.receipt_key || "");
      if (!receiptKey) return json({ error: "등록된 영수증이 없습니다." }, 404);
      const object = await uploadBucket().get(receiptKey);
      if (!object) return json({ error: "영수증 이미지를 찾을 수 없습니다." }, 404);
      const contentType = String(object.httpMetadata?.contentType || room.receipt_content_type || "application/octet-stream");
      return new Response(object.body, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="receipt.${receiptExtension(contentType)}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    }

    if (action === "bootstrap") {
      const now = Date.now();
      const email = user?.email || "";
      const result = await withD1ReadRetry(() => env.DB.prepare(`
        SELECT
          r.*,
          ? AS current_email,
          (SELECT COUNT(*) FROM room_members approved
            WHERE approved.room_id = r.id AND approved.status = 'approved') AS people,
          (SELECT mine.status FROM room_members mine
            WHERE mine.room_id = r.id AND mine.user_email = ?) AS my_status,
          (SELECT COUNT(*) FROM room_members pending
            WHERE pending.room_id = r.id AND pending.status = 'requested') AS pending_count
        FROM rooms r
        WHERE r.status = 'open' AND r.closes_at > ?
        ORDER BY r.created_at DESC
        LIMIT 100
      `).bind(email, email, now).all<Record<string, unknown>>());

      let myRooms: ReturnType<typeof serializeRoom>[] = [];
      if (user) {
        const mine = await withD1ReadRetry(() => env.DB.prepare(`
          SELECT
            r.*,
            ? AS current_email,
            mine.status AS my_status,
            (SELECT COUNT(*) FROM room_members approved
              WHERE approved.room_id = r.id AND approved.status = 'approved') AS people,
            (SELECT COUNT(*) FROM room_members pending
              WHERE pending.room_id = r.id AND pending.status = 'requested') AS pending_count
          FROM rooms r
          JOIN room_members mine ON mine.room_id = r.id
          WHERE mine.user_email = ?
            AND mine.status = 'approved'
            AND r.status = 'open'
            AND r.closes_at > ?
          ORDER BY r.created_at DESC
          LIMIT 50
        `).bind(user.email, user.email, now - recentRoomWindowMs).all<Record<string, unknown>>());
        myRooms = mine.results.map((row) => serializeRoom(row, true)).filter(isUsableRoom);
      }

      after(() => purgeExpiredRooms(now).catch((error) => console.error("Retention sweep failed", error)));
      return json({
        user: user ? { displayName: user.displayName } : null,
        rooms: result.results.map((row) => serializeRoom(row)).filter(isUsableRoom),
        myRooms,
      });
    }

    if (action === "room") {
      const auth = await requiredUser();
      if (isResponse(auth)) return auth;
      const id = url.searchParams.get("roomId") || "";
      const room = await roomForUser(id, auth.email);
      if (!room || room.my_status !== "approved" || room.status !== "open") {
        return json({ error: "초대되거나 승인된 구성원만 이 주문방을 볼 수 있습니다." }, 403);
      }
      if (Number(room.closes_at) < Date.now() - recentRoomWindowMs) {
        return json({ error: "보관 기간이 지난 주문방입니다." }, 410);
      }
      const isHost = room.host_email === auth.email;
      const loadMembers = () => withD1ReadRetry(() => env.DB.prepare(`
        SELECT review_token, display_name, role, status, created_at
        FROM room_members
        WHERE room_id = ? ${isHost ? "" : "AND status = 'approved'"}
        ORDER BY CASE status WHEN 'requested' THEN 0 ELSE 1 END, created_at ASC
      `).bind(id).all());
      let members = await loadMembers();
      if (isHost && members.results.some((member) => !member.review_token)) {
        await env.DB.prepare(`
          UPDATE room_members
          SET review_token = lower(hex(randomblob(16)))
          WHERE room_id = ? AND review_token IS NULL
        `).bind(id).run();
        members = await loadMembers();
      }
      const messages = await withD1ReadRetry(() => env.DB.prepare(`
        SELECT id, sender_name, body, created_at, mine
        FROM (
          SELECT id, sender_name, body, created_at,
            CASE WHEN sender_email = ? THEN 1 ELSE 0 END AS mine
          FROM room_messages
          WHERE room_id = ?
          ORDER BY created_at DESC
          LIMIT 200
        )
        ORDER BY created_at ASC
      `).bind(auth.email, id).all());
      return json({
        room: { ...serializeRoom({ ...room, current_email: auth.email, people: await approvedCount(id) }, true), isHost },
        members: members.results.map((member) => ({
          ...(isHost && member.role !== "host"
            ? { member_ref: String(member.review_token || "") }
            : {}),
          display_name: publicDisplayName(member.display_name),
          role: member.role,
          status: member.status,
          created_at: member.created_at,
        })),
        messages: messages.results.map((message) => ({
          ...message,
          sender_name: publicDisplayName(message.sender_name),
        })),
      });
    }

    return json({ error: "지원하지 않는 요청입니다." }, 400);
  } catch (error) {
    return serverError("Failed to read SIKGU data", error);
  }
}

export async function PUT(request: Request) {
  let newReceiptKey = "";
  let preserveNewReceiptOnFailure = false;
  let mutationToken = "";
  let mutationRoomId = "";
  let mutationHostEmail = "";
  let receiptBucket: UploadBucket | null = null;
  try {
    if (!sameOrigin(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
    const auth = await requiredUser();
    if (isResponse(auth)) return auth;
    const url = new URL(request.url);
    const id = url.searchParams.get("roomId") || "";
    if (url.searchParams.get("action") !== "update_order_info" || !id) {
      return json({ error: "주문 정보 요청을 확인해주세요." }, 400);
    }
    mutationRoomId = id;
    mutationHostEmail = auth.email;

    const initialRoom = await withD1ReadRetry(() => env.DB.prepare(`
      SELECT host_email, status, closes_at, receipt_uploaded_at
      FROM rooms
      WHERE id = ?
    `).bind(id).first<{
      host_email: string;
      status: string;
      closes_at: number;
      receipt_uploaded_at: number | null;
    }>());
    if (!initialRoom) return json({ error: "주문방을 찾을 수 없습니다." }, 404);
    if (initialRoom.host_email !== auth.email) {
      return json({ error: "방장만 주문 정보를 수정할 수 있습니다." }, 403);
    }
    if (Number(initialRoom.closes_at) < Date.now() - recentRoomWindowMs) {
      return json({ error: "보관 기간이 지난 주문방은 수정할 수 없습니다." }, 410);
    }
    if (initialRoom.status !== "open") {
      return json({ error: "다른 변경이 진행 중입니다. 잠시 후 다시 시도해주세요." }, 409);
    }

    const requestBytes = contentLength(request);
    if (requestBytes === null) {
      return json({ error: "요청 크기를 확인할 수 없습니다." }, 411);
    }
    if (requestBytes > maxReceiptBytes + 512 * 1024) {
      return json({ error: "영수증 이미지는 8MB 이하만 올릴 수 있습니다." }, 413);
    }
    const form = await request.formData();

    const estimatedArrival = String(form.get("estimatedArrival") || "").trim();
    if (
      estimatedArrival
      && (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(estimatedArrival)
        || !Number.isFinite(Date.parse(estimatedArrival))
      )
    ) {
      return json({ error: "도착 예상 시각을 다시 확인해주세요." }, 400);
    }

    const orderTotalValue = String(form.get("orderTotal") || "").trim();
    const orderTotal = orderTotalValue === "" ? null : Number(orderTotalValue);
    if (
      orderTotal !== null
      && (!Number.isInteger(orderTotal) || orderTotal < 0 || orderTotal > 10_000_000)
    ) {
      return json({ error: "최종 결제 금액은 0원부터 10,000,000원까지 입력할 수 있습니다." }, 400);
    }

    const collectedTotalValue = String(form.get("collectedTotal") || "").trim();
    const collectedTotal = collectedTotalValue === "" ? 0 : Number(collectedTotalValue);
    if (!Number.isInteger(collectedTotal) || collectedTotal < 0 || collectedTotal > 10_000_000) {
      return json({ error: "현재 모인 주문금액은 0원부터 10,000,000원까지 입력할 수 있습니다." }, 400);
    }

    const receipt = form.get("receipt");
    if (receipt !== null && !(receipt instanceof File)) {
      return json({ error: "영수증 이미지 형식을 확인해주세요." }, 400);
    }
    let receiptContentType = "";
    let receiptUploadedAt: number | null = null;
    let normalizedReceiptBuffer: ArrayBuffer | null = null;
    let receiptFileExtension = "";
    if (receipt instanceof File && receipt.size > 0) {
      const preliminaryRetryAfterMs =
        receiptUploadCooldownMs - (Date.now() - Number(initialRoom.receipt_uploaded_at || 0));
      if (preliminaryRetryAfterMs > 0) {
        return json(
          { error: "영수증 이미지는 30초에 한 번만 교체할 수 있습니다." },
          429,
          { "Retry-After": String(Math.ceil(preliminaryRetryAfterMs / 1000)) },
        );
      }
      if (receipt.size > maxReceiptBytes) {
        return json({ error: "영수증 이미지는 8MB 이하만 올릴 수 있습니다." }, 413);
      }
      if (!receiptTypes.has(receipt.type)) {
        return json({ error: "영수증 이미지를 처리할 수 없습니다. 다시 선택해주세요." }, 415);
      }
      const originalBuffer = await receipt.arrayBuffer();
      const detectedType = detectReceiptType(new Uint8Array(originalBuffer));
      if (!detectedType || detectedType !== receipt.type) {
        return json({ error: "이미지 파일의 형식을 확인할 수 없습니다." }, 415);
      }

      receiptContentType = detectedType;
      receiptFileExtension = receiptExtension(detectedType);
      try {
        normalizedReceiptBuffer = sanitizeReceiptImage(originalBuffer, detectedType);
        await validateReceiptImageData(normalizedReceiptBuffer, detectedType);
      } catch {
        return json({ error: "이미지 파일이 손상되었거나 크기가 너무 큽니다." }, 415);
      }
    }

    // Resolve the storage binding before taking the lock so a missing binding
    // fails here, where nothing needs to be rolled back.
    if (normalizedReceiptBuffer) receiptBucket = uploadBucket();
    mutationToken = await acquireRoomMutation(id, auth.email, "update") || "";
    if (!mutationToken) {
      return json({ error: "다른 변경이 진행 중입니다. 잠시 후 다시 시도해주세요." }, 409);
    }
    const room = await withD1ReadRetry(() => env.DB.prepare(`
      SELECT receipt_key, receipt_uploaded_at, status, closes_at
      FROM rooms
      WHERE id = ? AND host_email = ? AND status = 'open' AND mutation_token = ?
    `).bind(id, auth.email, mutationToken).first<{
      receipt_key: string | null;
      receipt_uploaded_at: number | null;
      status: string;
      closes_at: number;
    }>());
    if (!room) {
      throw new Error("The order room mutation lock was lost before the update started.");
    }
    if (Number(room.closes_at) < Date.now() - recentRoomWindowMs) {
      await releaseRoomMutation(id, auth.email, mutationToken);
      mutationToken = "";
      return json({ error: "보관 기간이 지난 주문방은 수정할 수 없습니다." }, 410);
    }

    if (normalizedReceiptBuffer && receiptBucket) {
      const retryAfterMs = receiptUploadCooldownMs - (Date.now() - Number(room.receipt_uploaded_at || 0));
      if (retryAfterMs > 0) {
        await releaseRoomMutation(id, auth.email, mutationToken);
        mutationToken = "";
        return json(
          { error: "영수증 이미지는 30초에 한 번만 교체할 수 있습니다." },
          429,
          { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
        );
      }
      receiptUploadedAt = Date.now();
      newReceiptKey = `receipts/${id}/${mutationToken}.${receiptFileExtension}`;
      await receiptBucket.put(newReceiptKey, normalizedReceiptBuffer, {
        httpMetadata: {
          contentType: receiptContentType,
          contentDisposition: `inline; filename="receipt.${receiptFileExtension}"`,
          cacheControl: "private, no-store",
        },
      });
    }

    try {
      let updateResult;
      if (newReceiptKey) {
        updateResult = await env.DB.prepare(`
          UPDATE rooms
          SET total = ?, estimated_arrival = ?, order_total = ?, receipt_key = ?,
              receipt_content_type = ?, receipt_uploaded_at = ?,
              mutation_token = NULL, mutation_started_at = NULL
          WHERE id = ? AND host_email = ? AND status = 'open' AND mutation_token = ?
        `).bind(
          collectedTotal,
          estimatedArrival || null,
          orderTotal,
          newReceiptKey,
          receiptContentType,
          receiptUploadedAt,
          id,
          auth.email,
          mutationToken,
        ).run();
      } else {
        updateResult = await env.DB.prepare(`
          UPDATE rooms
          SET total = ?, estimated_arrival = ?, order_total = ?,
              mutation_token = NULL, mutation_started_at = NULL
          WHERE id = ? AND host_email = ? AND status = 'open' AND mutation_token = ?
        `).bind(
          collectedTotal,
          estimatedArrival || null,
          orderTotal,
          id,
          auth.email,
          mutationToken,
        ).run();
      }
      if (!updateResult.meta.changes) {
        throw new Error("The order room was removed before its update completed.");
      }
    } catch (databaseError) {
      let persisted: {
        total: number;
        estimated_arrival: string | null;
        order_total: number | null;
        receipt_key: string | null;
        receipt_content_type: string | null;
        receipt_uploaded_at: number | null;
        mutation_token: string | null;
        status: string;
      } | null = null;
      try {
        persisted = await withD1ReadRetry(() => env.DB.prepare(`
          SELECT total, estimated_arrival, order_total, receipt_key,
                 receipt_content_type, receipt_uploaded_at, mutation_token, status
          FROM rooms
          WHERE id = ? AND host_email = ?
        `).bind(id, auth.email).first<typeof persisted>()) || null;
      } catch (verificationError) {
        // A unique object key cannot overwrite another mutation. Preserve it until
        // a later host deletion/retention prefix sweep resolves the D1 outcome.
        preserveNewReceiptOnFailure = Boolean(newReceiptKey);
        console.error("Deferred receipt commit verification", verificationError);
        throw databaseError;
      }
      const expectedOrderState = Boolean(
        persisted
        && Number(persisted.total) === collectedTotal
        && (persisted.estimated_arrival || null) === (estimatedArrival || null)
        && (persisted.order_total == null ? null : Number(persisted.order_total)) === orderTotal
        && persisted.mutation_token === null
        && persisted.status === "open"
        && (
          !newReceiptKey
          || (
            persisted.receipt_key === newReceiptKey
            && persisted.receipt_content_type === receiptContentType
            && Number(persisted.receipt_uploaded_at) === receiptUploadedAt
          )
        )
      );
      if (newReceiptKey && persisted?.receipt_key === newReceiptKey) {
        preserveNewReceiptOnFailure = true;
      }
      if (!expectedOrderState) {
        throw databaseError;
      }
    }

    mutationToken = "";
    const committedReceiptKey = newReceiptKey;
    newReceiptKey = "";
    if (committedReceiptKey && receiptBucket && room.receipt_key && room.receipt_key !== committedReceiptKey) {
      await receiptBucket.delete(room.receipt_key).catch((cleanupError) => {
        // Room deletion and retention enumerate the room prefix and retry leftovers.
        console.error("Deferred previous receipt cleanup", cleanupError);
      });
    }
    return json({ ok: true, receiptUploadedAt });
  } catch (error) {
    // Nothing in this block may throw: a second failure here would skip the
    // lock release and leave the room stuck for the whole lock timeout.
    if (newReceiptKey && !preserveNewReceiptOnFailure) {
      if (receiptBucket) await receiptBucket.delete(newReceiptKey).catch(() => undefined);
    }
    if (mutationToken) {
      await releaseRoomMutation(mutationRoomId, mutationHostEmail, mutationToken).catch(() => undefined);
    }
    return serverError("Failed to update private order information", error);
  }
}

export async function DELETE(request: Request) {
  let mutationToken = "";
  let mutationRoomId = "";
  let mutationHostEmail = "";
  try {
    if (!sameOrigin(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
    const auth = await requiredUser();
    if (isResponse(auth)) return auth;
    const url = new URL(request.url);
    const id = url.searchParams.get("roomId") || "";
    if (!id) return json({ error: "주문방 정보가 없습니다." }, 400);
    mutationRoomId = id;
    mutationHostEmail = auth.email;

    const initialRoom = await withD1ReadRetry(() => env.DB.prepare(
      "SELECT host_email FROM rooms WHERE id = ?",
    ).bind(id).first<{ host_email: string }>());
    if (!initialRoom) return json({ error: "주문방을 찾을 수 없습니다." }, 404);
    if (initialRoom.host_email !== auth.email) {
      return json({ error: "방장만 주문방을 삭제할 수 있습니다." }, 403);
    }
    mutationToken = await acquireRoomMutation(id, auth.email, "delete") || "";
    if (!mutationToken) {
      const existing = await withD1ReadRetry(() => env.DB.prepare(
        "SELECT id FROM rooms WHERE id = ?",
      ).bind(id).first<{ id: string }>());
      return existing
        ? json({ error: "다른 변경이 진행 중입니다. 잠시 후 다시 시도해주세요." }, 409)
        : json({ error: "주문방을 찾을 수 없습니다." }, 404);
    }
    const room = await withD1ReadRetry(() => env.DB.prepare(`
      SELECT receipt_key
      FROM rooms
      WHERE id = ? AND host_email = ? AND status = 'deleting' AND mutation_token = ?
    `).bind(id, auth.email, mutationToken).first<{ receipt_key: string | null }>());
    if (!room) throw new Error("The order room deletion lock was lost before cleanup.");

    try {
      // Enumerate the private room prefix so interrupted unique uploads are removed too.
      await deleteReceiptObjectsForRoom(id, room.receipt_key, true);
    } catch (error) {
      console.error("Receipt deletion must succeed before room deletion", error);
      mutationToken = "";
      return json(
        { error: "영수증 삭제를 완료하지 못했습니다. 2분 후 다시 시도해주세요." },
        503,
        { "Retry-After": "120" },
      );
    }
    try {
      // Members, invitations, and messages are removed by the schema's cascades.
      const result = await env.DB.prepare(`
        DELETE FROM rooms
        WHERE id = ? AND host_email = ? AND status = 'deleting' AND mutation_token = ?
      `).bind(id, auth.email, mutationToken).run();
      if (!result.meta.changes) {
        const remaining = await withD1ReadRetry(() => env.DB.prepare(
          "SELECT id FROM rooms WHERE id = ?",
        ).bind(id).first<{ id: string }>());
        if (remaining) throw new Error("The order room deletion claim was lost.");
      }
    } catch (error) {
      // D1 can commit an idempotent delete even if its response is interrupted.
      // Confirm the final state before surfacing a false deletion failure.
      const remaining = await withD1ReadRetry(() => env.DB.prepare(
        "SELECT id FROM rooms WHERE id = ?",
      ).bind(id).first<{ id: string }>()).catch(() => ({ id }));
      if (remaining) {
        // R2 cleanup already ran. Keep the room hidden until a retry can confirm
        // both private object cleanup and the token-guarded database deletion.
        console.error("Deferred claimed room deletion", error);
        mutationToken = "";
        return json(
          { error: "주문방 삭제를 마무리하지 못했습니다. 2분 후 다시 시도해주세요." },
          503,
          { "Retry-After": "120" },
        );
      }
    }
    mutationToken = "";
    return json({ ok: true });
  } catch (error) {
    if (mutationToken) {
      await releaseRoomMutation(mutationRoomId, mutationHostEmail, mutationToken).catch(() => undefined);
    }
    return serverError("Failed to delete private order room", error);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
    const auth = await requiredUser();
    if (isResponse(auth)) return auth;
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON 요청만 사용할 수 있습니다." }, 415);
    }
    const requestBytes = contentLength(request);
    if (requestBytes === null) return json({ error: "요청 크기를 확인할 수 없습니다." }, 411);
    if (requestBytes > maxJsonBytes) return json({ error: "요청 내용이 너무 큽니다." }, 413);
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action || "");

    if (action === "create_room") {
      const now = Date.now();
      const capacity = Number(payload.capacity);
      const apps = parseDeliveryApps(payload.apps);
      const restaurantId = String(payload.restaurantId || "");
      const pickup = String(payload.pickup || "");
      const closesAt = Number(payload.closesAt);
      const membership = payload.membership === "baemin" || payload.membership === "coupang"
        ? payload.membership
        : "";
      if (!isRestaurantId(restaurantId) || !isPickupId(pickup) || !apps.length) {
        return json({ error: "가게, 픽업 장소, 주문 앱을 확인해 주세요." }, 400);
      }
      if (!roomCapacities.includes(capacity)) {
        return json({ error: "모집 인원은 2명부터 8명까지 선택할 수 있습니다." }, 400);
      }
      if (!Number.isSafeInteger(closesAt) || closesAt < now + 5 * 60 * 1000 || closesAt > now + 60 * 60 * 1000) {
        return json({ error: "모집 마감 시간은 지금부터 5분~60분 사이여야 합니다." }, 400);
      }
      if (membership && !apps.includes(membership)) {
        return json({ error: "선택한 주문 앱과 무료배달 멤버십이 일치하지 않습니다." }, 400);
      }
      const id = roomId();
      const target = Math.min(...apps.map((app) => restaurantMinimums[restaurantId][app]));
      // The per-host limit lives inside the INSERT so that concurrent requests
      // cannot all pass a separate COUNT check; the host member row is only
      // written when the room row was.
      const [createdRoom] = await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO rooms (
            id, host_email, host_name, restaurant_id, pickup, pickup_full, apps,
            closes_at, total, target, capacity, membership, note, status, created_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?
          WHERE (
            SELECT COUNT(*) FROM rooms
            WHERE host_email = ? AND status = 'open' AND closes_at > ?
          ) < ?
        `).bind(
          id,
          auth.email,
          auth.displayName,
          restaurantId,
          pickup,
          pickupFullNames[pickup],
          JSON.stringify(apps),
          closesAt,
          0,
          target,
          capacity,
          membership,
          String(payload.note || "같이 맛있게 먹어요!").slice(0, 300),
          now,
          auth.email,
          now,
          maxOpenRoomsPerHost,
        ),
        env.DB.prepare(`
          INSERT INTO room_members (
            room_id, user_email, display_name, role, status, review_token, created_at
          )
          SELECT ?, ?, ?, 'host', 'approved', ?, ?
          WHERE changes() > 0
        `).bind(id, auth.email, auth.displayName, token(), now),
      ]);
      if (!createdRoom.meta.changes) {
        return json(
          { error: `동시에 운영할 수 있는 주문방은 ${maxOpenRoomsPerHost}개까지입니다.` },
          429,
          { "Retry-After": "300" },
        );
      }
      return json({ roomId: id }, 201);
    }

    const id = String(payload.roomId || "");
    if (!id) return json({ error: "주문방 정보가 없습니다." }, 400);

    if (action === "request_join") {
      const room = await env.DB.prepare(
        "SELECT capacity, status, closes_at FROM rooms WHERE id = ?",
      ).bind(id).first<{ capacity: number; status: string; closes_at: number }>();
      if (!room || room.status !== "open" || room.closes_at <= Date.now()) {
        return json({ error: "참여할 수 없는 주문방입니다." }, 409);
      }
      if (await approvedCount(id) >= room.capacity) {
        return json({ error: "주문방 정원이 모두 찼습니다." }, 409);
      }
      await env.DB.prepare(`
        INSERT INTO room_members (
          room_id, user_email, display_name, role, status, review_token, created_at
        )
        VALUES (?, ?, ?, 'member', 'requested', ?, ?)
        ON CONFLICT(room_id, user_email) DO UPDATE SET
          display_name = excluded.display_name,
          review_token = COALESCE(room_members.review_token, excluded.review_token),
          status = CASE WHEN room_members.status = 'approved' THEN 'approved' ELSE 'requested' END
      `).bind(id, auth.email, auth.displayName, token(), Date.now()).run();
      const membership = await roomForUser(id, auth.email);
      return json({ status: membership?.my_status || "requested" });
    }

    const room = await env.DB.prepare(
      "SELECT host_email, capacity, status, closes_at FROM rooms WHERE id = ?",
    ).bind(id).first<{ host_email: string; capacity: number; status: string; closes_at: number }>();
    if (!room) return json({ error: "주문방을 찾을 수 없습니다." }, 404);

    if (action === "review_member") {
      if (room.host_email !== auth.email) return json({ error: "방장만 참여자를 선택할 수 있습니다." }, 403);
      if (room.status !== "open" || room.closes_at <= Date.now()) {
        return json({ error: "마감된 주문방에서는 참여자를 변경할 수 없습니다." }, 409);
      }
      const memberRef = String(payload.memberRef || "");
      if (!/^[a-f0-9]{32,48}$/i.test(memberRef)) {
        return json({ error: "참여자 정보를 확인해 주세요." }, 400);
      }
      const decision = String(payload.decision || "");
      if (decision === "approve") {
        const result = await env.DB.prepare(`
          UPDATE room_members SET status = 'approved'
          WHERE room_id = ? AND review_token = ? AND status = 'requested'
            AND (
              SELECT COUNT(*) FROM room_members
              WHERE room_id = ? AND status = 'approved'
            ) < ?
        `).bind(id, memberRef, id, room.capacity).run();
        if (!result.meta.changes) {
          return json({ error: "신청을 찾을 수 없거나 주문방 정원이 모두 찼습니다." }, 409);
        }
      } else if (decision === "reject") {
        const result = await env.DB.prepare(`
          DELETE FROM room_members
          WHERE room_id = ? AND review_token = ? AND status = 'requested'
        `).bind(id, memberRef).run();
        if (!result.meta.changes) return json({ error: "대기 중인 신청을 찾을 수 없습니다." }, 404);
      } else {
        return json({ error: "승인 또는 거절을 선택해 주세요." }, 400);
      }
      return json({ ok: true });
    }

    if (action === "remove_member") {
      if (room.host_email !== auth.email) return json({ error: "방장만 참여자를 내보낼 수 있습니다." }, 403);
      const memberRef = String(payload.memberRef || "");
      if (!/^[a-f0-9]{32,48}$/i.test(memberRef)) {
        return json({ error: "참여자 정보를 확인해 주세요." }, 400);
      }
      const result = await env.DB.prepare(`
        DELETE FROM room_members
        WHERE room_id = ? AND review_token = ? AND role = 'member'
      `).bind(id, memberRef).run();
      if (!result.meta.changes) return json({ error: "참여자를 찾을 수 없습니다." }, 404);
      return json({ ok: true });
    }

    if (action === "leave_room") {
      const membership = await roomForUser(id, auth.email);
      if (!membership) return json({ error: "참여 중인 주문방이 아닙니다." }, 404);
      if (membership.my_role === "host") {
        return json({ error: "방장은 주문방 삭제를 이용해주세요." }, 409);
      }
      await env.DB.prepare(`
        DELETE FROM room_members
        WHERE room_id = ? AND user_email = ? AND role = 'member'
      `).bind(id, auth.email).run();
      return json({ ok: true });
    }

    if (action === "create_invite") {
      if (room.host_email !== auth.email) return json({ error: "방장만 초대 링크를 만들 수 있습니다." }, 403);
      const now = Date.now();
      if (room.status !== "open" || room.closes_at <= now) {
        return json({ error: "마감된 주문방에서는 초대 링크를 만들 수 없습니다." }, 409);
      }
      const approved = await approvedCount(id);
      if (approved >= room.capacity) return json({ error: "주문방 정원이 모두 찼습니다." }, 409);
      await env.DB.prepare("DELETE FROM room_invites WHERE room_id = ? AND expires_at <= ?").bind(id, now).run();
      const activeInvites = await env.DB.prepare(`
        SELECT COUNT(*) AS count FROM room_invites WHERE room_id = ? AND expires_at > ?
      `).bind(id, now).first<{ count: number }>();
      if (Number(activeInvites?.count || 0) >= 5) {
        return json({ error: "사용 중인 초대 링크가 너무 많습니다. 기존 링크를 이용해주세요." }, 429, {
          "Retry-After": "300",
        });
      }
      const inviteToken = token();
      const remaining = room.capacity - approved;
      await env.DB.prepare(`
        INSERT INTO room_invites (
          token, room_id, created_by_email, max_uses, uses, expires_at, created_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?)
      `).bind(inviteToken, id, auth.email, remaining, now + 24 * 60 * 60 * 1000, now).run();
      return json({ token: inviteToken, expiresInHours: 24 });
    }

    if (action === "accept_invite") {
      const inviteToken = String(payload.token || "");
      if (!/^[a-f0-9]{48}$/i.test(inviteToken)) {
        return json({ error: "초대 링크를 확인해 주세요." }, 400);
      }
      const existingMember = await roomForUser(id, auth.email);
      if (existingMember?.my_status === "approved") {
        return json({ ok: true, roomId: id });
      }
      const now = Date.now();
      const invite = await env.DB.prepare(`
        SELECT i.room_id, i.max_uses, i.uses, i.expires_at, r.capacity, r.status, r.closes_at
        FROM room_invites i
        JOIN rooms r ON r.id = i.room_id
        WHERE i.token = ? AND i.room_id = ?
      `).bind(inviteToken, id).first<{
        room_id: string;
        max_uses: number;
        uses: number;
        expires_at: number;
        capacity: number;
        status: string;
        closes_at: number;
      }>();
      if (!invite || invite.expires_at <= now || invite.uses >= invite.max_uses) {
        return json({ error: "초대 링크가 만료되었거나 사용할 수 없습니다." }, 410);
      }
      if (invite.status !== "open" || invite.closes_at <= now) {
        return json({ error: "주문방이 마감되었거나 정원이 모두 찼습니다." }, 409);
      }
      const [reservedInvite, accepted] = await env.DB.batch([
        env.DB.prepare(`
          UPDATE room_invites
          SET uses = uses + 1
          WHERE token = ? AND room_id = ?
            AND expires_at > ? AND uses < max_uses
            AND EXISTS (
              SELECT 1
              FROM rooms r
              WHERE r.id = room_invites.room_id
                AND r.status = 'open' AND r.closes_at > ?
                AND (
                  SELECT COUNT(*) FROM room_members approved
                  WHERE approved.room_id = r.id AND approved.status = 'approved'
                ) < r.capacity
            )
            AND NOT EXISTS (
              SELECT 1 FROM room_members mine
              WHERE mine.room_id = room_invites.room_id
                AND mine.user_email = ? AND mine.status = 'approved'
            )
        `).bind(inviteToken, id, now, now, auth.email),
        env.DB.prepare(`
          INSERT INTO room_members (
            room_id, user_email, display_name, role, status, review_token, created_at
          )
          SELECT ?, ?, ?, 'member', 'approved', ?, ?
          WHERE changes() > 0
          ON CONFLICT(room_id, user_email) DO UPDATE SET
            display_name = excluded.display_name,
            review_token = COALESCE(room_members.review_token, excluded.review_token),
            status = 'approved'
          WHERE room_members.status <> 'approved'
        `).bind(id, auth.email, auth.displayName, token(), now),
      ]);
      if (!reservedInvite.meta.changes || !accepted.meta.changes) {
        return json({ error: "주문방이 마감되었거나 정원이 모두 찼습니다." }, 409);
      }
      return json({ ok: true, roomId: id });
    }

    if (action === "send_message") {
      const membership = await roomForUser(id, auth.email);
      if (!membership || membership.my_status !== "approved") {
        return json({ error: "승인된 구성원만 채팅할 수 있습니다." }, 403);
      }
      if (Number(membership.closes_at) < Date.now() - recentRoomWindowMs) {
        return json({ error: "보관 기간이 지난 주문방에는 메시지를 보낼 수 없습니다." }, 410);
      }
      const body = String(payload.body || "").trim().slice(0, 1000);
      if (!body) return json({ error: "메시지를 입력해 주세요." }, 400);
      const now = Date.now();
      const recentMessages = await env.DB.prepare(`
        SELECT COUNT(*) AS count, MAX(created_at) AS latest
        FROM room_messages
        WHERE room_id = ? AND sender_email = ? AND created_at > ?
      `).bind(id, auth.email, now - 60_000).first<{ count: number; latest: number | null }>();
      if (
        Number(recentMessages?.count || 0) >= 30
        || (recentMessages?.latest != null && now - Number(recentMessages.latest) < 750)
      ) {
        return json({ error: "메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 시도해주세요." }, 429, {
          "Retry-After": "1",
        });
      }
      await env.DB.prepare(`
        INSERT INTO room_messages (id, room_id, sender_email, sender_name, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(`msg_${crypto.randomUUID()}`, id, auth.email, auth.displayName, body, now).run();
      return json({ ok: true }, 201);
    }

    return json({ error: "지원하지 않는 요청입니다." }, 400);
  } catch (error) {
    return serverError("Failed to mutate SIKGU data", error);
  }
}
