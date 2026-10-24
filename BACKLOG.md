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

- [ ] **Deploy:** the next Sites release must apply migrations
  `0007_join_request_log`, `0008_message_sender_index` and `0009_app_keys`
  (two tables, one index). Until then production keeps the old join limit and
  none of the 2026-10-24 security fixes. Checklist: [RELEASE.md](RELEASE.md).
- [ ] **Evidence:** regenerate `verification/` with `SIKGU_EVIDENCE=1` (see
  verification/README.md) at the next release; the committed inventories
  predate this branch.
- [ ] **Structural tests:** 45 tests in `tests/rendered-html.test.mjs` and
  `tests/sikgu.test.mjs` assert on source text while their names describe
  behaviour. Convert the ones guarding user-visible behaviour to browser tests
  (the storage case is done), or rename them as structural checks.
