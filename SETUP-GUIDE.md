# Bucksy Admin Dashboard Setup Guide for Cloudflare Pages

This guide will help you set up the Bucksy admin dashboard on Cloudflare Pages.

## Prerequisites

1. Node.js (v18 or higher)
2. Wrangler CLI installed: `npm install -g wrangler`
3. Cloudflare account
4. Logged into Wrangler: `wrangler login`

## Step 1: Create D1 Database

If you haven't already created a D1 database, run:

```bash
wrangler d1 create bucksy-db
```

This will output a database ID. Save it for the next step.

## Step 2: Update Configuration

### Update wrangler.toml

Replace the content of `wrangler.toml` with:

```toml
# Wrangler configuration for Bucksy project

name = "bucksy"
main = "index.js"
compatibility_date = "2023-12-01"

# D1 Database binding
[[d1_databases]]
binding = "DB" # <--- IMPORTANT: This should match the binding name in your functions
database_name = "bucksy-db"
database_id = "your-database-id-here" # <--- Replace with your actual database ID

# Environment variables
[env.production]
vars = { 
  ADMIN_TOKEN = "your_secure_admin_token_here",
  WAITLIST_EMAIL_PROVIDER = "resend",
  RESEND_API_KEY = "your_resend_api_key_here",
  WAITLIST_FROM_EMAIL = "noreply@bucksy.life"
}
```

### Update pages.toml

Create or update `pages.toml` with:

```toml
# Cloudflare Pages configuration for Bucksy project

[build]
command = "npm run build"  # Or your build command if you have one

[build.environment]
NODE_VERSION = "18"

# Environment variables
[env.production]
vars = { 
  ADMIN_TOKEN = "your_secure_admin_token_here",
  WAITLIST_EMAIL_PROVIDER = "resend",
  RESEND_API_KEY = "your_resend_api_key_here",
  WAITLIST_FROM_EMAIL = "noreply@bucksy.life"
}
```

## Step 3: Apply Database Migrations

Run the migration script:

```bash
# Option 1: Use the migration script
node scripts/migrate-database.js

# Option 2: Run migrations manually
wrangler d1 execute bucksy-db --file=./migrations/0006_waitlist.sql
wrangler d1 execute bucksy-db --file=./migrations/0007_waitlist_verification_sent_at.sql
wrangler d1 execute bucksy-db --file=./migrations/0008_email_logs.sql
wrangler d1 execute bucksy-db --file=./migrations/0009_admin_tables.sql
```

## Step 4: Set Environment Variables

Set the required environment variables:

```bash
# Generate a secure admin token
openssl rand -base64 32
# Use the output as your ADMIN_TOKEN

# Set email provider configuration
WAITLIST_EMAIL_PROVIDER=resend
RESEND_API_KEY=your_resend_api_key_here
WAITLIST_FROM_EMAIL=noreply@bucksy.life
```

Add these to your `pages.toml` or set them using:
```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put RESEND_API_KEY
```

## Step 5: Deploy Your Pages Project

```bash
# Deploy to Cloudflare Pages
wrangler pages deploy

# Or deploy to a specific branch
wrangler pages deploy --branch main
```

## Step 6: Access the Admin Dashboard

1. Open your browser to `https://your-domain.com/admin/login`
2. Use the admin token you set in the environment variables
3. You should see the Bucksy admin dashboard

## Step 7: Test the Dashboard

### Test Overview Section
- Check that statistics are displayed
- Verify charts are rendering correctly
- Ensure all metrics show data

### Test Waitlist Management
- View the waitlist table
- Test search functionality
- Try filtering by status
- Export data to CSV

### Test Invitation Management
- Select users and send invitations
- Verify emails are sent
- Check invitation status

### Test Audit Logs
- View administrative actions
- Verify timestamps and user information

## Troubleshooting

### Common Issues

#### 1. Database Connection Errors
**Error**: "Couldn't find a D1 DB"
**Solution**: 
- Verify database ID in `wrangler.toml`
- Ensure database exists: `wrangler d1 list`
- Check binding name matches in functions

#### 2. Authentication Issues
**Error**: "Invalid credentials"
**Solution**:
- Verify `ADMIN_TOKEN` is set correctly
- Check token is at least 32 characters
- Ensure no extra whitespace in token

#### 3. Email Delivery Issues
**Error**: Emails not sending
**Solution**:
- Verify email provider API keys
- Check provider dashboard for issues
- Test with `node scripts/test-email.js`

#### 4. Function Errors
**Error**: "Function failed"
**Solution**:
- Check function logs in Cloudflare dashboard
- Verify all required environment variables are set
- Check database schema matches migrations

### Debug Mode

Enable debug logging:

```bash
# Set debug environment variable
wrangler pages deploy --env=development
```

### Database Debugging

Check database contents:

```bash
# List all tables
wrangler d1 execute bucksy-db --command="SELECT name FROM sqlite_master WHERE type='table';"

# Check waitlist data
wrangler d1 execute bucksy-db --command="SELECT * FROM waitlist LIMIT 10;"

# Check admin actions
wrangler d1 execute bucksy-db --command="SELECT * FROM admin_actions LIMIT 10;"
```

## Security Considerations

### Admin Token
- Use a strong, randomly generated token
- Store securely and never commit to version control
- Consider rotating tokens periodically

### Database Security
- Restrict database access to authorized personnel only
- Regularly audit database access logs
- Monitor for unusual patterns

### Environment Variables
- Never expose sensitive information in client-side code
- Use Cloudflare secrets for sensitive data
- Regularly review and rotate API keys

## Maintenance

### Regular Tasks

1. **Database Maintenance**
   - Regular backups
   - Performance optimization
   - Data cleanup

2. **Security Updates**
   - Regular token rotation
   - Security patches
   - Provider API updates

3. **Monitoring**
   - Monitor email delivery rates
   - Track admin login attempts
   - Monitor for unusual patterns

### Backup and Recovery

```bash
# Create database backup
wrangler d1 export bucksy-db --local > backup-$(date +%Y%m%d).sql

# Restore from backup
wrangler d1 execute bucksy-db --local --file=backup-YYYYMMDD.sql
```

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review function logs in Cloudflare dashboard
3. Verify all environment variables are set correctly
4. Check database schema matches migrations

## Next Steps

1. Set up email provider (Resend, SendGrid, or Mailgun)
2. Configure custom domain for Pages
3. Set up monitoring and alerts
4. Create user documentation
5. Implement additional security measures