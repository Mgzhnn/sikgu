# Verification evidence

Run commands from the repository root with Node ≥22.13. Tests use synthetic data; no production database or bucket was modified.

```bash
npm ci
npm test > verification/final-local.log 2>&1
npm run lint > verification/final-lint.log 2>&1
npx playwright install chromium
npm run test:browser > verification/browser-final.log 2>&1
npm ls vinext image-size drizzle-kit @esbuild-kit/esm-loader @esbuild-kit/core-utils esbuild fflate --all
npm audit --json > verification/dependency-final.json
node verification/collect-evidence.mjs
```

An audit exit code of 1 is expected until the residual advisories in REPAIRS.md are addressed. It is not a test/build success. The evidence collector requires all three fresh module inventories from the build and checks catalog, hosting manifest and applied migration preservation against `25804ae`.

| Evidence | Meaning |
| --- | --- |
| `baseline.log` | Original 95-test baseline and build |
| `phase1-before.log`, `phase1-after.log` | Five deterministic SQL authorization/state interleavings before/after guarded writes |
| `invites-before.log`, `invites-after.log` | Invitation lifetime/recovery before/after |
| `pagination-before.log`, `pagination-after.log` | Bounded retained-room/chat traversal fails without cursor fields and passes with them |
| `phase1-full.log`, `phase2-full.log`, `phase3-full.log`, `refactor-*.log` | Integration checks while changes were developed; not a claim that every intermediate commit is a release candidate |
| `browser-phase*.log`, `browser-mobile*.log`, `browser-refactor.log` | Browser integration history, including the initial enlarged-text failures and their fixes |
| `final-local.log`, `final-node.log`, `final-lint.log`, `browser-final.log` | Final local build/typecheck, Node, lint and Chromium results |
| `server-*.log` | Verification on the Linux server, kept separate from local/browser evidence |
| `mobile-*.png` | Actual Chromium screenshots at 360/390px, including 200% root text size |
| `dependency-*.json`, `dependency-paths.log`, `modules-*.json` | Dated npm snapshots and exact production-module provenance |
| `hosting-probe.json` | Anonymous plain/spoofed requests to the known public URL; HTTP 403 is inconclusive |
| `catalog-preservation.log` | Exact catalog comparison and untouched hosting/applied SQL migration check |

Focused regression commands:

```bash
node --test tests/repairs-api.test.mjs
node --test tests/order-estimates.test.mjs tests/invite-continuation.test.mjs
node --test tests/pagination.test.mjs tests/message-history.test.mjs tests/polling.test.mjs
npm run test:browser
```

Before-fix logs were captured by running the correctness regressions against the original implementation (or the then-current intermediate implementation). To repeat a baseline comparison, use an isolated checkout of `25804ae`, copy the relevant regression plus the request-local harness, and run it there. Never run the original review's assertions of wrong behavior as a green acceptance gate.

The SQLite harness executes the real route and generated migrations, with D1/R2/platform adapters. Browser tests execute the app UI and replace local API responses. Neither verifies authentication at the real proxy, actual mobile hardware or production D1/R2 operation. Module inclusion plus call-site inspection supports the dependency disposition; a dependency's package category alone does not.
