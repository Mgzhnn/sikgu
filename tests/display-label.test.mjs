// The fallback label for accounts without a profile name (security review
// 2026-10-24, F-4). It used to be an unsalted SHA-256 prefix of the email, so
// anyone with a list of campus addresses could confirm who a label belongs to.
// Each test fails on the code before the fix.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createApi, identity } from "./helpers/api-harness.mjs";

const email = "noname@dgist.ac.kr";
const label = (digest) => `User-${digest.subarray(0, 3).toString("hex").toUpperCase()}`;

async function labelOf(api, address) {
  const response = await api.get(identity(address), "?action=bootstrap");
  assert.equal(response.status, 200);
  return response.data.user.displayName;
}

test("the label cannot be recomputed from the email alone", async () => {
  const api = await createApi();
  const shown = await labelOf(api, email);
  assert.match(shown, /^User-[0-9A-F]{6}$/);
  assert.notEqual(shown, label(createHash("sha256").update(email).digest()), "plain SHA-256 prefix");

  const [{ value }] = api.sql("SELECT value FROM app_keys WHERE name = 'display_label'");
  assert.match(value, /^[0-9a-f]{64}$/);
  assert.equal(shown, label(createHmac("sha256", Buffer.from(value, "hex")).update(email).digest()));
});

test("the label is stable for one account and distinct between accounts", async () => {
  const api = await createApi();
  const first = await labelOf(api, email);
  assert.equal(await labelOf(api, email), first);
  assert.equal(await labelOf(api, "  NoName@DGIST.ac.kr "), first, "the email is normalized before keying");
  assert.notEqual(await labelOf(api, "other@dgist.ac.kr"), first);
  assert.equal(api.sql("SELECT COUNT(*) AS count FROM app_keys")[0].count, 1, "one key, created once");
});

test("each database gets its own key, so labels do not carry over", async () => {
  const one = await createApi();
  const [{ value: firstKey }] = (await labelOf(one, email), one.sql("SELECT value FROM app_keys"));
  const two = await createApi();
  await labelOf(two, email);
  const [{ value: secondKey }] = two.sql("SELECT value FROM app_keys");
  assert.notEqual(secondKey, firstKey);
});

test("the key never appears in an API response", async () => {
  const api = await createApi();
  const host = identity(email);
  const created = await api.post(host, {
    action: "create_room", restaurantId: "sinjeon", pickup: "E1", apps: ["baemin"], capacity: 4, minutes: 30,
  });
  assert.equal(created.status, 201);
  const [{ value }] = api.sql("SELECT value FROM app_keys");
  for (const query of ["?action=bootstrap", `?action=room&roomId=${created.data.roomId}`]) {
    const response = await api.get(host, query);
    assert.equal(response.status, 200);
    assert.doesNotMatch(JSON.stringify(response.data), new RegExp(value));
  }
});
