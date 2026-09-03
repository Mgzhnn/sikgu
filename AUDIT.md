# SIKGU audit

Audit date: 2026-09-03. Repository at commit `10fa317` on `main` (working tree clean at start).
Auditor: Claude (Fable 5.1) following `/home/magzhan/projects/sikgu-audit-prompt.md`.

## Phase 0: environment and baseline

Node was not installed and `node_modules` was missing. Installed with nvm as instructed.

| Item | Result |
| --- | --- |
| nvm | v0.40.3 installed to `~/.nvm` |
| node | v22.23.2 |
| npm | 10.9.8 |
| `npm ci` | 507 packages added, exit 0. Two deprecation warnings: `@esbuild-kit/esm-loader@2.6.5` and `@esbuild-kit/core-utils@3.3.2` ("Merged into tsx"). |

### Baseline `npm test` (build + typecheck + node --test), exit 0

Build section, verbatim (warnings only):

```
  Route (app)
  ┌ ? /
  └ λ /api/sikgu

  λ API  ? Unknown

  ? Some routes could not be classified. vinext currently uses static analysis
    and cannot detect dynamic API usage (headers(), cookies(), etc.) at build time.
    Automatic classification will be improved in a future release.

  Build complete. Run `vinext start` to start the production server.
```

Typecheck: `tsc --noEmit` produced no output (clean).

Test section, verbatim summary:

```
# (node:633534) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
...
1..43
# tests 43
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 72.300386
```

43 `ok` lines, 0 `not ok` lines. The only warning is Node's ExperimentalWarning for `node:sqlite`, which tests/sikgu.test.mjs uses deliberately.

### Baseline `npm run lint`, exit 0

```
> site-creator-vinext-starter@0.1.0 lint
> eslint . --ignore-pattern dist --ignore-pattern .next
```

No warnings, no errors.

### Baseline `npm audit`, exit 1

```
22 vulnerabilities (1 low, 4 moderate, 17 high)
```

Advisories by package (all transitive unless noted): @babel/core, brace-expansion, browserslist, esbuild (via drizzle-kit, wrangler, @cloudflare/vite-plugin), fast-uri, image-size (via vinext), js-yaml, nanoid, next (direct runtime dependency 16.2.6), postcss, react-server-dom-webpack (direct dev dependency), sharp and undici and ws (via miniflare / @cloudflare/vite-plugin), vite. `npm audit fix` (no `--force`) offers fixes for @babel/core, brace-expansion, browserslist, fast-uri, js-yaml, nanoid; the rest need major bumps of vinext, vite, next, or @cloudflare/vite-plugin. Classification of which advisories are reachable at runtime is in finding category 11 below.

Baseline passes, so no baseline repair was needed.

Other baseline facts established before auditing (each verified by a command in this session):

- `npm run db:generate` prints "No schema changes, nothing to migrate", so `db/schema.ts` matches the four migrations.
- The client's `restaurants[].minimum` table in `app/page.tsx` matches `restaurantMinimums` in `app/sikgu-rules.mjs` for all 21 restaurants, and the eight pickup ids/full names match `pickupFullNames` (checked by script).
- `after()` from `next/server` is a vinext shim that calls `getRequestExecutionContext()?.waitUntil(...)`; the worker entry wraps every request in `runWithExecutionContext(ctx, ...)`, so the retention sweep scheduled in the bootstrap handler really runs after the response on Workers (it is a no-op only on the Node dev server).
- Production client bundle (gzip): framework 58.9 KB, index 24.3 KB, page 21.5 KB, CSS 74.6 KB raw.

## Phase 1: findings

Method. I read every source file, test, migration, and config in full myself, then fanned the per-category audits out to six fresh-context sub-agents (auth+privacy, concurrency, input validation+error handling, receipt pipeline, lifecycle+performance+quality+dependencies, frontend). Each agent had to execute a reproduction where one was possible: the auth and input agents ran the real `route.ts` in-process against `node:sqlite` (and under Miniflare/workerd for the input agent), the concurrency agent executed every SQL string extracted verbatim from `route.ts` against the real migrations under 70 interleavings, and the receipt agent fuzzed the sanitizer. Findings below are the merged, deduplicated result; where I disagree with an agent's severity I say so. Status values are filled in during Phase 3.

Severity scale: critical = exploitable by any student for money, privacy, or takeover; high = a real user hits it in normal use or a hostile student can break an invariant the README promises; medium = limit bypass, wrong state that self-heals, or a failure path that misbehaves; low = correctness or robustness gap with a narrow trigger.

Line numbers refer to commit `10fa317`.

### Category 1: authentication and authorization

**A1. Identity headers are trusted verbatim; the only guard is that the worker is reachable solely through the platform proxy.** Severity: medium (critical if the worker is reachable directly). `app/chatgpt-auth.ts:19-36`, `app/api/sikgu/route.ts:208-221`, `worker/index.ts:55-67`. Scenario: if any route reaches the worker without passing through the platform (a `workers.dev` route, a preview URL, a misconfigured proxy that does not strip client-supplied `oai-*` headers), then `curl -H 'oai-authenticated-user-email: victim@dgist.ac.kr' ...` acts as the victim: creates and deletes their rooms, reads their receipts, chats as them. Proven in the harness (any header value is accepted). Proposed fix: none is possible in application code because the platform does not expose a signed assertion or shared secret; the README already states the constraint. Hand-test before release: an anonymous request to the public host carrying a forged `oai-authenticated-user-email` header must return `"user": null` from `?action=bootstrap`. Status: DEFERRED (platform constraint, see hand-test list).

**A2. A member the host removed can re-enter through an invite link they already have, and a rejected requester is auto-approved by any invite link.** Severity: medium. `route.ts:1140-1152` (`remove_member` only deletes the row), `route.ts:1128-1133` (reject), `route.ts:1194-1263` (`accept_invite` checks token, expiry, uses, capacity, and "not already approved" only). Reproduction (executed): host creates a room, creates an invite (`max_uses` 2), `other@` accepts, host removes `other@`, `other@` posts `accept_invite` with the same token again: 200, `status='approved'`, room and chat visible again. Proposed fix: add a `room_blocks` table (new migration via `npm run db:generate`), insert a block in the same batch as `remove_member` and `reject`, and add `NOT EXISTS (SELECT 1 FROM room_blocks ...)` to the invite reservation UPDATE. Blocked users can still `request_join`, so the host stays in control (explicit approval still works); only the unattended invite bypass is closed. Status: FIXED in 88cea55.

**A3. A whitespace-only or Unicode-space identity header authenticates as the empty email, and anonymous visitors then see that room as their own.** Severity: low. `chatgpt-auth.ts:22` checks the raw value, `route.ts:211` trims afterwards, `route.ts:526,541` bind `""` as the anonymous viewer's email. Reproduction (executed): header value `\xA0` (NBSP) creates a room with `host_email=''`; every anonymous bootstrap then serializes `isHost: true, myStatus: "approved"` for it. Proposed fix: normalize and validate in `getChatGPTUser` (trim, lowercase, require a plausible `local@domain` shape) and bind `NULL` for anonymous bootstrap. Status: FIXED in 3e53383.

Verified sound (auth agent, executed against the real handlers): missing or empty email header gives 401 on every mutation and on room/receipt reads; the same-origin check fails closed for missing header, cross origin, `Origin: null`, and scheme mismatch; every mutation re-checks the caller's role in that room in SQL (`host_email = ?` in every host-only statement, `review_token` scoped by `room_id`, invite token scoped by `room_id`); stolen `member_ref` values are useless outside the host's own room; non-host room reads never receive `member_ref`; the receipt GET requires approved membership and sets `Cross-Origin-Resource-Policy: same-origin`.

### Category 2: concurrency and data integrity

