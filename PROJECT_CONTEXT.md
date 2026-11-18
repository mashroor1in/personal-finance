# Project Context

Last updated: 19 Nov 2026

## What it is

Bucksy (`https://bucksy.life`) is a monthly expense planner. Salary in,
itemised expenses out, totals and remaining balance computed live.

## Stack

| Layer | Choice |
|---|---|
| Hosting | Cloudflare Pages, no build step |
| Frontend | `index.html`, `app.html` (inline CSS + JS), three plain JS modules |
| Backend | Pages Functions, file-routed under `functions/` |
| Database | Cloudflare D1 (`personal-expenses-db`) |
| Sessions | Cloudflare KV (`SESSIONS`) |
| Auth | Username + password (PBKDF2), optional Turnstile, D1 throttling |
| Recovery | 10 one-time codes per account, no email |

There is no framework, bundler, or `package.json`.

## Routes

| Path | Handler |
|---|---|
| `/api/auth/*` | login, logout, me, status, recovery-codes |
| `/api/data` | bulk ledger read; unconditional import write |
| `/api/data/month/:month` | one month, versioned GET/PUT |
| `/api/settings` | account `__meta`, versioned GET/PUT |
| `/app`, `/api/*` | wrapped by `functions/_middleware.js` |

Migrations `0001`–`0005` are applied to production. `0005` adds
`months.version` and `user_settings`. See `DEPLOY.md`.

## Data model

- `months`: one JSON record per account per `YYYY-MM`, plus `version`.
- `user_settings`: `__meta` (custom items, name overrides, hidden items,
  category budgets), plus `version`.
- `deleted_months`: 30-day archive of a deleted account's months.
- `users`, `recovery_codes`, `auth_throttle`: auth state.

## Current state

- Phase 2 (ledger durability) is deployed: `ec0d8f1`, `5a29994`, `45264e9`.
- 202 tests pass (`README.md` has the exact command).
- Manual two-device verification is **pending**. Turnstile was left enabled,
  so a scripted authenticated live test was not run.
- Roadmap phases 3–8 are not started: generic ledger/onboarding, identity,
  waitlist, billing, hardening, operate/comply.

## Invariants

- There is no Cloudflare Access gate. The app is public by design; its own
  sign-in is the data boundary.
- `_middleware.js` allows only `bucksy.life`, `www.bucksy.life`, local
  development, and `*.personal-finance.pages.dev` previews. The production
  alias `personal-finance-8ch.pages.dev` is denied.
- Copy must describe only implemented features and controls. No invented
  capabilities or certifications.
- `__meta` is account state, not local-only.
- Deleting an account archives months for 30 days and erases `user_settings`
  immediately, so a re-registered username inherits nothing.

## Where to look

| File | Purpose |
|---|---|
| `README.md` | layout, tests, public posture |
| `DEPLOY.md` | routing, bindings, migrations, deploy |
| `SECURITY.md` | controls, test coverage, retention |
| `RUNBOOK.md` | operator procedures |
| `TASKS.md` | current work and pending items |
| `DECISIONS.md` | architecture and product decisions |
