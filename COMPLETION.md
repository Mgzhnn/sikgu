# SIKGU completion plan — fixed scope

Written 2026-10-05 from the full audit of commit `f964b71`. This list is closed:
when every box below is ticked, the project is finished. Nothing found later is
added here; it goes to a separate backlog that does not block completion.

**Definition of done:** all 24 items ticked, CI green on `main`, the deployed
Sites version recorded in README, the identity probe passed on that version,
and `main` tagged `v1.0.0`.

**Out of scope, by decision (do not add):** admin UI for the catalog, payment
or settlement, push notifications, host transfer, 요기요 or other apps,
free-text restaurants, multi-campus or i18n, native app, analytics,
performance work beyond what the items below require.

Each item: acceptance check, size (S ≤ half a day, M ≤ 2 days, L ≤ a week).

---

## A. Product completeness (the three gaps that send students back to KakaoTalk)

- [x] **A1 · Per-member order amount** (L)
  `room_members.amount` (integer won, nullable) added by a Drizzle migration.
  Approved members set and edit their own amount in the room; the host can
  override any member's amount. `rooms.total` is no longer typed by hand: the
  API computes `SUM(amount)` for feed, room and sort. The host's manual
  "현재 모인 주문금액" field is removed.
  *Accept:* harness tests for set / edit / override / sum; browser test for a
  member entering an amount; feed shows the summed total.

- [x] **A2 · Extend and close recruitment** (M)
  Host actions `extend_room` (+15 min, max 2 times, allowed until 10 min after
  `closes_at`) and `close_recruitment` (sets `closes_at = now`, keeps chat and
  receipts). Both checked inside the UPDATE with `databaseNow`. Invite expiry
  follows the new `closes_at`.
  *Accept:* harness tests for both actions and their limits; buttons in the
  room header; the "마감됨" state reflects the new deadline.

- [x] **A3 · Pending requests are visible and cancellable** (M)
  "신청 취소" in the pool modal calls `leave_room`. My Rooms lists `requested`
  rooms with a badge. Rejection is visible: the card shows "거절됨" instead of
  flipping back to "참여 신청".
  *Accept:* harness test that a requester can leave; `myRooms` includes
  requested rows; browser test for the three card states.

- [x] **A4 · Honest room-gone messages** (S)
  Room GET returns 404 with `code: "room_gone"` when the row is absent or in
  `deleting`, and 403 with `code: "removed"` when only the membership is
  absent. The room sheet closes itself with the matching toast.
  *Accept:* harness tests for both codes; browser test that the sheet closes.

## B. Security and privacy

- [x] **B1 · Scripted identity probe** (S)
  `verification/identity-probe.mjs` sends anonymous and forged-header
  requests to a given origin and exits nonzero unless bootstrap returns
  `user: null` and `create_room` returns 401.
  *Accept:* script in repo; RUNBOOK release checklist runs it; its output for
  the final deploy is committed under `verification/`.

- [x] **B2 · Join-request rate limit** (S)
  At most 10 `request_join` writes per user per 10 minutes, enforced inside
  the INSERT like the chat limiter.
  *Accept:* harness test with the limit crossed under concurrent requests.

- [x] **B3 · Runtime security headers** (S)
  One test fetches the built worker (or a Playwright request) and asserts
  CSP, `X-Content-Type-Options`, `Referrer-Policy` and frame headers from the
  actual response instead of regexes over `worker/index.ts`.
  *Accept:* the regex test is deleted; the runtime test passes in CI.

- [x] **B4 · In-app privacy notice** (S)
  A visible 개인정보 notice: what is stored (masked name, email, messages,
  receipts), that rooms are readable 30 days and deleted best-effort after,
  and how to delete a room. Korean PIPA baseline for an app storing names.
  *Accept:* reachable from the profile view; text reviewed by the owner.

## C. Reliability and operations

- [ ] **C1 · Retention sweep proven in production** (S)
  After a deploy, a `retention_sweep` log line is observed in the Sites log
  viewer. If the sweep is cut short by subrequest limits, `LIMIT 50` becomes
  `LIMIT 10`. If Sites offers a scheduled trigger, the sweep moves there.
  *Accept:* a dated note in RUNBOOK with the observed log line and the chosen
  limit.

- [ ] **C2 · Health check covers storage and has a monitor** (S)
  `?action=health` also does a 1-object R2 list and reports `storage`. An
  external uptime monitor polls it and emails the owner on failure.
  *Accept:* health JSON includes `storage`; monitor URL and recipient recorded
  in RUNBOOK.

