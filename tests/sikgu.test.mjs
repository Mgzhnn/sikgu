import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  deliveryAppIds,
  isPickupId,
  isRestaurantId,
  parseDeliveryApps,
  pickupFullNames,
  restaurantMinimums,
  roomCapacities,
  roomDurations,
} from "../app/sikgu-rules.mjs";

const root = new URL("../", import.meta.url);

const sourceFiles = Promise.all([
  readFile(new URL("app/api/sikgu/route.ts", root), "utf8"),
  readFile(new URL("app/page.tsx", root), "utf8"),
  readFile(new URL("db/schema.ts", root), "utf8"),
  readFile(new URL("worker/index.ts", root), "utf8"),
  readFile(new URL("app/receipt-image.mjs", root), "utf8"),
]).then(([api, page, schema, worker, receiptImage]) => ({
  api,
  page,
  schema,
  worker,
  receiptImage,
}));

const migrationSource = readdir(new URL("drizzle/", root), { withFileTypes: true })
  .then(async (entries) => Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => ({
        name: entry.name,
        source: await readFile(new URL(`drizzle/${entry.name}`, root), "utf8"),
      })),
  ));

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function compact(source) {
  return source.replace(/\s+/g, " ").trim();
}

function occurrences(source, fragment) {
  return source.split(fragment).length - 1;
}

