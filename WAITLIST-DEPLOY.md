# Bucksy Early Access Waitlist - Deployment Guide

This guide covers the deployment and operational procedures for the Bucksy Early Access waitlist system.

## Prerequisites

- Cloudflare Pages project: `personal-finance`
- Cloudflare D1 database: `personal-expenses-db`
- Cloudflare KV namespace: `SESSIONS` (for rate limiting)
- Cloudflare Turnstile configuration
- Environment variables for API keys

## Deployment Steps

### 1. Database Migration

Apply the waitlist database migration:

```bash
wrangler d1 execute personal-expenses-db \
  --file migrations/0006_waitlist.sql --remote
```

### 2. Environment Variables

Configure the following environment variables in Cloudflare Pages:

```bash
# Cloudflare Turnstile
TURNSTILE_SITE_KEY=0x4AAAAAAFrpNVLHluekM9BE
TURNSTILE_SECRET=your_turnstile_secret

# Analytics (optional)
ANALYTICS_API_KEY=your_analytics_api_key

# Rate limiting (optional)
RATE_LIMIT_MAX_REQUESTS=10
RATE_LIMIT_WINDOW_MS=900000
```

### 3. Pages Functions

The following functions will be automatically deployed:

- `/early-access/api/waitlist` - Registration endpoint
- `/early-access/api/verify` - Email verification
- `/early-access/api/referral` - Referral tracking
- `/early-access/api/analytics` - Analytics API

### 4. Testing

Run the test suite:

```bash
node --test tests/waitlist.test.js
```

## API Endpoints

### 1. Waitlist Registration

**Endpoint**: `POST /early-access/api/waitlist`

**Request Body**:
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "country": "US",
  "referral_code": "TEST123",
  "referred_by": "referrer_id",
  "signup_source": "early-access",
  "turnstile_token": "turnstile_token"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Registration successful. Please check your email for verification.",
  "data": {
    "id": "user_uuid",
    "email": "user@example.com",
    "referral_code": "generated_code",
    "status": "pending"
  }
}
```

### 2. Email Verification

**Endpoint**: `GET /early-access/api/verify?token=verification_token&email=user@example.com`

**Response**:
```json
{
  "success": true,
  "message": "Email verified successfully",
  "data": {
    "status": "verified",
    "user": {
      "id": "user_uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "verified_at": 1642678800000
    }
  }
}
```

### 3. Referral Information

**Endpoint**: `GET /early-access/api/referral?code=referral_code`

**Response**:
```json
{
  "success": true,
  "data": {
    "referrer": {
      "id": "referrer_uuid",
      "email": "referrer@example.com",
      "name": "Referrer Name"
    },
    "statistics": {
      "total_referrals": 10,
      "verified_referrals": 8,
      "invited_referrals": 2
    }
  }
}
```

### 4. Analytics

**Endpoint**: `GET /early-access/api/analytics`

**Response**:
```json
{
  "success": true,
  "data": {
    "overview": {
      "total_registrations": 100,
      "verified_registrations": 75,
      "verification_rate": 75
    },
    "time_series": {
      "registrations_last_24h": 5,
      "verifications_last_24h": 3
    }
  }
}
```

## Security Features

### 1. Rate Limiting

- 10 requests per 15 minutes per IP
- Implemented using Cloudflare KV
- Automatic cleanup of expired entries

### 2. Email Validation

- Format validation
- Disposable email detection
- Suspicious pattern detection

### 3. Turnstile Integration

- Client-side verification widget
- Server-side token validation
- Protection against automated attacks

### 4. Security Headers

- Content Security Policy
- XSS Protection
- Clickjacking Protection
- MIME Sniffing Protection

## Monitoring and Logging

### 1. Event Logging

All events are logged to the `waitlist_events` table:

- Registration events
- Verification events
- Referral events
- Error events

### 2. Analytics Dashboard

Access analytics via `/early-access/api/analytics`:

- Registration statistics
- Verification rates
- Geographic distribution
- Referral analytics

### 3. Error Monitoring

Monitor for common error patterns:

- Rate limit exceeded
- Invalid verification tokens
- Duplicate registrations
- Security violations

## Operational Procedures

### 1. Daily Checks

1. Monitor registration rates
2. Check for error spikes
3. Verify email delivery rates
4. Review referral activity

### 2. Weekly Maintenance

1. Clean up expired verification tokens
2. Review analytics trends
3. Update disposable email domain list
4. Check security logs for anomalies

### 3. Monthly Review

1. Analyze growth metrics
2. Review referral program effectiveness
3. Update security rules as needed
4. Archive old data if necessary

## Troubleshooting

### Common Issues

1. **High Error Rates**
   - Check for security attacks
   - Review rate limiting thresholds
   - Monitor for suspicious patterns

2. **Low Verification Rates**
   - Check email delivery
   - Review verification email content
   - Monitor for token expiration issues

3. **Referral Program Issues**
   - Verify referral code generation
   - Check referral tracking logic
   - Monitor for duplicate referrals

### Debug Mode

Enable debug logging by setting the `LOG_LEVEL` environment variable:

```bash
LOG_LEVEL=debug
```

### Performance Issues

If experiencing performance issues:

1. Check database indexes
2. Monitor query execution times
3. Review Cloudflare Analytics
4. Optimize slow queries

## Backup and Recovery

### 1. Database Backup

Regular D1 backups are configured automatically. To create a manual backup:

```bash
wrangler d1 export personal-expenses-db --remote --output backup.sql
```

### 2. Data Recovery

To recover specific data:

1. Export database backup
2. Identify the affected records
3. Restore using D1 import functionality

### 3. Disaster Recovery

In case of system failure:

1. Restore from latest backup
2. Verify data integrity
3. Monitor for errors
4. Notify users if necessary

## Compliance and Privacy

### 1. Data Protection

- Email addresses are hashed for storage
- Personal data is minimized
- Data retention policies are enforced

### 2. User Rights

- Users can request data deletion
- Email verification is required
- Privacy policy is available

### 3. Regulatory Compliance

- GDPR compliant data handling
- Appropriate data retention periods
- Security measures meet industry standards

## Scaling Considerations

### 1. Horizontal Scaling

- Cloudflare Pages automatically scales
- Rate limiting uses distributed KV
- Database queries are optimized

### 2. Vertical Scaling

- Monitor memory usage
- Optimize query performance
- Consider read replicas for analytics

### 3. Performance Optimization

- Use appropriate indexes
- Cache frequently accessed data
- Optimize API response times

## Contact Information

For operational issues:
- Operations Team: ops@bucksy.life
- Security Team: security@bucksy.life
- Support: support@bucksy.life

## Documentation

- API Documentation: See individual endpoint sections
- Security Documentation: See `SECURITY-WAITLIST.md`
- Database Schema: See `waitlist-schema.sql`