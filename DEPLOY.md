# Deployment

This project is a **Cloudflare Pages** project, not a standalone Worker.

| | |
|---|---|
| Project name | `personal-finance` |
| Production domains | `expenses.mashmind.in`, `personal-finance-8ch.pages.dev` |
| Build output | repository root (no build step) |
| Backend | `functions/` = Pages Functions, auto-routed by path |
| Deploy trigger | push to `main` (Pages Git integration) |
| Preview deploys | every other branch, e.g. `security/session-and-sentinel` |

Do **not** add a `wrangler.toml` with `main = ...` and do **not** run
`wrangler deploy` against this repository. That creates a separate Worker which
serves none of the static files. Bindings live in the Pages dashboard.

## How routing works

There is no entry point file. Pages maps files under `functions/` to URLs:

| File | Route |
|---|---|
| `functions/api/auth/login.js` | `POST /api/auth/login` |
| `functions/api/auth/logout.js` | `POST /api/auth/logout` |
| `functions/api/auth/me.js` | `GET /api/auth/me` |
| `functions/api/auth/status.js` | `GET /api/auth/status` |
| `functions/api/data/index.js` | `/api/data` |
| `functions/api/data/month/[month].js` | `/api/data/month/:month` |

Adding a `functions/index.js` would claim `/` and shadow `index.html`. Don't.

## Bindings (configured in the Pages dashboard)

| Binding | Kind | Purpose |
|---|---|---|
| `DB` | D1 database | users, months, auth_throttle |
| `SESSIONS` | KV namespace | `sess:<token>` session records |
| `TURNSTILE_SITE_KEY` | variable | client widget key |
| `TURNSTILE_SECRET` | secret | server-side verification |

Turnstile is all-or-nothing: set both or neither. With only one set, every
login and registration is refused (fail closed) and `/api/auth/status` reports
`turnstileMisconfigured: true`.

## Deploying a change

```powershell
git add -A
git commit -m "..."
git push origin main
```

Pages rebuilds automatically; watch the deployment at
Dashboard → Workers & Pages → `personal-finance` → Deployments.

## Applying a migration

Migrations are not run by Pages. Apply them by hand, before the code that needs
them goes live:

```powershell
wrangler d1 execute personal-expenses-db --file migrations/0002_auth_throttle.sql --remote
```

Database id: `f99159c3-82a7-405c-bf9e-6e65b5662be5`.

> **PowerShell warning:** `$` starts a variable. Never put a password hash inline
> in `--command "..."` — `pbkdf2-sha256$210000$...$...` gets silently mangled.
> Write the statement to a `.sql` file and pass `--file`.

## Reading runtime logs

The deployed code is the source of truth for errors. Tail the live deployment:

```powershell
# Grab the current production deployment id, then tail that one.
wrangler pages deployment list --project-name personal-finance
wrangler pages deployment tail <deployment-id> --project-name personal-finance --format json
```

Then reproduce the failing action in the browser and read the `exceptions`
array. Two details that cost real time when missed:

- `--environment production` alone does not work in non-interactive shells; pass
  the deployment id explicitly.
- a tail is bound to the deployment that was live when it started. Push a fix,
  and you need a new tail on the new deployment id.

## Local checks before pushing

```powershell
node --test tests/auth-session.test.mjs
node --test tests/data-sanitize.test.mjs
node --test tests/persistence.test.js
node --test tests/totals.test.js
node --test tests/overlays.test.js
```

`node --test tests/` does not work; pass the files.

## Password verifiers

New accounts store `pbkdf2-sha256$<iterations>$<salt>$<key>`. Old accounts store
a bare SHA-256 hex digest and are transparently upgraded on the next successful
login. `PASSWORD_ITERATIONS` (default 100000, the Cloudflare ceiling) is read per
request, so it can be lowered without a data migration. Values above 100000 are
clamped: WebCrypto throws `NotSupportedError` past that point, which would turn
every login into a 500.

## Recovery

- Forgot password: there is no reset flow. An operator must reset the row with a
  known verifier, or delete and re-register the account.
- Account deletion removes that user's `months` rows permanently.
- Back up with `wrangler d1 export personal-expenses-db > backup.sql`.

## See also

- `OPERATIONS.md` — watching live logs, reading errors, setting up alerts.
- `SECURITY.md` — what is hardened and what remains.
