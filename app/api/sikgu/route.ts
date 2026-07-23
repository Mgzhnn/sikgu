import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

type AuthUser = {
  email: string;
  displayName: string;
};

const json = (data: unknown, status = 200) => Response.json(data, { status });

function displayName(user: { email: string; fullName: string | null; displayName: string }) {
  return user.fullName?.trim() || user.displayName?.trim() || user.email.split("@")[0];
}

async function optionalUser(): Promise<AuthUser | null> {
  const user = await getChatGPTUser();
  return user ? { email: user.email.toLowerCase(), displayName: displayName(user) } : null;
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

function serializeRoom(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    restaurantId: String(row.restaurant_id),
    host: String(row.host_name),
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
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "bootstrap";
    const user = await optionalUser();

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
        SELECT id, sender_name, body, created_at,
          CASE WHEN sender_email = ? THEN 1 ELSE 0 END AS mine
        FROM room_messages
        WHERE room_id = ?
        ORDER BY created_at ASC
        LIMIT 200
      `).bind(auth.email, id).all();
      return json({
        room: { ...serializeRoom({ ...room, current_email: auth.email, people: await approvedCount(id) }), isHost },
        members: members.results.map((member) => isHost
          ? member
          : {
              display_name: member.display_name,
              role: member.role,
              status: member.status,
              created_at: member.created_at,
            }),
        messages: messages.results,
      });
    }

    return json({ error: "지원하지 않는 요청입니다." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, 500);
  }
}

export async function POST(request: Request) {
  try {
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
