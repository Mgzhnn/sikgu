#!/usr/bin/env node
/**
 * Identity boundary probe (completion plan B1).
 *
 * Sends an anonymous bootstrap, a bootstrap with forged
 * `oai-authenticated-user-*` headers, and a forged `create_room`, and exits
 * nonzero unless the origin strips the forged identity: bootstrap must answer
 * `user: null` both times and the mutation must be refused with 401.
 *
 *   node verification/identity-probe.mjs https://sikgu-dgist.ugrp44group.chatgpt.site
 *   npm run probe -- https://…
 *
 * Nothing is written; a 401 on create_room means no room was created. The
 * script prints one JSON line per check so the output can be committed under
 * verification/ as release evidence.
 */

const origin = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(origin)) {
  console.error("usage: node verification/identity-probe.mjs <origin>");
  process.exit(2);
}

const forged = {
  "oai-authenticated-user-email": "forged-probe@example.invalid",
  "oai-authenticated-user-full-name": "Forged%20Probe",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

const results = [];
let failed = false;

async function check(name, request, expect) {
  const started = Date.now();
  let status = 0;
  let body = null;
  let contentType = "";
  try {
    const response = await fetch(`${origin}${request.path}`, {
      method: request.method || "GET",
      headers: request.headers || {},
      body: request.body,
      redirect: "manual",
    });
    status = response.status;
    contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    try {
      body = contentType.includes("application/json") ? JSON.parse(text) : text.slice(0, 200);
    } catch {
      body = text.slice(0, 200);
    }
  } catch (error) {
    body = String(error);
  }
  const verdict = expect(status, body);
  const line = {
    check: name,
    origin,
    status,
    pass: verdict === true,
    detail: verdict === true ? undefined : verdict,
    user: body && typeof body === "object" && "user" in body ? body.user : undefined,
    durationMs: Date.now() - started,
    at: new Date().toISOString(),
  };
  results.push(line);
  if (!line.pass) failed = true;
  console.log(JSON.stringify(line));
}

await check(
  "anonymous bootstrap answers user: null",
  { path: "/api/sikgu?action=bootstrap" },
  (status, body) =>
    status === 200 && body && typeof body === "object" && body.user === null
      ? true
      : `expected 200 with user: null, got ${status} ${JSON.stringify(body).slice(0, 120)}`,
);

await check(
  "forged identity headers are stripped on bootstrap",
  { path: "/api/sikgu?action=bootstrap", headers: forged },
  (status, body) =>
    status === 200 && body && typeof body === "object" && body.user === null
      ? true
      : `expected 200 with user: null, got ${status} ${JSON.stringify(body).slice(0, 120)}`,
);

await check(
  "forged create_room is refused with 401",
  {
    path: "/api/sikgu",
    method: "POST",
    headers: {
      ...forged,
      "content-type": "application/json",
      "x-sikgu-request": "1",
      origin,
    },
    body: JSON.stringify({
      action: "create_room",
      restaurantId: "sinjeon",
      pickup: "E1",
      apps: ["baemin"],
      capacity: 2,
      minutes: 20,
      note: "identity probe",
    }),
  },
  (status) => (status === 401 ? true : `expected 401, got ${status}`),
);

console.log(JSON.stringify({
  summary: failed ? "FAIL" : "PASS",
  origin,
  checks: results.length,
  passed: results.filter((line) => line.pass).length,
  at: new Date().toISOString(),
}));
process.exit(failed ? 1 : 0);
