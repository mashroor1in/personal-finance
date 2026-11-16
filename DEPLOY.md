# Deployment

This project is a **Cloudflare Pages** project, not a standalone Worker.

| | |
|---|---|
| Project name | `personal-finance` |
| Production domain | `bucksy.life` |
| Back door | `personal-finance-8ch.pages.dev` (open; cannot be disabled) |
| Previous domain | `expenses.mashmind.in` (Access-gated, retirement pending) |
| Build output | repository root (no build step) |
| Backend | `functions/` = Pages Functions, auto-routed by path |
| Deploy trigger | push to `main` (Pages Git integration) |
| Preview deploys | every other branch, e.g. `security/session-and-sentinel` |

Both hostnames serve the **same deployment and the same D1/KV**, so there is no
data split. The only per-host difference is the session cookie: `pf_session` is
set without a `Domain=` attribute, so it is host-only and a sign-in at one
hostname does not carry to the other.

### URLs lose `.html`

Pages redirects `*.html` to the extensionless path with a **308**:
`/app.html` → `/app`, `/index.html` → `/`. Anything that matches on a path —
Access policies above all — has to be written against what the browser actually
requests: `/app*`, never `/app.html`.

Do **not** add a `wrangler.toml` with `main = ...` and do **not** run
`wrangler deploy` against this repository. That creates a separate Worker which
serves none of the static files. Bindings live in the Pages dashboard.

## Private mode: Cloudflare Access

Team domain: `uncle-mash.cloudflareaccess.com`. An Access application answers
unauthenticated requests with a `302` to the SSO page before Pages ever runs.

### Where the gate goes

The brand site should stay shareable, so scope Access to the planner rather than
the whole hostname. A self-hosted application on `bucksy.life` with these paths:

| Path | Why |
|---|---|
| `/app*` | The planner. Covers `/app` and anything under it. |
| `/api/*` | The data and auth endpoints behind it. |

Leave `/`, `/assets/*` and `/brand/*` outside the policy. That keeps link
unfurls working — a `302` in front of `og-1200x630.png` makes every social card
blank.

If you would rather protect the landing page too, use a single `bucksy.life/*`
application. Be aware it costs you previews and makes the brand site unshareable.

### Status as of 2026-11-17

`bucksy.life` is live but **has no Access application yet**. Verified:

```text
https://bucksy.life/                     200
https://bucksy.life/app                  200  (no SSO prompt)
https://bucksy.life/api/auth/status      200
https://bucksy.life/assets/og-1200x630.png  200
```

The app's own username/password + Turnstile still guards the data, but the
sign-in screen is public and `POST /api/auth/login` with `mode: register` will
create an account for anyone who sends it — registration is not closed once a
user exists. Add the access application above to restore the old posture.

### Three consequences worth knowing before you debug something

| Effect | Detail |
|---|---|
| `/api/auth/status` returns `302` | Not broken. The Access policy answers first. |
| Uptime monitors need a way in | Use an Access **service token**, or point the monitor at the `pages.dev` hostname instead. |
| `personal-finance-8ch.pages.dev` is open | Access apps can only target hostnames in a zone you control, and `pages.dev` is Cloudflare's. Treat that hostname as the unprotected back door. |

If sign-in through the custom domain ever starts failing while the site itself
loads, check the Access policy before the app: Dashboard → **Zero Trust** →
**Access** → **Applications**.

## Retiring `expenses.mashmind.in`

The old hostname is still served and still Access-gated. Remove it **after**
`bucksy.life` has been verified end to end, never before — the reverse order
leaves a window with no working address.

1. Sign in on `bucksy.life` once and confirm the month data is there. The
   host-only session cookie means the old sign-in does not carry over, so this
   is a real test, not a formality.
2. `personal-finance` → **Custom domains** → `expenses.mashmind.in` → Remove.
   This drops its certificate and DNS record. D1, KV and the account are
   untouched.
3. **Zero Trust** → **Access** → **Applications** → delete the
   `expenses.mashmind.in` app. Leaving it is harmless but will mislead you later.
4. **Turnstile** → widget → **Hostnames** → remove `expenses.mashmind.in`.
5. Optional: keep an `expenses.mashmind.in` DNS record behind a **Redirect
   Rule → 301 → `https://bucksy.life`** (preserve path), so old bookmarks land
   on the gated planner instead of a dead host.
6. Sweep for references: the uptime monitor in `OPERATIONS.md` §4, browser
   bookmarks, and anything in `RUNBOOK.md` still naming the old host.

## Going public

Only relevant if you decide the planner should stop being private.

1. **Decide about `pages.dev`.** It cannot be disabled on Pages, and Access
   cannot target it. What limits it is Turnstile with hostname management on and
   `pages.dev` unlisted — then sign-in and registration fail the bot check there.
2. **Remove or bypass the Access application** on `bucksy.life`: Zero Trust →
   Access → Applications → the app → delete it, or add a `Bypass` policy for
   `Everyone` if you want to re-enable it later in one click.
3. **Check the public surface:**
   ```powershell
   curl.exe -s -o NUL -w "%{http_code}\n" https://bucksy.life/api/auth/status
   curl.exe -s -o NUL -w "%{http_code}\n" https://bucksy.life/app
   ```
   Both must be `200`. A `302` means an Access policy is still in front.
4. **Turnstile hostnames.** Dashboard → Turnstile → your widget → **Hostnames**.
   `bucksy.life` must be listed, and `personal-finance-8ch.pages.dev` must
   **not** be, otherwise the back door accepts sign-ups.
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
