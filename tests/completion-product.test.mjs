/**
 * Behaviour tests for COMPLETION.md group 2 (A1–A4, B2): member amounts
 * summed into the room total, host extend / close-early, cancellable and
 * visible join requests, honest room-gone codes, and the join-request rate
 * limit. Every test runs the real route against the real migrations.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createApi, identity } from "./helpers/api-harness.mjs";

const host = identity("host@dgist.ac.kr", "김민수");
const alice = identity("alice@dgist.ac.kr", "Alice Park");
const bob = identity("bob@dgist.ac.kr", "Bob Lee");

async function openRoom(api, who = host, overrides = {}) {
  const created = await api.post(who, {
    action: "create_room", restaurantId: "sinjeon", pickup: "E1", apps: ["baemin"],
    capacity: 4, minutes: 30, ...overrides,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data.roomId;
}

async function approve(api, roomId, who) {
  assert.equal((await api.post(who, { action: "request_join", roomId })).status, 200);
  const view = await api.get(host, `?action=room&roomId=${roomId}`);
  const pending = view.data.members.find((member) => member.status === "requested");
  assert.ok(pending?.member_ref, "the host sees the pending request");
  assert.equal((await api.post(host, { action: "review_member", roomId, memberRef: pending.member_ref, decision: "approve" })).status, 200);
  return pending.member_ref;
}

const feedTotal = async (api, who, roomId) =>
  (await api.get(who, "?action=bootstrap")).data.rooms.find((pool) => pool.id === roomId)?.total;

test("A1: the room total is the sum of approved members' amounts, never typed by the host", async () => {
  const api = await createApi();
  const roomId = await openRoom(api);
  const aliceRef = await approve(api, roomId, alice);

  assert.equal((await api.post(alice, { action: "set_amount", roomId, amount: 7000 })).status, 200);
  const hostOwn = await api.post(host, { action: "set_amount", roomId, amount: 8000 });
  assert.equal(hostOwn.status, 200);
  assert.equal(hostOwn.data.total, 15000);
  assert.equal(await feedTotal(api, bob, roomId), 15000, "the public feed shows the summed total");

  const view = await api.get(alice, `?action=room&roomId=${roomId}`);
  const mine = view.data.members.find((member) => member.mine === 1);
  assert.equal(mine.amount, 7000);
  assert.ok(view.data.members.every((member) => !("user_email" in member)));

  // The host can set a member's amount for them; a member cannot touch another's.
  assert.equal((await api.post(host, { action: "set_amount", roomId, amount: 9000, memberRef: aliceRef })).status, 200);
  assert.equal(await feedTotal(api, bob, roomId), 17000);
  assert.equal((await api.post(alice, { action: "set_amount", roomId, amount: 1, memberRef: aliceRef })).status, 403);

  // Validation and membership.
  assert.equal((await api.post(alice, { action: "set_amount", roomId, amount: -5 })).status, 400);
  assert.equal((await api.post(alice, { action: "set_amount", roomId, amount: 10_000_001 })).status, 400);
  assert.equal((await api.post(alice, { action: "set_amount", roomId, amount: 12.5 })).status, 400);
  assert.equal((await api.post(bob, { action: "request_join", roomId })).status, 200);
  assert.equal((await api.post(bob, { action: "set_amount", roomId, amount: 5000 })).status, 403, "a pending requester has no amount");

  // Clearing an amount and removing a member both re-sum.
  assert.equal((await api.post(alice, { action: "set_amount", roomId, amount: null })).status, 200);
  assert.equal(await feedTotal(api, bob, roomId), 8000);
  assert.equal((await api.post(alice, { action: "set_amount", roomId, amount: 6000 })).status, 200);
  assert.equal((await api.post(host, { action: "remove_member", roomId, memberRef: aliceRef })).status, 200);
  assert.equal(await feedTotal(api, bob, roomId), 8000, "a removed member's amount leaves the total");

  // The host's order-info form no longer carries the pooled total.
  const put = await api.call("PUT", host, { query: `?action=update_order_info&roomId=${roomId}`, form: { estimatedArrival: "", orderTotal: "30000" } });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal(await feedTotal(api, bob, roomId), 8000, "saving order info does not reset the total");
});

test("A2: the host can extend recruitment twice by 15 minutes, until 10 minutes after the deadline", async () => {
  const api = await createApi();
  const roomId = await openRoom(api, host, { minutes: 20 });
  const before = (await api.get(host, `?action=room&roomId=${roomId}`)).data.room.closesAt;
  const invite = await api.post(host, { action: "create_invite", roomId });
  assert.equal(invite.status, 200);

  assert.equal((await api.post(alice, { action: "extend_room", roomId })).status, 403, "only the host extends");
  await approve(api, roomId, alice);
  assert.equal((await api.post(alice, { action: "extend_room", roomId })).status, 403, "members cannot extend");

  const first = await api.post(host, { action: "extend_room", roomId });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.ok(first.data.closesAt >= before + 15 * 60 * 1000 - 50, "the deadline moved by fifteen minutes");
  assert.equal(first.data.extensions, 1);
  const [inviteRow] = api.sql("SELECT expires_at FROM room_invites WHERE room_id = ?", roomId);
  assert.equal(inviteRow.expires_at, first.data.closesAt, "live invite links follow the new deadline");

  const second = await api.post(host, { action: "extend_room", roomId });
  assert.equal(second.status, 200);
  assert.equal(second.data.extensions, 2);
  const third = await api.post(host, { action: "extend_room", roomId });
  assert.equal(third.status, 409);
  assert.match(third.data.error, /2번/);

  // A fresh room whose deadline passed more than ten minutes ago cannot be revived.
  const stale = await openRoom(api, host, { minutes: 20 });
  api.sql("UPDATE rooms SET closes_at = ? WHERE id = ?", Date.now() - 11 * 60 * 1000, stale);
  const revive = await api.post(host, { action: "extend_room", roomId: stale });
  assert.equal(revive.status, 409);
  assert.match(revive.data.error, /10분/);

  // Within the grace period the extension counts from now, not from the old deadline.
  const grace = await openRoom(api, host, { minutes: 20 });
  api.sql("UPDATE rooms SET closes_at = ? WHERE id = ?", Date.now() - 5 * 60 * 1000, grace);
  const revived = await api.post(host, { action: "extend_room", roomId: grace });
  assert.equal(revived.status, 200);
  assert.ok(revived.data.closesAt > Date.now() + 14 * 60 * 1000, "a revived room gets a full fifteen minutes");
});

test("A2: closing recruitment early keeps chat, amounts and receipts open", async () => {
  const api = await createApi();
  const roomId = await openRoom(api);
  await approve(api, roomId, alice);
  assert.equal((await api.post(alice, { action: "close_recruitment", roomId })).status, 403);

  const closed = await api.post(host, { action: "close_recruitment", roomId });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));
  assert.ok(closed.data.closesAt <= Date.now());
  assert.equal((await api.post(host, { action: "close_recruitment", roomId })).status, 409, "closing twice is reported");

  assert.equal((await api.get(bob, "?action=bootstrap")).data.rooms.some((pool) => pool.id === roomId), false, "a closed room leaves the feed");
  assert.equal((await api.post(bob, { action: "request_join", roomId })).status, 409);
  assert.equal((await api.post(host, { action: "create_invite", roomId })).status, 409);
  assert.equal((await api.post(alice, { action: "send_message", roomId, body: "주문했어요" })).status, 201, "chat stays open");
  assert.equal((await api.post(alice, { action: "set_amount", roomId, amount: 9000 })).status, 200, "amounts stay editable");
  assert.equal((await api.get(alice, `?action=room&roomId=${roomId}`)).status, 200);
  assert.equal((await api.get(host, "?action=bootstrap")).data.myRooms.some((pool) => pool.id === roomId), true, "it stays in My Rooms");
});

test("A3: a pending requester can cancel, sees the room in My Rooms, and sees a rejection", async () => {
  const api = await createApi();
  const roomId = await openRoom(api);
  assert.equal((await api.post(alice, { action: "request_join", roomId })).status, 200);

  const mine = (await api.get(alice, "?action=bootstrap")).data.myRooms.find((pool) => pool.id === roomId);
  assert.equal(mine?.myStatus, "requested", "a pending request is listed");
  assert.equal("estimatedArrival" in mine, false, "without private order details");

  assert.equal((await api.post(alice, { action: "leave_room", roomId })).status, 200, "cancelling is leaving");
  const afterCancel = await api.get(alice, "?action=bootstrap");
  assert.equal(afterCancel.data.rooms.find((pool) => pool.id === roomId).myStatus, null);
  assert.equal(afterCancel.data.myRooms.some((pool) => pool.id === roomId), false);

  assert.equal((await api.post(alice, { action: "request_join", roomId })).status, 200);
  const ref = (await api.get(host, `?action=room&roomId=${roomId}`)).data.members.find((member) => member.status === "requested").member_ref;
  assert.equal((await api.post(host, { action: "review_member", roomId, memberRef: ref, decision: "reject" })).status, 200);
  const rejected = await api.get(alice, "?action=bootstrap");
  assert.equal(rejected.data.rooms.find((pool) => pool.id === roomId).myStatus, "rejected", "a rejection is visible");
  assert.equal((await api.post(alice, { action: "request_join", roomId })).status, 200, "and the host can be asked again");
  assert.equal((await api.get(bob, "?action=bootstrap")).data.rooms.find((pool) => pool.id === roomId).myStatus, null, "others are unaffected");
});

test("A4: a deleted room and a removed member get different codes on the room read", async () => {
  const api = await createApi();
  const roomId = await openRoom(api);
  const aliceRef = await approve(api, roomId, alice);
  await approve(api, roomId, bob);

  assert.equal((await api.post(host, { action: "remove_member", roomId, memberRef: aliceRef })).status, 200);
  const removed = await api.get(alice, `?action=room&roomId=${roomId}`);
  assert.equal(removed.status, 403);
  assert.equal(removed.data.code, "removed");

  const deleted = await api.call("DELETE", host, { query: `?roomId=${roomId}` });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  const gone = await api.get(bob, `?action=room&roomId=${roomId}`);
  assert.equal(gone.status, 404);
  assert.equal(gone.data.code, "room_gone");

  const unknown = await api.get(bob, "?action=room&roomId=room_does-not-exist");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.data.code, "room_gone");
});

test("B2: join requests are limited to ten per user per ten minutes inside the INSERT", async () => {
  const api = await createApi();
  const hosts = [identity("h1@dgist.ac.kr", "호스트일"), identity("h2@dgist.ac.kr", "호스트이"), identity("h3@dgist.ac.kr", "호스트삼")];
  const rooms = [];
  for (let index = 0; index < 12; index += 1) rooms.push(await openRoom(api, hosts[index % 3]));

  const results = await Promise.all(rooms.map((roomId) => api.post(alice, { action: "request_join", roomId })));
  const ok = results.filter((result) => result.status === 200).length;
  const limited = results.filter((result) => result.status === 429);
  assert.equal(ok, 10, "exactly ten requests get through");
  assert.equal(limited.length, 2);
  assert.equal(limited[0].headers.get("retry-after"), "600");
  assert.match(limited[0].data.error, /너무 많아요/);
});
