// Regression tests for the 2026-10-22 review: limits the server promised in
// README and RUNBOOK but did not enforce. Each test fails on the code before
// the fix.
import test from "node:test";
import assert from "node:assert/strict";
import { createApi, identity } from "./helpers/api-harness.mjs";

const host = identity("host@dgist.ac.kr", "김민수");
const alice = identity("alice@dgist.ac.kr", "Alice Park");

function openRoom(api, who = host, overrides = {}) {
  return api.post(who, {
    action: "create_room", restaurantId: "sinjeon", pickup: "E1", apps: ["baemin"],
    capacity: 8, minutes: 30, ...overrides,
  });
}

test("join requests are limited per request, so cancelling does not reset the limit", async () => {
  const api = await createApi();
  const roomId = (await openRoom(api)).data.roomId;
  const statuses = [];
  for (let i = 0; i < 12; i += 1) {
    statuses.push((await api.post(alice, { action: "request_join", roomId })).status);
    await api.post(alice, { action: "leave_room", roomId });
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
  assert.equal(statuses[10], 429);
});

test("rooms a user hosts or joined by invite do not use up their join requests", async () => {
  const api = await createApi();
  for (let i = 0; i < 5; i += 1) assert.equal((await openRoom(api, alice)).status, 201);
  for (let i = 0; i < 5; i += 1) {
    const other = identity(`h${i}@dgist.ac.kr`, "호스트");
    const roomId = (await openRoom(api, other)).data.roomId;
    const invite = await api.post(other, { action: "create_invite", roomId });
    assert.equal((await api.post(alice, { action: "accept_invite", roomId, token: invite.data.token })).status, 200);
  }
  const target = (await openRoom(api, identity("z@dgist.ac.kr", "제트"))).data.roomId;
  assert.equal((await api.post(alice, { action: "request_join", roomId: target })).status, 200);
});

test("the join-request log keeps only the rate-limit window", async () => {
  const api = await createApi();
  const roomId = (await openRoom(api)).data.roomId;
  api.sql("INSERT INTO join_requests (user_email, created_at) VALUES (?, ?)", "old@dgist.ac.kr", Date.now() - 11 * 60 * 1000);
  assert.equal((await api.post(alice, { action: "request_join", roomId })).status, 200);
  const rows = api.sql("SELECT user_email FROM join_requests");
  assert.deepEqual(rows.map((row) => row.user_email), ["alice@dgist.ac.kr"]);
});

test("reopening closed rooms cannot take a host past five open rooms", async () => {
  const api = await createApi();
  const first = [];
  for (let i = 0; i < 5; i += 1) first.push((await openRoom(api)).data.roomId);
  for (const id of first) assert.equal((await api.post(host, { action: "close_recruitment", roomId: id })).status, 200);
  for (let i = 0; i < 5; i += 1) assert.equal((await openRoom(api)).status, 201);
  const reopened = await api.post(host, { action: "extend_room", roomId: first[0] });
  assert.equal(reopened.status, 429);
  const open = api.sql(
    "SELECT COUNT(*) AS n FROM rooms WHERE host_email = ? AND status = 'open' AND closes_at > ?",
    "host@dgist.ac.kr", Date.now(),
  )[0].n;
  assert.equal(open, 5);
});

test("extending a room that is still open is not limited by the open-room cap", async () => {
  const api = await createApi();
  const ids = [];
  for (let i = 0; i < 5; i += 1) ids.push((await openRoom(api)).data.roomId);
  assert.equal((await api.post(host, { action: "extend_room", roomId: ids[0] })).status, 200);
});

test("a new invite link takes the room's deadline at the moment it is written", async () => {
  const api = await createApi();
  const roomId = (await openRoom(api, host, { minutes: 20 })).data.roomId;
  const db = globalThis.__sikguEnv.DB;
  const realBatch = db.batch.bind(db);
  let injected = false;
  db.batch = async (statements) => {
    if (!injected && statements.length === 2) {
      injected = true;
      // The host's extend from a second tab commits between the read and the write.
      api.sql("UPDATE rooms SET closes_at = closes_at + 900000, extensions = extensions + 1 WHERE id = ?", roomId);
    }
    return realBatch(statements);
  };
  try {
    const invite = await api.post(host, { action: "create_invite", roomId });
    assert.equal(invite.status, 200);
    const [room] = api.sql("SELECT closes_at FROM rooms WHERE id = ?", roomId);
    const [row] = api.sql("SELECT expires_at FROM room_invites WHERE room_id = ?", roomId);
    assert.equal(row.expires_at, room.closes_at);
    assert.equal(invite.data.expiresAt, room.closes_at);
  } finally {
    db.batch = realBatch;
  }
});

test("the social preview image is declared at its real size", async () => {
  const { readFileSync } = await import("node:fs");
  const png = readFileSync(new URL("../public/og.png", import.meta.url));
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, new RegExp(`width: ${width},\\s*height: ${height},`));
});
