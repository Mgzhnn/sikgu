import { env } from "cloudflare:workers";
import { json } from "./responses";
import { acquireRoomMutation, releaseRoomMutation } from "./lock";
import {
  contentLength,
  isRealLocalDateTime,
  isResponse,
  maxReceiptBytes,
  receiptTypes,
  receiptUploadCooldownMs,
  recentRoomWindowMs,
  requiredUser,
  roomForUser,
  sameOrigin,
  serverError,
  uploadBucket,
  withD1ReadRetry,
  type AuthUser,
  type UploadBucket,
} from "./shared";
import {
  detectReceiptType,
  sanitizeReceiptImage,
  validateReceiptImageData,
} from "../../receipt-image.mjs";

/** Receipts are stored as PNG only (`receiptTypes`); the extension names the stored format. */
function receiptExtension(contentType: string) {
  return contentType === "image/png" ? "png" : "bin";
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

export async function listReceiptKeysForRoom(
  bucket: UploadBucket,
  id: string,
  storedKey?: string | null,
  includeUncommittedCandidates = false,
) {
  const keys = new Set(storedKey ? [storedKey] : []);
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

export async function updateOrderInfo(request: Request) {
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
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      return json({ error: "주문 정보는 파일 업로드 형식으로만 보낼 수 있습니다." }, 415);
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "주문 정보 요청 형식을 확인해주세요." }, 400);
    }

    const estimatedArrival = String(form.get("estimatedArrival") || "").trim();
    if (estimatedArrival && !isRealLocalDateTime(estimatedArrival)) {
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
          SET estimated_arrival = ?, order_total = ?, receipt_key = ?,
              receipt_content_type = ?, receipt_uploaded_at = ?,
              mutation_token = NULL, mutation_started_at = NULL
          WHERE id = ? AND host_email = ? AND status = 'open' AND mutation_token = ?
        `).bind(
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
          SET estimated_arrival = ?, order_total = ?,
              mutation_token = NULL, mutation_started_at = NULL
          WHERE id = ? AND host_email = ? AND status = 'open' AND mutation_token = ?
        `).bind(
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

export async function deleteRoom(request: Request) {
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

/** GET ?action=receipt: streams the stored image to an approved member of a retained room. */
export async function readReceipt(url: URL, user: AuthUser | null) {
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
