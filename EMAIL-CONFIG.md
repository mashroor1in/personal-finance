# Bucksy Email Delivery Configuration

This document explains how to configure email delivery for the Bucksy waitlist system.

## Overview

The Bucksy email system supports multiple providers and provides a unified interface for sending transactional and marketing emails with proper branding, logging, and error handling.

## Supported Providers

### 1. Resend (Recommended)

Resend is a modern email service designed for developers with excellent deliverability and an API-first approach.

**Pros:**
- Excellent deliverability
- Modern API with good documentation
- Competitive pricing
- Good integration with serverless platforms
- Built-in analytics

**Setup:**
1. Create an account at [resend.com](https://resend.com)
2. Create an API key in your dashboard
3. Add the following environment variables:

```env
WAITLIST_EMAIL_PROVIDER=resend
RESEND_API_KEY=your_api_key_here
WAITLIST_FROM_EMAIL=noreply@bucksy.life
```

### 2. SendGrid

SendGrid is an enterprise-grade email service with robust features and excellent deliverability.

**Pros:**
- Enterprise-grade features
- Excellent deliverability
- Advanced analytics
- Template system
- Good for high volume

**Setup:**
1. Create an account at [sendgrid.com](https://sendgrid.com)
2. Create an API key with "Mail Send" permissions
3. Add the following environment variables:

```env
WAITLIST_EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=your_api_key_here
WAITLIST_FROM_EMAIL=noreply@bucksy.life
```

### 3. Mailgun

Mailgun is a developer-friendly email service with powerful APIs and good deliverability.

**Pros:**
- Developer-friendly APIs
- Good deliverability
- Advanced features like email validation
- Webhooks for events
- Good documentation

**Setup:**
1. Create an account at [mailgun.com](https://mailgun.com)
2. Get your API key and domain name
3. Add the following environment variables:

```env
WAITLIST_EMAIL_PROVIDER=mailgun
MAILGUN_API_KEY=your_api_key_here
MAILGUN_DOMAIN=your_domain.mailgun.org
WAITLIST_FROM_EMAIL=noreply@bucksy.life
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `WAITLIST_EMAIL_PROVIDER` | Email provider to use | `resend` |
| `[PROVIDER]_API_KEY` | API key for your chosen provider | `your_api_key_here` |
| `WAITLIST_FROM_EMAIL` | Default from address | `noreply@bucksy.life` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `WAITLIST_ADMIN_TOKEN` | Admin token for protected endpoints | - |
| `DB` | Database instance for logging | - |

### Admin Token (Required for Protected Endpoints)

The following endpoints require an admin token in the `x-admin-token` header:

- `POST /early-access/api/admin/invite` - Send invitations
- `POST /early-access/api/admin/launch` - Send launch announcements

Generate a secure token and set it as an environment variable:

```env
WAITLIST_ADMIN_TOKEN=your_secure_admin_token_here
```

## Email Templates

The system includes the following email templates:

### 1. Welcome Email
- **Trigger**: After successful waitlist registration
- **Purpose**: Welcome new users and explain what Bucksy does
- **Template**: `EMAIL_TYPE.WELCOME`

### 2. Verification Email
- **Trigger**: After waitlist registration
- **Purpose**: Confirm email address to prevent fake signups
- **Template**: `EMAIL_TYPE.VERIFICATION`
- **Features**: 24-hour expiration link

### 3. Verification Confirmation
- **Trigger**: After successful email verification
- **Purpose**: Confirm verification and set expectations
- **Template**: `EMAIL_TYPE.VERIFICATION_CONFIRMATION`

### 4. Invitation Email
- **Trigger**: When admin invites a user
- **Purpose**: Grant immediate access to Early Access
- **Template**: `EMAIL_TYPE.INVITATION`
- **Features**: 14-day expiration link

### 5. Invitation Reminder
- **Trigger**: When admin resends an invitation
- **Purpose**: Remind user about their pending invitation
- **Template**: `EMAIL_TYPE.INVITATION_REMINDER`
- **Features**: Countdown timer

### 6. Launch Announcement
- **Trigger**: When Bucksy launches to the public
- **Purpose**: Announce public availability
- **Template**: `EMAIL_TYPE.LAUNCH_ANNOUNCEMENT`
- **Features**: Batch sending to all verified users

## Database Schema

The email system creates an `email_logs` table to track all delivery attempts:

```sql
CREATE TABLE email_logs (
  id TEXT PRIMARY KEY,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  email_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'delivered', 'failed', 'bounced')),
  provider_id TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
```

## API Endpoints

### Waitlist Registration
- `POST /early-access/api/waitlist` - Registers user and sends verification email

### Email Verification
- `GET /early-access/api/verify?email=&token=` - Verifies email address
- `POST /early-access/api/verify` - Resends verification email

### Invitation System
- `POST /early-access/api/admin/invite` - Sends invitation (admin only)
- `GET /early-access/api/invite?email=&token=` - Accepts invitation
- `POST /early-access/api/invite` - Resends invitation

### Launch Announcements
- `POST /early-access/api/admin/launch` - Sends launch announcements (admin only)

## Testing

### Development Mode

In development mode (`NODE_ENV=development`), email failures will throw errors to help with debugging:

```bash
NODE_ENV=development wrangler pages dev
```

### Test Mode

Use test mode for launch announcements to send to a small group:

```json
{
  "test": true,
  "testEmails": ["test1@example.com", "test2@example.com"]
}
```

### Monitoring

Monitor email delivery through:

1. **Database logs**: Query the `email_logs` table
2. **Console logs**: Check Wrangler logs for `[email]` entries
3. **Provider dashboards**: Check Resend/SendGrid/Mailgun dashboards

## Error Handling

### Common Issues

1. **API Key Invalid**
   - Check provider dashboard for valid API key
   - Verify environment variables are set correctly

2. **Domain Not Verified**
   - Verify your domain in the provider dashboard
   - Check DNS records if required

3. **Rate Limiting**
   - Provider may have sending limits
   - Implement batching with delays for large sends

4. **Email Bounces**
   - Check provider bounce handling
   - Update database for bounced emails

### Retry Logic

The system implements retry logic for:
- Network failures
- Temporary provider errors
- Rate limiting

Permanent failures (invalid email, authentication errors) are logged but not retried.

## Security Considerations

1. **Admin Token**
   - Use a long, random token
   - Rotate periodically
   - Store securely in environment variables

2. **Email Validation**
   - All emails are normalized and validated
   - Disposable email domains are blocked
   - Role addresses (support@, admin@) are blocked

3. **Token Security**
   - Verification tokens are SHA-256 hashed
   - Tokens are bound to email addresses
   - Short expiration times prevent replay attacks

## Cost Optimization

### Provider Pricing

1. **Resend**
   - Free tier: 100 emails/day
   - Paid: $0.10 per email

2. **SendGrid**
   - Free tier: 100 emails/day
   - Paid: $9.95/month for 100 emails

3. **Mailgun**
   - Free tier: 5,000 emails/month
   - Paid: Starting at $35/month

### Batch Sending

For large sends (launch announcements):
- Use batch sizes appropriate for your provider
- Implement delays between batches
- Monitor delivery rates to avoid throttling

## Compliance

### Privacy

- All emails include unsubscribe links
- Personal data is minimized
- Logs are purged according to privacy policy

### CAN-SPAM

- Include physical address in footer
- Provide clear unsubscribe mechanism
- Don't use deceptive subject lines

### GDPR

- Obtain explicit consent for marketing emails
- Include clear privacy policy
- Allow data access and deletion

## Troubleshooting

### Debug Mode

Enable debug logging:

```bash
NODE_ENV=development LOG_LEVEL=debug wrangler pages dev
```

### Common Error Messages

1. **"Email delivery failed: Provider error"**
   - Check API key and authentication
   - Verify domain configuration

2. **"Email delivery failed: Network error"**
   - Check internet connection
   - Verify provider API is accessible

3. **"Invalid email address"**
   - Check email format
   - Verify domain is not in blocked list

### Testing Email Delivery

Test individual email endpoints:

```bash
# Test welcome email
curl -X POST https://bucksy.life/early-access/api/waitlist \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","turnstileToken":"test"}'

# Test admin invitation
curl -X POST https://bucksy.life/early-access/api/admin/invite \
  -H "Content-Type: application/json" \
  -H "x-admin-token: your_admin_token" \
  -d '{"email":"test@example.com","name":"Test User"}'
```

## Migration from Previous System

If upgrading from the previous console-based system:

1. Set up your chosen email provider
2. Add the required environment variables
3. Apply the `0008_email_logs.sql` migration
4. Test email delivery with a test user
5. Monitor the `email_logs` table for successful deliveries

The system maintains backward compatibility and will continue to work even if email delivery fails.