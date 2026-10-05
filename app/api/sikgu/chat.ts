import { env } from "cloudflare:workers";
import { databaseNow, json } from "./responses";
import { recentRoomWindowMs, roomForUser, type AuthUser, type Payload } from "./shared";
import { cleanText, maxChatMessageCharacters } from "../../sikgu-rules.mjs";

export async function sendMessage(auth: AuthUser, id: string, payload: Payload) {
  const membership = await roomForUser(id, auth.email);
  if (!membership || membership.my_status !== "approved") {
    return json({ error: "승인된 구성원만 채팅할 수 있습니다." }, 403);
  }
  if (Number(membership.closes_at) < Date.now() - recentRoomWindowMs) {
    return json({ error: "보관 기간이 지난 주문방에는 메시지를 보낼 수 없습니다." }, 410);
  }
  const body = cleanText(payload.body, maxChatMessageCharacters);
  if (!body) return json({ error: "메시지를 입력해 주세요." }, 400);
  const now = Date.now();
  // Both rate-limit predicates live inside the INSERT so that parallel
  // sends cannot all pass a separate SELECT: at most 30 per minute and at
  // least 750 ms between messages from one member in one room.
  const inserted = await env.DB.prepare(`
        INSERT INTO room_messages (id, room_id, sender_email, sender_name, body, created_at)
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM room_members m JOIN rooms r ON r.id = m.room_id
          WHERE m.room_id = ? AND m.user_email = ? AND m.status = 'approved'
            AND r.status = 'open' AND r.closes_at > ${databaseNow} - ?
        ) AND (
          SELECT COUNT(*) FROM room_messages
          WHERE room_id = ? AND sender_email = ? AND created_at > ?
        ) < 30
        AND COALESCE((
          SELECT MAX(created_at) FROM room_messages
          WHERE room_id = ? AND sender_email = ?
        ), 0) <= ?
      `).bind(
    `msg_${crypto.randomUUID()}`, id, auth.email, auth.displayName, body, now,
    id, auth.email, recentRoomWindowMs,
    id, auth.email, now - 60_000,
    id, auth.email, now - 750,
  ).run();
  if (!inserted.meta.changes) {
    const current = await roomForUser(id, auth.email);
    if (!current || current.my_status !== 'approved' || Number(current.closes_at) <= Date.now() - recentRoomWindowMs) {
      return json({ error: "이 주문방에 메시지를 보낼 수 없습니다." }, 403);
    }
    return json({ error: "메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 시도해주세요." }, 429, {
      "Retry-After": "1",
    });
  }
  return json({ ok: true }, 201);
}
