# Project Context

Last updated: 21 Nov 2026

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
| `/` | landing page |
| `/early-access` | early access landing page |
| `/early-access/api/waitlist` | waitlist registration with validation and security |
| `/early-access/api/verify` | email verification with token validation |
| `/early-access/api/referral` | referral tracking and information |
| `/early-access/api/analytics` | waitlist analytics and statistics |
| `/early-access/api/rate-limit` | rate limit status monitoring |
| `/early-access/api/monitoring` | system health and security monitoring |
| `/early-access/api/security-log` | security event logging |
| `/app` | main application |
| `/api/auth/*` | login, logout, me, status, recovery-codes |
| `/api/data` | bulk ledger read; unconditional import write |
| `/api/data/month/:month` | one month, versioned GET/PUT |
| `/api/settings` | account `__meta`, versioned GET/PUT |
| `/app`, `/api/*` | wrapped by `functions/_middleware.js` |

Migrations `0001`–`0006` are applied to production. `0005` adds
`months.version` and `user_settings`; `0006` adds `waitlist` and
`waitlist_events`. See `DEPLOY.md`.

## Data model

- `months`: one JSON record per account per `YYYY-MM`, plus `version`.
- `user_settings`: `__meta` (currency, categories, items, budgets, onboarded),
  plus `version`.
- `deleted_months`: 30-day archive of a deleted account's months.
- `users`, `recovery_codes`, `auth_throttle`: auth state.
- `waitlist`, `waitlist_events`: early-access signups and their audit log
  (migration `0006`). `email` is lower-case and unique; only a token *hash* is
  stored; `referral_code` is unique.

## Current state

- Phase 3 (generic ledger/onboarding) is deployed (`63fd1bd`):
  - `ledger.js` holds the ledger definitions and formatting rules
  - Every account owns its category list and line items (not hardcoded)
  - New accounts get a guided setup: currency, income, optional starter items
  - Category management UI is available from the budget modal
  - Removed bank/allocation section and rupee-specific formatting
- 219 tests pass (including 11 for `ledger.js`)
- Manual two-device verification is **pending**. Turnstile was left enabled,
  so a scripted authenticated live test was not run.

## Early Access System (NEW - 21 Nov 2026)

Complete waitlist system with comprehensive security and analytics:
- **Frontend**: Premium landing page at `/early-access` with Turnstile integration
- **Backend**: Full API suite with registration, verification, referral, and analytics endpoints
- **Database**: D1 schema with waitlist and events tables (`migrations/0006_waitlist.sql`)
- **Security**: Enterprise-grade protection with rate limiting, email validation, and bot detection
- **Analytics**: Real-time statistics and monitoring capabilities
- **Testing**: Comprehensive test suite covering all functionality
- **Documentation**: Complete deployment and operational guides

## Infrastructure

- **Hosting**: Cloudflare Pages, no build step
- **Frontend**: `early-access.html` (inline CSS + JS), standalone landing page
- **Backend**: Pages Functions, file-routed under `functions/early-access/`
- **Database**: Cloudflare D1 (`personal-expenses-db`) with waitlist tables
- **Sessions**: Cloudflare KV (`SESSIONS`) for rate limiting
- **Security**: Cloudflare Turnstile, rate limiting, input validation
- **Analytics**: Custom analytics endpoint with comprehensive metrics

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
| `PROJECT_CONTEXT.md` | stack, routes, data model, invariants |
| `TASKS.md` | phase checklist, current status, next steps |
| `DECISIONS.md` | architecture and product decisions |
| `SECURITY.md` | controls, test coverage, retention |
| `RUNBOOK.md` | operator procedures |
