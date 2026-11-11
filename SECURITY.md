# Security Hardening Summary

## Completed Security Improvements

All confirmed vulnerabilities from the security audit have been addressed:

### ✅ Session Management
- **Session Revocation**: Sessions are invalidated on password change, account deletion, or username re-registration
- **Session Versioning**: Each session contains a version hash of the password verifier
- **Legacy Token Support**: Old sessions without versioning work but require one re-login

### ✅ Cross-Site Scripting (XSS)
- **Data Sanitization**: All financial data is sanitized before storage
- **Output Escaping**: All rendered values are properly escaped in the UI
- **Backup Sanitization**: Imported backup files are sanitized before processing

### ✅ Authentication Security
- **Password Hashing**: Migrated from single-round SHA-256 to PBKDF2-HMAC-SHA256 at the Cloudflare iteration ceiling
- **Constant-Time Comparison**: Password comparisons use timing-safe comparison
- **Auth Throttling**: Atomic rate limiting prevents brute force attacks (5 failures per 15 minutes)
- **Turnstile Integration**: Bot protection fails closed when half-configured

### ✅ Cross-Site Request Forgery (CSRF)
- **Mutation Guard**: All mutating endpoints require `application/json` content type
- **Same-Origin Check**: Requests include `Origin` header validation
- **Session Binding**: All operations bound to authenticated user account

### ✅ Data Isolation
- **Owner Binding**: Each ledger write is bound to the account that loaded it
- **Stale Tab Prevention**: Prevents writes from old browser tabs to different accounts
- **Legacy Cleanup**: Removed automatic transfer of legacy `default` user data

### ✅ Password Recovery
- **One-Time Codes**: 10 codes issued at signup, shown once, each usable once
- **Hashed at Rest**: Only a per-code salted SHA-256 hash is stored; 60 bits of entropy per code
- **Current Password Required**: Replacing the set needs the password, so a stolen session cannot mint durable codes
- **Atomic Redemption**: A conditional update guarantees a code cannot be spent twice by concurrent requests
- **Separate Throttle Bucket**: Failed logins cannot lock a legitimate user out of recovery
- **Full Rotation on Reset**: A new password rotates the session version, killing every older token

## Security Features

### Password Hashing
- **Algorithm**: PBKDF2-HMAC-SHA256
- **Iterations**: 100,000 (Cloudflare's WebCrypto ceiling; higher values throw)
- **Salt**: 16 random bytes per password
- **Migration**: Legacy SHA-256 hashes are automatically upgraded on login

### Session Security
- **Storage**: Cloudflare KV with 7-day TTL
- **Validation**: Sessions invalidated when password changes
- **Cookies**: HttpOnly, Secure, SameSite=Lax
- **Versioning**: Password hash version stored in session token

### Rate Limiting
- **Login Attempts**: 5 failures per 15-minute window per IP
- **Exponential Backoff**: Lockout duration increases with failures
- **IP Buckets**: Separate rate limiting for different IP ranges
- **Atomic Operations**: Uses D1 for consistent counting
- **Independent Scopes**: Login, recovery-code redemption and code rotation each have their own bucket

### Recovery Codes
- **Count**: 10 per account, single use
- **Format**: 12 characters from a 32-symbol alphabet (no `0/O/1/I`), 60 bits each
- **Storage**: `recovery_codes` table, salted SHA-256, never the plaintext
- **Delivery**: Returned exactly once in the response that created them
- **Rotation**: Replaces the entire set in one batch; old codes stop working immediately

### Data Protection
- **Input Sanitization**: All user input is validated and sanitized
- **Output Encoding**: All rendered data is properly escaped
- **Backup Validation**: Imported files are verified before processing
- **CSRF Protection**: All mutations require proper headers

## Test Coverage

- **150 tests** covering all security-critical paths
- **Auth/Session Tests**: 38 tests covering authentication, session management, and rate limiting
- **Recovery Tests**: 17 tests covering code generation, hashing, redemption, rotation and re-registration
- **Data Sanitization Tests**: 13 tests covering input/output validation
- **Persistence Tests**: 29 tests covering data isolation and sync security
- **UI Tests**: 34 tests covering overlay and interaction security
- **Totals Tests**: 19 tests covering the calculation layer

## Remaining Considerations

### Low Priority
- Session keys accumulate on repeated password changes (bounded by 7-day TTL)
- No `__Host-` cookie prefix (minor improvement)
- IP-only rate limiting could affect users behind NAT (monitor in production)
- Losing both the password and every recovery code still needs an operator reset

### Product Gaps (Not Security Issues)
- No multi-user support (single-user design)
- No offline mode (cloud-dependent architecture)
- No email-based recovery (deliberately avoided: recovery codes need no mail service)

## Deployment Notes

1. **Migrations Required**: Apply `migrations/0002_auth_throttle.sql` and `migrations/0003_recovery_codes.sql` before deployment
2. **Sessions Invalidated**: All users will need to re-login after first deployment
3. **Legacy Data**: Legacy `user_id='default'` rows remain orphaned but not deleted
4. **Turnstile**: Fails closed if only half-configured (blocks all auth if incomplete)
5. **Existing Accounts**: Accounts created before recovery codes existed have none; they can generate a set from the account menu

## Monitoring

- Monitor Wrangler logs for authentication errors
- Watch for 429 (rate limited) and 401 (auth failures) responses
- Track CPU time during login peaks (PBKDF2 adds ~30ms per login)
- Review error rates for any anomalies

## Contact

For security concerns or vulnerabilities, please open an issue with detailed reproduction steps.
