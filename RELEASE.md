# SIKGU releases

How a commit on `main` becomes the live site, and how each live version is tied back to the commit it was built from. The general procedure is in [RUNBOOK.md](RUNBOOK.md) "Deploy". This file is the concrete checklist for the next release, the tag scheme, and the map from commit hashes in older records to the current history.

## Next release: Sites version 29 from `main`

Production is **Sites version 28**, built from `674d757` on 2026-10-06. Version 29 ships everything merged since then:

| Change | Commits | Migration |
| --- | --- | --- |
| Join-request limit, open-room cap, invite expiry (2026-10-22 review) | `6160108` | `0007_join_request_log` |
| Room sheet, UI, CI and tooling fixes; local paths removed from evidence | `bafa4de`, `5b5883b`, `3396a84`, `470b880`, `e40e233` | none |
| `sharp` and `source-map-js` advisories; Next.js 16.4.3 (three critical advisories in 16.3.8) | `97f9096`, `68d33d2` | none |
| Join-request log purged by the retention sweep | `5f3b782` | none |
| Chat volume cap: 2,000 messages per room, 500 per account per day | `7ba8365` (#9) | `0008_message_sender_index` |
| Health probe cached 30 s per isolate | `fcb0c53` (#11) | none |
| `User-XXXXXX` label keyed with a server-held HMAC key | `8bced40` (#12) | `0009_app_keys` |
| Release documentation | this file | none |

All three migrations are additive (one table, one index, one table), so version 28 still runs against the new schema if a rollback is needed.

Tick each box in order. Do not continue past a failed step.

### A. Before building

- [ ] **A1.** `main` is green in CI, including the Playwright job, for the exact commit you will deploy. Record it:
  ```bash
  git ls-remote https://github.com/Mgzhnn/sikgu.git refs/heads/main
  ```
  Commit: `________`
- [ ] **A2.** In the Sites project view, note the current live version (expected: 28) and keep it as the rollback target. Live version: `____`
- [ ] **A3.** Codex on the server is signed in as the owning UG account. A different account makes Sites report "project not found".

### B. Build from a clean clone

Run on the server, in a fresh directory outside `~/projects/sikgu`, so the working checkout and its ignored files cannot leak into the artifact.

- [ ] **B1.** Clone exactly the commit from A1 and confirm it:
  ```bash
  git clone https://github.com/Mgzhnn/sikgu.git sikgu-release && cd sikgu-release
  ```
  ```bash
  git checkout --detach <commit from A1> && git log -1 --oneline
  ```
- [ ] **B2.** Install and run the gates. `npm test` builds, type-checks and runs every Node test, and must report 0 failures and 0 skipped:
  ```bash
  npm ci
  ```
  ```bash
  npm test
  ```
  ```bash
  npm run lint
  ```
  ```bash
  npm audit --omit=dev --audit-level=high
  ```
  Use the CI result from A1 for the browser suite rather than running `npm run test:browser` on sail-gpu01. That command starts a dev server on 127.0.0.1:3000, which other users on the shared server can reach.
- [ ] **B3.** The artifact carries the hosting manifest and all ten migrations, `0000` through `0009`:
  ```bash
  ls dist/.openai/hosting.json dist/.openai/drizzle/*.sql
  ```
  The last three lines must be `0007_join_request_log.sql`, `0008_message_sender_index.sql` and `0009_app_keys.sql`.

### C. Save and deploy (Codex, Sites tools)

- [ ] **C1.** Ask Codex to save a new Sites version from the `sikgu-release` build. Record the version number it reports (expected 29) and the commit from A1. Version: `____`
- [ ] **C2.** Ask Codex to deploy **that explicit version** publicly, not "latest".
- [ ] **C3.** In the Sites Database view, confirm that migrations 0007–0009 were applied. This read-only query must return 5 rows:
  ```sql
  SELECT type, name FROM sqlite_master
  WHERE name IN ('join_requests', 'join_requests_user_created_idx', 'join_requests_created_idx',
                 'room_messages_sender_day_idx', 'app_keys')
  ORDER BY name;
  ```
  `app_keys` stays empty until the first account without a profile name signs in. Never edit or delete its row: replacing the key changes every `User-XXXXXX` label for new writes.

### D. Verify the live site

- [ ] **D1.** Health. It must answer HTTP 200 with `{"ok":true,"database":"ok","storage":"ok"}`. Results are cached for 30 s per isolate, so after a failure wait 30 s before retrying:
  ```bash
  curl -si "https://sikgu-dgist.ugrp44group.chatgpt.site/api/sikgu?action=health"
  ```
- [ ] **D2.** Identity probe. It must print `"summary":"PASS"` with 3/3 checks. Keep the output:
  ```bash
  npm run probe -- https://sikgu-dgist.ugrp44group.chatgpt.site | tee verification/identity-probe-$(date +%F).log
  ```
- [ ] **D3.** Alternate origins (release gate, security review F-3). Get the list of origins that reach this Worker (preview URLs, `workers.dev`, custom domains) from the platform, and run D2 against each. Each must strip forged headers or refuse the request. Record the origins and results in `verification/`. If the platform cannot list them, write that down here; do not mark this step as passed.
- [ ] **D4.** Smoke test in an authorized test room, using two of your own accounts: create a room, request to join from the second account, approve, chat both ways, upload a receipt and open it as the member, delete the room. Then confirm through the platform storage tools that the receipt object under `receipts/<roomId>/` is gone.
- [ ] **D5.** Watch the platform logs for about 10 minutes for `"level":"error"` lines and a `retention_sweep` event, which the first feed load after an hour triggers.

If D1–D4 fail and a fix is not immediate, roll back (RUNBOOK "Rollback"): redeploy version 28 as a saved version, with no rebuild. The new tables and index stay; version 28 simply does not use them.

### E. Record the release

- [ ] **E1.** Tag the deployed commit and push the tag (see the tag scheme below):
  ```bash
  git tag -a sites-v29 <commit from A1> -m "Sites version 29, deployed <YYYY-MM-DD>; migrations 0007-0009 applied"
  ```
  ```bash
  git push origin sites-v29
  ```
- [ ] **E2.** In one PR:
  - commit the probe log(s) from D2/D3;
  - update the README "Production" line and RUNBOOK "Last deploy" (version, tag, commit, date, migrations, health and probe results);
  - tick the BACKLOG "Deploy" item;
  - note the release in REPAIRS.md if anything went wrong;
  - regenerate the evidence in `verification/` from the release clone (`SIKGU_EVIDENCE=1 npm test`, then `node verification/collect-evidence.mjs`; see verification/README.md), which closes the BACKLOG "Evidence" item.
- [ ] **E3.** Delete the `sikgu-release` directory from the server.

## Tag scheme

Each Sites version that is deployed publicly gets an annotated tag `sites-v<version>` on the exact commit it was built from. A tag is created only after the deploy has been verified (step D), and it is never moved. The README "Production" line and RUNBOOK "Last deploy" name the tag, so a reader can check out the live source with `git checkout sites-v<version>`.

Historical releases, tagged retroactively. Confirm each commit against the Sites version metadata, if Sites shows it, before pushing:

| Tag | Commit | Evidence |
| --- | --- | --- |
| `sites-v26` | `1ea9eae` | REPAIRS.md: version 26 was "Raise Next.js to 16.3.8", deployed 2026-10-05 (recorded as `e5e77d7` before the history was rewritten) |
| `sites-v28` | `674d757` | `dcb46d5` "Record the 2026-10-06 deployment: Sites version 28 from 674d757", the merge of the completion-plan branch (recorded as `e42a53c` before the rewrite) |

```bash
git tag -a sites-v26 1ea9eae -m "Sites version 26, deployed 2026-10-05 (retroactive tag)"
```
```bash
git tag -a sites-v28 674d757 -m "Sites version 28, deployed 2026-10-06 (retroactive tag)"
```
```bash
git push origin sites-v26 sites-v28
```

## Commit hashes in older records

The repository history was rewritten after these records were written, so the hashes they quote no longer resolve. The docs now quote the current hash. This table keeps the old ones findable. Each mapping comes from what the record says the commit did, matched against the current commit with that change.

| Old hash | Current | Commit | How it was matched |
| --- | --- | --- | --- |
| `10fa317` | `ed047a1` | Allow install scripts for pinned build tools | AUDIT.md: `main` when the 2026-09-03 audit started; parent of that day's first commit |
| `77183f3` | `e85e250` | Add a health check, structured error logging, and a runbook | REPAIRS.md: the first build that answered `?action=health` (`git log -S'action === "health"'`) |
| `25804ae3bac5be6aa74b0ad39186fc3df10b7013` | `8439912` | README: point to the audit record and the runbook | Baseline of the ranked repairs: parent of the first repair (`6b14788`); `verification/catalog-preservation.log` records 5 applied migrations, which only this candidate has |
| `2aa6747` | `6b14788` | Fence membership and recruitment writes against concurrent revocation and deletion | REPAIRS R1/R2 |
| `9a60995` | `b720bb1` | Align invites with recruitment and show pricing conditions per delivery app | REPAIRS R3/R6/R8 |
| `b837677` | `65ebf76` | Paginate retained history, stop polling on teardown, and fix mobile chat usability | REPAIRS R4/R5/R7 |
| `bbf2f88` | `d0de04d` | Extract private room UI and invite actions, and report retention backlog | REPAIRS "extracted room-hub.tsx" |
| `72227f1` | `ef3aaff` | Update compatible build tools and record runtime dependency provenance | REPAIRS dependency scan, 2026-09-05 |
| `e5e77d7` | `1ea9eae` | Raise Next.js to 16.3.8 past the next/og remote code execution advisory | Sites version 26 |
| `f964b71` | `6640ad8` | Merge pull request #2 (record the 2026-10-05 deployment) | COMPLETION.md: the commit audited on 2026-10-05; parent of the audit-fix commit `955491a` |
| `e42a53c` | `674d757` | Merge pull request #3 (completion plan) | Sites version 28 |

`verification/catalog-preservation.log` still prints the old baseline hash, because it is a log of the run that produced it. It will print `8439912…` once the evidence is regenerated (step E2). `collect-evidence.mjs` already uses the current hash and passes against it.
