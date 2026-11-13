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

## Private mode: Cloudflare Access

`expenses.mashmind.in` is currently protected by a Zero Trust **Access**
application (team domain `uncle-mash.cloudflareaccess.com`). Anything without an
Access session gets a `302` to the SSO page before the request reaches Pages.

Three consequences worth knowing before you debug something:

| Effect | Detail |
|---|---|
| `/api/auth/status` returns `302` | Not broken. The Access policy answers first. |
| Uptime monitors need a way in | Use an Access **service token**, or point the monitor at the `pages.dev` hostname instead. |
| `personal-finance-8ch.pages.dev` is open | Access apps can only target hostnames in a zone you control, and `pages.dev` is Cloudflare's. Treat that hostname as the unprotected back door while private. |

If sign-in through the custom domain ever starts failing while the site itself
loads, check the Access policy before the app: Dashboard → **Zero Trust** →
**Access** → **Applications**.

## Going public

Do these in order. They take about ten minutes and prevent a half-open launch.

1. **Decide about `pages.dev`.** It becomes irrelevant once Access is removed
   from the custom domain, but until then it is the way around the gate.
2. **Remove or bypass the Access application** for `expenses.mashmind.in`:
   Zero Trust → Access → Applications → the app → delete it, or add a `Bypass`
   policy for `Everyone` if you want to re-enable it later in one click.
3. **Check the public surface:**
   ```powershell
   curl.exe -s -o NUL -w "%{http_code}\n" https://expenses.mashmind.in/api/auth/status
   curl.exe -s -o NUL -w "%{http_code}\n" https://expenses.mashmind.in/app
   ```
   Both must be `200`. A `302` means an Access policy is still in front.
4. **Turnstile hostnames.** Dashboard → Turnstile → your widget → **Hostnames**.
   `expenses.mashmind.in` must be listed, and `personal-finance-8ch.pages.dev`
   must **not** be, otherwise the back door accepts sign-ups.
5. **Start the uptime monitor** described in `OPERATIONS.md` §4, now that
   `/api/auth/status` really answers `200`.
6. **Create your own recovery codes** if you have not already: menu →
   **Recovery codes**. Accounts made before migration 0003 have none.
7. **Tail the first real sign-up** so you see a `200` on `/api/auth/login`, not
   just a page load.


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
| `DB` | D1 database | users, months, auth_throttle, recovery_codes, deleted_months |
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
wrangler d1 execute personal-expenses-db --file migrations/0003_recovery_codes.sql --remote
wrangler d1 execute personal-expenses-db --file migrations/0004_deleted_months.sql --remote
```

Both are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`),
so re-running them is safe.

> `0003_recovery_codes.sql` must be applied before pushing the recovery-code
> feature. Registration degrades gracefully without it (the account is created,
> just without codes), but recovery itself cannot work until the table exists.
>
> > `0004_deleted_months.sql` enables the 30-day retention window for deleted
> > accounts. Apply it before pushing the retention feature. If not applied,
> > deletion falls back to immediate erasure but still completes.

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
node --test tests/recovery.test.mjs
node --test tests/deletion.test.mjs
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

- Forgot password: the user redeems one of their 10 one-time recovery codes on
  the sign-in screen (`Use a recovery code`). No operator needed. If those are
  also lost, an operator resets the row with `scripts/reset-password.mjs`, or the
  account is deleted and re-registered.
- Recovery codes are shown once, at signup, and stored only as salted hashes.
  They can be replaced from the account menu (`Recovery codes`), which requires
  the current password.
- Account deletion archives the user's `months` to `deleted_months` for 30 days
  before permanent deletion. Recovery codes are removed immediately.
- Back up with `wrangler d1 export personal-expenses-db --remote --output backup.sql`.

## See also

- `RUNBOOK.md` — the "it broke" page: logs, password reset, restore.
- `OPERATIONS.md` — watching live logs, reading errors, setting up alerts.
- `SECURITY.md` — what is hardened and what remains.
