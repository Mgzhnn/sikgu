# SIKGU runbook

Operational notes for the people who deploy and watch SIKGU. Product and
architecture are described in `README.md`; the current repair record is `REPAIRS.md`, and the earlier audit history is in `AUDIT.md`.

## What runs where

- One Cloudflare Worker (`worker/index.ts`, built by vinext) serves the page
  and the single API route `/api/sikgu`.
- Cloudflare D1 database bound as `DB`; Cloudflare R2 bucket bound as
  `UPLOADS` (receipt images only). Both bindings are declared in
  `.openai/hosting.json` and injected by the hosting platform.
- Identity comes from the platform proxy's `oai-authenticated-user-*`
  headers. The worker must not be reachable except through that proxy; if it
  ever is, anyone can forge an identity (see AUDIT.md finding A1).

## Health

`GET /api/sikgu?action=health` needs no sign-in and returns
`{"ok":true,"database":"ok"}` after a one-row D1 round trip, or HTTP 503 with
`{"ok":false,"database":"unavailable"}` when D1 does not answer. Probe it
after every deploy and from any uptime monitor. This is a connectivity/liveness probe (`SELECT 1`), not a schema, R2, authentication or end-to-end readiness check. A missing migration or broken receipt bucket can coexist with a green health response.

## Deploy

1. Run `npm ci`, `npm test`, `npm run lint`, and `npm run test:browser` (install Playwright Chromium first). Inspect a fresh `npm audit --json`; use the per-advisory reasoning in `REPAIRS.md` rather than assuming all development packages are harmless.
2. Verify the hosting identity gate below before exposing a new release. Keep production data untouched during local verification.
3. Prepare and push the verified source, build/package its Sites artifact, save a version and deploy that explicit version through Sites. A GitHub push does not itself verify or perform this release workflow. The build packages `.openai/hosting.json` and generated migrations in `dist/.openai/`; verify the expected migration is in the artifact and applied by the platform.
4. Check migration/schema readiness through the platform's database tools (expected tables, columns and indexes), then probe health. In an authorized test room verify create, join, approve, chat, upload/read a receipt as a member, and delete. Verify the deleted receipt object is gone from R2.
5. Old tabs should reload after a contract change. This repair returns absolute `expiresAt` for invitation creation instead of `expiresInHours`; stale clients must not continue advertising 24 hours. New pagination fields are additive and optional cursor parameters preserve first-page behavior. Do not claim compatibility of stale cached UI just because the API still responds.

Last deploy: 2026-10-05, commit `e5e77d7` as Sites version 26, saved and deployed by Codex on the server with the Sites tools. Sites applied migrations 0004 and 0005; all tables were empty beforehand, so migration 0001's row deletion could not lose data. The owning ChatGPT account must be the one Codex is logged in as, or Sites reports the project as not found.

## Migrations

- Schema lives in `db/schema.ts`. Never hand-edit files under `drizzle/` or
  `drizzle/meta/`.
- To change the schema: edit `db/schema.ts`, run
  `npm run db:generate -- --name <short_name>`, read the generated SQL, add a
  test that applies all migrations in order (the existing tests do this with
  `node:sqlite`), and deploy.
- Migrations are forward-only. Write additive migrations (new tables, new
  nullable columns) so that rolling the code back does not break the schema.
- Production D1 does not allow toggling `PRAGMA foreign_keys`; use
  `PRAGMA defer_foreign_keys` if a migration needs it. Migration 0002 uses the
  old pragma but is already applied.

## Rollback

- Redeploy the previous known-good commit. Migration 0004 adds `room_blocks`; 0005 adds history/rate-window indexes and replaces the message-order index with one that adds an ID tie-breaker. It does not rewrite rows or remove columns, so earlier code can use the newer schema. Check the migration result before a rollback; do not undo the index migration by editing history.
- If a bad migration was applied, write a new forward migration that undoes
  it; do not edit or delete the applied file.

## Logs

- API failures are logged as one JSON line:
  `{"level":"error","reference":"<uuid>","context":"...","error":{...}}`.
  The user's error message ends with `(오류 코드 XXXXXXXX)`, the first eight
  characters of that `reference`; ask them for it and search the platform
  log viewer for that prefix.
- Log lines never contain emails, names, or request bodies. Keep it that
  way: log identifiers (room id, reference), not people.
