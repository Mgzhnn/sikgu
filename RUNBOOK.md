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
`{"ok":true,"database":"ok","storage":"ok"}` after a one-row D1 round trip
and a one-key R2 listing, or HTTP 503 with `Retry-After: 30` and the failing
dependency marked `"unavailable"`. Probe it after every deploy and from an
uptime monitor. This is a connectivity probe (`SELECT 1` plus `list`), not a
schema, authentication or end-to-end readiness check. A missing migration can
coexist with a green health response.

External monitor (COMPLETION.md item C2): _not yet configured_. When set up,
record here the monitor service, the probe URL, the interval and the alert
recipient, so the next operator knows where alerts go.

## Repository protection (COMPLETION.md item D3)

`main` must require a pull request with a green CI run before merge, and no
direct pushes. GitHub → repository Settings → Branches → Add rule for `main`:
"Require a pull request before merging", "Require status checks to pass"
(select the `verify` job), "Do not allow bypassing the above settings".
Record the date it was enabled here: _not yet enabled_.

## Deploy

1. Run `npm ci`, `npm test`, `npm run lint`, and `npm run test:browser` (install Playwright Chromium first). CI runs the same set plus `npm audit --omit=dev --audit-level=high`; merge only on a green run. For development-only audit entries use the per-advisory reasoning in `REPAIRS.md`.
2. After the deploy, run `npm run probe -- https://<origin>` and commit its output under `verification/` as `identity-probe-<date>.log`; it must print `"summary":"PASS"`. Keep production data untouched during local verification.
3. Prepare and push the verified source, build/package its Sites artifact, save a version and deploy that explicit version through Sites. A GitHub push does not itself verify or perform this release workflow. The build packages `.openai/hosting.json` and generated migrations in `dist/.openai/`; verify the expected migration is in the artifact and applied by the platform.
4. Check migration/schema readiness through the platform's database tools (expected tables, columns and indexes), then probe health. In an authorized test room verify create, join, approve, chat, upload/read a receipt as a member, and delete. Verify the deleted receipt object is gone from R2.
5. Old tabs should reload after a contract change. This repair returns absolute `expiresAt` for invitation creation instead of `expiresInHours`; stale clients must not continue advertising 24 hours. New pagination fields are additive and optional cursor parameters preserve first-page behavior. Do not claim compatibility of stale cached UI just because the API still responds.

Last deploy: 2026-10-05, commit `e5e77d7` as Sites version 26, saved and deployed by Codex on the server with the Sites tools. Sites applied migrations 0004 and 0005; all tables were empty beforehand, so migration 0001's row deletion could not lose data. The owning ChatGPT account must be the one Codex is logged in as, or Sites reports the project as not found.

## Catalog: adding or updating a restaurant or pickup point

The catalog is code, deployed with the app (no admin UI by decision; see
COMPLETION.md). Minimums and fees change on Baemin and Coupang Eats, so
review them on a fixed cadence (once per semester) and record the date in
the header comment of `app/catalog.ts`.

1. Minimum order amounts per app live in `app/sikgu-rules.mjs`
   (`restaurantMinimums`); the restaurant's name, cuisine, address, delivery
   fees and menu live in `app/catalog.ts` (`restaurants`). Both keys must
   match exactly; the server validates room creation against
   `restaurantMinimums` and the client renders from `catalog.ts`.
2. To add a restaurant: add its id and both minimums to `restaurantMinimums`,
   then its entry to `restaurants` in `catalog.ts` with `verified: true` only
   after checking the address on the map link. To update prices: edit the
   numbers only.
3. Pickup points: `pickupFullNames` in `app/sikgu-rules.mjs` and
   `pickupPoints` in `app/catalog.ts` (with map coordinates) must stay in
   step.
4. Never remove or rename an id that existing rooms may use: rooms with an
   unknown id are hidden from every list, including My Rooms. Retire a
   restaurant by leaving its id in place and setting a note in the catalog
   entry; remove it only after the 30-day retention window has passed.
5. Run `node --test` (the catalog preservation test checks the 21/8 counts
   and the id correspondence; update its expectations when the set
   deliberately changes), then deploy as a normal release.

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

Every migration so far is additive (0004 adds `room_blocks`, 0005 adds
indexes, 0006 adds the nullable `room_members.amount` and
`rooms.extensions` columns), so earlier code runs against the newer schema.
Never undo a migration by editing history; if a migration itself is bad,
write a new forward migration that reverses it.

Procedure (rehearse once and record the date and elapsed time below):

1. Note the current live version number from the Sites project view and the
   commit it was built from (README "Production" line).
2. On the server, open Codex in the project folder, signed in as the owning
   account (the UG account; a wrong account reports "project not found").
3. Ask Codex to list the saved Sites versions and deploy the previous
   known-good version number publicly. Do not rebuild: redeploying a saved
   version is the rollback.
4. Probe `GET /api/sikgu?action=health` on the public origin and run
   `npm run probe -- https://<origin>`; both must pass.
5. In a test room, create, join from a second account, approve, chat, and
   delete. Confirm the deleted receipt object is gone.
6. Record the rollback in REPAIRS.md: from version, to version, reason, time.
7. When the fix is ready, deploy forward as a new version; never leave the
   rolled-back version undocumented.

Rehearsal record: _not yet rehearsed_ (COMPLETION.md item C3; fill in the
date, the from/to versions and the elapsed time here after the rehearsal).

## Logs

- API failures are logged as one JSON line:
  `{"level":"error","reference":"<uuid>","context":"...","error":{...}}`.
  The user's error message ends with `(오류 코드 XXXXXXXX)`, the first eight
  characters of that `reference`; ask them for it and search the platform
  log viewer for that prefix.

### Finding a failure from the code a user quotes

Worked example. A student reports: "저장이 안 돼요. 서버 오류가 발생했습니다.
(오류 코드 225af8ad)".

1. The eight characters are the prefix of the `reference` UUID in exactly
   one log line. In the Sites project, open Logs, set the time range to the
   hour the student reported, and search for `225af8ad`.
2. The matching line looks like
   `{"level":"error","reference":"225af8ad-3f7a-4d2f-831d-5f2c7f60b84e","context":"Failed to update private order information","error":{"name":"Error","message":"영수증 저장소가 연결되지 않았습니다.","stack":"..."}}`.
   `context` names the handler (here the order-info PUT); `error.message` is
   the cause (here the R2 binding was missing). The stack shows the file and
   line in the deployed build.
3. There is no email, name, room id or request body in the line by design.
   If you need the room, ask the student which room and when; do not add
   identities to the log.
4. Deferred-cleanup lines ("Deferred …") and the `retention_sweep` event are
   not keyed by a reference; search by the prefix text instead.
5. Reply to the student with what happened in plain words and, if it was a
   platform fault, when it was fixed. Record platform faults in REPAIRS.md
   with the reference so repeat reports can be matched.
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
