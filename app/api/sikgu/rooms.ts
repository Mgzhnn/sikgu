import { env } from "cloudflare:workers";
import { databaseNow, json, token } from "./responses";
import {
  approvedCount,
  extensionGraceMs,
  extensionMs,
  joinRequestWindowMs,
  maxAmountWon,
  maxExtensions,
  maxJoinRequestsPerWindow,
  maxOpenRoomsPerHost,
  numberField,
  recentRoomWindowMs,
  roomForUser,
  roomId,
  syncRoomTotal,
  textField,
  withD1ReadRetry,
  type AuthUser,
  type Payload,
  type RoomSummary,
} from "./shared";
import {
  cleanText,
  isPickupId,
  isRestaurantId,
  maxRoomNoteCharacters,
  parseDeliveryApps,
  pickupFullNames,
  restaurantMinimums,
  roomCapacities,
  roomDurations,
} from "../../sikgu-rules.mjs";

export async function createRoom(auth: AuthUser, payload: Payload) {
  const now = Date.now();
  const capacity = numberField(payload.capacity);
  const apps = parseDeliveryApps(payload.apps);
  const restaurantId = textField(payload.restaurantId);
  const pickup = textField(payload.pickup);
  const minutes = numberField(payload.minutes);
  const membership = payload.membership === "baemin" || payload.membership === "coupang"
    ? payload.membership
    : "";
  if (!isRestaurantId(restaurantId) || !isPickupId(pickup) || !apps.length) {
    return json({ error: "가게, 픽업 장소, 주문 앱을 확인해 주세요." }, 400);
  }
  if (!roomCapacities.includes(capacity)) {
    return json({
      error: `모집 인원은 ${roomCapacities[0]}명부터 ${roomCapacities[roomCapacities.length - 1]}명까지 선택할 수 있습니다.`,
    }, 400);
  }
  // The deadline is computed here from the shared preset list: a client
  // timestamp would tie the room's life to the phone's clock (a fast
  // clock rejected valid presets, a slow one shortened every room) and
  // let a hand-crafted request pick any length.
  if (!roomDurations.includes(minutes)) {
    return json({
      error: `모집 시간은 ${roomDurations.map((value) => `${value}분`).join(", ")} 중에서 선택할 수 있습니다.`,
    }, 400);
  }
  const closesAt = now + minutes * 60 * 1000;
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
      cleanText(payload.note, maxRoomNoteCharacters) || "같이 맛있게 먹어요!",
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

export async function requestJoin(auth: AuthUser, id: string) {
  const room = await env.DB.prepare(
    "SELECT capacity, status, closes_at FROM rooms WHERE id = ?",
  ).bind(id).first<{ capacity: number; status: string; closes_at: number }>();
  if (!room) return json({ error: "주문방을 찾을 수 없습니다." }, 404);
  if (room.status !== "open" || room.closes_at <= Date.now()) {
    return json({ error: "참여할 수 없는 주문방입니다." }, 409);
  }
  if (await approvedCount(id) >= room.capacity) {
    return json({ error: "주문방 정원이 모두 찼습니다." }, 409);
  }
  const joined = await env.DB.prepare(`
        INSERT INTO room_members (
          room_id, user_email, display_name, role, status, review_token, created_at
        )
        SELECT ?, ?, ?, 'member', 'requested', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM rooms r WHERE r.id = ? AND r.status = 'open'
            AND r.closes_at > ${databaseNow}
            AND (SELECT COUNT(*) FROM room_members m
              WHERE m.room_id = r.id AND m.status = 'approved') < r.capacity
        )
        AND (
          SELECT COUNT(*) FROM room_members recent
          WHERE recent.user_email = ? AND recent.created_at > ?
        ) < ?
        ON CONFLICT(room_id, user_email) DO UPDATE SET
          display_name = excluded.display_name,
          review_token = COALESCE(room_members.review_token, excluded.review_token),
          status = CASE WHEN room_members.status = 'approved' THEN 'approved' ELSE 'requested' END
      `).bind(
    id, auth.email, auth.displayName, token(), Date.now(), id,
    auth.email, Date.now() - joinRequestWindowMs, maxJoinRequestsPerWindow,
  ).run();
  if (!joined.meta.changes) {
    const recent = await withD1ReadRetry(() => env.DB.prepare(
      "SELECT COUNT(*) AS count FROM room_members WHERE user_email = ? AND created_at > ?",
    ).bind(auth.email, Date.now() - joinRequestWindowMs).first<{ count: number }>());
    if (Number(recent?.count || 0) >= maxJoinRequestsPerWindow) {
      return json({ error: "참여 신청이 너무 많아요. 잠시 후 다시 시도해주세요." }, 429, { "Retry-After": "600" });
    }
    return json({ error: "주문방이 마감되었거나 정원이 모두 찼습니다." }, 409);
  }
  const membership = await roomForUser(id, auth.email);
  return json({ status: membership?.my_status || "requested" });
}

/** The room row every later action checks; the dispatcher answers 404 when it is missing. */
export function roomForAction(id: string) {
  return env.DB.prepare(
    "SELECT host_email, capacity, status, closes_at, extensions FROM rooms WHERE id = ?",
  ).bind(id).first<RoomSummary>();
}

export async function reviewMember(auth: AuthUser, id: string, room: RoomSummary, payload: Payload) {
  if (room.host_email !== auth.email) return json({ error: "방장만 참여자를 선택할 수 있습니다." }, 403);
  const memberRef = textField(payload.memberRef);
  if (!/^[a-f0-9]{32,48}$/.test(memberRef)) {
    return json({ error: "참여자 정보를 확인해 주세요." }, 400);
  }
  const decision = textField(payload.decision);
  if (decision === "approve") {
    // Only approval is tied to the deadline; a host must always be able to
    // clear a pending request, otherwise the row lingers until retention.
    if (room.status !== "open" || room.closes_at <= Date.now()) {
      return json({ error: "마감된 주문방에서는 참여자를 변경할 수 없습니다." }, 409);
    }
    const [result] = await env.DB.batch([
      env.DB.prepare(`
          UPDATE room_members SET status = 'approved'
          WHERE room_id = ? AND review_token = ? AND status = 'requested'
            AND EXISTS (SELECT 1 FROM rooms r
              WHERE r.id = room_members.room_id AND r.host_email = ?
                AND r.status = 'open' AND r.closes_at > ${databaseNow})
            AND (
              SELECT COUNT(*) FROM room_members
              WHERE room_id = ? AND status = 'approved'
            ) < ?
        `).bind(id, memberRef, auth.email, id, room.capacity),
      // An explicit approval lifts any earlier removal or rejection.
      env.DB.prepare(`
            DELETE FROM room_blocks
            WHERE changes() > 0 AND room_id = ? AND user_email = (
              SELECT user_email FROM room_members WHERE room_id = ? AND review_token = ?
            )
          `).bind(id, id, memberRef),
      syncRoomTotal(id),
    ]);
    if (!result.meta.changes) {
      return json({ error: "신청을 찾을 수 없거나 주문방 정원이 모두 찼습니다." }, 409);
    }
  } else if (decision === "reject") {
    // Record the rejection first so an invite link the requester already
    // holds cannot approve them without the host; then drop the request.
    const [, result] = await env.DB.batch([
      env.DB.prepare(`
            INSERT OR IGNORE INTO room_blocks (room_id, user_email, created_at)
            SELECT room_id, user_email, ? FROM room_members
            WHERE room_id = ? AND review_token = ? AND status = 'requested'
          `).bind(Date.now(), id, memberRef),
      env.DB.prepare(`
          DELETE FROM room_members
          WHERE room_id = ? AND review_token = ? AND status = 'requested'
        `).bind(id, memberRef),
      syncRoomTotal(id),
    ]);
    if (!result.meta.changes) return json({ error: "대기 중인 신청을 찾을 수 없습니다." }, 404);
  } else {
    return json({ error: "승인 또는 거절을 선택해 주세요." }, 400);
  }
  return json({ ok: true });
}

export async function removeMember(auth: AuthUser, id: string, room: RoomSummary, payload: Payload) {
  if (room.host_email !== auth.email) return json({ error: "방장만 참여자를 내보낼 수 있습니다." }, 403);
  const memberRef = textField(payload.memberRef);
  if (!/^[a-f0-9]{32,48}$/.test(memberRef)) {
    return json({ error: "참여자 정보를 확인해 주세요." }, 400);
  }
  // Blocking closes the unattended path only: the removed member can still
  // request again, but an invite link they already hold no longer works.
  const [, result] = await env.DB.batch([
    env.DB.prepare(`
          INSERT OR IGNORE INTO room_blocks (room_id, user_email, created_at)
          SELECT room_id, user_email, ? FROM room_members
          WHERE room_id = ? AND review_token = ? AND role = 'member'
        `).bind(Date.now(), id, memberRef),
    env.DB.prepare(`
        DELETE FROM room_members
        WHERE room_id = ? AND review_token = ? AND role = 'member'
      `).bind(id, memberRef),
    syncRoomTotal(id),
  ]);
  if (!result.meta.changes) return json({ error: "참여자를 찾을 수 없습니다." }, 404);
  return json({ ok: true });
}

export async function leaveRoom(auth: AuthUser, id: string) {
  const membership = await roomForUser(id, auth.email);
  if (!membership) return json({ error: "참여 중인 주문방이 아닙니다." }, 404);
  if (membership.my_role === "host") {
    return json({ error: "방장은 주문방 삭제를 이용해주세요." }, 409);
  }
  await env.DB.batch([
    env.DB.prepare(`
          DELETE FROM room_members
          WHERE room_id = ? AND user_email = ? AND role = 'member'
        `).bind(id, auth.email),
    syncRoomTotal(id),
  ]);
  return json({ ok: true });
}

export async function setAmount(auth: AuthUser, id: string, room: RoomSummary, payload: Payload) {
  // What one member will order. The pooled total is the sum of these, so
  // the host never types it. The host may set a member's amount for them.
  const raw = payload.amount;
  const amount = raw === null || raw === undefined || raw === "" ? null : numberField(raw);
  if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount > maxAmountWon)) {
    return json({ error: "주문 금액은 0원부터 10,000,000원까지 입력할 수 있습니다." }, 400);
  }
  const memberRef = textField(payload.memberRef);
  if (memberRef) {
    if (room.host_email !== auth.email) return json({ error: "방장만 다른 참여자의 금액을 수정할 수 있습니다." }, 403);
    if (!/^[a-f0-9]{32,48}$/.test(memberRef)) return json({ error: "참여자 정보를 확인해 주세요." }, 400);
  }
  if (Number(room.closes_at) < Date.now() - recentRoomWindowMs) {
    return json({ error: "보관 기간이 지난 주문방은 수정할 수 없습니다." }, 410);
  }
  if (room.status !== "open") return json({ error: "다른 변경이 진행 중입니다. 잠시 후 다시 시도해주세요." }, 409);
  const [updated] = await env.DB.batch([
    env.DB.prepare(`
          UPDATE room_members SET amount = ?
          WHERE room_id = ? AND status = 'approved'
            AND ${memberRef ? "review_token = ?" : "user_email = ?"}
            AND EXISTS (
              SELECT 1 FROM rooms r WHERE r.id = room_members.room_id
                AND r.status = 'open' AND r.closes_at > ${databaseNow} - ?
            )
        `).bind(amount, id, memberRef || auth.email, recentRoomWindowMs),
    syncRoomTotal(id),
  ]);
  if (!updated.meta.changes) {
    return json(
      { error: memberRef ? "참여 확정된 구성원을 찾을 수 없습니다." : "승인된 구성원만 주문 금액을 입력할 수 있습니다." },
      memberRef ? 404 : 403,
    );
  }
  const summed = await withD1ReadRetry(() => env.DB.prepare(
    "SELECT total FROM rooms WHERE id = ?",
  ).bind(id).first<{ total: number }>());
  return json({ ok: true, amount, total: Number(summed?.total || 0) });
}

