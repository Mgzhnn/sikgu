// Chat volume ceilings (security review 2026-10-24, F-2). The per-member rate
// limits bound speed only, so one account chatting in its own rooms could keep
// writing for 30 days and fill D1. Each test fails on the code before the fix.
import test from "node:test";
import assert from "node:assert/strict";
import { createApi, identity } from "./helpers/api-harness.mjs";

const host = identity("host@dgist.ac.kr", "김민수");

async function openRoom(api, who = host) {
  const created = await api.post(who, {
    action: "create_room", restaurantId: "sinjeon", pickup: "E1", apps: ["baemin"],
    capacity: 8, minutes: 30,
  });
  assert.equal(created.status, 201);
  return created.data.roomId;
}

function seedMessages(api, { roomId, sender, count, createdAt }) {
  const insert = api.db.prepare(
    "INSERT INTO room_messages (id, room_id, sender_email, sender_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  api.db.exec("BEGIN");
  for (let i = 0; i < count; i += 1) insert.run(`msg_seed_${roomId}_${sender}_${i}`, roomId, sender, "씨앗", "seed", createdAt);
  api.db.exec("COMMIT");
}

test("a room stops accepting messages at 2,000", async () => {
  const api = await createApi();
  const roomId = await openRoom(api);
  // Old messages from someone else, so only the room ceiling can apply.
  seedMessages(api, { roomId, sender: "earlier@dgist.ac.kr", count: 1999, createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000 });

  assert.equal((await api.post(host, { action: "send_message", roomId, body: "마지막 자리" })).status, 201);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const refused = await api.post(host, { action: "send_message", roomId, body: "넘침" });
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /2,000개/);
  assert.equal(api.sql("SELECT COUNT(*) AS count FROM room_messages WHERE room_id = ?", roomId)[0].count, 2000);
});

test("one account sends at most 500 messages a day across all rooms", async () => {
  const api = await createApi();
  const first = await openRoom(api);
  const second = await openRoom(api);
  seedMessages(api, { roomId: first, sender: "host@dgist.ac.kr", count: 500, createdAt: Date.now() - 2 * 60 * 60 * 1000 });

  const refused = await api.post(host, { action: "send_message", roomId: second, body: "다른 방" });
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get("retry-after"), "3600");
  assert.match(refused.data.error, /하루에 500개/);

  // Messages older than a day no longer count.
  api.sql("UPDATE room_messages SET created_at = ? WHERE sender_email = ?", Date.now() - 25 * 60 * 60 * 1000, "host@dgist.ac.kr");
  assert.equal((await api.post(host, { action: "send_message", roomId: second, body: "다음 날" })).status, 201);
});

test("the daily count across rooms is served by an index on sender and time", async () => {
  const api = await createApi();
  const plan = api.sql(
    "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM room_messages WHERE sender_email = ? AND created_at > ?",
    "host@dgist.ac.kr", 0,
  ).map((row) => row.detail).join("\n");
  assert.match(plan, /room_messages_sender_day_idx/);
});
