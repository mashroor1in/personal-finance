# Personal Finance Planner

A monthly expense planner: salary in, itemised expenses out, totals and
remaining balance computed live, with a bank-allocation section and a monthly
trend view.

Live at **https://expenses.mashmind.in** (currently behind Cloudflare Access —
see [Private mode](#private-mode)).

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
persistence.js        local storage, cloud sync, backup/restore
totals.js             calculation layer
overlays.js           chart/overlay rendering
functions/api/auth/   login, logout, me, status, recovery-codes
functions/api/data/   ledger read/write
functions/_lib/       shared auth, crypto, throttling, recovery, retention
migrations/           D1 schema, applied by hand (0001–0004)
tests/                node:test suites, 157 tests
```

## Tests

```powershell
node --test tests/auth-session.test.mjs tests/data-sanitize.test.mjs tests/overlays.test.js tests/persistence.test.js tests/recovery.test.mjs tests/totals.test.js tests/deletion.test.mjs
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

## Private mode

The custom domain currently sits behind a Cloudflare **Zero Trust Access**
application, so unauthenticated visitors are redirected to the team login page.
That is deliberate: the product is not public yet.

- The `*.pages.dev` hostname is **not** covered by that Access app. Treat it as
  the unprotected back door while private.
- An uptime monitor pointed at `/api/auth/status` will see `302`, not `200`.
- `DEPLOY.md` has the checklist for switching to public.

## Docs

| File | What it answers |
|---|---|
| `DEPLOY.md` | How a deploy ships, bindings, migrations, going public |
| `OPERATIONS.md` | Watching live logs, reading errors, alerting |
| `RUNBOOK.md` | "It broke" — logs, password reset, restore, rollback |
| `SECURITY.md` | What is hardened, what remains |
