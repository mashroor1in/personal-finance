# Tasks

Last updated: 22 Nov 2026

## Done

- [x] Phase 0 — product and platform decisions (see `DECISIONS.md`).
- [x] Phase 1 — honest public posture: host allowlist middleware, `_routes.json`,
  branded 404, copy and docs aligned, 17 middleware tests.
- [x] Phase 2 — ledger durability: `months.version`, `user_settings`, versioned
  month and settings writes, 409 conflict handling, migration `0005` applied.
  Deployed in `ec0d8f1`, `5a29994`, `45264e9`.
- [x] Account deletion removes `user_settings` as well as account and ledger
  rows (`45264e9`).
- [x] Unauthenticated production checks after Phase 2: `/app` returns 200 with
  `Cache-Control: no-cache` and the new build, `/api/settings` and
  `/api/data/month/:month` return 401, the production alias returns 404, and
  unknown paths return 404.
- [x] Project continuity docs added: `AGENTS.md`, `PROJECT_CONTEXT.md`,
  `TASKS.md`, `DECISIONS.md` (`d3b659a`).
- [x] Fixed onboarding items not appearing in ledger (issue with `ensureLedgerShape()` overwriting items)
- [x] Created early access landing page at `/early-access` with premium fintech aesthetic
- [x] Implemented complete Early Access waitlist system with backend API, security, and analytics (56cf91b)

## Pending

- [ ] **Manual two-device check** (blocked on a human, not code):
  1. Change a category budget on device A; reload device B and confirm it
     appears.
  2. Open two tabs, edit and save the same month in both; the stale tab must
     show "Changed elsewhere" and the saved copy, not overwrite it.
  3. Delete a throwaway account, re-register the same username; planner and
     settings must both start empty.
- [x] Phase 3 — generic ledger and onboarding.
  - [x] All development complete; deployed in `63fd1bd`
  - [x] Fixed onboarding items persistence issue (77c7274)
  - [ ] Manual two-device check (documented above)
- [x] **Early Access System** — complete waitlist platform (21 Nov 2026):
  - [x] Premium landing page with Turnstile integration
  - [x] Complete backend API with registration, verification, referral, analytics
  - [x] D1 database schema with comprehensive tables and indexes
  - [x] Migration `0006_waitlist.sql` **applied to production** (2 tables,
        3 views, 10 indexes; existing tables untouched)
  - [x] Schema covered by `tests/waitlist-schema.test.js` (13 tests, in-memory
        SQLite)
  - [x] Enterprise-grade security measures and rate limiting
  - [x] Comprehensive test suite and documentation
  - [x] Deployment guide and operational procedures
- [ ] Phase 4 — identity.
- [x] Phase 5 — waitlist and launch (Early Access system complete).
- [ ] Phase 6 — billing (last, by design).
- [ ] Phase 7 — hardening.
- [ ] Phase 8 — operate and comply.

## Known issues / notes

- Turnstile is enabled and its widget lists only `bucksy.life`. A scripted
  authenticated live test is not possible without a token; use the browser.
- Pages keeps no runtime logs. Use
  `wrangler pages deployment tail --project-name personal-finance`, which only
  sees `/api/*` and `/app`.
- `node --test tests/` does not work. Pass the file list from `README.md`.
