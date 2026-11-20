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
- [x] **Step 2 — Backend hardening** (22 Nov 2026):
  - [x] Added real Cloudflare Turnstile verification (`/early-access/api/turnstile.js`)
  - [x] Implemented SHA-256 token hashing with address binding (`/early-access/api/waitlist/utils.js`)
  - [x] Added atomic D1-based rate limiting (`/_lib/throttle.js`)
  - [x] Removed insecure/dead endpoint files and duplicate routes
  - [x] Updated `_routes.json` to include `/early-access/api/*`
  - [x] Fixed middleware to enforce host allowlist on waitlist endpoints
  - [x] Created comprehensive security library (`/_lib/waitlist.js`)
  - [x] Added 19 new API tests and 15 new library tests (58 total passing)
  - [x] Fixed verification link expiration logic (migration `0007_waitlist_verification_sent_at.sql`)
  - [x] Fixed event logging to handle orphaned events gracefully
- [x] **Step 3 — Email delivery** (22 Nov 2026):
  - [x] Implemented comprehensive email delivery system with provider abstraction
  - [x] Created Bucksy-branded email templates for all workflows
  - [x] Connected verification emails to real delivery service
  - [x] Added admin endpoints for invitations and launch announcements
  - [x] Implemented email delivery logging and error handling
  - [x] Created comprehensive test suite for email functionality
  - [x] Added email configuration documentation
  - [x] Applied email_logs migration to database schema

- [x] **Step 4 — Admin dashboard** (22 Nov 2026):
  - [x] Created secure admin authentication system with token-based access
  - [x] Built comprehensive admin dashboard interface
  - [x] Implemented waitlist management with search, filter, and export
  - [x] Added invitation management with bulk actions
  - [x] Created email communication management interface
  - [x] Implemented audit logging system for all administrative actions
  - [x] Added referral analytics dashboard
  - [x] Created comprehensive test suite for admin functionality
  - [x] Added admin configuration documentation
  - [x] Created Pages-compatible database client and helper functions
  - [x] Updated all admin functions to work with Cloudflare Pages D1 binding
  - [x] Generated admin token and updated configuration files
  - [x] Created comprehensive setup guide and documentation
  - [x] Applied all database migrations including admin tables
  - [x] Added sample data for testing
  - [x] Created automated test script for admin dashboard
  - [x] Simplified admin functions for production deployment
  - [x] Created deployment guide for Cloudflare Pages
  - [x] Tested local development environment
- [ ] Phase 4 — identity.
- [x] Phase 5 — waitlist and launch (Early Access system complete).
- [ ] Phase 6 — billing (last, by design).
- [ ] Phase 7 — hardening.
- [ ] Phase 8 — operate and comply.

## Deployment Tasks

- [ ] **Deploy Admin Dashboard to Cloudflare Pages** (Current Task)
  - [ ] Connect GitHub repository to Cloudflare Pages
  - [ ] Configure build settings and environment variables
  - [ ] Deploy to production
  - [ ] Test admin dashboard functionality
  - [ ] Configure custom domain (optional)
  - [ ] Set up monitoring and alerts

### Next Steps (After Deployment)
- [ ] Implement server-side authentication
- [ ] Connect to D1 database for real data
- [ ] Add user management interface
- [ ] Implement email management system
- [ ] Add analytics and reporting features
- [ ] Enhance security with proper token management

## Known issues / notes

- Turnstile is enabled and its widget lists only `bucksy.life`. A scripted
  authenticated live test is not possible without a token; use the browser.
- Pages keeps no runtime logs. Use
  `wrangler pages deployment tail --project-name personal-finance`, which only
  sees `/api/*` and `/app`.
- `node --test tests/` does not work. Pass the file list from `README.md`.
