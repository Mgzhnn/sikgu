// The health check needs no identity and each probe costs a D1 query and a
// billed R2 list, so its result is cached per isolate (security review
// 2026-10-24, F-6). Each test fails on the code before the fix.
import test from "node:test";
import assert from "node:assert/strict";
import { createApi, r2 } from "./helpers/api-harness.mjs";

function countingUploads() {
  const uploads = r2();
  const list = uploads.list;
  uploads.lists = 0;
  uploads.list = async (options) => {
    uploads.lists += 1;
    return list(options);
  };
  return uploads;
}

async function withClock(start, run) {
  const realNow = Date.now;
  let now = start;
  Date.now = () => now;
  try {
    await run((ms) => { now += ms; });
  } finally {
    Date.now = realNow;
  }
}

test("repeated health requests within 30 seconds share one probe", async () => {
  const uploads = countingUploads();
  const api = await createApi({ uploads });
  await withClock(1_800_000_000_000, async (advance) => {
    for (let i = 0; i < 20; i += 1) {
      const response = await api.get(undefined, "?action=health");
      assert.equal(response.status, 200);
      advance(1000);
    }
    assert.equal(uploads.lists, 1, "20 requests over 20 seconds, one R2 list");
    advance(10_000);
    assert.equal((await api.get(undefined, "?action=health")).status, 200);
    assert.equal(uploads.lists, 2, "a new probe once the cached one is 30 seconds old");
  });
});

test("concurrent health requests share one in-flight probe", async () => {
  const uploads = countingUploads();
  const api = await createApi({ uploads });
  const responses = await Promise.all(Array.from({ length: 10 }, () => api.get(undefined, "?action=health")));
  assert.deepEqual(responses.map((response) => response.status), Array(10).fill(200));
  assert.equal(uploads.lists, 1);
});

test("an outage is reported within 30 seconds and recovery likewise", async () => {
  const uploads = countingUploads();
  const api = await createApi({ uploads });
  await withClock(1_800_000_000_000, async (advance) => {
    assert.equal((await api.get(undefined, "?action=health")).status, 200);
    const working = uploads.list;
    uploads.list = async () => { throw new Error("R2 unavailable"); };
    advance(29_000);
    assert.equal((await api.get(undefined, "?action=health")).status, 200, "still the cached probe");
    advance(1_000);
    const down = await api.get(undefined, "?action=health");
    assert.equal(down.status, 503);
    assert.equal(down.headers.get("retry-after"), "30");
    uploads.list = working;
    advance(10_000);
    assert.equal((await api.get(undefined, "?action=health")).status, 503, "the failure is cached too");
    advance(20_000);
    assert.equal((await api.get(undefined, "?action=health")).status, 200);
  });
});
