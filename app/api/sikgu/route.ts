import { env } from "cloudflare:workers";
import { sendMessage } from "./chat";
import { bootstrap, readRoom } from "./feed";
import { createRoomInvite } from "./invites";
import { InvalidCursorError } from "./pagination";
import { deleteRoom, readReceipt, updateOrderInfo } from "./receipts";
import { json } from "./responses";
import {
  acceptInvite,
  closeRecruitment,
  createRoom,
  extendRoom,
  leaveRoom,
  removeMember,
  requestJoin,
  reviewMember,
  roomForAction,
  setAmount,
} from "./rooms";
import {
  approvedCount,
  contentLength,
  isResponse,
  maxJsonBytes,
  optionalUser,
  requiredUser,
  sameOrigin,
  serverError,
  textField,
  type Payload, uploadBucket } from "./shared";

export const dynamic = "force-dynamic";

// Dispatcher only: each handler lives with its feature module (feed, rooms,
// chat, receipts). Every delegation is awaited so a rejected handler is
// still turned into the fixed error body below.

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "bootstrap";

    if (action === "health") {
      // Liveness plus a one-row database round trip and a one-key storage
      // listing; no identity, no cache. Either dependency failing is a 503 so
      // an uptime monitor sees a broken receipt bucket, not only a dead D1.
      let database = "ok";
      let storage = "ok";
      try {
        await env.DB.prepare("SELECT 1").first();
      } catch (error) {
        database = "unavailable";
        console.error(JSON.stringify({ level: "error", context: "Health check database probe failed", error: String(error) }));
      }
      try {
        await uploadBucket().list({ prefix: "receipts/", limit: 1 });
      } catch (error) {
        storage = "unavailable";
        console.error(JSON.stringify({ level: "error", context: "Health check storage probe failed", error: String(error) }));
      }
      const ok = database === "ok" && storage === "ok";
      return json({ ok, database, storage }, ok ? 200 : 503, ok ? {} : { "Retry-After": "30" });
    }

    const user = await optionalUser();

    if (action === "receipt") return await readReceipt(url, user);
    if (action === "bootstrap") return await bootstrap(url, user);
    if (action === "room") return await readRoom(url);

    return json({ error: "지원하지 않는 요청입니다." }, 400);
  } catch (error) {
    if (error instanceof InvalidCursorError) return json({error:error.message},400);
    return serverError("Failed to read SIKGU data", error);
  }
}

// The order-info and deletion handlers release their own mutation lock on
// failure, so their try/catch stays with them in receipts.ts.
export async function PUT(request: Request) {
  return updateOrderInfo(request);
}

export async function DELETE(request: Request) {
  return deleteRoom(request);
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
    let payload: Payload;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      payload = parsed as Record<string, unknown>;
    } catch {
      // null, arrays, scalars, and invalid JSON are client mistakes, not server errors.
      return json({ error: "요청 형식을 확인해 주세요." }, 400);
    }
    const action = textField(payload.action);

    if (action === "create_room") return await createRoom(auth, payload);

    const id = textField(payload.roomId);
    if (!id) return json({ error: "주문방 정보가 없습니다." }, 400);

    if (action === "request_join") return await requestJoin(auth, id);

    const room = await roomForAction(id);
    if (!room) return json({ error: "주문방을 찾을 수 없습니다." }, 404);

    if (action === "review_member") return await reviewMember(auth, id, room, payload);
    if (action === "remove_member") return await removeMember(auth, id, room, payload);
    if (action === "leave_room") return await leaveRoom(auth, id);
    if (action === "set_amount") return await setAmount(auth, id, room, payload);
    if (action === "extend_room") return await extendRoom(auth, id, room);
    if (action === "close_recruitment") return await closeRecruitment(auth, id, room);
    if (action === "create_invite") {
      return await createRoomInvite({db:env.DB, id, hostEmail:auth.email, room, approvedCount});
    }

    if (action === "accept_invite") return await acceptInvite(auth, id, payload);
    if (action === "send_message") return await sendMessage(auth, id, payload);

    return json({ error: "지원하지 않는 요청입니다." }, 400);
  } catch (error) {
    return serverError("Failed to mutate SIKGU data", error);
  }
}
