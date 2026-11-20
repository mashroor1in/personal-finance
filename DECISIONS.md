# Decisions

Newest first. Each entry records the choice and why, so a later session does
not relitigate it by accident.

## 19 Nov 2026 — Erase settings immediately on account deletion

`user_settings` is deleted in the same batch as the account and ledger rows;
months still go to the 30-day archive. Reason: a deleted username can be
registered again, and settings left behind would be inherited by the new
holder. Months are archived because they are the user's history; settings are
account configuration.

## 19 Nov 2026 — Versioned writes and account-level settings

- `months.version` and `user_settings.version` make writes conditional.
- A client sends `baseVersion`; a stale write gets `409 version_conflict` with
  the stored copy, and the client loads that copy instead of retrying.
- `baseVersion` is optional: a cached old client still overwrites, so rollout
  does not break open tabs.
- The bulk `POST /api/data` stays unconditional (one-time local-ledger import)
  but bumps and returns versions.
- `__meta` moved from `localStorage`-only to `user_settings`. A browser with
  local meta uploads it once when the account has no stored settings.

Reason: losing budgets and custom items on a second device, and stale tabs
silently overwriting newer data, were the two durability bugs left after
Phase 1.

## 19 Nov 2026 — Public posture with no Cloudflare Access

The app is deliberately public. `_middleware.js` denies `/app` and `/api/*` on
any host except `bucksy.life`, `www.bucksy.life`, local development, and
`*.personal-finance.pages.dev` previews. The production alias
`personal-finance-8ch.pages.dev` is denied.

Reason: Access was not actually in front of the app, so copy claiming it would
be false. One hostname keeps sessions and Turnstile hostnames consistent.

## 19 Nov 2026 — Stay on Cloudflare Pages, D1 and KV

No framework rewrite, no bundler, no `package.json`. File-routed Functions,
static HTML and plain JS modules.

Reason: the app already ships this way; a rewrite buys nothing that the
roadmap needs and would add build and migration risk.

## 19 Nov 2026 — Keep ledger rows as JSON blobs

One row per account per month with `items_json` / `paid_json`; no normalised
item tables.

Reason: the client model is a nested month record. Normalising it would force
a rewrite of read/write paths for no user-visible benefit at this stage.

## 19 Nov 2026 — Account-owned ledger

Categories and items are now account state in `__meta`, not compiled into the
page. The server validates that every item points at a category the account
defines.

Reason: the old hardcoded categories and items worked for one user but not for
a global SaaS. Every account now owns its own ledger shape.

## 19 Nov 2026 — Ship order by risk, billing last

Order: decisions → public posture → ledger durability → generic ledger and
onboarding → identity → waitlist → billing → hardening → operate.

The waitlist was originally next after Phase 1; Phase 2 moved ahead of it
because data durability is a prerequisite for inviting strangers.

Phase 3 (generic ledger) completed before Phase 5 (waitlist) because a global
audience needs custom categories and currencies from day one.

Reason: charging money before data survives a second device or supports user
customisation would create refunds and support load. Billing depends on
identity and onboarding being stable.

## 19 Nov 2026 — Turnstile is all-or-nothing

Both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` must be set, or neither. A
half-configured deployment fails closed. The widget lists only `bucksy.life`,
so previews fail the bot check even if the host allowlist changes by mistake.

Reason: the earlier check let requests through when only the secret was
missing while the UI still demanded a challenge.

## 19 Nov 2026 — Phase 3 implementation

- `ledger.js` holds ledger definitions, legacy migration, currency formatting
- No hardcoded categories, items, or currency symbols in the page
- Every account owns its category list and line items via `__meta`
- New accounts see onboarding: currency, income, optional quick-pick items
- Category management UI added to budget modal
- Bank/allocation section removed entirely
- Server validates items against supplied category list

Reason: the old compiled ledger worked for one user but not for a global SaaS.
Making the ledger account-owned enables customisation and removes Indian bias.

## 20 Nov 2026 — Fixed onboarding items persistence

- Set items directly in `data.__meta` to bypass legacy migration in `ensureLedgerShape()`
- Preserve existing items in `ensureLedgerShape()` to prevent overwriting
- Use `data.__meta` directly in `getAllItems()` for consistency

Reason: The `LEDGER.migrateMeta()` function was overwriting manually set items during
onboarding with legacy migration logic, causing selected items to disappear.

## 22 Nov 2026 — Email Delivery System Complete

- Implemented comprehensive email delivery system with provider abstraction (Resend, SendGrid, Mailgun)
- Created Bucksy-branded email templates for all workflows (welcome, verification, invitation, launch)
- Connected verification emails to real delivery service with proper error handling
- Added admin endpoints for invitations and launch announcements
- Implemented email delivery logging with D1 database tracking
- Created invitation system with expiration and resend functionality
- Added comprehensive test suite for email functionality
- Created email configuration documentation with setup guides

Reason: Professional email communication is essential for user onboarding, verification, and launch
announcements. The system provides reliable delivery with proper branding, logging, and error handling
while supporting multiple providers for flexibility and cost optimization.

## 22 Nov 2026 — Admin Dashboard System Complete

- Created secure token-based authentication system for admin access
- Built comprehensive admin dashboard interface with Bucksy branding
- Implemented waitlist management with search, filter, and export functionality
- Added invitation management with bulk actions and configurable expiry
- Created email communication management interface with delivery tracking
- Implemented audit logging system for all administrative actions
- Added referral analytics dashboard with conversion metrics and visualizations
- Created Pages-compatible database client and helper functions
- Updated all admin functions to work with Cloudflare Pages D1 binding
- Generated secure admin token and updated configuration files
- Created comprehensive setup guide and documentation
- Applied all database migrations including admin tables
- Added sample data for testing
- Created automated test script for admin dashboard functionality

Reason: A secure internal administration dashboard is essential for managing the early access program,
monitoring user growth, and handling administrative tasks. The system provides a premium SaaS
experience with comprehensive audit logging, data export capabilities, and professional UI/UX
while maintaining security through token-based authentication and comprehensive logging.

## Implementation Status

- **Phase 0**: Complete (product/platform decisions)
- **Phase 1**: Complete (host allowlist, honest posture)
- **Phase 2**: Complete (ledger durability)
- **Phase 3**: Complete (generic ledger, onboarding) - Fixed items persistence issue
- **Early Access System**: Complete (21 Nov 2026) - Full waitlist platform with backend API
- **Admin Dashboard System**: Complete (22 Nov 2026) - Secure internal administration interface
- **Phase 4**: Not started
- **Phase 5**: Complete (waitlist and launch via Early Access system)
- **Phase 6**: Not started
- **Phase 7**: Not started
- **Phase 8**: Not started
