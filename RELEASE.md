# SIKGU releases

How a commit on `main` becomes the live site, and how each live version is tied back to the commit it was built from. The general procedure is in [RUNBOOK.md](RUNBOOK.md) "Deploy". This file holds the release checklist, the record of each release, the tag scheme, and the map from commit hashes in older records to the current history.

**Live:** Sites version 29, tag `sites-v29` (`db0861a`), deployed 2026-10-24. See the [release log](#release-log).

## Release checklist

For the next release, version N, from `main`. Copy this list into the PR or notes for that release and tick each box in order. Do not continue past a failed step. The current production version is the rollback target.

Before starting, list what the release ships since the last tag (`git log --oneline sites-v<N-1>..main`) and which migrations it adds (`git diff --name-only sites-v<N-1> main -- drizzle/*.sql`). Write migrations so that the previous version still runs against the new schema.

### A. Before building

- [ ] **A1.** `main` is green in CI, including the Playwright job, for the exact commit you will deploy. Record it:
  ```bash
  git ls-remote https://github.com/Mgzhnn/sikgu.git refs/heads/main
  ```
- [ ] **A2.** In the Sites project view, note the current live version and keep it as the rollback target.
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
- [ ] **B3.** The artifact carries the hosting manifest and every migration in `drizzle/`, including the new ones:
  ```bash
  ls dist/.openai/hosting.json dist/.openai/drizzle/*.sql
  ```

### C. Join the Sites history, save and deploy (Codex, Sites tools)

Sites keeps its own git copy of the site source and publishes only when its current head is an ancestor of the commit being published. That head is the **release merge** from the previous release. Release merges exist only on Sites, never on GitHub: the GitHub history was rewritten to remove AI-authored commits and trailers, and the original Sites history still contains them. So every release needs its own release merge first.

- [ ] **C1.** Ask Codex to save a new Sites version from the `sikgu-release` checkout. It stops with *"Local and remote Site history diverged. Reconcile the changes before retrying; no history was overwritten."* That is expected. It has fetched the Sites head into `.git/FETCH_HEAD`.
- [ ] **C2.** Check that the Sites head holds exactly the source of the live version; this command must print nothing:
  ```bash
  git diff sites-v<N-1> "$(awk '{print $1; exit}' .git/FETCH_HEAD)"
  ```
  If it prints a difference, stop. Sites holds source that is not tagged; find out where it came from before going on.
- [ ] **C3.** Create the release merge. It keeps the files of the A1 commit and adds the Sites head as a second parent:
  ```bash
  git merge -s ours --no-ff --allow-unrelated-histories "$(awk '{print $1; exit}' .git/FETCH_HEAD)" -m "Release merge for Sites version <N>: join the Sites source history to <A1 commit>"
  ```
  Confirm the tree is unchanged; this must print nothing:
  ```bash
  git diff <commit from A1> HEAD
  ```
  **Never push this merge to GitHub.** The clone's `origin` is GitHub; nothing in this checklist pushes to it.
- [ ] **C4.** Ask Codex to save the Sites version again from this checkout, then deploy **that explicit version** publicly, not "latest". Record the version number and the release merge hash.
- [ ] **C5.** Check that the release's migrations were applied. The Sites tools show a list of user tables but cannot run SQL. New tables can be checked there; new indexes cannot. Record which objects you could and could not observe. If the Sites Database view in the browser can run SQL, this query lists everything:
  ```sql
  SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name;
  ```
  Never edit or delete the `app_keys` row: replacing the key changes every `User-XXXXXX` label for new writes.

### D. Verify the live site

- [ ] **D1.** Health. It must answer HTTP 200 with `{"ok":true,"database":"ok","storage":"ok"}`. Results are cached for 30 s per isolate, so after a failure wait 30 s before retrying:
  ```bash
  curl -si "https://sikgu-dgist.ugrp44group.chatgpt.site/api/sikgu?action=health"
  ```
- [ ] **D2.** Identity probe. It must print `"summary":"PASS"` with 3/3 checks. Keep the output:
  ```bash
  npm run probe -- https://sikgu-dgist.ugrp44group.chatgpt.site | tee identity-probe-$(date +%F).log
  ```
- [ ] **D3.** Alternate origins (release gate, security review F-3). Ask Codex for every URL that serves the app (preview URLs, `workers.dev`, custom domains), and run D2 against each. Each must strip forged headers or refuse the request. If the platform cannot list them, record "could not verify"; do not mark this step as passed.
- [ ] **D4.** Smoke test with two of your own accounts, for example one in a private window: create a room, request to join from the second account, approve, chat both ways, upload a receipt and open it as the member, delete the room. If possible, also ask Codex to confirm that nothing is left under `receipts/<roomId>/` in storage.
- [ ] **D5.** About 10 minutes after the deploy, ask Codex to check the Sites logs for `"level":"error"` lines.

If D1–D4 fail and a fix is not immediate, roll back (RUNBOOK "Rollback"): redeploy the previous version as a saved version, with no rebuild.

### E. Record the release

- [ ] **E1.** Tag the A1 commit, not the release merge, and push the tag:
  ```bash
  git tag -a sites-v<N> <commit from A1> -m "Sites version <N>, deployed <YYYY-MM-DD>; Sites source <release merge>"
  ```
  ```bash
  git push origin sites-v<N>
  ```
- [ ] **E2.** In one PR:
  - commit the probe log(s) from D2/D3 under `verification/`;
  - add an entry to the [release log](#release-log);
  - update the README "Production" line and RUNBOOK "Last deploy";
  - regenerate the evidence in `verification/` from a clean clone of the tag, with its own `node_modules` (a symlinked one leaks absolute paths into `modules-*.json`):
    ```bash
    SIKGU_EVIDENCE=1 npm test
    ```
    ```bash
    node verification/collect-evidence.mjs
    ```
- [ ] **E3.** Delete the `sikgu-release` directory from the server. The next release fetches the Sites head again in C1.

## Release log

### Sites version 29 — 2026-10-24

| | |
| --- | --- |
| Source on GitHub | `db0861a`, tag `sites-v29` |
| Sites source | release merge `5ca240d` (parents `db0861a`, `e42a53c`; tree `e557a5e5`, identical to `db0861a`) |
| Sites version / deployment | `appgver_28999db1…` / `appgdep_6adca638…`, status succeeded 2026-10-24T12:36:26Z |
| Rolled back from / to | none; version 28 (`sites-v28`) stays the rollback target |
| Migrations | `0007_join_request_log`, `0008_message_sender_index`, `0009_app_keys` |

Shipped since version 28: the join-request limit, open-room cap and invite expiry fixes (`6160108`); room sheet, UI, CI and tooling fixes (`bafa4de`, `5b5883b`, `3396a84`, `470b880`, `e40e233`); `sharp`/`source-map-js` advisories and Next.js 16.4.3 (`97f9096`, `68d33d2`); the join-request log purge (`5f3b782`); the chat volume cap (#9), the health probe cache (#11) and the HMAC display label (#12) from the 2026-10-24 security review; and this release documentation (#13, #14).

| Step | Result |
| --- | --- |
| A1–B3 | Pass. CI green including Playwright; fresh clone; `npm test` 131/131, 0 skipped; lint clean; production audit 0; all ten migrations in the artifact |
| C1–C3 | The first save stopped on the divergence, because the Sites head was `e42a53c`, the pre-rewrite twin of `674d757` (identical tree). The release merge `5ca240d` was created in the release clone only; nothing was pushed to GitHub |
| C4 | Version 29 saved and deployed publicly |
| C5 | Partly verified. `app_keys` and `join_requests` are listed in the Sites table overview. The three indexes (`join_requests_user_created_idx`, `join_requests_created_idx`, `room_messages_sender_day_idx`) could not be observed because the tools cannot run SQL. Migrations apply in journal order and 0009 is present, so 0008 is very likely applied, but this is not observed |
| D1 | Pass, twice (21:38 and 21:39 KST): HTTP 200 `{"ok":true,"database":"ok","storage":"ok"}`. Security headers present; no `Strict-Transport-Security` (review F-10) |
| D2 | Pass, 3/3 (`verification/identity-probe-2026-10-24.log`) |
| D3 | Could not verify. Sites reports the public URL only: no current preview URL, no custom domains; `workers.dev` routes and older preview URLs are not exposed by the tools |
| D4 | Pass. The owner reported that all steps worked; storage cleanup of the receipt object was not separately checked |
| D5 | Not run |
| E | Tags `sites-v26`, `sites-v28`, `sites-v29` pushed; evidence regenerated from `sites-v29` |

Open after this release: C5 index check, D3, D5.

## Tag scheme

Each Sites version that is deployed publicly gets an annotated tag `sites-v<version>` on the GitHub commit it was built from. A tag is created only after the deploy has been verified (step D), and it is never moved. The README "Production" line and RUNBOOK "Last deploy" name the tag, so a reader can check out the live source with `git checkout sites-v<version>`.

| Tag | Commit | Evidence |
| --- | --- | --- |
| `sites-v26` | `1ea9eae` | REPAIRS.md: version 26 was "Raise Next.js to 16.3.8", deployed 2026-10-05 (recorded as `e5e77d7` before the history was rewritten). Tagged retroactively |
| `sites-v28` | `674d757` | The Sites source head for version 28 is `e42a53c`, whose tree is identical to `674d757`; `dcb46d5` says the same. Tagged retroactively |
| `sites-v29` | `db0861a` | Sites version 29 records source tree `e557a5e5…`, identical to `db0861a`, built through release merge `5ca240d` |

## Commit hashes in older records

The repository history was rewritten after these records were written, so the hashes they quote no longer resolve. The docs now quote the current hash. This table keeps the old ones findable. Each mapping comes from what the record says the commit did, matched against the current commit with that change.

| Old hash | Current | Commit | How it was matched |
| --- | --- | --- | --- |
| `10fa317` | `ed047a1` | Allow install scripts for pinned build tools | AUDIT.md: `main` when the 2026-09-03 audit started; parent of that day's first commit |
| `77183f3` | `e85e250` | Add a health check, structured error logging, and a runbook | REPAIRS.md: the first build that answered `?action=health` (`git log -S'action === "health"'`) |
| `25804ae3bac5be6aa74b0ad39186fc3df10b7013` | `8439912` | README: point to the audit record and the runbook | Baseline of the ranked repairs: parent of the first repair (`6b14788`); the evidence log recorded 5 applied migrations, which only this candidate has |
| `2aa6747` | `6b14788` | Fence membership and recruitment writes against concurrent revocation and deletion | REPAIRS R1/R2 |
| `9a60995` | `b720bb1` | Align invites with recruitment and show pricing conditions per delivery app | REPAIRS R3/R6/R8 |
| `b837677` | `65ebf76` | Paginate retained history, stop polling on teardown, and fix mobile chat usability | REPAIRS R4/R5/R7 |
| `bbf2f88` | `d0de04d` | Extract private room UI and invite actions, and report retention backlog | REPAIRS "extracted room-hub.tsx" |
| `72227f1` | `ef3aaff` | Update compatible build tools and record runtime dependency provenance | REPAIRS dependency scan, 2026-09-05 |
| `e5e77d7` | `1ea9eae` | Raise Next.js to 16.3.8 past the next/og remote code execution advisory | Sites version 26 |
| `f964b71` | `6640ad8` | Merge pull request #2 (record the 2026-10-05 deployment) | COMPLETION.md: the commit audited on 2026-10-05; parent of the audit-fix commit `955491a` |
| `e42a53c` | `674d757` | Merge pull request #3 (completion plan) | Sites version 28; `e42a53c` still exists in the Sites source history with an identical tree |
