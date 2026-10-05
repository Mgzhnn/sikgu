import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { maskDisplayName } from "../../name-mask.mjs";
import { json } from "./responses";
import {
  cleanText,
  isPickupId,
  isRestaurantId,
  maxDisplayNameCharacters,
  parseDeliveryApps,
} from "../../sikgu-rules.mjs";

export type AuthUser = {
  email: string;
  displayName: string;
};

export type UploadObject = {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: {
    contentType?: string;
  };
};

export type UploadBucket = {
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

/** The room row loaded once by the POST dispatcher for every action after `request_join`. */
export type RoomSummary = { host_email: string; capacity: number; status: string; closes_at: number; extensions: number };

/** A parsed JSON request body; every field is validated by the handler that reads it. */
export type Payload = Record<string, unknown>;

export const maxReceiptBytes = 8 * 1024 * 1024;
export const maxJsonBytes = 32 * 1024;
export const maxOpenRoomsPerHost = 5;
export const recentRoomWindowMs = 30 * 24 * 60 * 60 * 1000;
export const receiptUploadCooldownMs = 30 * 1000;
export const mutationLockTimeoutMs = 2 * 60 * 1000;
export const maxAmountWon = 10_000_000;
/** Recruitment extensions: +15 minutes, at most twice, until 10 minutes after the deadline. */
export const maxExtensions = 2;
export const extensionMs = 15 * 60 * 1000;
export const extensionGraceMs = 10 * 60 * 1000;
/** Join requests per user across all rooms, enforced inside the INSERT. */
export const maxJoinRequestsPerWindow = 10;
export const joinRequestWindowMs = 10 * 60 * 1000;
export const receiptTypes = new Set(["image/png"]);
export function uploadBucket() {
  const bucket = (env as unknown as { UPLOADS?: UploadBucket }).UPLOADS;
  if (!bucket) throw new Error("영수증 저장소가 연결되지 않았습니다.");
  return bucket;
}

export function isRetryableD1ReadError(error: unknown) {
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

export async function withD1ReadRetry<T>(read: () => Promise<T>) {
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

export function sameOrigin(request: Request) {
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

export function contentLength(request: Request) {
  const raw = request.headers.get("content-length");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function displayName(user: { email: string; fullName: string | null; displayName: string }) {
  // The platform name is attacker-controlled (their own profile): strip the
  // same control and format characters as any other text and bound it, since
  // it is copied into every room, member, and message row the user touches.
  const candidate = cleanText(user.fullName, maxDisplayNameCharacters)
    || cleanText(user.displayName, maxDisplayNameCharacters);
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

export async function optionalUser(): Promise<AuthUser | null> {
  const user = await getChatGPTUser();
  return user
    ? { email: user.email.trim().toLowerCase(), displayName: maskDisplayName(await displayName(user)) }
    : null;
}

export async function requiredUser(): Promise<AuthUser | Response> {
  const user = await optionalUser();
  return user || json({
    error: "로그인이 필요합니다.",
    signInPath: "/signin-with-chatgpt?return_to=/",
  }, 401);
}

/** A JSON field expected to hold a string; anything else (including objects
 * whose toString throws inside String()) is treated as absent. */
export function textField(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** A JSON field expected to hold a number; numeric strings are accepted, nothing else. */
export function numberField(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

export function isResponse(value: AuthUser | Response): value is Response {
  return value instanceof Response;
}

export function serverError(context: string, error: unknown) {
  const reference = crypto.randomUUID();
  // One JSON line per failure so the platform log viewer can be searched by
  // the reference the user sees. Errors here never contain identities: D1
  // messages carry no bound values and nothing logs request bodies.
  console.error(JSON.stringify({
    level: "error",
    reference,
    context,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) },
  }));
  return json({ error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.", reference }, 500);
}

export function roomId() {
  return `room_${crypto.randomUUID()}`;
}

/**
 * Accepts a datetime-local value (YYYY-MM-DDTHH:mm) only if every component
 * round-trips: Date.parse alone normalizes "2024-02-30" to March 1 and accepts
 * "24:00", which the host's own date control then refuses to display.
 */
export function isRealLocalDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute;
}

export function publicDisplayName(value: unknown) {
  const name = String(value || "").trim();
  return name.includes("@") ? "사용자" : maskDisplayName(name);
}

export async function roomForUser(id: string, email: string) {
  return withD1ReadRetry(() => env.DB.prepare(`
    SELECT r.*, m.role AS my_role, m.status AS my_status
    FROM rooms r
    JOIN room_members m ON m.room_id = r.id AND m.user_email = ?
    WHERE r.id = ? AND r.status = 'open'
  `).bind(email, id).first<Record<string, unknown>>());
}

export async function approvedCount(id: string) {
  const row = await withD1ReadRetry(() => env.DB.prepare(
    "SELECT COUNT(*) AS count FROM room_members WHERE room_id = ? AND status = 'approved'",
  ).bind(id).first<{ count: number }>());
  return Number(row?.count || 0);
}

/**
 * `rooms.total` is the sum of approved members' amounts. It is recomputed in
 * the same batch as any write that changes an amount or the approved set, so
 * the feed, the sort by remaining amount and the room all read one number.
 */
export function syncRoomTotal(id: string) {
  return env.DB.prepare(`
    UPDATE rooms
    SET total = (
      SELECT COALESCE(SUM(amount), 0) FROM room_members
      WHERE room_id = ? AND status = 'approved'
    )
    WHERE id = ?
  `).bind(id, id);
}

export function serializeRoom(row: Record<string, unknown>, includeOrderInfo = false) {
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
    // Only the host sees how many requests are waiting; everyone else gets 0.
    pendingCount: row.host_email === row.current_email ? Number(row.pending_count || 0) : 0,
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
    extensions: Number(row.extensions || 0),
  };
}

export function isUsableRoom(room: ReturnType<typeof serializeRoom>) {
  return isRestaurantId(room.restaurantId)
    && isPickupId(room.pickup)
    && room.apps.length > 0;
}