test("shared room rules reject unsupported values and drive both client and server", async () => {
  const { api, page } = await sourceFiles;

  assert.deepEqual([...deliveryAppIds], ["baemin", "coupang"]);
  assert.deepEqual(parseDeliveryApps(["baemin", "baemin", "unknown", "coupang"]), [
    "baemin",
    "coupang",
  ]);
  assert.deepEqual(parseDeliveryApps(null), []);
  assert.deepEqual(parseDeliveryApps("baemin"), []);

  assert.deepEqual([...roomDurations], [20, 30, 45]);
  assert.deepEqual([...roomCapacities], [2, 3, 4, 5, 6, 7, 8]);
  assert.ok(roomCapacities.every((value) => Number.isInteger(value) && value >= 2 && value <= 8));
  assert.ok(roomDurations.every((value) => Number.isInteger(value) && value >= 5 && value <= 60));

  for (const [restaurantId, minimums] of Object.entries(restaurantMinimums)) {
    assert.equal(isRestaurantId(restaurantId), true);
    assert.match(page, new RegExp(`id: "${restaurantId}"`));
    assert.ok(
      Object.values(minimums).every((value) => Number.isSafeInteger(value) && value > 0),
      `${restaurantId} must have positive integer minimums`,
    );
  }
  for (const [pickupId, fullName] of Object.entries(pickupFullNames)) {
    assert.equal(isPickupId(pickupId), true);
    assert.ok(page.includes(`id: "${pickupId}"`));
    assert.ok(page.includes(`full: "${fullName}"`));
  }

  for (const unsupported of ["", "unknown", "__proto__", "toString", null, 1]) {
    assert.equal(isRestaurantId(unsupported), false);
    assert.equal(isPickupId(unsupported), false);
  }

  assert.equal(Object.isFrozen(deliveryAppIds), true);
  assert.equal(Object.isFrozen(restaurantMinimums), true);
  assert.equal(Object.isFrozen(pickupFullNames), true);
  assert.match(page, /import \{ roomCapacities, roomDurations \} from "\.\/sikgu-rules\.mjs"/);
  assert.match(api, /from "\.\.\/\.\.\/sikgu-rules\.mjs"/);
  assert.match(page, /const \[apps, setApps\] = useState<DeliveryApp\[\]>\(\[\]\)/);
  assert.doesNotMatch(page, /useState<DeliveryApp\[\]>\(\["baemin"\]\)/);
  assert.match(page, /\{roomDurations\.map\(/);
  assert.match(page, /\{roomCapacities\.map\(/);
});

test("server derives room data from allowlists and bounds every request before parsing", async () => {
  const { api } = await sourceFiles;
  const post = section(api, "export async function POST", "return serverError(\"Failed to mutate SIKGU data\"");
  const createRoom = section(post, "if (action === \"create_room\")", "const id = String(payload.roomId");
  const put = section(api, "export async function PUT", "export async function DELETE");

  assert.match(api, /const maxJsonBytes = 32 \* 1024/);
  assert.match(post, /startsWith\("application\/json"\)/);
  assert.ok(post.indexOf("contentLength(request)") < post.indexOf("request.json()"));
  assert.match(post, /requestBytes === null[\s\S]*411/);
  assert.match(post, /requestBytes > maxJsonBytes[\s\S]*413/);

  assert.match(createRoom, /parseDeliveryApps\(payload\.apps\)/);
  assert.match(createRoom, /!isRestaurantId\(restaurantId\) \|\| !isPickupId\(pickup\) \|\| !apps\.length/);
  assert.match(createRoom, /!roomCapacities\.includes\(capacity\)/);
  assert.match(createRoom, /!Number\.isSafeInteger\(closesAt\)/);
  assert.match(createRoom, /closesAt < now \+ 5 \* 60 \* 1000/);
  assert.match(createRoom, /closesAt > now \+ 60 \* 60 \* 1000/);
  assert.match(createRoom, /membership && !apps\.includes\(membership\)/);
  assert.match(createRoom, /pickupFullNames\[pickup\]/);
  assert.match(createRoom, /restaurantMinimums\[restaurantId\]\[app\]/);
  assert.match(createRoom, /maxOpenRoomsPerHost/);
  assert.doesNotMatch(createRoom, /payload\.(?:pickupFull|target|total)/);

  assert.ok(put.indexOf("contentLength(request)") < put.indexOf("request.formData()"));
  assert.match(put, /requestBytes === null[\s\S]*411/);
  assert.match(put, /requestBytes > maxReceiptBytes \+ 512 \* 1024[\s\S]*413/);
  assert.match(put, /initialRoom\.status !== "open"/);
  assert.match(put, /Number\(initialRoom\.closes_at\) < Date\.now\(\) - recentRoomWindowMs/);
  assert.match(put, /Number\.isInteger\(orderTotal\)[\s\S]*10_000_000/);
  assert.match(put, /Number\.isInteger\(collectedTotal\)[\s\S]*10_000_000/);
});

test("member review uses opaque references and never serializes member email addresses", async () => {
  const [{ api, page, schema }, migrations] = await Promise.all([sourceFiles, migrationSource]);
  const roomRead = section(api, "if (action === \"room\")", "return json({ error: \"지원하지 않는 요청입니다.\"");
  const memberQuery = section(roomRead, "const loadMembers =", "const messages =");
  const memberResponse = section(roomRead, "members: members.results.map", "messages: messages.results.map");
  const roomMemberType = section(page, "type RoomMember = {", "type ChatMessage = {");
  const reviewAction = section(api, "if (action === \"review_member\")", "if (action === \"remove_member\")");

  assert.match(schema, /reviewToken: text\("review_token"\)/);
  assert.match(
    migrations.map(({ source }) => source).join("\n"),
    /(?:ADD\s+`review_token`|`review_token`\s+text)/i,
    "a deployed migration must add room_members.review_token",
  );
  assert.match(memberQuery, /SELECT review_token, display_name, role, status, created_at/);
  assert.doesNotMatch(memberQuery, /user_email/);
  assert.match(memberQuery, /members\.results\.some\(\(member\) => !member\.review_token\)/);
  assert.match(memberQuery, /WHERE room_id = \? AND review_token IS NULL/);
  assert.match(memberQuery, /members = await loadMembers\(\)/);
  assert.match(memberResponse, /member_ref: String\(member\.review_token \|\| ""\)/);
  assert.doesNotMatch(memberResponse, /user_email|\.\.\.member/);
  assert.match(roomMemberType, /member_ref\?: string/);
  assert.doesNotMatch(roomMemberType, /user_email/);
  assert.match(reviewAction, /const memberRef = String\(payload\.memberRef \|\| ""\)/);
  assert.match(reviewAction, /review_token = \?/);
  assert.doesNotMatch(reviewAction, /memberEmail|payload\.user_email/);
  assert.match(api, /return `User-\$\{suffix\}`/);
});

test("approval and invite acceptance reserve capacity atomically", async () => {
  const { api } = await sourceFiles;
  const reviewAction = section(api, "if (action === \"review_member\")", "if (action === \"remove_member\")");
  const acceptInvite = section(api, "if (action === \"accept_invite\")", "if (action === \"send_message\")");
  const normalizedReview = compact(reviewAction);
  const normalizedAccept = compact(acceptInvite);

  assert.match(
    normalizedReview,
    /UPDATE room_members SET status = 'approved' WHERE room_id = \? AND review_token = \? AND status = 'requested' AND \( SELECT COUNT\(\*\) FROM room_members WHERE room_id = \? AND status = 'approved' \) < \?/,
  );
  assert.match(reviewAction, /if \(!result\.meta\.changes\)/);

  assert.match(acceptInvite, /const \[reservedInvite, accepted\] = await env\.DB\.batch\(\[/);
  assert.match(normalizedAccept, /UPDATE room_invites SET uses = uses \+ 1/);
  assert.match(normalizedAccept, /expires_at > \? AND uses < max_uses/);
  assert.match(normalizedAccept, /COUNT\(\*\) FROM room_members approved[\s\S]*< r\.capacity/);
  assert.match(normalizedAccept, /NOT EXISTS \( SELECT 1 FROM room_members mine/);
  assert.match(normalizedAccept, /SELECT \?, \?, \?, 'member', 'approved', \?, \? WHERE changes\(\) > 0/);
  assert.match(acceptInvite, /!reservedInvite\.meta\.changes \|\| !accepted\.meta\.changes/);
  assert.equal(occurrences(acceptInvite, "UPDATE room_invites"), 1);
});

test("approved users can reopen recent rooms and stale rooms are purged after receipt cleanup", async () => {
  const { api, page } = await sourceFiles;
  const purge = section(api, "async function purgeExpiredRooms", "export async function GET");
  const bootstrap = section(api, "if (action === \"bootstrap\")", "if (action === \"room\")");

  assert.match(api, /const recentRoomWindowMs = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(purge, /lastRetentionSweep < 60 \* 60 \* 1000/);
  assert.match(purge, /if \(retentionSweepInFlight\) return retentionSweepInFlight/);
  assert.match(purge, /retentionSweepInFlight = \(async \(\) => \{/);
  assert.match(purge, /closes_at < \?[\s\S]*status = 'open'/);
  assert.match(purge, /status = 'deleting'[\s\S]*mutation_started_at < \?/);
  assert.match(purge, /LIMIT 50/);
  assert.match(purge, /SET status = 'deleting', mutation_token = \?, mutation_started_at = \?/);
  assert.match(purge, /WHERE id IN \(\$\{placeholders\}\)/);
  assert.match(purge, /WHERE status = 'deleting' AND mutation_token = \?/);
  assert.match(purge, /Deferred stale receipt cleanup/);
  assert.match(purge, /claimed\.results\.map\(\(room\) =>[\s\S]*listReceiptKeysForRoom/);
  assert.match(purge, /await bucket\.delete\(receiptKeys\.slice\(offset, offset \+ 1000\)\)/);
  assert.match(purge, /DELETE FROM rooms[\s\S]*status = 'deleting' AND mutation_token = \?/);
  assert.doesNotMatch(purge, /DELETE FROM room_(?:messages|invites|members)/);
  assert.doesNotMatch(purge, /SET status = 'open'/);
  assert.ok(
    purge.indexOf("await bucket.delete(receiptKeys.slice") < purge.indexOf("DELETE FROM rooms"),
    "receipt deletion must happen before the database loses its object key",
  );
  assert.ok(
    purge.indexOf("lastRetentionSweep = Date.now()") > purge.indexOf("DELETE FROM rooms"),
    "the cooldown must begin only after a successful sweep reaches its completion point",
  );
  assert.match(purge, /finally \{[\s\S]*retentionSweepInFlight = null/);

  assert.match(bootstrap, /let myRooms:/);
  assert.match(bootstrap, /JOIN room_members mine ON mine\.room_id = r\.id/);
  assert.match(bootstrap, /mine\.status = 'approved'/);
  assert.match(bootstrap, /r\.status = 'open'/);
  assert.match(bootstrap, /r\.closes_at > \?/);
  assert.match(bootstrap, /now - recentRoomWindowMs/);
  assert.match(bootstrap, /myRooms,/);
  assert.match(bootstrap, /after\(\(\) => purgeExpiredRooms\(now\)/);
  assert.ok(occurrences(api, "보관 기간이 지난 주문방입니다.") >= 2);

  assert.match(page, /const \[myRooms, setMyRooms\] = useState<Pool\[\]>\(\[\]\)/);
  assert.match(page, /setMyRooms\(\(data\.myRooms \|\| \[\]\)\.filter\(isValidRoom\)\)/);
  assert.match(page, /rooms=\{myRooms\}/);
  assert.match(page, /마감 후 30일 동안 다시 열 수 있어요/);
  assert.match(page, /onClick=\{\(\) => onRoom\(room\.id\)\}/);
});

test("mobile and desktop location pickers share behavior without overwriting stored state", async () => {
  const { page } = await sourceFiles;
  const picker = section(page, "function LocationPicker", "function CampusMapPreview");

  assert.match(picker, /compact = false/);
  assert.match(picker, /mobile-location-options/);
  assert.match(picker, /desktop-location-options/);
  assert.match(picker, /event\.key !== "Escape"/);
  assert.match(picker, /triggerRef\.current\?\.focus\(\)/);
  assert.match(picker, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(page, /<LocationPicker currentPickup=\{currentPickup\} onSelect=\{selectCurrentPickup\} \/>/);
  assert.match(page, /<LocationPicker currentPickup=\{currentPickup\} onSelect=\{selectCurrentPickup\} compact \/>/);
  assert.match(page, /setLocationReady\(true\)/);
  assert.match(page, /if \(locationReady\) \{[\s\S]*localStorage\.setItem\(currentPickupStorageKey, currentPickup\)/);
});

test("dialogs, Korean IME input, request ordering, and bootstrap states have explicit safeguards", async () => {
  const { page } = await sourceFiles;
  const dialogHook = section(page, "function useDialogLifecycle", "const appLabels");

  assert.match(dialogHook, /event\.key === "Escape"/);
  assert.match(dialogHook, /event\.key !== "Tab"/);
  assert.match(dialogHook, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dialogHook, /previouslyFocused\?\.focus\(\)/);
  for (const [component, nextComponent] of [
    ["function CampusMapModal", "function FeedbackModal"],
    ["function FeedbackModal", "function PoolModal"],
    ["function PoolModal", "function RoomHubModal"],
    ["function RoomHubModal", "function CreateModal"],
    ["function CreateModal", "export default function Home"],
  ]) {
    assert.match(section(page, component, nextComponent), /useDialogLifecycle\(/);
  }

  assert.match(page, /!event\.nativeEvent\.isComposing/);
  assert.match(page, /event\.nativeEvent\.keyCode !== 229/);
  assert.match(page, /const requestId = \+\+loadRoomRequestRef\.current/);
  assert.ok(occurrences(page, "requestId !== loadRoomRequestRef.current") >= 2);
  assert.match(page, /const \[bootstrapState, setBootstrapState\] = useState<"loading" \| "ready" \| "error">\("loading"\)/);
  assert.match(page, /loading \? \([\s\S]*rooms-loading[\s\S]*\) : loadError \? \(/);
  assert.match(page, /setBootstrapState\("error"\)/);
  assert.match(page, /if \(bootstrapState === "loading"\)/);
  assert.match(page, /if \(bootstrapState === "error"\)/);
  assert.match(page, /if \(!apps\.length \|\| creating\) return/);
});

test("all client mutations carry the custom same-origin request header", async () => {
  const { api, page } = await sourceFiles;
  const sameOrigin = section(api, "function sameOrigin", "function contentLength");
  const roomPost = section(page, "const post = async", "const review = async");
  const saveOrder = section(page, "const saveOrderInfo = async", "const deleteRoom = async");
  const deleteRoom = section(page, "const deleteRoom = async", "const leaveRoom = async");
  const globalPost = section(page, "const postAction = useCallback", "const loadRooms = useCallback");

  assert.match(sameOrigin, /request\.headers\.get\("x-sikgu-request"\) !== "1"/);
  assert.match(sameOrigin, /origin === expectedOrigin/);
  assert.match(sameOrigin, /new URL\(referer\)\.origin === expectedOrigin/);
  assert.equal(occurrences(api, "if (!sameOrigin(request))"), 3);
  for (const mutation of [roomPost, saveOrder, deleteRoom, globalPost]) {
    assert.match(mutation, /"x-sikgu-request": "1"/);
  }
  assert.match(deleteRoom, /response\.status === 404[\s\S]*onDeleted\(\)/);
});

test("receipt updates and room deletion use fenced mutations with recoverable storage cleanup", async () => {
  const { api, receiptImage } = await sourceFiles;
  const put = section(api, "export async function PUT", "export async function DELETE");
  const deleteRoom = section(api, "export async function DELETE", "export async function POST");
  const normalizedPut = compact(put);
  const lock = section(api, "async function acquireRoomMutation", "async function releaseRoomMutation");
  const cleanup = section(api, "async function deleteReceiptObjectsForRoom", "function isRetryableD1ReadError");

  assert.match(api, /const receiptUploadCooldownMs = 30 \* 1000/);
  assert.match(
    api,
    /import \{[\s\S]*detectReceiptType,[\s\S]*sanitizeReceiptImage,[\s\S]*validateReceiptImageData,[\s\S]*\} from "\.\.\/\.\.\/receipt-image\.mjs"/,
  );
  assert.match(receiptImage, /const maxReceiptDimension = 2400/);
  assert.match(receiptImage, /const maxReceiptPixels = 5_760_000/);
  assert.match(receiptImage, /const maxJpegSegments = 4096/);
  assert.match(receiptImage, /const maxPngChunks = 4096/);
  assert.match(api, /const receiptTypes = new Set\(\["image\/png"\]\)/);
  assert.match(receiptImage, /export function sanitizeReceiptImage\(buffer, contentType\)/);
  assert.match(receiptImage, /const isMetadata = \(marker >= 0xe0 && marker <= 0xef\) \|\| marker === 0xfe/);
  assert.match(receiptImage, /const safeAncillaryChunks = new Set\(\["tRNS"\]\)/);
  assert.match(lock, /SET mutation_token = \?, mutation_started_at = \?/);
  assert.match(lock, /status = 'open'[\s\S]*mutation_token IS NULL[\s\S]*mutation_started_at < \?/);
  assert.match(lock, /SET status = 'deleting', mutation_token = \?, mutation_started_at = \?/);
  assert.match(lock, /return result\.meta\.changes \? mutationToken : null/);
  assert.match(normalizedPut, /acquireRoomMutation\(id, auth\.email, "update"\)/);
  assert.match(
    normalizedPut,
    /newReceiptKey = `receipts\/\$\{id\}\/\$\{mutationToken\}\.\$\{receiptFileExtension\}`/,
  );
  assert.match(put, /sanitizeReceiptImage\(originalBuffer, detectedType\)/);
  assert.match(put, /await validateReceiptImageData\(normalizedReceiptBuffer, detectedType\)/);
  assert.ok(
    put.indexOf("initialRoom.receipt_uploaded_at") < put.indexOf("receipt.arrayBuffer()"),
    "the cheap cooldown check must happen before parsing a large image",
  );
  assert.ok(
    put.indexOf('acquireRoomMutation(id, auth.email, "update")') <
      put.indexOf("WHERE id = ? AND host_email = ? AND status = 'open' AND mutation_token = ?"),
    "receipt state must be reread after acquiring the lock",
  );
  assert.match(put, /retryAfterMs = receiptUploadCooldownMs - \(Date\.now\(\) - Number\(room\.receipt_uploaded_at \|\| 0\)\)/);
  assert.match(put, /영수증 이미지는 30초에 한 번만 교체할 수 있습니다/);
  assert.match(put, /"Retry-After": String\(Math\.ceil\(retryAfterMs \/ 1000\)\)/);
  assert.ok(
    put.indexOf("receiptBucket.put(newReceiptKey") < put.indexOf("UPDATE rooms"),
    "the replacement object must exist before its key is committed",
  );
  assert.ok(occurrences(put, "status = 'open' AND mutation_token = ?") >= 3);
  assert.ok(occurrences(put, "mutation_token = NULL, mutation_started_at = NULL") >= 2);
  assert.match(put, /SELECT total, estimated_arrival, order_total, receipt_key,[\s\S]*mutation_token, status/);
  assert.match(put, /persisted\.receipt_key === newReceiptKey[\s\S]*preserveNewReceiptOnFailure = true/);
  assert.match(put, /if \(newReceiptKey && !preserveNewReceiptOnFailure\)[\s\S]*delete\(newReceiptKey\)/);
  assert.ok(
    put.indexOf("const committedReceiptKey = newReceiptKey") < put.indexOf("delete(room.receipt_key)"),
    "the previous object must remain available until the database commit succeeds",
  );
  assert.match(put, /const committedReceiptKey = newReceiptKey;[\s\S]*newReceiptKey = ""/);
  assert.match(put, /Deferred previous receipt cleanup/);
  assert.match(put, /let updateResult/);
  assert.ok(occurrences(put, "updateResult = await env.DB.prepare") >= 2);
  assert.match(
    put,
    /if \(!updateResult\.meta\.changes\) \{[\s\S]*The order room was removed before its update completed/,
  );
  assert.ok(
    put.indexOf("if (!updateResult.meta.changes)") < put.indexOf("const committedReceiptKey = newReceiptKey"),
    "a concurrent room deletion must be detected before the uploaded key is treated as committed",
  );

  assert.match(cleanup, /bucket\.list\(\{[\s\S]*prefix: `receipts\/\$\{id\}\//);
  assert.match(cleanup, /page\.truncated \? page\.cursor : undefined/);
  assert.match(cleanup, /bucket\.delete\(allKeys\.slice\(offset, offset \+ 1000\)\)/);
  assert.match(deleteRoom, /acquireRoomMutation\(id, auth\.email, "delete"\)/);
  assert.match(deleteRoom, /status = 'deleting' AND mutation_token = \?/);
  assert.match(deleteRoom, /deleteReceiptObjectsForRoom\(id, room\.receipt_key, true\)/);
  assert.ok(
    deleteRoom.indexOf("deleteReceiptObjectsForRoom(id, room.receipt_key, true)") < deleteRoom.indexOf("DELETE FROM rooms"),
  );
  assert.match(deleteRoom, /Receipt deletion must succeed before room deletion/);
  assert.match(deleteRoom, /영수증 삭제를 완료하지 못했습니다[\s\S]*503/);
  assert.match(
    deleteRoom,
    /DELETE FROM rooms[\s\S]*id = \? AND host_email = \? AND status = 'deleting' AND mutation_token = \?/,
  );
  assert.match(deleteRoom, /"Retry-After": "120"/);
  assert.doesNotMatch(deleteRoom, /DELETE FROM room_(?:messages|invites|members)/);
});

test("production reads retry transient D1 failures and cleanup avoids repeated writes", async () => {
  const { api } = await sourceFiles;
  const retryable = section(api, "function isRetryableD1ReadError", "async function withD1ReadRetry");
  const retry = section(api, "async function withD1ReadRetry", "function sameOrigin");
  const cleanup = section(api, "async function deleteReceiptObjectsForRoom", "function isRetryableD1ReadError");
  const purge = section(api, "async function purgeExpiredRooms", "export async function GET");
  const roomRead = section(
    api,
    "if (action === \"room\")",
    "return json({ error: \"지원하지 않는 요청입니다.\"",
  );
  const deleteRoom = section(api, "export async function DELETE", "export async function POST");

  for (const fragment of [
    "Network connection lost",
    "storage caused object to be reset",
    "reset because its code was updated",
    "Cannot resolve D1 DB due to transient issue on remote node",
  ]) {
    assert.ok(retryable.includes(`"${fragment}"`));
  }
  assert.match(retry, /attempt < 2/);
  assert.match(retry, /attempt > 0 \|\| !isRetryableD1ReadError\(error\)/);
  assert.match(retry, /75 \+ Math\.floor\(Math\.random\(\) \* 76\)/);
  assert.ok(occurrences(api, "withD1ReadRetry") >= 8);

  assert.match(cleanup, /if \(!storedKey && !includeUncommittedCandidates\) return/);
  assert.match(cleanup, /listReceiptKeysForRoom/);
  assert.match(cleanup, /limit: 1000/);
  assert.match(cleanup, /bucket\.delete\(allKeys\.slice\(offset, offset \+ 1000\)\)/);

  assert.match(purge, /SELECT CASE WHEN[\s\S]*EXISTS\(SELECT 1 FROM rooms/);
  assert.match(purge, /if \(legacyNames\?\.found\)/);
  assert.match(roomRead, /members\.results\.some\(\(member\) => !member\.review_token\)/);

  assert.match(deleteRoom, /D1 can commit an idempotent delete/);
  assert.match(deleteRoom, /SELECT id FROM rooms WHERE id = \?/);
  assert.match(deleteRoom, /if \(remaining\) \{[\s\S]*mutationToken = ""[\s\S]*503/);
});

test("API and worker responses carry privacy and browser security headers", async () => {
  const { api, worker } = await sourceFiles;

  assert.match(api, /"Cache-Control": "private, no-store"/);
  assert.match(api, /"X-Content-Type-Options": "nosniff"/);
  assert.match(api, /"Cross-Origin-Resource-Policy": "same-origin"/);

  for (const header of [
    "Content-Security-Policy",
    "Permissions-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
  ]) {
    assert.ok(worker.includes(`"${header}"`), `missing ${header}`);
  }
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]) {
    assert.ok(worker.includes(`"${directive}"`), `missing CSP directive ${directive}`);
  }
  assert.match(worker, /return withSecurityHeaders\(new Response\("Not Found"/);
  assert.match(worker, /return withSecurityHeaders\(await handler\.fetch\(request, env, ctx\)\)/);
  assert.doesNotMatch(worker, /IMAGES|handleImageOptimization/);
  assert.match(worker, /url\.pathname === "\/_vinext\/image"[\s\S]*status: 404/);
});

test("the browser receives only a public user shape and clears revoked room state", async () => {
  const { api, page } = await sourceFiles;
  const bootstrap = section(api, 'if (action === "bootstrap")', 'if (action === "room")');
  const roomRead = section(api, 'if (action === "room")', 'return json({ error: "지원하지 않는 요청입니다."');
  const publicName = section(api, "function publicDisplayName", "async function acquireRoomMutation");
  const roomLookup = section(api, "async function roomForUser", "async function approvedCount");
  const roomLoader = section(page, "const loadRoom = useCallback", "useEffect(() => {");

  assert.match(bootstrap, /user: user \? \{ displayName: user\.displayName \} : null/);
  assert.doesNotMatch(bootstrap, /user:\s*user[,}]/);
  assert.match(bootstrap, /rooms: result\.results\.map\(\(row\) => serializeRoom\(row\)\)/);
  assert.match(bootstrap, /r\.status = 'open'/);
  assert.doesNotMatch(page, /user\.email/);
  assert.match(publicName, /name\.includes\("@"\) \? "사용자" : maskDisplayName\(name\)/);
  assert.match(api, /host: publicDisplayName\(row\.host_name\)/);
  assert.match(roomRead, /display_name: publicDisplayName\(member\.display_name\)/);
  assert.match(roomRead, /sender_name: publicDisplayName\(message\.sender_name\)/);
  assert.match(roomLookup, /WHERE r\.id = \? AND r\.status = 'open'/);
  assert.ok(occurrences(api, 'room.status !== "open"') >= 2);
  assert.match(roomLoader, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(roomLoader, /setRoom\(null\)/);
  assert.match(roomLoader, /setMembers\(\[\]\)/);
  assert.match(roomLoader, /setMessages\(\[\]\)/);
});

test("the review-token migration works whether the production column already exists or not", async () => {
  const migration = await readFile(
    new URL("drizzle/0002_military_forgotten_one.sql", root),
    "utf8",
  );
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const alreadyHasColumn of [false, true]) {
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE rooms (id text PRIMARY KEY NOT NULL)");
    database.exec(`
      CREATE TABLE room_members (
        room_id text NOT NULL,
        user_email text NOT NULL,
        display_name text NOT NULL,
        role text DEFAULT 'member' NOT NULL,
        status text DEFAULT 'requested' NOT NULL,
        created_at integer NOT NULL,
        ${alreadyHasColumn ? "review_token text," : ""}
        PRIMARY KEY(room_id, user_email),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE cascade
      )
    `);
    database.exec("CREATE INDEX room_members_user_idx ON room_members (user_email, status)");
    database.exec("CREATE INDEX room_members_room_status_idx ON room_members (room_id, status)");
    database.exec("INSERT INTO rooms (id) VALUES ('room_1')");
    database.exec(`
      INSERT INTO room_members (
        room_id, user_email, display_name, role, status, created_at
        ${alreadyHasColumn ? ", review_token" : ""}
      )
      VALUES ('room_1', 'member@example.com', 'Member', 'member', 'approved', 1
        ${alreadyHasColumn ? ", 'legacy-token'" : ""}
      )
    `);

    for (const statement of statements) database.exec(statement);

    const columns = database.prepare("PRAGMA table_info(room_members)").all();
    assert.ok(columns.some((column) => column.name === "review_token"));
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM room_members").get().count, 1);
    assert.equal(
      database.prepare("SELECT display_name FROM room_members").get().display_name,
      "Member",
    );
    const indexes = database.prepare("PRAGMA index_list(room_members)").all();
    assert.ok(indexes.some((index) => index.name === "room_members_user_idx"));
    assert.ok(indexes.some((index) => index.name === "room_members_room_status_idx"));
    database.close();
  }
});

test("the mutation-lock migration preserves existing rooms", async () => {
  const { schema } = await sourceFiles;
  const migration = await readFile(
    new URL("drizzle/0003_mutation_locks.sql", root),
    "utf8",
  );
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  const database = new DatabaseSync(":memory:");
  assert.match(schema, /mutationToken: text\("mutation_token"\)/);
  assert.match(schema, /mutationStartedAt: integer\("mutation_started_at"\)/);
  database.exec(`
    CREATE TABLE rooms (
      id text PRIMARY KEY NOT NULL,
      host_email text NOT NULL,
      status text DEFAULT 'open' NOT NULL,
      created_at integer NOT NULL
    )
  `);
  database.exec("INSERT INTO rooms VALUES ('room_1', 'host@example.com', 'open', 123)");
  for (const statement of statements) database.exec(statement);

  const columns = database.prepare("PRAGMA table_info(rooms)").all();
  assert.ok(columns.some((column) => column.name === "mutation_token"));
  assert.ok(columns.some((column) => column.name === "mutation_started_at"));
  assert.deepEqual(
    { ...database.prepare(`
      SELECT id, host_email, status, created_at, mutation_token, mutation_started_at
      FROM rooms
    `).get() },
    {
      id: "room_1",
      host_email: "host@example.com",
      status: "open",
      created_at: 123,
      mutation_token: null,
      mutation_started_at: null,
    },
  );
  database.close();
});

test("the per-host open-room limit holds under concurrent create_room requests", async () => {
  const { createApi, identity, closesIn } = await import("./helpers/api-harness.mjs");
  const api = await createApi();
  const host = identity("host@dgist.ac.kr", "홍길동");
  const create = () => api.post(host, {
    action: "create_room",
    restaurantId: "sinjeon",
    pickup: "E1",
    apps: ["baemin"],
    capacity: 4,
    closesAt: closesIn(30),
  });

  for (let index = 0; index < 4; index += 1) assert.equal((await create()).status, 201);

  const results = await Promise.all([create(), create(), create()]);
  const statuses = results.map((result) => result.status).sort();
  assert.deepEqual(statuses, [201, 429, 429]);
  assert.equal(
    api.sql("SELECT COUNT(*) AS count FROM rooms WHERE host_email = 'host@dgist.ac.kr' AND status = 'open'")[0].count,
    5,
  );
  assert.equal(
    api.sql("SELECT COUNT(*) AS count FROM room_members WHERE role = 'host'")[0].count,
    5,
    "every stored room has exactly one host member row",
  );
  const rejected = results.find((result) => result.status === 429);
  assert.match(rejected.data.error, /5개까지/);
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = []) {
  const typeBytes = [...new TextEncoder().encode(type)];
  const checksum = crc32([...typeBytes, ...data]);
  const uint32 = (value) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  return [...uint32(data.length), ...typeBytes, ...data, ...uint32(checksum)];
}

async function tinyPng(width = 4, height = 4) {
  const { deflateSync } = await import("node:zlib");
  const uint32 = (value) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  const rows = new Uint8Array((width * 3 + 1) * height);
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", [...uint32(width), ...uint32(height), 8, 2, 0, 0, 0]),
    ...pngChunk("IDAT", [...deflateSync(rows)]),
    ...pngChunk("IEND"),
  ]);
}

test("a receipt upload without an R2 binding fails cleanly and releases the room's mutation lock", async () => {
  const { createApi, identity, closesIn } = await import("./helpers/api-harness.mjs");
  const api = await createApi({ uploads: null });
  const host = identity("host@dgist.ac.kr", "홍길동");
  const created = await api.post(host, {
    action: "create_room",
    restaurantId: "sinjeon",
    pickup: "E1",
    apps: ["baemin"],
    capacity: 4,
    closesAt: closesIn(30),
  });
  assert.equal(created.status, 201);
  const roomId = created.data.roomId;
  const receipt = new File([await tinyPng()], "receipt.png", { type: "image/png" });

  const response = await api.call("PUT", host, {
    query: `?action=update_order_info&roomId=${roomId}`,
    form: { estimatedArrival: "", orderTotal: "12000", collectedTotal: "0", receipt },
  });
  assert.equal(response.status, 500);
  assert.equal(typeof response.data.reference, "string", "the failure must be a JSON server error with a reference");
  assert.deepEqual(
    { ...api.sql("SELECT status, mutation_token, mutation_started_at FROM rooms WHERE id = ?", roomId)[0] },
    { status: "open", mutation_token: null, mutation_started_at: null },
    "the lock must be released so the host can retry or delete immediately",
  );
  assert.equal(
    (await api.call("DELETE", host, { query: `?roomId=${roomId}` })).status,
    503,
    "deletion still needs R2 in this environment, but must not be blocked by a stale lock (409)",
  );
});

test("a host can still reject or remove a pending requester after the room's deadline has passed", async () => {
  const { createApi, identity, closesIn } = await import("./helpers/api-harness.mjs");
  const api = await createApi();
  const host = identity("host@dgist.ac.kr", "홍길동");
  const early = identity("early@dgist.ac.kr", "김민수");
  const late = identity("late@dgist.ac.kr", "이영희");
  const created = await api.post(host, {
    action: "create_room",
    restaurantId: "sinjeon",
    pickup: "E1",
    apps: ["baemin"],
    capacity: 4,
    closesAt: closesIn(30),
  });
  const roomId = created.data.roomId;
  assert.equal((await api.post(early, { action: "request_join", roomId })).status, 200);
  assert.equal((await api.post(late, { action: "request_join", roomId })).status, 200);
  api.db.prepare("UPDATE rooms SET closes_at = ? WHERE id = ?").run(Date.now() - 1000, roomId);

  const hostView = await api.get(host, `?action=room&roomId=${roomId}`);
  const refs = hostView.data.members.filter((member) => member.status === "requested").map((member) => member.member_ref);
  assert.equal(refs.length, 2);

  const approve = await api.post(host, { action: "review_member", roomId, memberRef: refs[0], decision: "approve" });
  assert.equal(approve.status, 409, "approving after the deadline stays blocked");

  const reject = await api.post(host, { action: "review_member", roomId, memberRef: refs[0], decision: "reject" });
  assert.equal(reject.status, 200, "rejecting after the deadline must work so the request row does not linger");
  const remove = await api.post(host, { action: "remove_member", roomId, memberRef: refs[1] });
  assert.equal(remove.status, 200);
  assert.equal(
    api.sql("SELECT COUNT(*) AS count FROM room_members WHERE room_id = ? AND status = 'requested'", roomId)[0].count,
    0,
  );
});