- Deferred cleanups log with a fixed prefix: "Deferred stale receipt
  cleanup", "Deferred stale room cleanup", "Deferred previous receipt
  cleanup", "Deferred receipt commit verification", "Deferred claimed room
  deletion", "Receipt deletion must succeed before room deletion", and
  "Retention sweep failed". They are retried automatically (see below); a
  steady stream of them means R2 or D1 is unhealthy. A failed health probe
  logs `{"level":"error","context":"Health check database probe failed",...}`.

## Background behaviour worth knowing

- Retention: rooms are kept 30 days after their deadline so members can
  reopen the chat and receipt. A sweep runs at most once an hour per Worker
  isolate, triggered by the first feed load after the hour, and deletes up to
  50 expired rooms per run, one at a time, receipt objects before the row. This is best-effort physical deletion, not a 30-day deletion SLA. API read authorization still ends at the 30-day cutoff. No traffic means no sweep; isolates do not share a global schedule.
- Mutation lock: receipt updates and room deletion take a per-room lock
  (`rooms.mutation_token`) that goes stale after 2 minutes. A room stuck in
  status `deleting` after a failed deletion is hidden from everyone and is
  reclaimed by the host's next delete attempt or by the sweep.
- Rate limits: 5 open rooms per host, 5 active invite links per room, 30
  chat messages per minute and 750 ms between messages per member, one
  receipt replacement per 30 seconds. All are enforced inside SQL statements. Expired/exhausted links are pruned on creation. At the five-link cap the host receives an existing usable token; the limit is not a five-minute recovery promise.

## Cleanup monitoring and orphan recovery

Each attempted sweep emits a structured `retention_sweep` event containing selected, claimed, deleted and failed counts, pending room count, oldest overdue age and duration. No emails, names, tokens or message content are included. A backlog-query outage emits `backlog: "unavailable"`. Pending counts include all deletion tombstones, even a recently active deletion, so a single nonzero reading is not necessarily an outage.

Investigate repeated failures, increasing pending counts, or no successful sweep while expired data remains. Look for R2/D1 errors and stale mutation tokens; the next eligible sweep or a host deletion retry recovers tombstones. A request-triggered batch of 50 is not enough evidence that a large backlog has drained. The new metrics test injects a storage failure for one of three expired rooms: two are deleted and one remains observable and hidden.

No recurring Worker trigger is configured, and the available Sites manifest/tools did not establish a supported scheduling capability for this project. Do not add a fictitious cron or describe scheduled deletion as deployed. Before introducing a platform-supported scheduler, reuse the same fenced, bounded cleanup logic and test overlapping executions.

A receipt key whose room row has already vanished cannot be found by the room sweep. For orphan recovery, use authorized platform storage/database tools to inventory `receipts/<roomId>/` keys and compare them with room rows. Record only aggregate counts in routine logs. Recheck missing rows after a grace period exceeding the mutation timeout and upload window; review the concrete candidate list before deleting objects. No bucket-wide orphan sweep or destructive cleanup was run during this repair.

## Identity and device release gates

- Anonymous spoof-header test: request the public bootstrap endpoint with synthetic `oai-authenticated-user-*` headers and verify an actual app response has `user: null`. Verify a legitimate signed-in request separately. Never send a real user's identity or publish session cookies/tokens in evidence.
- A 403/HTML response from the edge is **inconclusive**, not a pass. Both plain and spoofed requests received that result on 2026-09-05; see `verification/hosting-probe.json`.
- On 2026-10-05 against version 26, the public origin returned real app responses: spoofed bootstrap gave `user: null` and a spoofed `create_room` got 401. This passes the spoof-header test for `sikgu-dgist.ugrp44group.chatgpt.site`; see `verification/production-probe-2026-10-05.log`. On the same day a separate Sites project (LineageGuard) accepted a genuine signed-in request and rejected the same spoofed header, so the platform injects identity only for real sessions.
- Check any reachable Worker, preview, custom-domain and alternate origins. They must either reject direct access or enforce the same trusted-proxy boundary. Sites returned no current preview URL and did not expose Worker routing/header-stripping configuration, so these checks remain unverified. Keep this as a release gate; local header stubs do not prove it.
- The browser suite uses Chromium with synthetic local API responses. Verify physical iOS Safari IME, keyboard/scroll behavior and receipt selection from the photo library before claiming iOS support was tested. On 2026-10-05 the owner ran a room test (create, Korean chat, receipt, delete) on an iPhone against version 26 and reported it working; no itemized results were recorded.
- Bootstrap history cursors use `(created_at, id)`; chat uses the same tie-breaker. Keep filters/sort fixed while paging. Feed amount sorting can change while totals change; it is a live view, not a transactionally frozen snapshot. Refresh if ordering changes during browsing.
