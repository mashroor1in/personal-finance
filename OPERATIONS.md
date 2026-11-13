# Operations: Logs, Errors and Alerts

How to find out what broke, and how to learn about it before a user tells you.

## The one thing to understand first

**Cloudflare does not store this app's runtime logs.** There is no log file to
open afterwards. Errors can only be watched **live**, as they happen.

If a request fails while nobody is tailing, the details are gone. That is why
the recommended setup below is an alert, not a log archive.

| Kind of log | Stored? | Where |
|---|---|---|
| Build logs (deploy failed) | Yes | Dashboard → Deployments |
| Runtime errors (500s) | **No** | Live tail only |
| Request/error counters | Aggregated | Dashboard → Analytics |

Build logs tell you "the deploy did not go out". They cannot tell you "login is
throwing 500s". Those are different problems.

---

## 1. Watch errors live

In an interactive terminal, the deployment id is optional — wrangler attaches to
the newest production deployment itself:

```powershell
wrangler pages deployment tail --project-name personal-finance
```

This is the command to use. No id to copy, and it cannot go stale.

If you need to pin a specific build (or you are in a non-interactive shell, where
the id **is** required), get the id first:

```powershell
wrangler pages deployment list --project-name personal-finance
```

```powershell
wrangler pages deployment tail <deployment-id> --project-name personal-finance --format json
```

Leave the window open, then reproduce the problem in the browser. The record
appears within a second or two.

### Filters

```powershell
# Only failed requests
wrangler pages deployment tail <id> --project-name personal-finance --status error

# Only POSTs (logins, data writes)
wrangler pages deployment tail <id> --project-name personal-finance --method POST

# Only requests carrying a given header
wrangler pages deployment tail <id> --project-name personal-finance --header "cf-connecting-ip:1.2.3.4"
```

### Four gotchas that cost real time

1. **Without an id, you get the newest production deployment.** That is usually
   what you want. In a non-interactive shell the id is mandatory —
   `--environment production` alone is not enough.
2. **A tail is bound to one deployment.** If you pin an id, the moment you push a
   fix and it goes live, the old tail goes quiet. Start a new tail.
3. **`--status error` hides everything that worked.** If the action succeeded,
   you will see nothing at all. That is correct, not a broken tail.
4. **Static files and edge blocks never appear.** See the table below.

### What never shows up in a tail

The tail only sees requests that reached your Pages Functions. That excludes two
whole categories:

| Missing from the tail | Why | Where to look instead |
|---|---|---|
| `/`, `/app.html`, CSS, images, `_headers` | Served directly by Cloudflare, never enter a function | Nowhere — they are static files |
| WAF / rate-limit / Bot Fight blocks on `mashmind.in` | Rejected at the edge, before your code runs | Dashboard → `mashmind.in` zone → Security → Events |

So only `/api/*` traffic appears. Page loads show up indirectly, through the
`/api/auth/status` and `/api/auth/me` calls the page makes.

The tail is scoped to a **deployment**, not a hostname: requests from
`expenses.mashmind.in` and `personal-finance-8ch.pages.dev` both appear, and the
`host` field tells you which one a request came through.

### Order matters

Start the tail **first**, then reproduce. There is nothing to read afterwards.

---

## 2. Reading an error record

The `exceptions` array is the part that matters. A real example, from this
project:

```json
{
  "outcome": "exception",
  "exceptions": [
    {
      "name": "NotSupportedError",
      "message": "Pbkdf2 failed: iteration counts above 100000 are not supported (requested 210000)."
    }
  ],
  "event": { "request": { "url": "https://.../api/auth/login", "method": "POST" } },
  "event": { "response": { "status": 500 } }
}
```

Fields worth reading:

| Field | Meaning |
|---|---|
| `outcome` | `ok`, `exception` or `canceled`. Anything not `ok` needs a look. |
| `exceptions[].name` | The error type. `NotSupportedError` = platform limit, not your bug. |
| `exceptions[].message` | Plain-English cause. Usually enough on its own. |
| `event.request.url` | Which endpoint. |
| `event.response.status` | What the user saw. |
| `cpuTime` / `wallTime` | Milliseconds. Very high `cpuTime` suggests a runaway computation. |

