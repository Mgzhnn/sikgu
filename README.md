# SIKGU 식구 — 혼자 넘기 어려운 최소 주문금액, 같이.

Group food-delivery ordering for the DGIST campus. SIKGU (식구, "family / people
you share meals with") lets students near Hyeonpung Technopolis pool their
delivery orders from **Baemin** and **Coupang Eats**, so nobody has to clear a
15,000–20,000원 minimum order alone or pay the full delivery fee for one meal.

![SIKGU — DGIST 공동주문](public/og.png)

## How it works

1. **Open a room** — pick one of 21 local restaurants, a campus pickup point
   (the E1 front gate, the E2–E6 lockers, the 201–204 pickup spot, or Bisl
   Village), a deadline (20 / 30 / 45 minutes, computed on the server), and a
   capacity (2–8 people).
2. **Gather food family** — others request to join; the host approves members
   and keeps the room's collected order total up to date until it clears the
   restaurant's minimum. Capacity is reserved atomically, so a room can never
   overfill. A member the host removed or rejected can ask again, but cannot
   re-enter through an invite link they already hold.
3. **Order together** — the host places one order through Baemin or Coupang
   Eats, shares the estimated arrival, and uploads a receipt photo for
   transparent cost-splitting. Members coordinate in a private room chat.

Membership perks (배민클럽 / 쿠팡와우) are surfaced so rooms hosted by members
show free delivery for everyone.

## Features

- Live feed of open rooms with filters (availability, deadline, pickup point)
  and a campus map view of where rooms are gathering
- Host-approved joins, invite links, member removal, and room deletion with
  full cleanup (members, chat, receipts)
- Private per-room chat with Korean IME-safe input handling
- Receipt uploads that are re-encoded client-side and sanitized server-side
  (PNG-only, metadata/EXIF stripped, CRC-checked, size- and pixel-bounded)
- Restaurant directory for the Hyeonpung/Technopolis area with per-app minimum
  order and delivery-fee comparison and Kakao Map links
- Privacy by default: display names are masked everywhere, emails are never
  serialized to other users, and member actions use opaque references

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | [vinext](https://github.com/cloudflare/vinext) (Next.js on Cloudflare Workers) + React 19 |
| Database | Cloudflare D1 (SQLite) via Drizzle ORM |
| File storage | Cloudflare R2 (receipt images) |
| Styling | Tailwind CSS 4 |
| Identity | Sign in with ChatGPT (platform-injected identity headers) |
| Tests | `node --test` — 85 tests covering rules, sanitization, migrations, and the real API run in-process against SQLite |

## Getting started

Requires Node.js ≥ 22.13.

```bash
npm ci
npm run dev        # local dev server with simulated D1/R2 bindings
npm test           # build + typecheck + full test suite
npm run lint       # ESLint
npm run db:generate  # regenerate Drizzle migrations after schema changes
```

`vite.config.ts` simulates the D1 and R2 bindings declared in
`.openai/hosting.json`, so local development needs no Cloudflare account.

## Project structure

```
app/
  page.tsx            # the whole client UI (feed, rooms, chat, directory)
  api/sikgu/route.ts  # the whole API (rooms, members, chat, receipts, health)
  chatgpt-auth.ts     # Sign in with ChatGPT identity header parsing
  name-mask.mjs       # display-name masking (shared client/server)
  receipt-image.mjs   # receipt image validation + sanitization
  sikgu-rules.mjs     # shared room rules (restaurants, pickups, limits, text)
build/                # Vite plugin that packages hosting metadata + migrations
db/                   # Drizzle schema + client
drizzle/              # SQL migrations (generated; never hand-edited)
worker/               # Cloudflare Worker entry
tests/                # node --test suites; tests/helpers/ runs the real API in-process
AUDIT.md              # audit findings, fixes, and verification record
RUNBOOK.md            # deploy, migrate, roll back, read logs, health check
```

## Security notes

Writes require a custom same-origin request header, mutations on a room are
fenced with single-use tokens (stale locks are recoverable), capacity,
approvals, and every per-user limit are enforced inside single atomic SQL
statements, request bodies are size-bounded before parsing, free text is
normalized (control and bidi characters removed), and API responses carry
privacy and browser security headers. `GET /api/sikgu?action=health` reports
liveness and database reachability without identity. Authentication relies on identity headers injected by the
hosting platform's proxy; the worker must not be reachable except through it.

## Deployment

The app is built for OpenAI workspace Sites hosting: `.openai/hosting.json`
declares the `DB` (D1) and `UPLOADS` (R2) bindings, and the platform owns the
`/signin-with-chatgpt`, `/signout-with-chatgpt`, and `/callback` routes along
with identity-header injection.