**C1. The per-host open-room limit is a check-then-act race.** Severity: medium. `route.ts:1029-1040` (COUNT) then `route.ts:1043-1070` (batch INSERT). Reproduction (executed against the real SQL): a host with 4 open rooms fires two `create_room` requests in parallel; both COUNTs read 4, both batches insert; result 6 open rooms for a limit of 5. With N parallel requests the host gets 4+N rooms in the public feed. Proposed fix: `INSERT INTO rooms ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?` followed by the host-member insert guarded by `WHERE changes() > 0`, the same shape `accept_invite` already uses; 429 when the first statement changes 0 rows. Status: FIXED in f0bb58d.

**C2. The five-active-invites cap has the same race.** Severity: low. `route.ts:1175-1190`. Executed: two parallel `create_invite` calls at 4 active invites produce 6. Effect is row growth only; capacity is still enforced at accept time. Proposed fix: conditional `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < 5`. Status: FIXED in b637771.

**C3. The chat rate limit is enforced only in JavaScript.** Severity: low. `route.ts:1276-1292`. Executed: five parallel sends from one member all read `count=0` and all insert with the same `created_at`. Proposed fix: conditional `INSERT ... SELECT ... WHERE` with the count and spacing predicates inside the statement. Status: FIXED in b637771.

**C4. The PUT error path can throw inside its own catch block, skipping lock release and the JSON error response.** Severity: medium. `route.ts:786-787` sets `newReceiptKey` before `uploadBucket().put(...)`; `uploadBucket()` (`route.ts:75-79`) throws synchronously when the `UPLOADS` binding is missing; the catch at `route.ts:894-895` calls `uploadBucket()` again, which throws before `.catch` can attach, so `releaseRoomMutation` (line 898) and `serverError` (line 900) never run. Reproduction (executed under workerd by the input agent): in an environment without R2 bound, a host PUT with a receipt returns the framework's plain-text 500 and leaves `mutation_token` set, so every host PUT and DELETE returns 409 for the next two minutes. Proposed fix: resolve the bucket once before acquiring the lock and reuse it, and make the cleanup in the catch block exception-safe. Status: FIXED in 3073b50.

Verified sound (concurrency agent, 70 executed checks, `FAILURES: 0`): the README's capacity promise holds. `review_member` approve carries the capacity check inside the UPDATE, so of five racing approvals for one seat exactly one succeeds and the approved count never exceeds capacity. `accept_invite` was checked across all 48 combinations of membership state x room state x invite state; the invite `uses` counter is never incremented without a membership change and never the reverse, because the UPDATE's `NOT EXISTS approved` predicate is exactly the complement of the INSERT's `ON CONFLICT ... WHERE status <> 'approved'`. `changes()` inside a batch refers to the immediately preceding statement even when Miniflare's D1 shim interposes its bookkeeping SELECTs. Approve-then-leave, leave-then-approve, remove-then-approve, delete-while-joining, PUT racing DELETE, two DELETEs racing, stale-lock reclaim by a retry or by the sweep, and a second isolate's sweep racing the first all end in a consistent state with no orphans; `ON DELETE CASCADE` fires; migration 0002 is safe whether or not D1 honours `PRAGMA foreign_keys=OFF`; the largest statement binds 55 parameters (D1 limit 100). No `UNIQUE(room_id, review_token)` index exists, so two members sharing a 128-bit random token would both be approved by one UPDATE; probability 2^-128, not a finding.

### Category 3: input validation

**I1. `closesAt` comes from the phone's clock and the server validates it against a 5 to 60 minute window instead of the shared `roomDurations` rule.** Severity: low. `route.ts:1013,1023`, `app/page.tsx:2950`, `app/sikgu-rules.mjs:38`. Scenarios: (a) hostile: any signed-in user creates a 5-minute or 59-minute room although the UI only offers 20/30/45; (b) honest: a phone 16 minutes fast plus "45분" is rejected with "모집 마감 시간은 지금부터 5분~60분 사이여야 합니다" for a preset the user never typed; a phone 12 minutes slow plus "20분" produces a room everyone else sees as "8분 후 마감". Proposed fix: client sends `minutes`; server checks `roomDurations.includes(minutes)` and computes `closes_at` itself. Decision taken during the fix: the client-supplied `closesAt` path was removed entirely rather than kept as a fallback, because keeping it would have left the hostile scenario (a hand-crafted 5- or 59-minute room) open; the three existing assertions that pinned the old window now pin the rule-based check, and the error copy changed accordingly. This is an API contract change: a browser tab holding the pre-deploy bundle gets a 400 on room creation until reloaded (RUNBOOK deploy note). Status: FIXED in efe1744.

**I2. `estimatedArrival` accepts impossible calendar dates.** Severity: low. `route.ts:685-694`. V8's `Date.parse` normalizes `2024-02-30T10:00` to March 1 and accepts `24:00` (verified: `Date.parse("2024-02-30T10:00")` is finite). Scenario: host submits `2024-02-30T10:00`; stored verbatim; members see "3월 1일 오전 10:00" while the host's own `datetime-local` editor shows an empty control because the value is invalid for the element. Proposed fix: parse the components and require them to round-trip through `Date.UTC`. Status: FIXED in ff8ae69.

**I3. Free-text fields accept control and bidi-override characters, zero-width-only text, and non-strings, and `slice()` can split a surrogate pair into invalid UTF-8.** Severity: low. `route.ts:1062` (note), `route.ts:1273` (chat body). Reproductions (executed, including D1 storage under workerd): `note` of 299 `a` plus an emoji is stored as `aa\ud83d` (invalid UTF-8, reads back as U+FFFD); `note: "‮ABC..."` renders right-to-left in every visitor's feed; `body: "​"` posts a blank chat line; `note: "   "` is accepted untrimmed; `note: {}` becomes `[object Object]`. Proposed fix: one shared `cleanText(value, max)` in `sikgu-rules.mjs` (string check, NFC, strip C0/C1 controls except newline, strip Unicode format characters, trim, require a visible character, truncate by code point). Status: FIXED in ceaa4be.

**I4. A JSON body that is `null`, an array, a scalar, or invalid JSON produces a 500 with a fresh error reference instead of a 400.** Severity: low. `route.ts:1004-1005`. Reproduction: `POST /api/sikgu` with body `null` returns 500 and logs a `TypeError`; `{bad` returns 500 and logs a `SyntaxError`. Any student can fill the error log. Proposed fix: parse inside a try, require a plain object, else 400 "요청 형식을 확인해 주세요." Status: FIXED in 3d21bb9.

**I5. A PUT whose body is not multipart produces a 500.** Severity: low. `route.ts:683`. Reproduction (executed under workerd): `Content-Type: application/json` body `{}` makes `request.formData()` throw a `TypeError` that becomes a 500 with a reference. No lock is held yet. Proposed fix: require `multipart/form-data` (415) and wrap `formData()` (400). Status: FIXED in 3d21bb9.

**I6. Uppercase `memberRef` passes the regex (`/i` flag) but never matches the lowercase token, so the host sees the misleading "정원이 모두 찼습니다".** Severity: low. `route.ts:1112,1143`. Proposed fix: drop the `i` flag so the malformed reference gets the 400 it deserves. Status: FIXED in 7582c6e.

Verified sound (input agent, executed): capacity, apps, restaurant and pickup ids (`Object.hasOwn`, so `__proto__` and `toString` are rejected), membership, `closesAt` type (`isSafeInteger`), `memberRef` and invite `token` regexes, decision enum, money fields (`Number` then `isInteger` then range; `"1.5"`, fullwidth digits, `"1,000"`, `Infinity` all rejected), receipt file type plus magic bytes plus sanitizer plus full inflate, Content-Length gate before parsing, Content-Type prefix check, no SQL built from input, prototype pollution impossible (fields read individually), and every D1 bind is string, number, or null.

### Category 4: receipt image pipeline