export async function extendRoom(auth: AuthUser, id: string, room: RoomSummary) {
  if (room.host_email !== auth.email) return json({ error: "방장만 모집 시간을 연장할 수 있습니다." }, 403);
  // +15 minutes from the later of the current deadline and now, at most
  // twice, and only until 10 minutes after the deadline. Every bound is
  // inside the UPDATE with the database clock. Live invite links follow
  // the new deadline.
  const [extended] = await env.DB.batch([
    env.DB.prepare(`
          UPDATE rooms
          SET closes_at = MAX(closes_at, ${databaseNow}) + ?, extensions = extensions + 1
          WHERE id = ? AND host_email = ? AND status = 'open'
            AND extensions < ? AND closes_at > ${databaseNow} - ?
        `).bind(extensionMs, id, auth.email, maxExtensions, extensionGraceMs),
    env.DB.prepare(`
          UPDATE room_invites
          SET expires_at = (SELECT closes_at FROM rooms WHERE id = ?)
          WHERE room_id = ? AND changes() > 0 AND uses < max_uses
        `).bind(id, id),
  ]);
  if (!extended.meta.changes) {
    if (Number(room.extensions) >= maxExtensions) {
      return json({ error: `모집 시간은 ${maxExtensions}번까지만 연장할 수 있습니다.` }, 409);
    }
    if (Number(room.closes_at) <= Date.now() - extensionGraceMs) {
      return json({ error: "마감 후 10분이 지나 연장할 수 없습니다. 새 주문방을 열어주세요." }, 409);
    }
    return json({ error: "모집 시간을 연장하지 못했습니다. 잠시 후 다시 시도해주세요." }, 409);
  }
  const after = await withD1ReadRetry(() => env.DB.prepare(
    "SELECT closes_at, extensions FROM rooms WHERE id = ?",
  ).bind(id).first<{ closes_at: number; extensions: number }>());
  return json({ ok: true, closesAt: Number(after?.closes_at), extensions: Number(after?.extensions || 0) });
}