`"logs": []` is normal. This codebase does not `console.log`.

---

## 3. What the dashboard keeps

Cloudflare Dashboard → **Workers & Pages** → `personal-finance`:

- **Deployments** — one row per push. Build logs are stored here. This is where
  you check "did my change actually go live?".
- **Analytics / Metrics** — request counts, 5xx rate, CPU time. Aggregated, kept
  over time, no per-request detail.
- **Logs** — live runtime logs, only if the plan includes Workers Logs. Short
  retention.

Custom domains: `expenses.mashmind.in`, `personal-finance-8ch.pages.dev`.

---

## 4. Getting told when something breaks

### Step 1 — uptime monitor (do this first)

Point a free monitor (UptimeRobot, Cloudflare Health Checks, or similar) at:

```
https://expenses.mashmind.in/api/auth/status
```

Check every minute. Alert when the status is not `200`.

> **While Cloudflare Access is enabled**, that URL answers `302` to the SSO page
> before Pages runs. Alert on `302` being *unexpected* is impossible to
> distinguish from a normal redirect, so either give the monitor an Access
> service token, or point it at
> `https://personal-finance-8ch.pages.dev/api/auth/status` until the site is
> public. See `DEPLOY.md` → "Going public".

Expected healthy response:

```json
{"ok":true,"hasUsers":true,"turnstileEnabled":true,"turnstileSiteKey":"...","turnstileMisconfigured":false}
```

This endpoint touches no database rows, so it is safe to hammer.

Watch for `turnstileMisconfigured: true` in a healthy `200` too — that means only
one of the two Turnstile values is set, and **all logins are being refused** even
though the site looks up.

### Step 2 — error tracking (when you have an hour)

Add Sentry (free tier). It stores every exception with a stack trace and emails
you. This is what converts "I found a 500 by chance" into "I got an email with
the line number".

Wrap the Pages Functions handlers so uncaught throws are reported.

### Step 3 — database monitoring (optional)

Use Cloudflare D1 alerts to notify of:
- High error rates on auth endpoints
- Unusual login failures
- High CPU time during login peaks (PBKDF2 adds ~30ms per login)
- Spikes in 429 responses (rate limiting)

### Step 3 — real retention (optional, paid)

Cloudflare Logpush ships logs to storage you own (R2/S3). Real retention, more
setup, paid. Not worth it at this size.

---

## 5. Incident checklist

1. Confirm it is real — load the app, retry the action.
2. **Start a tail** on the current production deployment id.
3. Reproduce the action.
4. Read `exceptions[0].message`.
5. Check `git log --oneline -5` — did this start right after a push?
6. Roll back if needed: Deployments → pick the previous good build → Rollback.
7. Fix, test locally, push, then **re-tail the new deployment** to confirm.

### Quick reference

| Symptom | Likely cause |
|---|---|
| Everything 500s right after a deploy | Runtime exception — tail it |
| One endpoint 500s | Bug in that handler |
| Login refused, site looks fine | Turnstile half-configured, or auth throttling |
| `429` | Rate limit / lockout (`auth_throttle` table) |
| Everything `302`s to `cloudflareaccess.com` | Access policy is on; expected while private |
| Forgotten password | User redeems a recovery code; see `RUNBOOK.md` §3 |
| Site 404s at `/` | A `functions/index.js` was added and is shadowing `index.html` |
| `D1_ERROR` / no such table | A migration was not applied; see `DEPLOY.md` |
| Account deleted by mistake | Financial data is kept for 30 days; see `RUNBOOK.md` §6 |
| Deploy never goes live | Build failed — read the build log, not the runtime log |

---

## 6. What is deliberately not logged

No plaintext passwords, no session tokens, no financial values. That is
intentional. Do not add `console.log` of request bodies to make debugging
easier — the tail output is not private either.

If you need more detail in a production error, log a short reason code, never
the sensitive value.

---

## See also

- `RUNBOOK.md` — the "it broke" page: logs, password reset, restore.
- `DEPLOY.md` — deploy topology, migrations, PowerShell `$` warning.
- `SECURITY.md` — what is hardened and what remains.
