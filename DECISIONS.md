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

## 19 Nov 2026 — Ship order by risk, billing last

Order: decisions → public posture → ledger durability → generic ledger and
onboarding → identity → waitlist → billing → hardening → operate.

The waitlist was originally next after Phase 1; Phase 2 moved ahead of it
because data durability is a prerequisite for inviting strangers.

Reason: charging money before data survives a second device would create
refunds and support load. Billing depends on identity and onboarding being
stable.

## 19 Nov 2026 — Turnstile is all-or-nothing

Both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` must be set, or neither. A
half-configured deployment fails closed. The widget lists only `bucksy.life`,
so previews fail the bot check even if the host allowlist changes by mistake.

Reason: the earlier check let requests through when only the secret was
missing while the UI still demanded a challenge.
