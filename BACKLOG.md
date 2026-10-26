# SIKGU backlog

Work found after [COMPLETION.md](COMPLETION.md) was closed (2026-10-05). Nothing
here blocks `v1.0.0`; COMPLETION.md stays the definition of done.

## 2026-10-22 review

Four read-only reviews (server, client, tests/CI, docs) were checked and fixed
on `fix/review-2026-10-22`. Each fix has a test that fails on the code before it.

Fixed:

- Room sheet reloaded about every 30 seconds behind the user (chat jumped to
  the top, the phone keyboard closed); 저장 on an untouched amount erased it;
  a pending room opened from 내 정보 showed as closed during a home search; the
  member panel collapsed to 68–119px on phones.
- Join-request limit counted membership rows (cancel reset it; own rooms and
  invites used it up) — now a `join_requests` log, migration 0007. Reopening
  closed rooms could put 15 rooms in the feed for one host. A new invite link
  could keep the deadline from before a simultaneous extension.
- CI's npm 10.9 ignored `strict-allow-scripts`; `npm ci` failed on macOS with
  npm 11 (fsevents); builds and browser tests rewrote committed evidence files;
  a stray `test.only` passed CI; `npm start` could not run.
- Dialog close scrolled from the top; long chat links scrolled sideways; three
  contrast failures; search placeholder offered menu search; wrong og.png size.
- Browser storage that throws is now tested in a real browser, and the catalog
  count test RUNBOOK describes exists.
- Two production advisories published on 2026-10-22 failed CI's audit:
  `sharp` <0.35.5 (GHSA-wq5f-xc86-pv6w, via next) and `source-map-js` 1.2.1
  (GHSA-68fv-2mgg-jv7q, via postcss). `source-map-js` moved to 1.2.2 within its
  range; `sharp` is overridden to 0.35.5 because miniflare pins 0.35.4 exactly
  and npm shares that copy with next. Drop the override once miniflare allows it.

Open:

- [x] **Deploy:** Sites version 29 (`sites-v29`) shipped migrations 0007–0009
  on 2026-10-24 ([RELEASE.md](RELEASE.md) release log). Still open from that
  release: observing the three new indexes, alternate origins (D3) and the log
  check (D5).
- [x] **Evidence:** module inventories, dependency reachability and catalog
  preservation regenerated from `sites-v29` on 2026-10-24. Screenshots were
  not regenerated (browser tests run in CI, not on the shared server).
- [ ] **Structural tests:** 45 tests in `tests/rendered-html.test.mjs` and
  `tests/sikgu.test.mjs` assert on source text while their names describe
  behaviour. Convert the ones guarding user-visible behaviour to browser tests
  (the storage case is done), or rename them as structural checks.

## 2026-10-26 review

A read-only review of `main` at `15dc560` (server, client, CI, the live site
at version 29). Build, typecheck, lint, the 131 Node tests and the production
audit passed; CI was green; the live health check answered ok. No
authorization bypass, injection or race in the capacity, deadline and
rate-limit checks was found. Server findings were reproduced with the SQLite
harness; client findings were traced in the code, the layout ones also
rendered in Chromium.

Fixed:

- The member amount field was about 22px wide, live since version 28. A
  member row is a three-column grid (`34px 1fr auto`) and the amount form's
  flex rules (`flex-basis: 100%`) do nothing in a grid, so the form fell into
  the avatar column. The A1 browser test passed because `fill()` works on a
  box that small. The form now spans the row (`grid-column: 1 / -1`), and a
  browser test measures it at 360px and 1280px.

Open, server:

- [ ] **Room creation is unbounded.** The five-room cap in `create_room`
  counts only rooms before their deadline, and `close_recruitment` moves the
  deadline to now. Create five, close five, repeat: one account reached 31
  rooms, each kept 30 days, while the sweep removes 50 an hour. That is the
  "fill D1" risk the chat caps were added for (F-2). Count rooms created in
  a recent window inside the INSERT, as `join_requests` does.
- [ ] **A retried delete can reopen a room.** The delete lock can be retaken
  on a `deleting` room (`lock.ts`), and if the read after it fails,
  `deleteRoom` releases the lock with `status = 'open'`. A room whose
  receipt was already deleted returns to the feed. Keep `deleting` when the
  lock was taken from it.
- [ ] **`User-XXXXXX` labels can be copied.** A ChatGPT profile name in that
  pattern passes `displayName` unchanged, so a host can see two identical
  labels. README calls the label distinct. Reject or mark names in the
  generated pattern.
