# SIKGU runbook

Operational notes for the people who deploy and watch SIKGU. Product and
architecture are described in `README.md`; audit history is in `AUDIT.md`.

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
after every deploy and from any uptime monitor.

## Deploy

1. `npm ci`, then `npm test` and `npm run lint` must both exit 0. The test
   suite builds the production bundle first, so a green run means the bundle
   builds.
2. Push the branch the platform deploys from. The build step copies
   `.openai/hosting.json` and the `drizzle/` migrations into `dist/.openai/`
   (see `build/sites-vite-plugin.ts`); the platform applies any migration
   not yet applied to the production D1 database, in file order.
3. After the deploy, open `/api/sikgu?action=health`, then sign in and
   create, join, approve, chat in, and delete one test room.
4. Releases that change the API contract (the 2026-09-03 audit branch moved
   room creation from a client `closesAt` to `minutes`) make a browser tab
   that still holds the previous bundle fail its next room creation with a
   400 until the page is reloaded. Expect a few such reports right after the
   deploy; a reload fixes them.

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

- Redeploy the previous known-good commit. Every migration so far is
  additive (0004 adds `room_blocks`), so older code runs against the newer
  schema.
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
  50 expired rooms per run, one at a time, receipt objects before the row.
- Mutation lock: receipt updates and room deletion take a per-room lock
  (`rooms.mutation_token`) that goes stale after 2 minutes. A room stuck in
  status `deleting` after a failed deletion is hidden from everyone and is
  reclaimed by the host's next delete attempt or by the sweep.
- Rate limits: 5 open rooms per host, 5 active invite links per room, 30
  chat messages per minute and 750 ms between messages per member, one
  receipt replacement per 30 seconds. All are enforced inside SQL statements.

## Hand checks before a release

- Forged identity: `curl -s https://<public-host>/api/sikgu?action=bootstrap
  -H 'oai-authenticated-user-email: probe@example.com'` must return
  `"user":null`.
- Mutations work through the proxy: create a room in the browser (this
  exercises the same-origin check against the public origin).
- Receipt upload from a phone: choose an existing screenshot from the photo
  library, then view it as a member.
- Delete a room that has a receipt and confirm the object is gone from R2.
