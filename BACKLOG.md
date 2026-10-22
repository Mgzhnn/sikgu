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

Open:

- [ ] **Deploy:** the next Sites release must apply migration
  `0007_join_request_log` (one new table). Until then production keeps the old
  join limit.
- [ ] **Evidence:** regenerate `verification/` with `SIKGU_EVIDENCE=1` (see
  verification/README.md) at the next release; the committed inventories
  predate this branch.
- [ ] **Structural tests:** 45 tests in `tests/rendered-html.test.mjs` and
  `tests/sikgu.test.mjs` assert on source text while their names describe
  behaviour. Convert the ones guarding user-visible behaviour to browser tests
  (the storage case is done), or rename them as structural checks.