The receipt agent ran 124 malformed-chunk cases, 20 deflate cases, and 32 JPEG cases (plus a 20,000-iteration mutation fuzz of the JPEG parser) against the exported functions in Node and inside workerd (Miniflare with the production compatibility date and `nodejs_compat`), sampling isolate RSS per case.

**R1. A decompression bomb drives the worker isolate to gigabytes of memory before the image is rejected.** Severity: high. `app/receipt-image.mjs:412-437`. The reader loop stops logically once inflated bytes exceed the declared size, but it scans output byte by byte in JavaScript while `DecompressionStream` runs ahead and buffers decompressed output without backpressure. Measured inside workerd, fresh isolate per case: a 1 MiB IDAT that inflates to 1 GiB under a 2400x2400 RGBA16 header (expected 46 MB) is rejected after about 720 ms at +1.33 GB RSS; a 256 KB IDAT that inflates to 256 MB under a 1x1 header (expected 4 bytes) is rejected at +261 MB. Workers enforce a 128 MB memory cap, so one authenticated host with an open room can kill the isolate on demand with a 1 MB upload every 30 seconds. No integrity or confidentiality loss (the bomb is still rejected). Proposed fix (validated by the agent in workerd): inflate with `node:zlib` `inflateSync(compressed, { info: true, maxOutputLength: expectedBytes })`, which throws the moment output would exceed the cap and never allocates past it; reject when `engine.bytesWritten` is less than the input length (trailing junk or a concatenated stream); check only row-start bytes for the filter value. Measured: the 1 GiB bomb drops from +1.33 GB and 720 ms to +59 MB and 22 ms; the legitimate 46 MB worst case still passes. `nodejs_compat` is already required (vinext's request context uses `AsyncLocalStorage`) and is present in `dist/server/wrangler.json`. Status: FIXED in ff666ec.

**R2. Arbitrary bytes survive inside stored-block IDAT pixel data (polyglot).** Severity: low, no change. A level-0 deflate block carries literal bytes, so `<script>` text or a ZIP header embedded as pixels passes both validators and is stored verbatim. Harmless because the object is served as `image/png` with `nosniff`, `inline`, `Cross-Origin-Resource-Policy: same-origin`, and the global CSP (`object-src 'none'`), so browsers render it only as an image. Recorded because that header posture is load-bearing. Status: NOT A BUG (residual of any re-wrapping sanitizer; headers verified).

**R3. The JPEG and WebP sanitizer paths are unreachable from the network.** Severity: informational. `receiptTypes` (`route.ts:64`) allows PNG only and the magic-byte check must match the declared type, so `sanitizeJpeg` (about 130 lines) and the WebP branch are dead in production but bundled and covered by five tests. The client still advertises JPG and WebP because it re-encodes everything to PNG in the browser. Fuzzing found no crash in the dead JPEG parser. Status: DEFERRED to Phase 4 (dead code removal).

Verified rejected, with the observed error string, all cited from the agent's logs: chunk length overflow and past-end lengths, chunk types with non-letters or the reserved bit set, CRC mismatch on kept and dropped chunks, duplicate or misplaced IHDR, missing IEND, data after IEND, zero-length-only IDAT, IDAT before PLTE for palette images, PLTE of 0, 769, or non-multiple-of-3 bytes, tRNS of the wrong length per color type, unknown critical chunks, interlaced images, invalid depth and color combinations, dimensions 0, 2401, 2^31, 2^32-1 and 2400x2401 (no 32-bit wrap: 65536x65536 is rejected), zlib streams with trailing bytes, concatenated streams, bad adler32, raw deflate, gzip, truncation, FDICT, bad filter bytes on any row including across chunk boundaries. Accepted correctly at the time of the audit: 2400x2400 exactly, 16-bit RGB, RGBA, and gray, 1-bit gray, palette with 256 entries, IDAT split across consecutive chunks. (16-bit depths were later refused on purpose, df63016, see Phase 5 round 1.) tRNS is the only ancillary chunk retained; every text, EXIF, ICC, time, physical-size, gamma, and APNG chunk is dropped. R2 keys: the room id in the URL is used only after the token-guarded lock matched a row the caller hosts, the receipt GET derives the key from the row, the upload key carries a 192-bit random token, and both deletion paths list the prefix with cursor paging, throw on a truncated listing without a cursor, delete in 1000-key batches, and delete objects before the row. Twelve cold-start isolates showed no `DecompressionStream` flakiness.

### Category 5: privacy

**P1. `pendingCount` is serialized to every viewer, including anonymous ones.** Severity: low. `route.ts:339,535-536,552-553`. Reproduction (executed): anonymous `?action=bootstrap` returns `"pendingCount": 1` for a room the viewer has no relation to; by polling, a non-member learns when requests are made and decided. The client only displays it to hosts. Proposed fix: serialize the count only when the viewer is the host. Status: FIXED in 3e53383.

**P2. The invite bearer token round-trips through the sign-in redirect and stays in the URL when acceptance fails.** Severity: low. `page.tsx:2014,2710-2713,2779-2788`. Scenario: an unauthenticated recipient opens `/?room=...&invite=...`; the client passes the full query, including the 192-bit token, as `return_to` to the platform sign-in route (third-party logs, browser history); if acceptance returns 410 or 409 the URL is never cleaned, so every reload re-posts the failing request and re-shows the error toast. Proposed fix: strip the parameters from the URL immediately, keep them in browser storage, sign in with `return_to=/`, and resume from storage. Implemented first with `sessionStorage` and a ten-minute window (850f222); Phase 5 moved it to `localStorage` because the platform sign-in can finish in another tab (b549608), then bounded the window to one hour so that an invite opened on a shared computer is not consumed by the next person to sign in (round 2). Status: FIXED in 850f222, refined in b549608 and the round-2 commit.

**P3. The placeholder name `사용자` is re-masked to `사*자` by the client.** Severity: low (user-visible wrong name, no leak). `app/name-mask.mjs:13`, `route.ts:244`, `page.tsx:2227,2396`. The doc comment promises idempotence. Proposed fix: make `사용자` a fixed point of `maskDisplayName`. Status: FIXED in 3427e2d.

**P4. Korean names keep first and last syllable (`홍길동` becomes `홍*동`), which reveals two of three syllables plus the length.** Severity: low. `name-mask.mjs:15-18`. This is a masking policy choice that the tests pin (`tests/rendered-html.test.mjs:451-455`) and that the product copy relies on ("masked names that read naturally"). Status: DEFERRED (design decision for the owner; changing it changes copy and tests).

Verified sound (auth agent, 27 real response bodies scanned for `@`, `dgist`, `host_email`, `user_email`, `sender_email`, `review_token`): no email, review token, mutation token, or receipt key is ever serialized except `member_ref` to the host; names are masked at write time (`route.ts:211`) and again at read time; error bodies are a fixed Korean message plus a random reference; nothing logs identities; the invite link carries only room id and token and `Referrer-Policy` prevents leaking it via Referer; `maskDisplayName` is a fixed point for every already-masked input except the placeholder (P3).

### Category 6: room lifecycle and state machine

States actually reachable: `rooms.status` is `open` or `deleting` only; closure is implicit from `closes_at` (recruiting, closed-but-recent for 30 days, expired and swept). Members are `host/approved`, `member/requested`, `member/approved`; removal is row deletion. The mutation lock adds held and stale substates. The full transition table with guards is in the lifecycle agent's report and was checked against the code; I reproduce only the defects here.

**L1. A join request on a room that has closed can never be rejected, so the row is orphaned for up to 30 days and the host UI keeps offering buttons that always fail.** Severity: medium. `route.ts:1108-1110` gates reject on `closes_at`; `page.tsx:2232-2246` renders approve/reject for every requested member with no closure awareness; the requester has no leave control either. Scenario: B requests one minute before close, host reviews one minute after: 거절 returns 409 "마감된 주문방에서는 참여자를 변경할 수 없습니다" and the row stays until the sweep. Proposed fix: allow reject (and remove) regardless of the deadline, keep the guard on approve. Status: FIXED in 89bec6d.

**L2. The room hub never shows that the room has closed; host controls that are guaranteed to 409 stay enabled.** Severity: low. `page.tsx:1868-2433` never reads `room.closesAt`. Status: DEFERRED to Phase 4 (polish item: countdown and closed state in the hub).

**L3. The pool detail modal disappears silently when the pool leaves the feed.** Severity: low. `page.tsx:2690-2692,3085`. Scenario: open a "1분 후 마감" card, the next 30-second poll drops it, the modal unmounts mid-read with no message. Status: DEFERRED to Phase 4.

**L4. The retention sweep is all-or-nothing across up to 50 rooms and can exceed the Workers subrequest budget, so a backlog may never drain.** Severity: low. `route.ts:403,414-473`. With 50 claimed rooms one `after()` task issues about 55 subrequests before the single `DELETE FROM rooms`; one transient R2 error defers all 50 for an hour; on a 50-subrequest plan it never completes. Proposed fix: process and delete per room so progress is kept. Status: FIXED in 404bd38.

Verified sound (lifecycle agent): every persisted timestamp is server `Date.now()` and every guard compares server time to server time; the only client-sourced time is `closesAt` (I1); `estimatedArrival` is a wall-clock string that every KST device renders identically; deletion order is R2 before D1 on both paths; no release path can resurrect a room after R2 cleanup began; the sweep's token-fenced claim makes cross-isolate duplication safe. README mismatch, not a bug: `rooms.total` is never updated by joins because the app has no per-member amount; the host types the collected total. Recorded as a spec disagreement for the owner.

### Category 7: error handling

**E1. The client parses `response.json()` before checking status or content type, so platform HTML error pages surface as `Unexpected token '<'...` in Korean UI.** Severity: medium (every user sees it during any platform outage or deploy). `page.tsx:1973,2097,2120-2121,2721,2733`. In `deleteRoom` the 404-means-already-deleted shortcut is unreachable when the 404 body is HTML. Proposed fix: one `readJson(response)` helper with a status-keyed Korean fallback, and check 401/404 before parsing. Status: FIXED in ee791d2.

**E2. `void loadRooms()` in three RoomHub callbacks and two join handlers has no catch, producing unhandled promise rejections and a silently stale feed.** Severity: low. `page.tsx:3110,3113,3118,1840-1847,1690`. Scenario: host approves a member while bootstrap returns 502; console shows `Uncaught (in promise)`, feed `pendingCount` stays stale. Proposed fix: a `refreshRooms` callback that swallows, and catch blocks in the two handlers. Status: FIXED in 04df625.

**E3. Inconsistent status codes for the same failure class.** Severity: low. `request_join` on a missing room returns 409 (`route.ts:1081`) while every other action returns 404; approve merges "not found" and "full" into one 409 (`route.ts:1125`). Proposed fix: 404 for a missing room in `request_join`; keep the merged approve message (splitting it costs a read and the client copy already covers both). Status: FIXED in 7582c6e.

Verified sound: `serverError` returns a fixed message plus a random reference and logs the error object only; D1 error text carries no bound values; `request.json()` and `formData()` failures are caught (wrong status is I4/I5); every `.catch(() => undefined)` was traced to a recovery path (orphaned receipt objects are removed by prefix enumeration, failed lock releases go stale after two minutes, a failed verification read yields 503 with `Retry-After`); the sweep resets its in-flight flag in `finally` and stamps its cooldown even on failure, so there is no cleanup storm.

### Category 8: frontend correctness

**F1. The receipt file input has `capture="environment"`, which forces the camera on iOS and Android, so a host cannot pick a screenshot of the order screen from the gallery.** Severity: high. `page.tsx:2362-2368`. The copy and the image alt text explicitly target "주문 화면 캡처", which is impossible on phones with this attribute. Proposed fix: remove `capture`; the OS then offers camera, library, and files. Status: FIXED in 8e39383.

**F2. The two money inputs use `step="100"`, so a real total like 28,450원 fails browser validation and the form never submits.** Severity: high. `page.tsx:2328,2352`; the form at line 2318 has no `noValidate`. Verified: `28450 % 100 !== 0` triggers `stepMismatch`; Chrome shows "유효한 값을 입력하세요..."; the server accepts any integer. Proposed fix: `step="1"`. Status: FIXED in 8e39383.

**F3. The chat textarea is disabled while a message is in flight, which blurs it and closes the mobile keyboard after every message.** Severity: high (every chat message on every phone). `page.tsx:2406`, `sendMessage` at 2039-2055. Proposed fix: keep the textarea enabled (the `sending` guard and the disabled send button already prevent double submits) and clear only the text that was sent, so anything typed during the round trip survives. Status: FIXED in 8e39383.

**F4. `scrollIntoView` on every message-count change scrolls the whole room sheet on phones.** Severity: medium. `page.tsx:1963-1965`, `globals.css:3631`. On screens up to 680px the member panel and order-info form live in the same scroll container as the chat, so opening a room jumps past the pending-approval list, and a poll that brings a new message yanks a host away from the half-filled order form. Proposed fix: scroll the chat list element itself (`scrollTop`), keeping `scrollIntoView` only as a fallback. Status: FIXED in f80a7a9.

**F5. Web Storage is accessed outside try/catch in four places.** Severity: medium. `page.tsx:2791,2900,2860,2871`. With storage blocked (Safari "모든 쿠키 차단", locked-down WebViews) the app shows an English `SecurityError` toast on every load, the guest "참여 신청" button does nothing because `sessionStorage.setItem` throws before `signIn()`, and a throwing effect can unmount the root to a blank page. Proposed fix: guarded storage helpers around the exact existing calls. Status: FIXED in 34cc639.

**F6. Five `<label>` elements in the create dialog label nothing, and the pickup and duration button groups have no accessible name.** Severity: low. `page.tsx:2578,2590,2596,2615,2640` and containers at 2580, 2592. Proposed fix: give the groups `role="group"` with `aria-labelledby` pointing at the label text. Status: FIXED in e32bcc8.

**F7. A pending join saved before sign-in is kept on a 4xx, so the same error toast repeats on every load for ten minutes.** Severity: low. `page.tsx:2823-2837`. Proposed fix: clear the key in the catch. Status: FIXED in 850f222.

**F8. Escape during IME composition closes the dialog and loses the chat draft.** Severity: low. `page.tsx:197-202` (also 784-790, 1104-1110). Proposed fix: ignore Escape while `isComposing` or `keyCode === 229`. Status: FIXED in 52ddd6d.

**F9. The RoomHub `post` helper does not redirect to sign-in on 401, unlike `postAction`.** Severity: low. `page.tsx:1967-1976`. Scenario: session expires while the hub is open; the next action shows "로그인이 필요합니다" as text and the next poll wipes the room. Proposed fix: call `signIn()` on 401. Status: FIXED in 04df625.

**F10. The pool modal's join button stays enabled for a full room, guaranteeing a 409 toast, while the campus map disables it and shows "정원 마감".** Severity: low. `page.tsx:1838-1862` versus 1660,1690. Proposed fix: disable with the existing copy. Status: FIXED in 52ddd6d.

Deferred to Phase 4 (polish, listed there with rationale): JS smooth scrolling ignores `prefers-reduced-motion`; `body{overflow:hidden}` does not stop iOS touch scrolling behind sheets; 22 to 37px hit areas and 7px text in the create dialog; `aria-live` on the whole message list; `aria-label` on generic divs and headings inside buttons; no polling backoff or `visibilitychange` refresh.

Verified sound (frontend agent, every hook read): all effects have complete dependency lists (`eslint` exhaustive-deps clean) and cleanup; the request-ordering refs drop stale responses and cannot overwrite a newer join state; the "requested" state is set after the POST succeeds (not optimistic); every action has a double-submit guard including held Enter; the chat composer handles `isComposing` and keyCode 229; all other text inputs are plain controlled inputs with no transformation, so Korean IME needs no special handling there; `maxLength` and the server slice both count UTF-16 units and the client sends the trimmed value, so the server never cuts a surrogate pair from the client (I3 covers direct API calls); every dialog has role, name, Escape, Tab trap, focus-in, and focus restore; no reachable state mounts two dialogs; SSR and first client render are identical.

### Category 9: performance

No finding met the bar. Every WHERE and ORDER BY except two is served by a primary key or a declared index; the exceptions are the hourly legacy-name `instr()` scan (three full scans, dead since names are masked at write time) and the feed's `ORDER BY created_at` over at most a few hundred open rooms. Query counts per request: bootstrap 1 to 2, room 4 (6 on a host's first read), PUT 4, DELETE 4 plus R2, each POST 2 to 5. All lists are bounded (100, 50, 200, 50) except members, which is bounded by one row per user. First-load client bundle is about 120 KB gzipped (React 59 KB, vinext runtime 24 KB, page 21 KB, CSS 15 KB); nothing is code-split, and the restaurant menu descriptions and prices (about 4 KB gzipped) are never rendered. Polling is a fixed 30 s (feed) and 10 s (room) with no backoff and no refresh on tab focus. `og.png` is 1.25 MB, fetched only by link-preview crawlers. These go to the Phase 4 polish plan.

