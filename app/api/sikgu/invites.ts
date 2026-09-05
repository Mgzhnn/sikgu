import {json, token, databaseNow} from "./responses";

/** Called after request authentication/validation; SQL rechecks current host, room and capacity. */
export async function createRoomInvite({db,id,hostEmail,room,approvedCount}: {
  db: D1Database;
  id: string;
  hostEmail: string;
  room: {host_email:string; capacity:number; status:string; closes_at:number};
  approvedCount: (id:string)=>Promise<number>;
}) {
  if (room.host_email !== hostEmail) return json({ error: "방장만 초대 링크를 만들 수 있습니다." }, 403);
  const now = Date.now();
  if (room.status !== "open" || room.closes_at <= now) {
    return json({ error: "마감된 주문방에서는 초대 링크를 만들 수 없습니다." }, 409);
  }
  const approved = await approvedCount(id);
  if (approved >= room.capacity) return json({ error: "주문방 정원이 모두 찼습니다." }, 409);
  const inviteToken = token();
  const remaining = room.capacity - approved;
  // The active-invite cap lives inside the INSERT so parallel requests
  // cannot all pass a separate COUNT check.
  const [, inserted] = await db.batch([
    db.prepare("DELETE FROM room_invites WHERE room_id = ? AND (expires_at <= ? OR uses >= max_uses)").bind(id, now),
    db.prepare(`
      INSERT INTO room_invites (
        token, room_id, created_by_email, max_uses, uses, expires_at, created_at
      )
      SELECT ?, ?, ?, ?, 0, ?, ?
      WHERE (SELECT COUNT(*) FROM room_invites WHERE room_id = ? AND expires_at > ?) < 5
        AND EXISTS (SELECT 1 FROM rooms r WHERE r.id = ? AND r.host_email = ?
          AND r.status = 'open' AND r.closes_at > ${databaseNow}
          AND (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id AND m.status = 'approved') < r.capacity)
    `).bind(inviteToken, id, hostEmail, remaining, room.closes_at, now, id, now, id, hostEmail),
  ]);
  if (!inserted.meta.changes) {
    // At the bounded cap, recover a usable link instead of stranding a
    // host who closed the sheet or lost clipboard access. Only the host
    // reaches this path; tokens never enter the public room response.
    const existing = await db.prepare(`
      SELECT i.token, MIN(i.expires_at, r.closes_at) AS expiresAt
      FROM room_invites i JOIN rooms r ON r.id = i.room_id
      WHERE i.room_id = ? AND r.host_email = ? AND r.status = 'open'
        AND r.closes_at > ${databaseNow} AND i.expires_at > ${databaseNow}
        AND i.uses < i.max_uses
        AND (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id AND m.status = 'approved') < r.capacity
      ORDER BY i.created_at DESC, i.token DESC LIMIT 1
    `).bind(id, hostEmail).first<{token: string; expiresAt: number}>();
    if (existing) return json({ ...existing, reused: true });
    return json({ error: "사용 가능한 초대 링크가 없거나 정원이 모두 찼습니다." }, 409);
  }
  return json({ token: inviteToken, expiresAt: room.closes_at, reused: false });
}
