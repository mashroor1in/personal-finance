# Bucksy Admin Dashboard Configuration

## Overview
The Bucksy Admin Dashboard provides a secure interface for managing the early access program, including waitlist management, email communications, and audit logging.

## Security Requirements

### Environment Variables
The admin dashboard requires the following environment variables to be set:

```bash
# Admin Authentication
ADMIN_TOKEN=your_secure_admin_token_here

# Email Provider Configuration (for sending emails)
WAITLIST_EMAIL_PROVIDER=resend  # Options: resend, sendgrid, mailgun
RESEND_API_KEY=your_resend_api_key
SENDGRID_API_KEY=your_sendgrid_api_key
MAILGUN_API_KEY=your_mailgun_api_key
WAITLIST_FROM_EMAIL=noreply@bucksy.life

# Database Configuration
DB_D1=your_database_d1_binding_name
```

### Admin Token
The `ADMIN_TOKEN` is used for authentication with the admin dashboard. It should be:
- At least 32 characters long
- Randomly generated
- Kept secret and not committed to version control

You can generate a secure token using:
```bash
openssl rand -base64 32
```

## Database Schema

The admin system requires the following tables:

### 1. `admin_actions` Table
Tracks all administrative actions for audit purposes.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Unique identifier for the action |
| admin_id | TEXT | ID of the admin performing the action |
| admin_email | TEXT | Email of the admin performing the action |
| action | TEXT | Description of the action performed |
| data | TEXT | JSON data associated with the action |
| created_at | INTEGER | Timestamp when the action was performed |

### 2. Existing Tables
The admin system also requires the existing tables:
- `waitlist` - User registrations
- `email_logs` - Email delivery logs

## API Endpoints

### Authentication
- `POST /admin/login` - Authenticate admin and get session token
- `GET /admin` - Admin dashboard (requires authentication)

### Dashboard APIs
- `GET /admin/api/dashboard` - Dashboard overview data
- `GET /admin/api/waitlist` - Waitlist management data
- `POST /admin/api/waitlist/bulk-action` - Bulk actions on waitlist
- `GET /admin/api/emails` - Email delivery history
- `POST /admin/api/emails/resend` - Resend specific emails
- `GET /admin/api/countries` - Country distribution data
- `POST /admin/api/invite` - Send invitations to users
- `POST /admin/api/resend-verification/:userId` - Resend verification to specific user
- `POST /admin/api/resend-email/:emailId` - Resend specific email
- `GET /admin/api/audit` - Administrative audit logs
- `POST /admin/api/audit/export` - Export audit logs to CSV

## Features

### 1. Overview Dashboard
- Total waitlist registrations
- Verified registrations
- Pending registrations
- Invitations sent
- Users who joined the application
- Signup growth over time
- Referral analytics

### 2. Waitlist Management
- View all registrations
- Search by name or email
- Filter by country and registration status
- Sort by signup date
- View individual registration details
- Export registrations to CSV

### 3. Invitation Management
- Select individual users
- Invite multiple users
- Generate secure invitation codes
- Set invitation expiry
- Track invitation acceptance
- Resend invitations

### 4. Referral Analytics
- Total referrals
- Top referrers
- Successful referrals
- Referral conversion rate

### 5. Communication Management
- View email delivery history
- View failed notifications
- Resend eligible transactional emails

### 6. Audit Logs
- Record administrative actions
- Track invitation and status changes
- Include timestamps and administrator identity

## Security Features

### 1. Authentication
- Token-based authentication for all admin endpoints
- Secure session management
- Protection against brute force attacks

### 2. Authorization
- All admin endpoints require valid authentication
- No sensitive data exposure
- Server-side validation of all parameters

### 3. Audit Logging
- Complete audit trail of all administrative actions
- Timestamped records with admin identity
- Export capabilities for compliance

### 4. Data Protection
- No unnecessary exposure of sensitive user information
- Secure handling of user data
- Proper error handling that doesn't expose details

## Email Integration

The admin dashboard integrates with the email delivery system to:
- Send verification emails
- Send invitation emails
- Send launch announcements
- Track email delivery status
- Resend failed emails

### Supported Email Providers
- Resend
- SendGrid
- Mailgun

## Deployment

### 1. Apply Database Migration
```bash
# Apply the admin tables migration
wrangler d1 execute bucksy-db --file=./migrations/0009_admin_tables.sql
```

### 2. Set Environment Variables
```bash
# Set admin token (generate a secure one)
ADMIN_TOKEN=your_secure_token_here

# Set email provider configuration
WAITLIST_EMAIL_PROVIDER=resend
RESEND_API_KEY=your_resend_api_key
WAITLIST_FROM_EMAIL=noreply@bucksy.life
```

### 3. Test the Admin Dashboard
1. Navigate to `/admin/login`
2. Enter the admin token
3. Access the dashboard at `/admin`

## Best Practices

### 1. Security
- Use a strong, randomly generated admin token
- Regularly rotate the admin token
- Monitor audit logs for suspicious activity
- Use HTTPS for all communications

### 2. Performance
- Use pagination for large datasets
- Implement proper caching for dashboard data
- Optimize database queries for performance

### 3. Monitoring
- Monitor email delivery rates
- Track admin login attempts
- Set up alerts for unusual activity
- Regularly review audit logs

### 4. Maintenance
- Regular database backups
- Keep email provider credentials updated
- Monitor for security vulnerabilities
- Update dependencies regularly

## Troubleshooting

### Common Issues

1. **Admin Login Fails**
   - Verify the ADMIN_TOKEN is set correctly
   - Check that the token is at least 32 characters long
   - Ensure no extra whitespace in the token

2. **Email Delivery Issues**
   - Verify email provider API keys are correct
   - Check email provider dashboard for delivery issues
   - Review email_logs table for error details

3. **Database Connection Issues**
   - Verify the DB_D1 environment variable is set
   - Check database permissions
   - Ensure the database is accessible

### Debug Mode
For development, you can enable debug logging by setting:
```bash
DEBUG=admin:*  # Enable admin-related debug logging
```

## Support

For issues or questions regarding the admin dashboard:
- Check the audit logs for clues
- Review error messages in the console
- Ensure all environment variables are correctly set
- Contact the development team for assistance