export async function closeRecruitment(auth: AuthUser, id: string, room: RoomSummary) {
  if (room.host_email !== auth.email) return json({ error: "방장만 모집을 마감할 수 있습니다." }, 403);
  // The deadline moves to now: the room leaves the feed and refuses new
  // requests, approvals and invites, while chat, amounts and receipts stay
  // open for the retention window as after any deadline.
  const [closed] = await env.DB.batch([
    env.DB.prepare(`
          UPDATE rooms SET closes_at = ${databaseNow}
          WHERE id = ? AND host_email = ? AND status = 'open' AND closes_at > ${databaseNow}
        `).bind(id, auth.email),
    env.DB.prepare(`
          UPDATE room_invites
          SET expires_at = (SELECT closes_at FROM rooms WHERE id = ?)
          WHERE room_id = ? AND changes() > 0
        `).bind(id, id),
  ]);
  if (!closed.meta.changes) return json({ error: "이미 마감된 주문방입니다." }, 409);
  const after = await withD1ReadRetry(() => env.DB.prepare(
    "SELECT closes_at FROM rooms WHERE id = ?",
  ).bind(id).first<{ closes_at: number }>());
  return json({ ok: true, closesAt: Number(after?.closes_at) });
}

export async function acceptInvite(auth: AuthUser, id: string, payload: Payload) {
  const inviteToken = textField(payload.token);
  // Tokens are always lowercase hex; a case-insensitive check let uppercase
  // input pass and then fail the exact SQL match as "expired".
  if (!/^[a-f0-9]{48}$/.test(inviteToken)) {
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
            AND expires_at > ${databaseNow} AND uses < max_uses
            AND EXISTS (
              SELECT 1
              FROM rooms r
              WHERE r.id = room_invites.room_id
                AND r.status = 'open' AND r.closes_at > ${databaseNow}
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
            AND NOT EXISTS (
              SELECT 1 FROM room_blocks blocked
              WHERE blocked.room_id = room_invites.room_id AND blocked.user_email = ?
            )
        `).bind(inviteToken, id, auth.email, auth.email),
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
