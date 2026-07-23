import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
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
]).then(([api, page, schema, worker]) => ({ api, page, schema, worker }));

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
  assert.match(put, /room\.status !== "open" \|\| Number\(room\.closes_at\) < Date\.now\(\) - recentRoomWindowMs/);
  assert.match(put, /Number\.isInteger\(orderTotal\)[\s\S]*10_000_000/);
  assert.match(put, /Number\.isInteger\(collectedTotal\)[\s\S]*10_000_000/);
});

test("member review uses opaque references and never serializes member email addresses", async () => {
  const [{ api, page, schema }, migrations] = await Promise.all([sourceFiles, migrationSource]);
  const roomRead = section(api, "if (action === \"room\")", "return json({ error: \"지원하지 않는 요청입니다.\"");
  const memberQuery = section(roomRead, "const members =", "const messages =");
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
  assert.match(purge, /WHERE closes_at < \?/);
  assert.match(purge, /LIMIT 100/);
  assert.match(purge, /Deferred stale receipt cleanup/);
  assert.match(purge, /for \(const key of receiptKeysForRoom\(room\.id, room\.receipt_key\)\)/);
  assert.ok(
    purge.indexOf("await uploadBucket().delete(key)") < purge.indexOf("DELETE FROM rooms WHERE id = ?"),
    "receipt deletion must happen before the database loses its object key",
  );
  assert.ok(
    purge.indexOf("lastRetentionSweep = Date.now()") > purge.indexOf("DELETE FROM rooms WHERE id = ?"),
    "the cooldown must begin only after a successful sweep reaches its completion point",
  );
  assert.match(purge, /finally \{[\s\S]*retentionSweepInFlight = null/);

  assert.match(bootstrap, /let myRooms:/);
  assert.match(bootstrap, /JOIN room_members mine ON mine\.room_id = r\.id/);
  assert.match(bootstrap, /mine\.status = 'approved'/);
  assert.match(bootstrap, /r\.closes_at > \?/);
  assert.match(bootstrap, /now - recentRoomWindowMs/);
  assert.match(bootstrap, /myRooms,/);
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
});

test("receipt storage uses bounded deterministic keys and cleans up around the database commit", async () => {
  const { api } = await sourceFiles;
  const put = section(api, "export async function PUT", "export async function DELETE");
  const deleteRoom = section(api, "export async function DELETE", "export async function POST");
  const normalizedPut = compact(put);

  assert.match(api, /const receiptUploadCooldownMs = 30 \* 1000/);
  assert.match(
    api,
    /transform\(\{ fit: "scale-down", width: 2400, height: 2400, metadata: "none" \}\)/,
  );
  assert.match(
    normalizedPut,
    /newReceiptKey = room\.receipt_key\?\.endsWith\("\/a"\) \? `receipts\/\$\{id\}\/b` : `receipts\/\$\{id\}\/a`/,
  );
  assert.doesNotMatch(put, /receipts\/\$\{id\}\/\$\{crypto\.randomUUID/);
  assert.match(put, /normalizeReceiptImage\(receipt, detectedType\)/);
  assert.match(put, /retryAfterMs = receiptUploadCooldownMs - \(Date\.now\(\) - Number\(room\.receipt_uploaded_at \|\| 0\)\)/);
  assert.match(put, /영수증 이미지는 30초에 한 번만 교체할 수 있습니다/);
  assert.match(put, /"Retry-After": String\(Math\.ceil\(retryAfterMs \/ 1000\)\)/);
  assert.ok(
    put.indexOf("uploadBucket().put(newReceiptKey") < put.indexOf("UPDATE rooms"),
    "the replacement object must exist before its key is committed",
  );
  assert.match(put, /catch \(databaseError\) \{[\s\S]*delete\(newReceiptKey\)[\s\S]*throw databaseError/);
  assert.ok(
    put.indexOf("const committedReceiptKey = newReceiptKey") < put.indexOf("delete(room.receipt_key)"),
    "the previous object must remain available until the database commit succeeds",
  );
  assert.match(put, /const committedReceiptKey = newReceiptKey;[\s\S]*newReceiptKey = ""/);
  assert.match(put, /Deferred previous receipt cleanup/);

  assert.match(deleteRoom, /for \(const key of receiptKeysForRoom\(id, room\.receipt_key\)\)/);
  assert.ok(
    deleteRoom.indexOf("await uploadBucket().delete(key)") < deleteRoom.indexOf("DELETE FROM rooms"),
  );
  assert.match(deleteRoom, /Receipt deletion must succeed before room deletion/);
  assert.match(deleteRoom, /영수증 삭제를 완료하지 못했습니다[\s\S]*503/);
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
  assert.match(worker, /return withSecurityHeaders\(response\)/);
  assert.match(worker, /return withSecurityHeaders\(await handler\.fetch\(request, env, ctx\)\)/);
});

test("the browser receives only a public user shape and clears revoked room state", async () => {
  const { api, page } = await sourceFiles;
  const bootstrap = section(api, 'if (action === "bootstrap")', 'if (action === "room")');
  const roomLoader = section(page, "const loadRoom = useCallback", "useEffect(() => {");

  assert.match(bootstrap, /user: user \? \{ displayName: user\.displayName \} : null/);
  assert.doesNotMatch(bootstrap, /user:\s*user[,}]/);
  assert.doesNotMatch(page, /user\.email/);
  assert.match(roomLoader, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(roomLoader, /setRoom\(null\)/);
  assert.match(roomLoader, /setMembers\(\[\]\)/);
  assert.match(roomLoader, /setMessages\(\[\]\)/);
});
