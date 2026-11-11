# Runbook: If It Breaks

The page to open when something is wrong and you do not want to think.

Nothing here is exploratory. Every command was run against this project.

> **Read this first:** Cloudflare stores **no** runtime logs for this app. If a
> request failed and nobody was tailing, the details are already gone. So step 1
> of every investigation is *start the tail, then reproduce* — never the reverse.

---

## The facts you need, without looking them up

| Thing | Value |
|---|---|
| Project (Pages) | `personal-finance` |
| Live URL | `https://expenses.mashmind.in` |
| Fallback URL | `https://personal-finance-8ch.pages.dev` |
| Health check | `https://expenses.mashmind.in/api/auth/status` |
| D1 database | `personal-expenses-db` |
| D1 database id | `f99159c3-82a7-405c-bf9e-6e65b5662be5` |
| KV namespace (`SESSIONS`) | `d70752bc58ac491fba7f23441ba1f2f4` |
| Repo folder | `C:\mash\Study\personal-finance` |

Healthy `/api/auth/status` looks like:

```json
{"ok":true,"hasUsers":true,"turnstileEnabled":true,"turnstileSiteKey":"...","turnstileMisconfigured":false}
```

Every command below assumes you are in the project folder:

```powershell
cd C:\mash\Study\personal-finance
```

---

## Triage: 60 seconds

