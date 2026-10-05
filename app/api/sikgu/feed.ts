import { env } from "cloudflare:workers";
import { after } from "next/server";
import { json } from "./responses";
import { cursorWhere, decodeCursor, encodeCursor } from "./pagination";
import { purgeExpiredRooms } from "./retention";
import {
  approvedCount,
  isResponse,
  isUsableRoom,
  publicDisplayName,
  recentRoomWindowMs,
  requiredUser,
  roomForUser,
  serializeRoom,
  withD1ReadRetry,
  type AuthUser,
} from "./shared";
import { isPickupId, isRestaurantId } from "../../sikgu-rules.mjs";

/** GET ?action=room: the private room, its members and the latest chat page for an approved member. */
export async function readRoom(url: URL) {
  const auth = await requiredUser();
  if (isResponse(auth)) return auth;
  const id = url.searchParams.get("roomId") || "";
  const room = await roomForUser(id, auth.email);
  if (!room || room.my_status !== "approved" || room.status !== "open") {
    // A member who was removed and a room that is gone need different
    // messages: the sheet closes with the right one instead of offering
    // a retry that fails identically. Room ids are random UUIDs, so
    // confirming that one exists reveals nothing useful.
    const existing = id ? await withD1ReadRetry(() => env.DB.prepare(
      "SELECT status FROM rooms WHERE id = ?",
    ).bind(id).first<{ status: string }>()) : null;
    if (!existing || existing.status !== "open") {
      return json({ error: "삭제되었거나 더 이상 없는 주문방입니다.", code: "room_gone" }, 404);
    }
    return json({ error: "초대되거나 승인된 구성원만 이 주문방을 볼 수 있습니다.", code: "removed" }, 403);
  }
  if (Number(room.closes_at) < Date.now() - recentRoomWindowMs) {
    return json({ error: "보관 기간이 지난 주문방입니다." }, 410);
  }
  const isHost = room.host_email === auth.email;
  const loadMembers = () => withD1ReadRetry(() => env.DB.prepare(`
        SELECT review_token, display_name, role, status, created_at, amount,
          CASE WHEN user_email = ? THEN 1 ELSE 0 END AS mine
        FROM room_members
        WHERE room_id = ? ${isHost ? "" : "AND status = 'approved'"}
        ORDER BY CASE status WHEN 'requested' THEN 0 ELSE 1 END, created_at ASC
      `).bind(auth.email, id).all());
  const members = await loadMembers();
  const messageCursor=decodeCursor(url.searchParams.get("messagesCursor"));
  const messages = await withD1ReadRetry(() => env.DB.prepare(`
        SELECT id, sender_name, body, created_at,
          CASE WHEN sender_email = ? THEN 1 ELSE 0 END AS mine
        FROM room_messages
        WHERE room_id = ?
          ${messageCursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
        ORDER BY created_at DESC, id DESC LIMIT 201
      `).bind(auth.email,id,...(messageCursor?[messageCursor.value,messageCursor.value,messageCursor.id]:[])).all<Record<string,unknown>>());
  const nextMessagesCursor=messages.results.length>200?encodeCursor(messages.results[199]):null;
  messages.results=messages.results.slice(0,200).reverse();
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
      amount: member.amount == null ? null : Number(member.amount),
      mine: Number(member.mine || 0),
    })),
    nextMessagesCursor,
    messages: messages.results.map((message) => ({
      ...message,
      sender_name: publicDisplayName(message.sender_name),
    })),
  });
}

