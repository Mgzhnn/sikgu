# SIKGU 식구 — 혼자 넘기 어려운 최소 주문금액, 같이.

Group food-delivery coordination for the DGIST campus. Students choose a nearby restaurant and pickup point, gather an order, and coordinate privately before the host orders through Baemin or Coupang Eats.

![SIKGU — DGIST 공동주문](public/og.png)

## How it works

1. **Open a room:** choose one of 21 restaurants, one of 8 campus pickup points, a server-timed 20 / 30 / 45 minute recruitment period, and capacity of 2–8 people.
2. **Gather members:** request approval or accept a host's invitation. Approval, capacity and recruitment deadlines are checked inside the database write. Removed members cannot reuse an invitation to bypass the host's decision.
3. **Compare ordering apps:** each app shows its own minimum, remaining amount and estimated delivery fee. Membership benefits apply to that app only. For example, Sinjeon with ₩15,000 collected meets Baemin's stored minimum, while Coupang still needs ₩3,000, even with Coupang membership. Confirm current prices and benefits in the delivery app before ordering.
4. **Coordinate privately:** the host updates the collected total, order total and expected arrival, and shares a receipt. Approved members use the room chat. Retained rooms and older messages have “load more” controls.

This app coordinates orders; it does not place delivery orders, collect payments or calculate individual settlements.

## Invitations, history and privacy

- Invitation expiry is bounded by the room's recruitment deadline. A full room, removal or deletion can make a link unusable sooner. Hosts can recover an existing usable link when the five-link limit is reached, including after a refresh.
- Invite credentials leave the URL before the initial API request. A pending invitation requires confirmation showing the current account and room, including after sign-in or a failed initial load.
- Public browsing supports server-side filters and pages of up to 100 rooms. My Rooms uses 50-room pages; chat uses 200-message pages. Equal timestamps use an ID tie-breaker. Polling pauses in hidden tabs, backs off after errors and stops when its component unmounts.
- Names are masked and email addresses are not serialized to other users. Private chat and receipts require current approved membership on every read. Chat writes recheck membership at the SQL boundary.
- Receipts are re-encoded in the browser and validated/sanitized on the server: PNG only, metadata stripped, CRC checked, with size and pixel limits.
- Access to retained rooms ends 30 days after recruitment closes. Physical deletion is **best-effort**, driven by feed traffic; it can happen later. See [RUNBOOK.md](RUNBOOK.md) for cleanup limits and monitoring.

## Development and verification

Requires Node.js ≥22.13 to run and ≥22.18 to run the tests (the API harness imports TypeScript directly). Use the versions pinned by `package-lock.json`.

```bash
npm ci
npm run dev -- --hostname 127.0.0.1
npm test                    # production build, TypeScript, Node/SQLite tests
npm run lint
npx playwright install chromium
npm run test:browser        # real UI, local synthetic API responses
npm audit --json            # review residual entries; not currently a zero-audit gate
npm run db:generate -- --name descriptive_change
```

Local Vite development provides simulated D1 and R2 bindings without a Cloudflare account. The authentication proxy is not simulated by these bindings. Behavioral API tests use request-local synthetic identities and the real SQL against SQLite; browser tests intercept only the local API. Neither proves the production identity boundary or live D1 concurrency.

The latest repair results, before/after reproductions, package audit and deployment limitations are in [REPAIRS.md](REPAIRS.md) and [verification/](verification/). Browser coverage includes the 201st/202nd chat messages, retained history, failed sends, stale search responses, invitation confirmation, Korean IME, focus restoration, and 360px/390px layouts with enlarged text. Physical iOS testing remains outstanding.

## Architecture

| Layer | Implementation |
| --- | --- |
| UI | React 19, vinext (Next.js on Cloudflare Workers), CSS/Tailwind 4 |
| Database | D1 / SQLite, Drizzle schema and generated migrations |
| Files | R2 private receipt objects |
| Identity | Platform-injected Sign in with ChatGPT headers |
| Verification | Node/SQLite tests, deterministic scheduler tests, Playwright Chromium |

```text
app/
  page.tsx                 # feed, directory, creation and page coordination
  room-hub.tsx             # private room, membership, chat and receipt UI
  room-ui.tsx              # dialog lifecycle, API reads, uploads and polling adapter
  catalog.ts, types.ts      # preserved restaurant/pickup data and shared UI types
  polling.mjs              # cancellable scheduler shared by feed and room
  message-history.mjs      # message identity and history merging
  invite-continuation.mjs   # URL scrubbing and pending invitation validation
  order-estimates.mjs      # per-app minimum and delivery calculations
  api/sikgu/
    route.ts               # request validation, room/member/chat/receipt actions
    invites.ts             # host-only invite creation and recovery
    pagination.ts          # bounded cursor validation and ordering
    responses.ts           # private responses, tokens, SQL clock expression
  chatgpt-auth.ts           # trusted proxy identity parsing
  sikgu-rules.mjs           # shared constraints and restaurant minimums
  receipt-image.mjs         # receipt sanitization
build/                     # Sites packaging and build-module evidence
worker/                    # Worker entry and browser security headers
db/, drizzle/              # schema and generated migration history
tests/, browser-tests/     # behavioral and supplementary structural checks
```

## Hosting and operations

`.openai/hosting.json` declares `DB` and `UPLOADS`; the Sites platform provides authentication routes and bindings. A GitHub push alone is not evidence of a Sites release.

**Production (2026-10-05):** commit `e5e77d7` is live as Sites version 26 at `https://sikgu-dgist.ugrp44group.chatgpt.site`. Migrations `0004_room_blocks` and `0005_history_indexes` were applied to tables that were empty at the time. On the public origin, forged `oai-authenticated-user-*` headers are stripped: bootstrap returns `user: null` and a forged mutation gets 401 (`verification/production-probe-2026-10-05.log`). A manual room test on a physical iPhone was reported working. See the deployment section of [REPAIRS.md](REPAIRS.md) for what remains unverified.

**Before each release:** re-run the identity probe, confirm no alternate origin bypasses Sites, check migrations through the Sites Database view, and verify receipt storage. The health endpoint checks database connectivity only.

[RUNBOOK.md](RUNBOOK.md) covers release, rollback and cleanup. [REPAIRS.md](REPAIRS.md) is the current repair record; [AUDIT.md](AUDIT.md) preserves the earlier audit as history rather than certifying the present deployment.