1. Open the app in a browser. Try the action again.
2. Does the **page** load but the **action** fail? → it is your code. Go to [§1](#1-see-the-logs).
3. Does **nothing** load? → it is DNS, the edge, or a bad deploy. Go to [§4](#4-put-a-bad-deploy-back).
4. Text yourself the time it started. If it started right after a push, [§4](#4-put-a-bad-deploy-back) is faster than debugging.

| Symptom | Most likely cause | Go to |
|---|---|---|
| Everything 500s right after a deploy | Runtime exception in new code | [§1](#1-see-the-logs) then [§4](#4-put-a-bad-deploy-back) |
| One endpoint 500s, rest fine | Bug in that one handler | [§1](#1-see-the-logs) |
| Login fails, site looks healthy | Turnstile half-configured, or lockout | [§3](#3-fix-a-password-by-hand) |
| `429` on login | Rate limit / `auth_throttle` lockout | [§5](#5-unlock-a-locked-out-account) |
| `404` at `/` | A `functions/index.js` came back | [§4](#4-put-a-bad-deploy-back) |
| `D1_ERROR` / `no such table` | A migration was never applied | [§6](#6-restore-the-database) |
| Someone forgot their password | They should redeem a recovery code first | [§3](#3-fix-a-password-by-hand) |
| Data is wrong / deleted | Needs a restore | [§6](#6-restore-the-database) |

---

## 1. See the logs

This is the command. In an interactive terminal the deployment id is **optional**:

```powershell
wrangler pages deployment tail --project-name personal-finance
```

Say `Connected to deployment ..., waiting for logs...`, then leave the window
alone and reproduce the problem in the browser. Records appear within a second.

Only failures (less noise):

```powershell
wrangler pages deployment tail --project-name personal-finance --status error
```

Only writes and logins:

```powershell
wrangler pages deployment tail --project-name personal-finance --method POST
```

Want a file to read afterwards:

```powershell
wrangler pages deployment tail --project-name personal-finance | Tee-Object -FilePath posts.log
```

Then read it:

```powershell
Select-String -Path posts.log -Pattern '"outcome"|"status"|"name"|"message"'
```

### Reading a record

Only three fields matter under pressure:

```json
{
  "outcome": "exception",
  "cpuTime": 8,
  "exceptions": [
    {
      "name": "NotSupportedError",
      "message": "Pbkdf2 failed: iteration counts above 100000 are not supported (requested 210000)."
    }
  ],
  "event": { "request": { "url": ".../api/auth/login" }, "response": { "status": 500 } }
}
```

- `"outcome": "ok"` → it worked. Ignore it.
- `"status": 500` → it broke. Read `exceptions[0].message`, which is usually a
  complete diagnosis in plain English.
- `"exceptions": []` with a `500` → unusual. Capture the whole block.

`"logs": []` is normal. This codebase does not `console.log`.

### If the tail is silent

| Check | Fix |
|---|---|
| Are you tailing an old deployment? | Drop the id and use the command above |
| Did you already reproduce before starting? | Nothing is retroactive — start the tail, then act |
| Are you looking for a page load? | Static files never appear; look for `/api/*` instead |
| A user reports "blocked" but the tail is empty | It was blocked at the edge — see [§7](#7-when-the-tail-is-empty-but-the-user-sees-an-error) |
| Has the session expired? | It prints an expiry; just run the command again |

---

## 2. Roll back first, debug second

If the app is broken **for users**, do not debug. Ship the previous build.

**There is no `wrangler pages rollback`.** Pages rollback is dashboard-only
(`wrangler rollback` is a Workers command and will not help here).

1. Dashboard → **Workers & Pages** → `personal-finance` → **Deployments**
2. Find the last deployment whose commit you trust
3. Open its `...` menu → **Rollback**

That is the entire emergency action. It takes seconds and does not need a
terminal. Then do the real fix calmly, on a branch.

---

## 3. Fix a password by hand

There are two paths, in this order.

### First: the user resets it themselves

Every account gets 10 one-time recovery codes at signup. On the sign-in screen
the user clicks **Use a recovery code**, then enters their username, one code,
and a new password. That is the whole flow: no operator, no downtime, and the
code is burned on use.

If they never saved the codes, they can still generate a fresh set after signing
in: menu → **Recovery codes** → enter the current password. That replaces the
old set, so a lost sheet stops working.

### Second: the codes are gone too

Then an operator resets the row.

**Never paste a password hash into `wrangler d1 execute --command "..."`.** In
PowerShell, `$` starts a variable, so `pbkdf2-sha256$100000$...` silently
becomes `pbkdf2-sha256` and the account is bricked in a way that looks like a
code bug. Always go through a `.sql` file.

### Generate it

```powershell
node scripts/reset-password.mjs <username> <new-password>
```

Example:

```powershell
node scripts/reset-password.mjs mash "a-long-temporary-password"
```

It prints:

```
  Wrote reset-mash.sql
  iterations: 100000
  self-check: ok
```

`self-check: ok` means the generated verifier was proven to verify the password
before the file was written. If it ever prints `self-check failed`, nothing was
written — do not proceed.

### Apply it

```powershell
wrangler d1 execute personal-expenses-db --file reset-mash.sql --remote -y
```

### Clean up

```powershell
Remove-Item reset-mash.sql
```

The file holds a password **hash**, not the password, but it is still not
something to leave lying around. It is gitignored (`reset-*.sql`).

### Tell the user

1. Log in with the temporary password.
2. Immediately use the in-app **change password** screen.
3. That rehash is what makes the account theirs again.

Existing sessions **are** invalidated by this reset: the session version is
derived from the verifier, so resetting the password revokes every session for
that account on its next request. Users being signed out is expected.

### Verify the row

```powershell
wrangler d1 execute personal-expenses-db --remote --command "SELECT id, substr(pin_hash,1,20) AS prefix, length(pin_hash) AS len FROM users;"
```

`pbkdf2-sha256$100000$` with `len` 90 is a healthy modern row. A bare 64-character
hex value is a legacy SHA-256 row, which auto-upgrades on the next login. That is
not an error.

An operator reset does **not** clear recovery codes. That is usually right: the
owner keeps their backup sheet. But if you reset the password to evict someone,
clear the codes too, or that someone keeps a way back in:

```powershell
wrangler d1 execute personal-expenses-db --remote --command "DELETE FROM recovery_codes WHERE user_id = 'mash';"
```

The owner can then generate a fresh set from the account menu.

---

## 4. Put a bad deploy back

Same as [§2](#2-roll-back-first-debug-second). Roll back in the dashboard, then:

```powershell
git log --oneline -5
```

The top commit is what is deployed. The one below it is what you just went back
to.

To confirm the rollback actually took effect:

```powershell
wrangler pages deployment list --project-name personal-finance
```

The top `Production` row is live. If the id did not change, the rollback did not
happen.

**Do not** run `wrangler deploy` in this repo. It is a **Pages** project, not a
Worker. `wrangler deploy` creates a stray Worker that shadows nothing and
confuses everything (this happened once already — `personal-finance-production`
had to be deleted).

---

## 5. Unlock a locked-out account

Login throttling lives in the D1 `auth_throttle` table, keyed by IP bucket.
A `429` is the lockout working as designed.

Look at it:

```powershell
wrangler d1 execute personal-expenses-db --remote --command "SELECT * FROM auth_throttle ORDER BY failures DESC LIMIT 10;"
```

Clear it (careful — this removes the protection until it refills):

```powershell
wrangler d1 execute personal-expenses-db --remote --command "DELETE FROM auth_throttle;"
```

Only do that when you are certain the failures were the real user mistyping.
Clearing it during an actual attack re-opens the door.

---

## 6. Restore the database

### Option A — Time Travel (30-day window, fastest)

This rolls the **whole database** back to a moment. Everything written after that
moment is lost. Make sure that is what you want.

```powershell
wrangler d1 time-travel info personal-expenses-db --timestamp "2026-11-12T09:00:00Z"
```

```powershell
wrangler d1 time-travel restore personal-expenses-db --timestamp "2026-11-12T09:00:00Z"
```

It prints a **bookmark** — write that down. You can undo the restore with it:

```powershell
wrangler d1 time-travel restore personal-expenses-db --bookmark <bookmark>
```

### Option B — Export, inspect, re-import (safer, slower)

Take a copy **before** touching anything:

```powershell
wrangler d1 export personal-expenses-db --remote --output backup.sql
```

`backup.sql` is gitignored. Read it (it is plain text) and confirm it is not
empty and contains your data:

```powershell
Select-String -Path backup.sql -Pattern "INSERT INTO" | Measure-Object
```

Restore from a copy by importing it:

```powershell
wrangler d1 execute personal-expenses-db --file backup.sql --remote -y
```

**Back up before any risky migration, always.** One command, ten seconds.

### What is *not* in the database

Sessions live in KV, not D1. Restoring D1 does not log anyone out and does not
bring back deleted sessions. To force everyone out after a restore, delete a
session key or rotate the affected password ([§3](#3-fix-a-password-by-hand)) —
the session version changes with the verifier, so all sessions die.

---

## 7. When the tail is empty but the user sees an error

Two categories never reach your code, so they never reach the tail:

**Static files.** `/`, `/app.html`, CSS, images. Cloudflare serves these
directly. A `404` here means the file is missing from the deploy, or a
`functions/index.js` is shadowing `index.html`.

**Edge blocks.** Your custom domain sits on the `mashmind.in` zone, so the
following reject the request before your function runs:

- WAF custom rules
- Cloudflare rate-limiting rules
- Bot Fight Mode

Dashboard → `mashmind.in` zone → **Security → Events**. That lists each block
and the exact rule that fired.

If a user reports a block and your tail is silent, this is almost always why.

---

## 8. The four commands, on one page

```powershell
# 1. Watch what is happening, live
wrangler pages deployment tail --project-name personal-finance

# 2. Fix a password (generates SQL, then you apply it)
node scripts/reset-password.mjs <username> <new-password>
wrangler d1 execute personal-expenses-db --file reset-<username>.sql --remote -y

# 3. Back up the database
wrangler d1 export personal-expenses-db --remote --output backup.sql

# 4. Put everything back to a point in time
wrangler d1 time-travel restore personal-expenses-db --timestamp "<RFC3339 time>"
```

Plus one action that is not a command: **rollback is the dashboard's Deployments
tab.**

---

## What not to do

| Do not | Why |
|---|---|
| Run `wrangler deploy` | This is a Pages project. It creates a stray Worker. |
| Add `functions/index.js` | It shadows `index.html` and the whole site 404s. |
| Pass a hash inline with `--command "..."` | PowerShell eats the `$` and corrupts the verifier. |
| Paste request bodies or passwords into `console.log` | The tail stream is not private either. |
| Clear `auth_throttle` during a suspected attack | You are removing the lock the attacker is hitting. |
| Restore a database without noting the bookmark | You lose the ability to undo the restore. |
| Edit `pin_hash` to a value you made up | It must be a real `pbkdf2-sha256$100000$salt$key` verifier. Use the script. |
| Ask a user to send you a recovery code | It is a password equivalent. Have them enter it themselves. |
| Delete `migrations/*.sql` | They are the schema of record. |
| Commit `backup.sql`, `reset-*.sql`, `*.log` | They are all gitignored; keep it that way. |

---

## See also

- `DEPLOY.md` — how a deploy ships, bindings, migrations.
- `OPERATIONS.md` — the longer version of §1: filters, record fields, alerting.
- `SECURITY.md` — what is hardened and what remains.