/** GET ?action=bootstrap: the public feed, the viewer's own rooms and the server clock. */
export async function bootstrap(url: URL, user: AuthUser | null) {
  const now = Date.now();
  // NULL never equals a stored email, so an anonymous viewer can never be
  // matched as a member or host.
  const email = user?.email || null;
  const sort = url.searchParams.get("sort");
  const sortColumn = sort === "deadline" ? "r.closes_at" : sort === "remaining" ? "MAX(0, r.target - r.total)" : "r.created_at";
  const sortDirection = sort === "deadline" || sort === "remaining" ? "ASC" : "DESC";
  const cursor = cursorWhere(decodeCursor(url.searchParams.get("roomsCursor")),sortColumn,sortDirection);
  const mineCursor = cursorWhere(decodeCursor(url.searchParams.get("myRoomsCursor")),"r.created_at","DESC");
  const filters: string[]=[];
  const filterValues: (string | number | null)[]=[];
  const ids = (key:string, validate:(id:string)=>boolean) => (url.searchParams.get(key)||"").split(",").filter(validate).slice(0,30);
  const categoryIds=ids("categoryIds",isRestaurantId);
  if (url.searchParams.has("categoryIds")) {
    filters.push(categoryIds.length ? `r.restaurant_id IN (${categoryIds.map(()=>"?").join(",")})` : "0");
    filterValues.push(...categoryIds);
  }
  if (url.searchParams.has("searchRestaurants")) {
    const restaurants=ids("searchRestaurants",isRestaurantId), pickups=ids("searchPickups",isPickupId);
    const parts=[];
    if(restaurants.length){parts.push(`r.restaurant_id IN (${restaurants.map(()=>"?").join(",")})`);filterValues.push(...restaurants);}
    if(pickups.length){parts.push(`r.pickup IN (${pickups.map(()=>"?").join(",")})`);filterValues.push(...pickups);}
    filters.push(parts.length?`(${parts.join(" OR ")})`:"0");
  }
  const pickup=url.searchParams.get("pickup");
  if(pickup && isPickupId(pickup)){filters.push("r.pickup = ?");filterValues.push(pickup);}
  if(url.searchParams.get("available")==="1"){
    filters.push("((SELECT COUNT(*) FROM room_members a WHERE a.room_id=r.id AND a.status='approved') < r.capacity OR EXISTS (SELECT 1 FROM room_members m WHERE m.room_id=r.id AND m.user_email=?))");filterValues.push(email);
  }
  const filterSql=filters.length?` AND ${filters.join(" AND ")}`:"";
  const result = await withD1ReadRetry(() => env.DB.prepare(`
        SELECT
          r.*, ${sortColumn} AS page_sort,
          ? AS current_email,
          (SELECT COUNT(*) FROM room_members approved
            WHERE approved.room_id = r.id AND approved.status = 'approved') AS people,
          COALESCE(
            (SELECT mine.status FROM room_members mine
              WHERE mine.room_id = r.id AND mine.user_email = ?),
            (SELECT 'rejected' FROM room_blocks blocked
              WHERE blocked.room_id = r.id AND blocked.user_email = ?)
          ) AS my_status,
          (SELECT COUNT(*) FROM room_members pending
            WHERE pending.room_id = r.id AND pending.status = 'requested') AS pending_count
        FROM rooms r
        WHERE r.status = 'open' AND r.closes_at > ?
          ${filterSql} ${cursor.sql}
        ORDER BY ${sortColumn} ${sortDirection}, r.id ${sortDirection}
        LIMIT 101
      `).bind(email, email, email, now, ...filterValues, ...cursor.bind).all<Record<string, unknown>>());

  let myRooms: ReturnType<typeof serializeRoom>[] = [];
  let nextMyRoomsCursor: string | null = null;
  const nextRoomsCursor=result.results.length>100?encodeCursor(result.results[99],"page_sort"):null;
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
            AND mine.status IN ('approved', 'requested')
            AND r.status = 'open'
            AND r.closes_at > ?
            ${mineCursor.sql}
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT 51
        `).bind(user.email, user.email, now - recentRoomWindowMs, ...mineCursor.bind).all<Record<string, unknown>>());
    nextMyRoomsCursor=mine.results.length>50?encodeCursor(mine.results[49]):null;
    // Order details stay private to approved members; a pending request only sees the public shape.
    myRooms = mine.results.slice(0,50).map((row) => serializeRoom(row, row.my_status === "approved")).filter(isUsableRoom);
  }

  after(() => purgeExpiredRooms(now).catch((error) => console.error("Retention sweep failed", error)));
  return json({
    user: user ? { displayName: user.displayName } : null,
    // Deadlines are server timestamps; the client offsets its own clock
    // by this value so countdowns do not depend on the phone's clock.
    serverNow: now,
    nextRoomsCursor, nextMyRoomsCursor,
    rooms: result.results.slice(0,100).map((row) => serializeRoom(row)).filter(isUsableRoom),
    myRooms,
  });
}