- [ ] **The 500-a-day chat cap counts surviving messages.** Deleting a room
  deletes its messages and frees the sender's daily allowance. Storage stays
  bounded; README's "500 a day" is not strictly true.
- [ ] **Extending a closed room revives its invite links.** After
  `close_recruitment` an old link answers 410; an extension within the grace
  window rewrites every unused link's expiry to the new deadline, and the
  link works again.
- [ ] Nits: repeated ids in `categoryIds`/`searchRestaurants` are not
  deduplicated, so a crafted feed URL reaches 99 of D1's 100 bound
  parameters; a few reads (`roomForAction`, the first read in
  `requestJoin`, invite reads) skip `withD1ReadRetry`; an empty POST gets
  411 instead of 400; `detectReceiptType` still recognises JPEG and WebP;
  `room_invites.expires_at` always equals `rooms.closes_at`.

Open, client:

- [ ] **A stored invite forces sign-in on every load for an hour.** While a
  pending invite is stored (60 minutes) and nobody is signed in,
  `continuations.ts` calls `signIn()` on each page load. A student who does
  not finish signing in cannot browse the site.
- [ ] **Text too small to read.** 100 of 289 `font-size` declarations in
  `globals.css` are under 10px and 41 under 8px (host note 8px, host name
  6.5px, fee label 7px, pool dialog countdown 8px, campus map meta 7–8px).
  They are px, so the browser text-size setting does not scale them.
- [ ] **The amount input zooms iOS.** It is 13px and not in the 16px phone
  list, so iOS zooms in on focus inside the fixed sheet.
- [ ] **The invite panel's expiry goes stale.** It shows the expiry from when
  the link was created; after 모집 마감 it still offers a dead link, and after
  an extension it says 마감 for a link that works. Use `room.closesAt`.
- [ ] **The dialog focus trap leaks.** It wraps only from the first or last
  element; the send, approve and reject buttons disable themselves after a
  click, focus drops to `body`, and the next Tab reaches the page behind.
- [ ] **내보내기 has no confirmation**, unlike 방 삭제 and 방 나가기, and the
  removed member cannot rejoin through an invite.
- [ ] **Screen readers miss pool-card state.** The card button's `aria-label`
  replaces its content, so 거절됨, 승인 대기, deadline and progress are not
  announced.
- [ ] **A saved amount briefly shows the old value.** The draft is cleared
  before the room reloads; if the reload fails, the old amount stays next to
  an error although the save succeeded. The POST already returns the amount
  and total.
- [ ] **The invite confirmation is unstyled.** It reuses `.pool-modal`, which
  has no padding, so text and buttons touch the sheet edges.
- [ ] **One failed search or filter refetch replaces the feed with the error
  screen** (`use-feed.ts`), which also blocks 주문방 만들기 until the next
  poll.
- [ ] **Chat history can have a gap.** After 이전 메시지 더 보기 the poll
  stops updating the older-messages cursor, so more than 200 messages
  arriving while the tab is hidden leave a gap that cannot be loaded.
- [ ] **Two actions skip the 401 redirect.** `saveOrderInfo` and `deleteRoom`
  in `room-hub.tsx` call `fetch` directly instead of `lib/api.ts`, so an
  expired session shows an error instead of going to sign-in.
- [ ] **The map, map preview and hero count the filtered feed and rooms past
  their deadline.** With 현재 위치만 on, other pickup points show 0; the hero's
  바로 참여하기 can open your own room.
- [ ] Copy and small UI: the host sees 방장이 주문 정보를 업데이트했어요 after
  their own save; "모집이 마감됐어요. 정원이 차면 더 일찍 마감돼요." contradicts
  itself; the extend hint stays after both extensions are used; pool-card
  pins show 대학원 instead of 206; chat times have no date across a 30-day
  room; server messages end in ~습니다 and client ones in ~어요.
- [ ] Structure: `room-hub.tsx` is 739 lines with about 30 `useState` calls
  and eight copies of the same try/catch/finally; the extension count, 15
  minutes, 10-minute grace and 30 days are literals instead of coming from
  `sikgu-rules.mjs`.

Open, repository:

- [ ] **The 2026-10-24 security review is not recorded.** Commits cite F-2,
  F-3, F-5 and F-10, but no file lists the findings or which remain open.
- [ ] **Development-only advisories:** vite 8.2.2 (dev server, fixed in
  8.3.5), zod <4.6.6, and undici through miniflare/wrangler. None reaches the
  production bundle; `npm audit --omit=dev` is clean.