### Category 10: code quality that causes bugs

**Q1. `build/sites-vite-plugin.ts` is never linted because `eslint.config.mjs:9-16` ignores `build/**`, a name that here holds source, not output.** Severity: low. Verified: `npx eslint build/sites-vite-plugin.ts` reports "File ignored". Proposed fix: remove `build/**` from the ignore list. Status: FIXED in 3e91f67.

**Q2. `note` default text, the 8 MB limit, the 30-day window, the chat length, the capacity and duration bounds in error copy, and the `isUsableRoom` rule are each duplicated between client and server.** Severity: low. They have not drifted yet (verified by script for minimums and pickups), but only the ids are tested. Status: DEFERRED to Phase 4 (rules as single source of truth), except where a Phase 2 fix touches the line.

Dead code recorded for Phase 4: `sanitizeJpeg` and the JPEG/WebP branches are unreachable from the API (`receiptTypes` allows PNG only) yet bundled and tested; `requireChatGPTUser`, `chatGPTSignInPath`, `chatGPTSignOutPath` have no callers; `db/index.ts` and `drizzle-orm` have zero references in the production bundle; `examples/d1` is type-checked and linted but never routed; `MenuItem.description/price/badge` are never rendered; the legacy receipt keys `a/b/current` are redundant with prefix listing.

