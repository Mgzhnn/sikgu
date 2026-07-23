import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { maskDisplayName } from "../../name-mask.mjs";

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
  delete: (key: string) => Promise<void>;
};

const maxReceiptBytes = 8 * 1024 * 1024;
const receiptTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const json = (data: unknown, status = 200) => Response.json(data, { status });

function uploadBucket() {
  const bucket = (env as unknown as { UPLOADS?: UploadBucket }).UPLOADS;
  if (!bucket) throw new Error("영수증 저장소가 연결되지 않았습니다.");
  return bucket;
}

function detectReceiptType(bytes: Uint8Array) {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

function receiptExtension(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function displayName(user: { email: string; fullName: string | null; displayName: string }) {
  return user.fullName?.trim() || user.displayName?.trim() || user.email.split("@")[0];
}

async function optionalUser(): Promise<AuthUser | null> {
  const user = await getChatGPTUser();
  return user
    ? { email: user.email.toLowerCase(), displayName: maskDisplayName(displayName(user)) }
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

function roomId() {
  return `room_${crypto.randomUUID()}`;
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function roomForUser(id: string, email: string) {
  return env.DB.prepare(`
    SELECT r.*, m.role AS my_role, m.status AS my_status
    FROM rooms r
    JOIN room_members m ON m.room_id = r.id AND m.user_email = ?
    WHERE r.id = ?
  `).bind(email, id).first<Record<string, unknown>>();
}

async function approvedCount(id: string) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM room_members WHERE room_id = ? AND status = 'approved'",
  ).bind(id).first<{ count: number }>();
  return Number(row?.count || 0);
}

function serializeRoom(row: Record<string, unknown>, includeOrderInfo = false) {
  const room = {
    id: String(row.id),
    restaurantId: String(row.restaurant_id),
    host: maskDisplayName(String(row.host_name)),
    pickup: String(row.pickup),
    pickupFull: String(row.pickup_full),
    closesAt: Number(row.closes_at),
    total: Number(row.total),
    target: Number(row.target),
    people: Number(row.people || 1),
    capacity: Number(row.capacity),
    apps: JSON.parse(String(row.apps || "[]")),
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
      if (!room || room.my_status !== "approved") {
        return json({ error: "승인된 주문방 구성원만 영수증을 볼 수 있습니다." }, 403);
      }
      const receiptKey = String(room.receipt_key || "");
      if (!receiptKey) return json({ error: "등록된 영수증이 없습니다." }, 404);
      const object = await uploadBucket().get(receiptKey);
      if (!object) return json({ error: "영수증 이미지를 찾을 수 없습니다." }, 404);
      return new Response(object.body, {
        headers: {
          "Content-Type": String(room.receipt_content_type || object.httpMetadata?.contentType || "application/octet-stream"),
          "Content-Disposition": `inline; filename="receipt.${receiptExtension(String(room.receipt_content_type || ""))}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    }

    if (action === "bootstrap") {
      const email = user?.email || "";
      const result = await env.DB.prepare(`
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
      `).bind(email, email, Date.now()).all<Record<string, unknown>>();

      return json({
        user,
        rooms: result.results.map(serializeRoom),
      });
    }

    if (action === "room") {
      const auth = await requiredUser();
      if (isResponse(auth)) return auth;
      const id = url.searchParams.get("roomId") || "";
      const room = await roomForUser(id, auth.email);
      if (!room || room.my_status !== "approved") {
        return json({ error: "초대되거나 승인된 구성원만 이 주문방을 볼 수 있습니다." }, 403);
      }
      const isHost = room.host_email === auth.email;
      const members = await env.DB.prepare(`
        SELECT user_email, display_name, role, status, created_at
        FROM room_members
        WHERE room_id = ? ${isHost ? "" : "AND status = 'approved'"}
        ORDER BY CASE status WHEN 'requested' THEN 0 ELSE 1 END, created_at ASC
      `).bind(id).all();
      const messages = await env.DB.prepare(`
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
      `).bind(auth.email, id).all();
      return json({
        room: { ...serializeRoom({ ...room, current_email: auth.email, people: await approvedCount(id) }, true), isHost },
        members: members.results.map((member) => isHost
          ? { ...member, display_name: maskDisplayName(String(member.display_name)) }
          : {
              display_name: maskDisplayName(String(member.display_name)),
              role: member.role,
              status: member.status,
              created_at: member.created_at,
            }),
        messages: messages.results.map((message) => ({
          ...message,
          sender_name: maskDisplayName(String(message.sender_name)),
        })),
      });
    }

    return json({ error: "지원하지 않는 요청입니다." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, 500);
  }
}

export async function PUT(request: Request) {
  let newReceiptKey = "";
  try {
    if (!sameOrigin(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > maxReceiptBytes + 1024 * 1024) {
      return json({ error: "영수증 이미지는 8MB 이하만 올릴 수 있습니다." }, 413);
    }

    const auth = await requiredUser();
    if (isResponse(auth)) return auth;
    const form = await request.formData();
    const action = String(form.get("action") || "");
    const id = String(form.get("roomId") || "");
    if (action !== "update_order_info" || !id) {
      return json({ error: "주문 정보 요청을 확인해주세요." }, 400);
    }

    const room = await env.DB.prepare(
      "SELECT host_email, receipt_key FROM rooms WHERE id = ?",
    ).bind(id).first<{ host_email: string; receipt_key: string | null }>();
    if (!room) return json({ error: "주문방을 찾을 수 없습니다." }, 404);
    if (room.host_email !== auth.email) {
      return json({ error: "방장만 주문 정보를 수정할 수 있습니다." }, 403);
    }

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

    const receipt = form.get("receipt");
    if (receipt !== null && !(receipt instanceof File)) {
      return json({ error: "영수증 이미지 형식을 확인해주세요." }, 400);
    }
    let receiptContentType = "";
    let receiptUploadedAt: number | null = null;
    if (receipt instanceof File && receipt.size > 0) {
      if (receipt.size > maxReceiptBytes) {
        return json({ error: "영수증 이미지는 8MB 이하만 올릴 수 있습니다." }, 413);
      }
      if (!receiptTypes.has(receipt.type)) {
        return json({ error: "영수증은 JPG, PNG, WebP 이미지로 올려주세요." }, 415);
      }
      const receiptBuffer = await receipt.arrayBuffer();
      const detectedType = detectReceiptType(new Uint8Array(receiptBuffer));
      if (!detectedType || detectedType !== receipt.type) {
        return json({ error: "이미지 파일의 형식을 확인할 수 없습니다." }, 415);
      }

      receiptContentType = detectedType;
      receiptUploadedAt = Date.now();
      const extension = receiptExtension(detectedType);
      newReceiptKey = `receipts/${id}/${crypto.randomUUID()}.${extension}`;
      await uploadBucket().put(newReceiptKey, receiptBuffer, {
        httpMetadata: {
          contentType: detectedType,
          contentDisposition: `inline; filename="receipt.${extension}"`,
          cacheControl: "private, no-store",
        },
      });
    }

    try {
      if (newReceiptKey) {
        await env.DB.prepare(`
          UPDATE rooms
          SET estimated_arrival = ?, order_total = ?, receipt_key = ?,
              receipt_content_type = ?, receipt_uploaded_at = ?
          WHERE id = ? AND host_email = ?
        `).bind(
          estimatedArrival || null,
          orderTotal,
          newReceiptKey,
          receiptContentType,
          receiptUploadedAt,
          id,
          auth.email,
        ).run();
      } else {
        await env.DB.prepare(`
          UPDATE rooms
          SET estimated_arrival = ?, order_total = ?
          WHERE id = ? AND host_email = ?
        `).bind(estimatedArrival || null, orderTotal, id, auth.email).run();
      }
    } catch (databaseError) {
      if (newReceiptKey) await uploadBucket().delete(newReceiptKey).catch(() => undefined);
      throw databaseError;
    }

    if (newReceiptKey && room.receipt_key && room.receipt_key !== newReceiptKey) {
      await uploadBucket().delete(room.receipt_key).catch(() => undefined);
    }
    return json({ ok: true, receiptUploadedAt });
  } catch (error) {
    if (newReceiptKey) {
      await uploadBucket().delete(newReceiptKey).catch(() => undefined);
    }
    console.error("Failed to update private order information", error);
    return json({ error: "주문 정보를 저장하지 못했습니다." }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
    const auth = await requiredUser();
    if (isResponse(auth)) return auth;
    const url = new URL(request.url);
    const id = url.searchParams.get("roomId") || "";
    if (!id) return json({ error: "주문방 정보가 없습니다." }, 400);

    const room = await env.DB.prepare(
      "SELECT host_email, receipt_key FROM rooms WHERE id = ?",
    ).bind(id).first<{ host_email: string; receipt_key: string | null }>();
    if (!room) return json({ error: "주문방을 찾을 수 없습니다." }, 404);
    if (room.host_email !== auth.email) {
      return json({ error: "방장만 주문방을 삭제할 수 있습니다." }, 403);
    }

    await env.DB.batch([
      env.DB.prepare("DELETE FROM room_messages WHERE room_id = ?").bind(id),
      env.DB.prepare("DELETE FROM room_invites WHERE room_id = ?").bind(id),
      env.DB.prepare("DELETE FROM room_members WHERE room_id = ?").bind(id),
      env.DB.prepare("DELETE FROM rooms WHERE id = ? AND host_email = ?").bind(id, auth.email),
    ]);
    if (room.receipt_key) {
      await uploadBucket().delete(room.receipt_key).catch(() => undefined);
    }
    return json({ ok: true });
  } catch (error) {
    console.error("Failed to delete private order room", error);
    return json({ error: "주문방을 삭제하지 못했습니다." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
    const auth = await requiredUser();
    if (isResponse(auth)) return auth;
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action || "");

    if (action === "create_room") {
      const capacity = Math.min(8, Math.max(2, Number(payload.capacity || 4)));
      const apps = Array.isArray(payload.apps)
        ? payload.apps.filter((item) => item === "baemin" || item === "coupang")
        : [];
      if (!payload.restaurantId || !payload.pickup || !apps.length) {
        return json({ error: "가게, 픽업 장소, 주문 앱을 확인해 주세요." }, 400);
      }
      const id = roomId();
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO rooms (
            id, host_email, host_name, restaurant_id, pickup, pickup_full, apps,
            closes_at, total, target, capacity, membership, note, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
        `).bind(
          id,
          auth.email,
          auth.displayName,
          String(payload.restaurantId),
          String(payload.pickup),
          String(payload.pickupFull),
          JSON.stringify(apps),
          Number(payload.closesAt),
          Number(payload.total || 0),
          Number(payload.target),
          capacity,
          String(payload.membership || ""),
          String(payload.note || "같이 맛있게 먹어요!").slice(0, 300),
          now,
        ),
        env.DB.prepare(`
          INSERT INTO room_members (room_id, user_email, display_name, role, status, created_at)
          VALUES (?, ?, ?, 'host', 'approved', ?)
        `).bind(id, auth.email, auth.displayName, now),
      ]);
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
        INSERT INTO room_members (room_id, user_email, display_name, role, status, created_at)
        VALUES (?, ?, ?, 'member', 'requested', ?)
        ON CONFLICT(room_id, user_email) DO UPDATE SET
          display_name = excluded.display_name,
          status = CASE WHEN room_members.status = 'approved' THEN 'approved' ELSE 'requested' END
      `).bind(id, auth.email, auth.displayName, Date.now()).run();
      return json({ status: "requested" });
    }

    const room = await env.DB.prepare(
      "SELECT host_email, capacity, status FROM rooms WHERE id = ?",
    ).bind(id).first<{ host_email: string; capacity: number; status: string }>();
    if (!room) return json({ error: "주문방을 찾을 수 없습니다." }, 404);

    if (action === "review_member") {
      if (room.host_email !== auth.email) return json({ error: "방장만 참여자를 선택할 수 있습니다." }, 403);
      const memberEmail = String(payload.memberEmail || "").toLowerCase();
      const decision = String(payload.decision || "");
      if (decision === "approve") {
        if (await approvedCount(id) >= room.capacity) {
          return json({ error: "주문방 정원이 모두 찼습니다." }, 409);
        }
        await env.DB.prepare(`
          UPDATE room_members SET status = 'approved'
          WHERE room_id = ? AND user_email = ? AND status = 'requested'
        `).bind(id, memberEmail).run();
      } else if (decision === "reject") {
        await env.DB.prepare(`
          DELETE FROM room_members
          WHERE room_id = ? AND user_email = ? AND status = 'requested'
        `).bind(id, memberEmail).run();
      } else {
        return json({ error: "승인 또는 거절을 선택해 주세요." }, 400);
      }
      return json({ ok: true });
    }

    if (action === "create_invite") {
      if (room.host_email !== auth.email) return json({ error: "방장만 초대 링크를 만들 수 있습니다." }, 403);
      const inviteToken = token();
      const remaining = Math.max(1, room.capacity - await approvedCount(id));
      await env.DB.prepare(`
        INSERT INTO room_invites (
          token, room_id, created_by_email, max_uses, uses, expires_at, created_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?)
      `).bind(inviteToken, id, auth.email, remaining, Date.now() + 24 * 60 * 60 * 1000, Date.now()).run();
      return json({ token: inviteToken, expiresInHours: 24 });
    }

    if (action === "accept_invite") {
      const inviteToken = String(payload.token || "");
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
      if (!invite || invite.expires_at <= Date.now() || invite.uses >= invite.max_uses) {
        return json({ error: "초대 링크가 만료되었거나 사용할 수 없습니다." }, 410);
      }
      const existingMember = await roomForUser(id, auth.email);
      if (existingMember?.my_status === "approved") {
        return json({ ok: true, roomId: id });
      }
      if (invite.status !== "open" || invite.closes_at <= Date.now() || await approvedCount(id) >= invite.capacity) {
        return json({ error: "주문방이 마감되었거나 정원이 모두 찼습니다." }, 409);
      }
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO room_members (room_id, user_email, display_name, role, status, created_at)
          VALUES (?, ?, ?, 'member', 'approved', ?)
          ON CONFLICT(room_id, user_email) DO UPDATE SET
            display_name = excluded.display_name,
            status = 'approved'
        `).bind(id, auth.email, auth.displayName, Date.now()),
        env.DB.prepare("UPDATE room_invites SET uses = uses + 1 WHERE token = ?").bind(inviteToken),
      ]);
      return json({ ok: true, roomId: id });
    }

    if (action === "send_message") {
      const membership = await roomForUser(id, auth.email);
      if (!membership || membership.my_status !== "approved") {
        return json({ error: "승인된 구성원만 채팅할 수 있습니다." }, 403);
      }
      const body = String(payload.body || "").trim().slice(0, 1000);
      if (!body) return json({ error: "메시지를 입력해 주세요." }, 400);
      await env.DB.prepare(`
        INSERT INTO room_messages (id, room_id, sender_email, sender_name, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(`msg_${crypto.randomUUID()}`, id, auth.email, auth.displayName, body, Date.now()).run();
      return json({ ok: true }, 201);
    }

    return json({ error: "지원하지 않는 요청입니다." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, 500);
  }
}
