/**
 * Behaviour tests for COMPLETION.md item D2: paths that were previously
 * covered only by regular expressions over the source. Each one drives the
 * real route through the harness and checks what a client would observe.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createApi, identity, r2 } from "./helpers/api-harness.mjs";
import { deflateSync } from "node:zlib";

const host = identity("host@dgist.ac.kr", "김민수");
const alice = identity("alice@dgist.ac.kr", "Alice Park");

async function openRoom(api, who = host) {
  const created = await api.post(who, {
    action: "create_room", restaurantId: "sinjeon", pickup: "E1", apps: ["baemin"], capacity: 4, minutes: 30,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data.roomId;
}

/** A minimal valid 1×1 RGB PNG, built the same way the receipt tests do. */
function tinyPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const typeBytes = Buffer.from(type, "ascii");
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crcBytes = Buffer.alloc(4); crcBytes.writeUInt32BE(crc(Buffer.concat([typeBytes, data])));
    return Buffer.concat([length, typeBytes, data, crcBytes]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.from([0, 255, 255, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("D2: the health check reports a database outage as 503 with Retry-After", async () => {
  const api = await createApi();
  const working = await api.get(undefined, "?action=health");
  assert.deepEqual(working.data, { ok: true, database: "ok", storage: "ok" });

  // A broken receipt bucket is a 503 too (COMPLETION.md item C2).
  const realUploads = globalThis.__sikguEnv.UPLOADS;
  globalThis.__sikguEnv.UPLOADS = { async list() { throw new Error("R2 unavailable"); } };
  try {
    const noStorage = await api.get(undefined, "?action=health");
    assert.equal(noStorage.status, 503);
    assert.deepEqual(noStorage.data, { ok: false, database: "ok", storage: "unavailable" });
    assert.equal(noStorage.headers.get("retry-after"), "30");
  } finally {
    globalThis.__sikguEnv.UPLOADS = realUploads;
  }

  const realDb = globalThis.__sikguEnv.DB;
  globalThis.__sikguEnv.DB = {
    prepare() {
      throw new Error("D1_ERROR: storage caused object to be reset");
    },
  };
  try {
    const down = await api.get(undefined, "?action=health");
    assert.equal(down.status, 503);
    assert.deepEqual(down.data, { ok: false, database: "unavailable", storage: "ok" });
    assert.equal(down.headers.get("retry-after"), "30");
    assert.equal(down.headers.get("cache-control"), "private, no-store");
  } finally {
    globalThis.__sikguEnv.DB = realDb;
  }
});

test("D2: order info round-trips through PUT with a receipt that approved members can fetch", async () => {
  const uploads = r2();
  const api = await createApi({ uploads });
  const roomId = await openRoom(api);
  assert.equal((await api.post(alice, { action: "request_join", roomId })).status, 200);
  const ref = (await api.get(host, `?action=room&roomId=${roomId}`)).data.members.find((m) => m.status === "requested").member_ref;
  assert.equal((await api.post(host, { action: "review_member", roomId, memberRef: ref, decision: "approve" })).status, 200);

  const receipt = new File([tinyPng()], "receipt.png", { type: "image/png" });
  const saved = await api.call("PUT", host, {
    query: `?action=update_order_info&roomId=${roomId}`,
    form: { estimatedArrival: "2026-10-05T19:30", orderTotal: "28500", receipt },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.ok(saved.data.receiptUploadedAt > 0);
  assert.equal(uploads.objects.size, 1, "one receipt object is stored");

  const view = await api.get(alice, `?action=room&roomId=${roomId}`);
  assert.equal(view.status, 200);
  assert.equal(view.data.room.estimatedArrival, "2026-10-05T19:30");
  assert.equal(view.data.room.orderTotal, 28500);
  assert.match(view.data.room.receiptUrl, /action=receipt&roomId=/);
  assert.equal(view.data.room.receiptUploadedAt, saved.data.receiptUploadedAt);

  const image = await api.call("GET", alice, { query: view.data.room.receiptUrl.replace("/api/sikgu", ""), sameOrigin: false });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("cache-control"), "private, no-store");
  assert.equal(image.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal((await api.call("GET", identity("stranger@dgist.ac.kr", "낯선이"), { query: view.data.room.receiptUrl.replace("/api/sikgu", ""), sameOrigin: false })).status, 403);

  // A second save within the cooldown that replaces the receipt is refused; one without a receipt is fine.
  const again = await api.call("PUT", host, { query: `?action=update_order_info&roomId=${roomId}`, form: { estimatedArrival: "", orderTotal: "", receipt } });
  assert.equal(again.status, 429);
  const cleared = await api.call("PUT", host, { query: `?action=update_order_info&roomId=${roomId}`, form: { estimatedArrival: "", orderTotal: "" } });
  assert.equal(cleared.status, 200);
  const after = await api.get(alice, `?action=room&roomId=${roomId}`);
  assert.equal(after.data.room.estimatedArrival, null);
  assert.equal(after.data.room.orderTotal, null);
  assert.ok(after.data.room.receiptUrl, "the receipt stays until replaced");
});

test("D2: approve, reject and remove change what both sides see", async () => {
  const api = await createApi();
  const bob = identity("bob@dgist.ac.kr", "Bob Lee");
  const roomId = await openRoom(api);
  for (const who of [alice, bob]) assert.equal((await api.post(who, { action: "request_join", roomId })).status, 200);

  const pending = (await api.get(host, `?action=room&roomId=${roomId}`)).data.members.filter((m) => m.status === "requested");
  assert.equal(pending.length, 2);
  const [first, second] = pending;
  assert.equal((await api.get(alice, "?action=bootstrap")).data.rooms[0].people, 1, "only the host counts before approval");

  assert.equal((await api.post(host, { action: "review_member", roomId, memberRef: first.member_ref, decision: "approve" })).status, 200);
  assert.equal((await api.post(host, { action: "review_member", roomId, memberRef: second.member_ref, decision: "reject" })).status, 200);
  const feed = (await api.get(bob, "?action=bootstrap")).data.rooms[0];
  assert.equal(feed.people, 2);
  assert.equal(feed.myStatus, "rejected");
  assert.equal(api.sql("SELECT COUNT(*) AS n FROM room_blocks WHERE room_id = ?", roomId)[0].n, 1, "a rejection is recorded as a block");

  const hostView = await api.get(host, `?action=room&roomId=${roomId}`);
  assert.deepEqual(hostView.data.members.map((m) => m.status), ["approved", "approved"]);
  const approvedRef = hostView.data.members.find((m) => m.role === "member").member_ref;
  assert.equal((await api.post(host, { action: "remove_member", roomId, memberRef: approvedRef })).status, 200);
  assert.equal((await api.get(alice, "?action=bootstrap")).data.rooms[0].people, 1);
  assert.equal((await api.get(alice, `?action=room&roomId=${roomId}`)).status, 403);
  assert.equal((await api.post(host, { action: "remove_member", roomId, memberRef: approvedRef })).status, 404, "removing twice is reported");
  assert.equal((await api.post(alice, { action: "review_member", roomId, memberRef: approvedRef, decision: "approve" })).status, 403, "only the host reviews");
});

test("D2: deleting a room removes every row and every stored receipt object", async () => {
  const uploads = r2();
  const api = await createApi({ uploads });
  const roomId = await openRoom(api);
  assert.equal((await api.post(alice, { action: "request_join", roomId })).status, 200);
  const ref = (await api.get(host, `?action=room&roomId=${roomId}`)).data.members.find((m) => m.status === "requested").member_ref;
  assert.equal((await api.post(host, { action: "review_member", roomId, memberRef: ref, decision: "approve" })).status, 200);
  assert.equal((await api.post(host, { action: "create_invite", roomId })).status, 200);
  assert.equal((await api.post(alice, { action: "send_message", roomId, body: "안녕하세요" })).status, 201);
  const receipt = new File([tinyPng()], "receipt.png", { type: "image/png" });
  assert.equal((await api.call("PUT", host, { query: `?action=update_order_info&roomId=${roomId}`, form: { estimatedArrival: "", orderTotal: "", receipt } })).status, 200);
  // An interrupted upload leaves an orphan under the room prefix; deletion must sweep it too.
  uploads.objects.set(`receipts/${roomId}/orphan.png`, { value: new ArrayBuffer(1), options: {} });
  assert.equal(uploads.objects.size, 2);

  assert.equal((await api.call("DELETE", alice, { query: `?roomId=${roomId}` })).status, 403, "members cannot delete");
  const deleted = await api.call("DELETE", host, { query: `?roomId=${roomId}` });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));

  for (const table of ["rooms", "room_members", "room_invites", "room_messages", "room_blocks"]) {
    const column = table === "rooms" ? "id" : "room_id";
    assert.equal(api.sql(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, roomId)[0].n, 0, `${table} is empty`);
  }
  assert.equal(uploads.objects.size, 0, "the receipt prefix is empty");
  assert.equal((await api.call("DELETE", host, { query: `?roomId=${roomId}` })).status, 404, "deleting twice is reported");
  assert.equal((await api.get(alice, "?action=bootstrap")).data.rooms.length, 0);
});