### Category 11: dependency and config hygiene

**D1. No advisory is reachable by a production request, but the one vulnerable package that is bundled into the worker (`react-server-dom-webpack` 19.2.6, DoS in Server Functions) is exact-pinned so `npm audit fix` cannot service it.** Severity: low. The production bundle contains only vinext, plugin-rsc, react, react-dom, and react-server-dom-webpack; the Next.js runtime, image-size, postcss, sharp, undici, ws, and esbuild are absent from `dist/` (verified by grepping the bundle). The app declares no server functions, so the decoder is most likely unreachable. Proposed fix: bump `react`, `react-dom`, `react-server-dom-webpack` to 19.2.8 and apply the non-forced `npm audit fix` (it changes only transitive dev packages: babel, browserslist, postcss, nanoid, js-yaml, fast-uri, brace-expansion, esbuild patch); then rerun the gate. Status: FIXED in a7f76d4.

**D2. `.mjs` modules are not type-checked (`allowJs` without `checkJs`, `**/*.mjs` not in `include`).** Severity: low; no concrete failure today, all three modules have JSDoc types. Status: DEFERRED to Phase 4.

Config facts with no finding: `strict` is on; the single `eslint-disable` (`page.tsx:2303`, `no-img-element`) is justified; `hosting.json` contains a project id, not a credential; the personal feedback email in `page.tsx:1717` is intentionally public product copy; `layout.tsx` trusts `x-forwarded-host` for OG URLs, which is safe only under the same proxy assumption as A1 (the page is dynamic, so no cache poisoning); lockfile, `engines`, and the installed tree are consistent; `allowScripts` in package.json is inert under npm (read only by lavamoat).


## Phase 2: fixes

All fixes live on branch `audit-2026-09-03`, branched from `main` at `10fa317`; nothing was pushed. Twenty-four commits, one per finding or tightly related pair, each verified by the full gate before the next; the gate log with every "before fix" failure and "after fix" pass is in the session scratchpad (`phase2/gate-log.txt`). New behavioural API tests run the real `app/api/sikgu/route.ts` in-process against `node:sqlite` with the real migrations through `tests/helpers/api-harness.mjs` (Node 22 strips the TypeScript types natively; only `cloudflare:workers`, `next/headers`, `next/server`, and `next/navigation` are stubbed). One new migration, `drizzle/0004_room_blocks.sql`, was produced by `npm run db:generate`; `drizzle/meta` was touched only by that generator.

Six existing assertions were changed rather than removed, each keeping or strengthening its meaning (the Phase 5 diff review counted them): the ordering check `uploadBucket().put(newReceiptKey` became `receiptBucket.put(newReceiptKey` (3073b50); the chat bound `.trim().slice(0, 1000)` became `cleanText(payload.body, 1000)` (ceaa4be); the deadline window checks became `roomDurations.includes(minutes)` plus the server-side computation (efe1744); and the sweep's `claimed.results.map((room) =>` became the `for (const room of claimed.results)` loop (404bd38); in Phase 4 the two assertions pinning the exact rules import line became a regex requiring both rule names (50570ca). Existing test payloads switched from a client `closesAt` to `minutes: 30` because that is now the contract. Two commit messages overstate slightly and are corrected here rather than by rewriting history: ee791d2 says the 429 fallback copy reuses existing server copy, but "요청이 너무 잦아요. 잠시 후 다시 시도해주세요." is new; 8e39383's clear rule was later replaced (cd756df) because it left sent text behind when the student kept typing.

## Phase 3: final gate after the fixes

`npm test` (build + typecheck + `node --test`), exit 0. Build and typecheck sections were identical to the baseline (same unclassified-route note, no TypeScript output). Test summary, verbatim:

```
# tests 71
# suites 0
# pass 71
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 207.517918
npm test exit: 0
```

71 `ok` lines, 0 `not ok` lines (43 baseline tests plus 28 new ones).

`npm run lint`, exit 0:

```
> site-creator-vinext-starter@0.1.0 lint
> eslint . --ignore-pattern dist --ignore-pattern .next

npm run lint exit: 0
```

`npm audit`, exit 1 (advisories remain in the build toolchain), verbatim package lines and summary:

```
esbuild  <=0.24.2 || 0.27.3 - 0.28.0
image-size  *
next  9.3.4-canary.0 - 16.3.0-preview.10
postcss  <=8.5.22
sharp  <0.35.0
undici  7.0.0 - 7.28.0
vite  8.0.0 - 8.0.15
ws  8.0.0 - 8.20.1

15 vulnerabilities (4 moderate, 11 high)

To address all issues (including breaking changes), run:
  npm audit fix --force
npm audit exit: 1
```