- [ ] **C3 · Rollback rehearsed once** (S)
  Redeploy the previous Sites version through Codex, confirm the site serves
  it, redeploy current. Record the exact steps and elapsed time.
  *Accept:* RUNBOOK rollback section is a numbered procedure with a date.

- [ ] **C4 · Error reference lookup documented** (S)
  How to find a server log line by the 8-character reference a user quotes.
  *Accept:* RUNBOOK section with a worked example.

## D. Quality gates

- [x] **D1 · CI runs the full gate** (S)
  CI adds `npx playwright install --with-deps chromium && npm run
  test:browser` and `npm audit --omit=dev --audit-level=high`.
  *Accept:* both steps green on `main`.

- [x] **D2 · Behaviour tests replace source regexes for the risky paths** (M)
  New tests for: room GET 401 redirect, load-more racing a poll, host
  approve / reject / remove round trip, order-info PUT round trip, DELETE
  round trip, health 503. Source-regex assertions that lock implementation
  strings for these paths are removed.
  *Accept:* the six behaviours each have a passing test; `tests/helpers/
  client-source.mjs` asserts its splice anchors exist.

- [ ] **D3 · Branch protection** (S)
  `main` requires a pull request and a green CI run; no direct pushes.
  *Accept:* GitHub branch protection enabled; recorded in RUNBOOK.

## E. Dependencies and maintenance

- [x] **E1 · Dev-dependency advisories cleared where fixable** (S)
  Bump `@cloudflare/vite-plugin` and `wrangler` to current; `npm audit fix`
  for `brace-expansion` and `fast-uri`. REPAIRS dependency table re-dated.
  *Accept:* `npm audit` lists only vinext-rooted entries; build and all tests
  pass.

- [ ] **E2 · vinext 1.x decision** (L or S)
  Either migrate to vinext 1.x with build, Node and browser tests passing,
  or write a dated decision note in REPAIRS stating the pin stays and why.
  *Accept:* one of the two, recorded.

- [x] **E3 · Package hygiene** (S)
  Package renamed from `site-creator-vinext-starter` to `sikgu`;
  `.npmrc` sets `strict-allow-scripts=true`; `npm ci` succeeds.
  *Accept:* `npm ci` clean in CI with strict scripts.

## F. Code structure (bounded refactor, no behaviour change)

- [ ] **F1 · Split the API route** (M)
  `app/api/sikgu/route.ts` becomes `rooms.ts`, `chat.ts`, `receipts.ts`,
  `retention.ts`, `lock.ts` and a short dispatcher. Raw SQL stays.
  *Accept:* no file over 500 lines; all existing tests pass unchanged except
  for import paths.

- [ ] **F2 · Split the page** (M)
  `app/page.tsx` becomes `useFeed`, `useSession`, `continuations.ts`,
  `lib/api.ts`, `lib/pool-status.ts` and one file per modal.
  *Accept:* `Home` under 300 lines; browser tests pass unchanged.

- [ ] **F3 · Dead code removed** (S)
  Email-scrub table scans in the sweep, `review_token` backfill in GET (after
  confirming no NULL rows in production), unused `db/index.ts`, legacy
  receipt key names, JPEG receipt tests for a PNG-only path.
  *Accept:* each removal has a one-line note in the commit; tests pass.

## G. Documentation and handover

- [ ] **G1 · Docs match the final code** (S)
  README feature list and file tree, RUNBOOK release checklist as numbered
  steps, REPAIRS closed with a final date. A "how to add or update a
  restaurant" procedure (edit `sikgu-rules.mjs` and `catalog.ts`, run the
  catalog preservation test, deploy).
  *Accept:* a reader can deploy and update the catalog from the docs alone.

- [ ] **G2 · Catalog reviewed once** (S)
  Minimums and delivery fees for all 21 restaurants checked against Baemin
  and Coupang Eats on one date, corrected, and the date written at the top of
  `catalog.ts`.
  *Accept:* dated header; catalog preservation test updated if values moved.

---

## Suggested order (five pull requests)

1. **Gate first:** D1, D3, E1, E3, B1 — so every later PR is checked the same way.
2. **Product:** A1, A2, A3, A4, B2, B4.
3. **Tests:** D2, B3.
4. **Structure:** F1, F2, F3 (after D2, so the refactor is covered).
5. **Ops and close:** C1, C2, C3, C4, E2, G1, G2, then tag `v1.0.0`.

Progress is tracked by ticking boxes in this file in the same PR that
completes the item.
