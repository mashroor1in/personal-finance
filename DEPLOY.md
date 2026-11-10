# Personal Finance App Deployment Guide

## Prerequisites
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install/) installed
- Cloudflare account with D1 database and KV namespace configured

## 1. Apply Database Migration

Before deploying, run the auth throttling migration:

```bash
wrangler d1 execute personal-finance --file migrations/0002_auth_throttle.sql --remote
```

## 2. Configure Environment

Create `wrangler.toml`:

```toml
name = "personal-finance"
main = "functions/index.js"
compatibility_date = "2023-12-01"

[env.production]
vars = { ENVIRONMENT = "production" }

[[env.production.kv_namespaces]]
binding = "SESSIONS"
id = "your-kv-namespace-id"

[[env.production.d1_databases]]
binding = "DB"
database_id = "your-d1-database-id"

[env.production.vars]
# Required for password hashing policy
PASSWORD_ITERATIONS = "210000"

# Optional: Turnstile for bot protection
TURNSTILE_SITE_KEY = "your-site-key"
TURNSTILE_SECRET = "your-secret-key"
```

## 3. Deploy

```bash
wrangler deploy --env production
```

## 4. Post-Deploy Checklist

### Sessions
- All existing sessions are invalidated on first deploy
- Users will need to re-login after deployment
- Session TTL remains 7 days

### Legacy Data
- Legacy `user_id='default'` rows remain orphaned but are not deleted
- Legacy password hashes (SHA-256) will be upgraded to PBKDF2 on next login
- No data migration is required

### Security
- Password hashing now uses 210k-iteration PBKDF2-HMAC-SHA256
- Login attempts are throttled at 5 failures per 15-minute window
- Turnstile validation fails closed if only half-configured
- All financial data is sanitized on save and escaped on render

### Monitoring
- No built-in error tracking is configured
- Check Wrangler logs for errors: `wrangler tail --env production`
- Monitor for 429 (rate limited) and 401 (auth failures) responses

## 5. Backup and Recovery

### Database
```bash
# Create a local copy
wrangler d1 export personal-finance > backup-$(date +%Y%m%d).sql

# Restore to a new database
wrangler d1 execute personal-finance-new --file backup-20240101.sql
```

### User Accounts
- No password recovery mechanism is currently implemented
- Account deletion is permanent and deletes all financial data
- Users must re-register if they forget their password

## 6. Maintenance

### Password Hashing Policy
To adjust the iteration count (e.g., for CPU constraints):

```bash
# Lower to 100k for CPU-constrained plans
wrangler secret put PASSWORD_ITERATIONS

# In wrangler.toml:
[env.production.vars]
PASSWORD_ITERATIONS = "100000"
```

### Migration Updates
If additional migrations are needed:
1. Create SQL files in `migrations/`
2. Apply with: `wrangler d1 execute personal-finance --file migrations/XXXX_name.sql --remote`
3. Deploy code changes that depend on the new schema

## 7. Troubleshooting

### Login Fails with D1 Error
- Missing `auth_throttle` table: run migration 0002
- Check D1 binding in `wrangler.toml`

### Turnstile Issues
- If Turnstile is half-configured, all auth attempts will be blocked
- Ensure both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` are set, or neither

### Session Issues
- Sessions are invalidated on password change
- Check KV namespace binding is correct
- Session cookies are HttpOnly, Secure, SameSite=Lax

### Performance
- PBKDF2 hashing adds ~30ms per login on Workers
- Monitor for 1102 (CPU time limit) errors during login peaks