Down from 22 (1 low, 4 moderate, 17 high) to 15 (4 moderate, 11 high). Every remaining advisory is in code that never runs in production (verified by grepping `dist/server/index.js`: no Next.js runtime, image-size, postcss, sharp, undici, ws, or esbuild code is bundled): `next` (Next's own server, replaced by vinext; the affected features, middleware, server actions, rewrites, image optimization, do not exist here), `image-size` via vinext (build-time only), `postcss` (build-time), `sharp`, `undici`, `ws` via miniflare and the Cloudflare Vite plugin (dev server only), `esbuild` (dev server and drizzle-kit), `vite` (dev server, Windows-only paths). Fixing them requires major or out-of-range bumps of vinext (to a 1.0 beta), vite, next, and the Cloudflare Vite plugin, which is a dedicated migration, not an audit fix; recorded as DEFERRED with this classification.

### Status of every finding

| ID | Severity | Status |
| --- | --- | --- |
| A1 | medium | DEFERRED: platform constraint; hand-test listed in the summary |
| A2 | medium | FIXED 88cea55 |
| A3 | low | FIXED 3e53383 |
| C1 | medium | FIXED f0bb58d |
| C2 | low | FIXED b637771 |
| C3 | low | FIXED b637771 |
| C4 | medium | FIXED 3073b50 |
| I1 | low | FIXED efe1744 |
| I2 | low | FIXED ff8ae69 |
| I3 | low | FIXED ceaa4be |
| I4 | low | FIXED 3d21bb9 |
| I5 | low | FIXED 3d21bb9 |
| I6 | low | FIXED 7582c6e |
| R1 | high | FIXED ff666ec |
| R2 | low | NOT A BUG: served with nosniff, image/png, CORP same-origin, CSP object-src none (verified in worker/index.ts and route.ts headers) |
| R3 | info | DEFERRED to Phase 4 dead-code review (kept: fuzzed clean, covered by tests) |
| P1 | low | FIXED 3e53383 |
| P2 | low | FIXED 850f222 |
| P3 | low | FIXED 3427e2d |
| P4 | low | DEFERRED: masking policy is a product decision pinned by tests and copy |
| L1 | medium | FIXED 89bec6d |
| L2 | low | DEFERRED to Phase 4 polish item 1 |
| L3 | low | DEFERRED to Phase 4 polish item 4 |
| L4 | low | FIXED 404bd38 |
| E1 | medium | FIXED ee791d2 |
| E2 | low | FIXED 04df625 |
| E3 | low | FIXED 7582c6e (request_join 404; the merged approve message kept, documented) |
| F1 | high | FIXED 8e39383 |
| F2 | high | FIXED 8e39383 |
| F3 | high | FIXED 8e39383 |
| F4 | medium | FIXED f80a7a9 |
| F5 | medium | FIXED 34cc639 |
| F6 | low | FIXED e32bcc8 |
| F7 | low | FIXED 850f222 |
| F8 | low | FIXED 52ddd6d |
| F9 | low | FIXED 04df625 |
| F10 | low | FIXED 52ddd6d |
| Q1 | low | FIXED 3e91f67 |
| Q2 | low | DEFERRED to Phase 4 polish item 9 |
| D1 | low | FIXED a7f76d4 (react 19.2.8 line; remaining advisories classified above) |
| D2 | low | DEFERRED to Phase 4 polish item 9 |

## Phase 4: polish plan

Ranked by what a student on a phone would notice. Constraint discovered while planning: every existing test reads `app/page.tsx` and `app/api/sikgu/route.ts` as whole files and slices them by function name, so moving components or handlers into other files breaks the suite without changing behaviour. A file split therefore needs those tests converted to behavioural ones first; it is proposed as a follow-up in "Polish results" rather than done here, and the structure item below is limited to single-source constants and dead code that the tests allow.

1. Room hub shows the deadline state (L2). Benefit: members and hosts see "N분 후 마감" or "마감됨" in the room, and the invite and approve controls that would only produce a 409 are disabled once the room closes. Risk: low. Files: `app/page.tsx`.
2. Countdowns use server time and survive a sleeping tab. Benefit: a phone with a skewed clock no longer hides fresh rooms or shows wrong minutes; after the tab sleeps the countdown and feed are refreshed on return instead of waiting up to 30 s. Risk: low. Files: `app/api/sikgu/route.ts` (bootstrap returns `serverNow`), `app/page.tsx`.
3. Polling backs off and refreshes on focus. Benefit: an outage does not hammer the API from every open tab; returning to the app shows fresh data immediately. Risk: low. Files: `app/page.tsx`.
4. Pool dialog explains a vanished room (L3). Benefit: instead of the dialog disappearing mid-read, the student sees that the room closed or was deleted. Risk: low. Files: `app/page.tsx`.
5. Screen-reader semantics. Benefit: progress bars announce their value, the chat announces only new messages instead of up to 200 on open, the room error is an alert, generic containers stop carrying labels. Risk: low. Files: `app/page.tsx`.
6. Mobile touch targets and sheet scrolling. Benefit: the 22 to 28 px clear, marker, and picker buttons get 44 px hit areas; scrolling inside a sheet no longer scrolls the feed behind it on iOS. Risk: medium (CSS touching layout; verified visually only by inspection here). Files: `app/globals.css`, `app/page.tsx`.
7. Reduced motion. Benefit: users with the OS setting get no smooth-scroll animation from JavaScript either. Risk: low. Files: `app/page.tsx`.
8. Operability. Benefit: a health check the platform can probe and a runbook for deploy, rollback, migration, and logs; the worker logs one structured JSON line per API error without personal data. Risk: low. Files: `app/api/sikgu/route.ts`, `RUNBOOK.md`.
9. Single source of truth for constants and dead code (Q2, D2, R3). Benefit: the 8 MB, 30-day, chat-length, capacity and duration copy cannot drift between client and server; unused auth helpers, the example route, and the unused Drizzle client stop being maintained; `.mjs` modules get type-checked. Risk: medium (touches many lines; guarded by the suite). Files: `app/sikgu-rules.mjs`, `app/api/sikgu/route.ts`, `app/page.tsx`, `app/chatgpt-auth.ts`, `examples/`, `db/index.ts`, `tsconfig.json`.
10. Copy consistency. Benefit: the invite card shows the validity the API actually returns; small wording consistency checks. Risk: low. Files: `app/page.tsx`.

Not planned, with reasons: splitting `page.tsx` and `route.ts` (see constraint above); code-splitting the room hub (same constraint: `React.lazy` needs a separate module); removing the unrendered restaurant menu data (restaurant data is out of bounds for this phase); changing font sizes below 9 px in the create dialog (a visual identity decision for the owner); changing the Korean masking policy (P4).

## Polish results

Executed, one commit each, every one verified by `npm test` and `npm run lint` before the next:

1. Room hub deadline state: dd90fe7. The hub header shows "N분 후 마감" or "마감됨"; 초대 링크 and 승인 are disabled once the room closes (reject and remove stay available).
2. Server clock for countdowns and wake-up refresh: 557ddcc. Bootstrap returns `serverNow`; the client offsets its clock by it; a tab becoming visible refreshes the clock and the feed at once.
3. Polling backoff: faa4146. Feed and room polls are self-scheduling timeouts that double their delay per consecutive failure (capped at five minutes) and reset on success or visibility.
4. Vanished-room state in the pool dialog: cca82db. The dialog stays open with "마감되었거나 삭제된 주문방이에요" and a disabled join button instead of unmounting mid-read.
5. Screen-reader semantics: 89499ad. Real progressbar; a hidden status line announces only new chat messages; the room error is an alert; grouped containers use group roles; the brand block no longer carries a redundant label.
6. Phone ergonomics: 9883628. 42 to 48 px hit areas for the search clear buttons and map preview markers; `overscroll-behavior: contain` on every sheet scroll container; the body is pinned at its scroll offset while a dialog is open (iOS ignores `overflow: hidden` for touch).
7. Reduced motion: a9f84e1. JavaScript-initiated scrolling uses "auto" when the OS preference is set.
8. Operability: 77183f3. `GET /api/sikgu?action=health` (no identity, one-row D1 probe, 503 with Retry-After on failure); `serverError` logs one JSON line keyed by the reference the user sees, with no identity in it; `RUNBOOK.md` covers deploy, forward-only migrations, rollback, logs, background behaviour, rate limits, and pre-release hand checks.
9. Single source of truth and dead code: 50570ca. Chat and note limits and the capacity copy come from `sikgu-rules.mjs`; every client restaurant entry references `restaurantMinimums.<id>`; the unused sign-in helpers and the unrouted `examples/d1` template code are gone; `app/**/*.mjs` is type-checked (`checkJs`) and `tsc` is clean.
10. Copy consistency: b903c95. The invite card shows the validity the API returned.

Deliberately skipped, with reasons:

- Splitting `app/page.tsx` and `app/api/sikgu/route.ts` into modules, and code-splitting the room hub. Every existing test reads those two files whole and slices them by function name, so any move breaks the suite without a behaviour change, and the phase rule requires the suite to pass unchanged after each split. Follow-up proposed: convert the source-regex tests to behavioural tests on the new API harness (`tests/helpers/api-harness.mjs`) and a DOM-level client harness, then split by feature (feed, room hub, create dialog, campus map, receipt pipeline) and by API action group.
- Removing the JPEG/WebP sanitizer paths (R3). They are unreachable from the API but fuzzed clean and covered by five tests; deleting them means deleting tests, which a reviewer could read as weakening. Left for the owner.
- Pool cards nesting a heading inside a button. Screen readers read the text correctly; changing the markup means touching the card layout selectors, a visual change beyond "refine".
- Font sizes of 6.7 to 8.7 px in the create dialog's restaurant picker and category chips. Legibility on a 390 px phone is a real concern, but the sizes are part of the visual identity; recorded for the owner.
- Removing the unrendered restaurant menu descriptions and prices (about 4 KB gzipped). Restaurant data is out of bounds for this phase.
- `og.png` at 1.25 MB. Only link-preview crawlers fetch it; re-encoding an asset is a design decision.
- Moving `drizzle-orm` to devDependencies and deleting `db/index.ts`. Both are unused at runtime, but the README documents the Drizzle client and the hosting platform's treatment of `dependencies` is unknown; left as-is.
- Korean masking policy (P4) and the per-member order amounts the README describes (`rooms.total` is set by the host): product decisions.

## Phase 5: adversarial verification

### Round 1

Three fresh-context verifiers were given the repository, the brief, the README, and this file, with no knowledge of how the fixes were written. Their raw reports are in the session transcript; what they found and what happened to it:

Adversarial security and concurrency verifier (34 attack tests, 28 passed as "could not break", 6 failed as findings). Could not break: every authorization check across all actions and roles; stolen member references; cross-room invite tokens; closed, expired, and `deleting` rooms; every malformed identity header; the `room_blocks` mechanism in every path and interleaving including remove-versus-accept and approve-versus-accept races; capacity under 20 rounds of shuffled concurrent approvals, acceptances, leaves, and removals (approved count never above capacity, invite `uses` always equal to members admitted by invite); the per-host, per-room, and chat limits under parallel requests; the mutation lock in every PUT/DELETE/sweep interleaving including stale reclaims; the sweep with R2 or D1 failures; the receipt pipeline against bombs, truncation, trailing data, filters, palettes, and polyglots (served with the documented headers); 96 response bodies across five roles with no identity, token, key, or pending count leaked. Findings, all low: V-B1 hostile `{toString: 1}` objects in coerced fields produced 500s (FIXED f914e9f); V-B2 and V-B3 display names bypassed text normalization and were unbounded for Korean names (FIXED 76f4af9); V-B4 several invisible code points passed `cleanText` (FIXED 76f4af9); V-B5 an object can be orphaned under a deleted room's prefix if a PUT stalls past the two-minute lock, a DELETE reclaims and completes, the late upload lands after the prefix listing, and its compensating delete then fails (ACCEPTED: needs a two-minute stall plus an R2 error; cleaning it requires a bucket-wide orphan sweep, recorded as a follow-up). Qualifications: the uppercase invite token gave 410 instead of 400 (FIXED f914e9f); the 46 MB legitimate worst case measured about +122 MB end to end in Node, close to the 128 MB isolate cap (FIXED df63016 by refusing 16-bit depths, which the browser never produces, halving the worst case to 23 MB); D1 batch atomicity itself cannot be verified outside D1 and remains an assumption stated in the concurrency section.

Spec comparison verifier (19 behavioural checks through the harness, all agreeing with the README's promises). Disagreements, all documentation: the README test count and project structure were stale (FIXED 76d0d48); the README described per-member order amounts the product never had and mislabelled E1 (FIXED 76d0d48); the runbook told operators to ask for a reference the toast never showed (FIXED 76d0d48: messages now end with the reference prefix); the I1 text in this file said the client `closesAt` path was kept, which it was not (corrected above); the create-room contract change needs a deploy note (added to RUNBOOK.md); the runbook's log-prefix list was incomplete (FIXED 76d0d48).

Full-diff reviewer (every test-file diff, every commit, nine fails-before/passes-after runs from extracted parent trees). No test removed; six assertions changed, each judged at least as strong; every Phase 2 commit ships a test; no forbidden file touched; no new dependency; restaurant data unchanged. Findings: the composer clear rule left sent text behind if the student kept typing (FIXED cd756df); the invite resume used per-tab storage with a ten-minute limit and could strand an invitee (FIXED b549608); the room poll counted a superseded response as a failure and had no visibility reset (FIXED 7a040d2); this file undercounted the changed assertions and one commit message overstated its copy reuse (corrected above). It also lists every user-visible change made under Phase 2; each is the fix for a recorded finding, and they are enumerated in the summary below under "what changed for users".

### Round 2

Two fresh verifiers re-checked the seven commits made in response to round 1.

Diff reviewer: all seven tests fail on the parent commit and pass on their commit (run from extracted parent trees); no assertion weakened; no forbidden file or dependency touched; README count matches the suite at HEAD. Findings: the room-poll visibility handler could leave two timer chains running after rapid tab switches and one chain alive after unmount (FIXED, "Room poll: one timer chain"); stripping tag characters reduced subdivision flag emoji to a plain flag (FIXED, "Keep tag characters"); the 24-hour invite memory in shared browser storage would be consumed by the next person to sign in on a shared computer (FIXED, window reduced to one hour); two stale sentences in this file (corrected). Process notes it recorded, accepted as-is rather than rewriting history: commit f914e9f bumped the README test count to 87 while the suite had 86 at that commit (the next commit, df63016, made at the same time, added the 87th test), so the README-count test is red at that single commit; commit 76d0d48 bundled the reference display, the documentation pass, and a small follow-up to the poll change; commit 7a040d2's message said callers "keep working" while two of them showed a stale-screen notice on a superseded reload until 76d0d48.

Adversarial re-check (re-run against HEAD after the round-2 fixes above): the field coercion holds against every hostile object, symbol, array, numeric-string, and prototype-key shape in every field (400, no log line; harmless `Number()` semantics for strings like `" 4 "` and `"4e0"` since only allow-listed values pass); no unnormalized name reaches `rooms.host_name`, `room_members.display_name`, `room_messages.sender_name`, or the bootstrap display name for overrides, zero-width, fillers, tags, 1500 syllables, emoji-only, or `@`; the full IHDR matrix accepts exactly the eleven 8-bit and sub-8-bit combinations and refuses all four 16-bit ones; the largest accepted image (2400x2400 8-bit RGBA, 7.7 MB compressed) costs +60 MB RSS through the PUT handler (the earlier +122 MB figure was dominated by the test harness's own multipart encoding); the reference suffix appears only on server failures and never shows the full UUID. Open items it found: combining-mark-only, variation-selector-supplement, and rarer format-character strings still counted as visible (FIXED 4ef2c28: category-based rule, which also stopped stripping the joiners that family emoji and Persian words need); the composer prefix rule still left sent text behind for a few mid-flight edits and changed the textarea value long after the gesture (FIXED 284c15c: clear on send, restore on failure); the pending-invite JSON parse was unguarded (FIXED 284c15c). Its measured pre-fix reproduction of the poll timer leak matches the diff reviewer's simulation (FIXED 9de664b).


### Round 3

A fresh verifier attacked the five round-2 follow-up commits (9de664b, ba74bec, 764a2f6, 4ef2c28, 284c15c) with fake-timer simulations of the poll effect (rapid visibility toggles, unmount during reloads, remount, a 40-run seeded fuzz), an exhaustive sweep of every code point in the mark, format, separator, and control categories, 41 blank-rendering shapes and 33 legitimate strings through `cleanText`, the display-name path end to end, and the composer and invite flows with fake network calls; every commit's test fails on its parent and passes at HEAD. It found one high regression and two lows, all mine: the category-based blank rule listed the variation-selector range as a separate alternative although `\p{M}` already covers it, and two overlapping alternatives under a `*` quantifier backtrack exponentially on a non-blank string (22 such characters plus a letter: half a second; 40: did not finish in a minute), reachable from the identity header on every authenticated request and from chat bodies (FIXED 3183e03: one character class, verified to accept the identical set of code points; the new test did not complete before the fix); the blank test ran before truncation, so a run of a thousand joiners plus a letter was cut to an invisible body (FIXED 733110d); the guarded invite parse still let a literal `null` through to a property access (FIXED 3b3e4c1). Everything else held: one poll chain in every simulation, zero timers and listeners after unmount, family emoji and Persian words intact, subdivision flags intact, every previously leaking name shape now the masked fallback, the composer clearing on send and restoring the draft on failure, the invite window boundaries exact. It also noted that the categorical rule strips a few visible "prepended concatenation mark" format characters (Arabic number and ayah signs, Syriac abbreviation mark, Kaithi number signs), which no Korean, English, or Japanese text uses; recorded, not changed.

### Round 4

Round 4 was started as a fresh-context re-check of the three round-3 follow-up commits (3183e03, 733110d, 3b3e4c1) and was stopped by the owner before it reported, so those three commits are covered only by their own tests (each shown failing before and passing after its change) and by the full gate below, not by an independent verifier. The regex fix was additionally checked by the round-3 verifier's own equivalence script before it was applied. This is the one open item in the verification loop: a final adversarial pass over those three commits should be run before release.

## Final gate

Run after the last code commit on `audit-2026-09-03` (3b3e4c1; the two commits after it touch only AUDIT.md). `npm test`, exit 0; build and typecheck sections unchanged from the baseline. Test summary, verbatim:

```
# tests 95
# suites 0
# pass 95
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 221.804259
npm test exit: 0
```

`npm run lint`, exit 0, no output beyond the script banner. `npm audit`, exit 1: `15 vulnerabilities (4 moderate, 11 high)`, the same toolchain-only set classified in Phase 3 (esbuild, image-size, next, postcss, sharp, undici, vite, ws), none of which is present in the production bundle.

## Summary

Outcome: on branch `audit-2026-09-03` (51 commits, not pushed) every high and medium finding that code can fix is fixed with a test that failed before and passes after, three completed rounds of fresh-context adversarial verification could not break authorization, capacity, invite blocking, the mutation lock, the retention sweep, or the receipt pipeline, the regressions those rounds found in my own fixes (including one exponential-backtracking regex) are fixed, and the full gate is green (95 tests, lint clean); a fourth verification pass over the last three code commits was stopped before it reported and remains the one open item.

Findings by severity (Phase 1): 41 in total. 4 high (all FIXED: receipt bomb memory, camera-only picker, money step validation, chat keyboard closing). 8 medium (7 FIXED; A1, forgeable identity headers if the worker is ever reachable outside the platform proxy, DEFERRED as a platform constraint with a hand test). 28 low (26 FIXED, including the four deferred to the polish phase and completed there; P4, the Korean masking policy, DEFERRED as a product decision; R2, the polyglot residue, NOT A BUG given the serving headers). 1 informational (R3, unreachable JPEG/WebP sanitizer code, DEFERRED). Phase 5 verifiers found 18 further issues across three completed rounds: 17 FIXED in the same test-first loop, 1 ACCEPTED (an object orphaned under a deleted room's prefix only when an upload stalls past the two-minute lock and its compensating delete then fails). No finding was DECLINED.

What changed for users. Phase 2 fixes a student can notice: the receipt picker on a phone now offers the photo library instead of forcing the camera; any whole won amount is accepted in the order form; the chat keyboard stays open across sends and the composer clears on send; a host can reject or remove a pending requester after the deadline; a removed or rejected user can no longer re-enter through an invite link they already have, though they may ask again; the pool dialog disables joining a full room and says so; a missing room is reported as not found; platform outages show Korean messages instead of parser errors; room creation sends the chosen preset and the server sets the deadline, so a phone with a wrong clock no longer breaks room creation. Phase 4 polish: the room hub shows the countdown and the closed state and disables the controls that would fail; countdowns follow the server clock and refresh when a tab wakes; polling backs off during outages; a room that closes or is deleted while its dialog is open is explained instead of vanishing; screen readers get a real progress bar, new-message announcements, and alerts; small buttons have phone-sized hit areas and sheets no longer scroll the page behind them on iOS; reduced motion is respected; server errors end with an error code an operator can search for; the invite card shows the validity the API returned. Operability: a health endpoint, one structured log line per server error with no personal data, and RUNBOOK.md.

What remains and why. A1 cannot be fixed in application code; the README and RUNBOOK state the proxy requirement and the hand test below checks it. P4 (first and last syllable of Korean names shown) and the missing per-member order amounts are product decisions. The 15 audit advisories are toolchain-only and need a framework migration. Splitting `page.tsx` and `route.ts` into modules is proposed as a follow-up because the existing tests read those files whole; the new in-process API harness is the path to behavioural tests that would make a split safe. The orphaned-object residue needs a bucket-wide sweep if it is ever observed. D1 batch atomicity is assumed (documented by Cloudflare) and cannot be exercised outside D1.

What a human should test by hand before deploying.
1. Forged identity: an anonymous request to the public host with a fake `oai-authenticated-user-email` header must return `"user": null` from `?action=bootstrap` (A1).
2. Mutations through the proxy: sign in on the public host and create a room in the browser; this exercises the same-origin check against the real origin and the new `minutes` contract.
3. Receipt upload from a phone: pick an existing screenshot from the photo library, save, and view it as an approved member; this also proves `nodejs_compat` (`node:zlib`) is honoured in production.
4. Delete a room that has a receipt and confirm the object is gone from the R2 bucket.
5. Open `/api/sikgu?action=health` after the deploy.
6. In a room on iOS Safari: send several chat messages (keyboard stays open, only the chat list scrolls), scroll inside the sheet (the feed behind it must not move), and press Escape mid-composition on a desktop Korean IME (the dialog must stay open).
7. Invite flow signed out: open an invite link, sign in, and confirm the room opens and the token is not in the address bar at any point.
8. Right after the deploy, a tab left open on the old bundle should fail room creation once with a 400 and work after a reload (RUNBOOK deploy note).

How this was verified. Every fix has a test that was run against the code before the fix (recorded failing) and after (passing); the gate log in the session scratchpad has each run. The API tests execute the real route handler against SQLite with the real migrations. Three rounds of fresh-context verifiers (adversarial, spec comparison, full-diff review) attacked the branch; what they could not break is listed under Phase 5, and everything they did find was fixed test-first and re-verified in the next round. This is not a claim that the app is bug-free: it is a record of what was tried, what held, and what was changed.
