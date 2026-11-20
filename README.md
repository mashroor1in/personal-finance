# Bucksy — personal finance planner

A monthly expense planner: salary in, itemised expenses out, totals and
remaining balance computed live, with a monthly trend view. The ledger itself
belongs to the account — categories and line items are defined by the user, and
amounts are shown in one of twelve currencies.

Live at **https://bucksy.life**. It is the only entry point; the previous
`expenses.mashmind.in` address has been removed.

## Stack

| | |
|---|---|
| Hosting | Cloudflare **Pages** (no build step) |
| Frontend | `index.html` (landing), `app.html` (planner), three plain JS modules |
| Backend | `functions/` — Pages Functions, file-routed |
| Database | Cloudflare **D1** (`personal-expenses-db`) |
| Sessions | Cloudflare **KV** (`SESSIONS`) |
| Auth | Username + password (PBKDF2), Turnstile, D1-backed throttling |
| Recovery | 10 one-time recovery codes per account, no email service |

There is no bundler, no framework, and no `package.json`. Edit a file, push, and
Pages redeploys.

## Layout

```
index.html            landing page
app.html              the planner (single page, inline styles + script)
404.html              branded not-found page
persistence.js        local storage, cloud sync, backup/restore
totals.js             calculation layer
overlays.js           one open/close lifecycle for modals and popovers
_routes.json          which paths invoke Pages Functions
functions/_middleware.js  host allowlist for /app and /api/*
functions/api/auth/   login, logout, me, status, recovery-codes
functions/api/data/   ledger read/write
functions/api/settings/  account ledger: currency, categories, items, budgets
functions/_lib/       shared auth, crypto, throttling, recovery, retention
migrations/           D1 schema, applied by hand (0001–0005)
tests/                node:test suites
```

## The ledger

`ledger.js` holds the ledger definitions and the formatting rules; the page
only renders what it returns.

The first seven categories are defaults, not constants. An account owns its
category list and its line items, and both travel in `__meta` over
`/api/settings`:

- A new account starts empty and is walked through a short setup: pick a
  currency, optionally enter income, and tick any starter lines.
- An account created before this change keeps every row: on first load the old
  compiled list is converted once, with item keys preserved so stored amounts
  still point at the same line.
- Category names are user text. They are escaped wherever the page renders
  them, and the server trims and caps them like any other label.

Formatting is locale-aware per currency (`Intl.NumberFormat`), so `₹12,34,567`
and `$1,234,567` both come from the same code path.

## Tests

```powershell
node --test tests/auth-session.test.mjs tests/data-sanitize.test.mjs tests/middleware.test.mjs tests/overlays.test.js tests/persistence.test.js tests/recovery.test.mjs tests/totals.test.js tests/deletion.test.mjs tests/ledger.test.js tests/waitlist-schema.test.js
```

`node --test tests/` does not work — pass the files explicitly. CI runs the same
command on every push and pull request.

## Deploy

Push to `main`. That is the whole process:

```powershell
git add -A
git commit -m "..."
git push origin main
```

Migrations are **not** applied by Pages. See `DEPLOY.md` for the schema steps,
and run them before pushing code that needs them.

## Data durability

Months and account settings both live in D1 per account. Every write carries
the version the tab last saw:

- `PUT /api/data/month/:month` updates one month. If another device wrote
  first, the server returns `409 version_conflict` with the stored copy, and
  the client loads that copy instead of overwriting it.
- `PUT /api/settings` stores `__meta` — currency, categories, line items, budgets
  and onboarding state — under the same conditional-version rule. A browser
  that only ever used `localStorage` uploads its copy on its next sign-in.
- `POST /api/data` stays an unconditional bulk write for the one-time local
  ledger import. It bumps versions and returns them, so the client switches to
  conditional writes afterwards.

The ledger is no longer compiled into the page — every account owns its own
category list and line items.

`__meta` used to be local-only. It is now account state, so categories, items,
budgets and currency survive on a second device. The ledger is no longer compiled
into the page — every account owns its own category list and line items.

## Public posture

There is **no Cloudflare Access gate** in front of this project. `bucksy.life`
and its API are publicly reachable. The app's own sign-in protects the ledger,
not the door, so the public surface is deliberate:

- **Registration is open.** `POST /api/auth/login` with `mode: register` creates
  an account regardless of how many already exist. `hasUsers` only chooses the
  default tab in the UI.
- **One hostname serves the app.** `functions/_middleware.js` returns `404` for
  `/app` and `/api/*` on any host that is not `bucksy.life`, `www.bucksy.life`,
  local development (`localhost`, `127.0.0.1`, `[::1]`) or a preview deployment
  (`*.<project>.pages.dev`). The production alias
  `personal-finance-8ch.pages.dev` is explicitly denied.
- **Functions run only where they are needed.** `_routes.json` limits the
  runtime to `/api/*` and `/app`; every other path is served as a static asset.
- **Uptime monitors see `200`.** `/api/auth/status` is public JSON with no gate
  in front of it.
- **Unknown paths return a real `404`.** `404.html` is served with status `404`
  instead of the old soft-404 landing page.

If a gate is ever added, change it here and in `DEPLOY.md` in the same commit —
the copy on the landing page must match what the edge actually does.

## Docs

| File | What it answers |
|---|---|
| `DEPLOY.md` | How a deploy ships, bindings, migrations, public posture |
| `PROJECT_CONTEXT.md` | Stack, routes, data model, invariant rules |
| `TASKS.md` | Phase checklist, current status, next steps |
| `DECISIONS.md` | Architecture and product decisions |
| `OPERATIONS.md` | Watching live logs, reading errors, alerting |
| `RUNBOOK.md` | "It broke" — logs, password reset, restore, rollback |
| `SECURITY.md` | What is hardened, what remains |
