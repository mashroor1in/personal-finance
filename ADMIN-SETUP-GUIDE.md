# Bucksy Admin Dashboard Setup Guide

This guide provides step-by-step instructions for setting up and deploying the Bucksy admin dashboard to Cloudflare Pages.

## Prerequisites

1. Cloudflare account with Pages and D1 database access
2. Wrangler CLI installed (`npm install -g wrangler`)
3. Git repository initialized
4. Admin token generated

## Step 1: Database Setup

### 1.1 Create D1 Database

If you haven't already created a D1 database, run:

```bash
wrangler d1 create bucksy-db
```

Follow the prompts to create your database. Note down the database ID and name.

### 1.2 Apply Migrations

Run the following commands to apply all migrations:

```bash
wrangler d1 execute bucksy-db --file=./migrations/0006_waitlist.sql
wrangler d1 execute bucksy-db --file=./migrations/0007_waitlist_verification_sent_at.sql
wrangler d1 execute bucksy-db --file=./migrations/0008_email_logs.sql
wrangler d1 execute bucksy-db --file=./migrations/0009_admin_tables.sql
```

### 1.3 Add Sample Data (Optional)

Add some sample data for testing:

```bash
wrangler d1 execute bucksy-db --command="INSERT INTO waitlist (id, email, name, status, created_at, updated_at) VALUES ('sample-user-1', 'user1@example.com', 'Alice Johnson', 'verified', 1698765432100, 1698765432100);"
wrangler d1 execute bucksy-db --command="INSERT INTO waitlist (id, email, name, status, created_at, updated_at) VALUES ('sample-user-2', 'user2@example.com', 'Bob Smith', 'pending', 1698765432100, 1698765432100);"
wrangler d1 execute bucksy-db --command="INSERT INTO waitlist (id, email, name, status, created_at, updated_at) VALUES ('sample-user-3', 'user3@example.com', 'Carol Davis', 'verified', 1698765432100, 1698765432100);"
wrangler d1 execute bucksy-db --command="INSERT INTO admin_actions (id, admin_id, admin_email, action, data, created_at) VALUES ('sample-action-1', 'admin', 'admin@bucksy.life', 'Test dashboard access', '{}', 1698765432100);"
```

## Step 2: Configure Wrangler

### 2.1 Update wrangler.toml

Update your `wrangler.toml` file with your D1 database binding:

```toml
name = "bucksy-pages"
compatibility_date = "2023-12-01"

[build]
command = "npm run build"

[build.environment]
NODE_VERSION = "18"

# D1 Database
[[d1_databases]]
binding = "bucksy_db"
database_id = "YOUR_DATABASE_ID"
database_name = "bucksy-db"
```

Replace `YOUR_DATABASE_ID` with your actual database ID.

### 2.2 Update pages.toml

Update your `pages.toml` file with environment variables:

```toml
[build]
command = "npm run build"

[build.environment]
NODE_VERSION = "18"

# Environment variables
[env.production]
vars = { 
  ADMIN_TOKEN = "mehgEdEV3aeASWuaqvgsJK0NfziQev2B",
  WAITLIST_EMAIL_PROVIDER = "resend",
  RESEND_API_KEY = "your_resend_api_key_here",
  WAITLIST_FROM_EMAIL = "noreply@bucksy.life"
}
```

Replace `your_resend_api_key_here` with your actual Resend API key.

## Step 3: Environment Variables

### 3.1 Required Variables

Make sure you have the following environment variables set:

- `ADMIN_TOKEN`: Your admin authentication token
- `WAITLIST_EMAIL_PROVIDER`: Email provider (e.g., "resend")
- `RESEND_API_KEY`: API key for your email provider
- `WAITLIST_FROM_EMAIL`: Default sender email address

### 3.2 Optional Variables

You can also set these optional variables:

- `WAITLIST_ADMIN_EMAIL`: Email address for admin notifications
- `WAITLIST_MAX_INVITES`: Maximum number of invites per batch
- `WAITLIST_INVITE_EXPIRY_DAYS`: Default expiry days for invites

## Step 4: Deployment

### 4.1 Create GitHub Repository

If you haven't already, create a GitHub repository for your project:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/bucksy-pages.git
git push -u origin main
```

### 4.2 Connect to Cloudflare Pages

1. Go to the Cloudflare Pages dashboard
2. Click "Create project"
3. Select "Connect to Git"
4. Choose your GitHub repository
5. Configure the build settings:
   - Build command: `npm run build`
   - Build output directory: `public`
   - Root directory: `/`
6. Click "Save and Deploy"

### 4.3 Environment Configuration

After the initial deployment, configure your environment variables:

1. Go to your Pages project settings
2. Navigate to "Environment variables"
3. Add the variables from Step 3
4. Click "Save and Deploy"

## Step 5: Testing

### 5.1 Access the Admin Dashboard

Once deployed, access your admin dashboard at:
`https://your-project-name.pages.dev/admin`

### 5.2 Test Authentication

1. Click the "Admin Login" button
2. Enter your admin token: `mehgEdEV3aeASWuaqvgsJK0NfziQev2B`
3. Verify you can access the dashboard

### 5.3 Test Functionality

Test the following features:

1. **Waitlist Management**
   - View waitlist users
   - Search and filter users
   - Export waitlist data

2. **Email Communication**
   - View email logs
   - Check delivery statistics
   - Resend failed emails

3. **Audit Logging**
   - View admin actions
   - Export audit logs
   - Filter by date/action

4. **Invitation Management**
   - View country distribution
   - Send bulk invitations
   - Resend verification emails

### 5.4 Run Automated Tests

If you want to run automated tests, you can use the test script:

```bash
node test-admin-dashboard.js
```

Note: This requires the dashboard to be running at `http://localhost:8787` for local testing.

## Step 6: Security Considerations

### 6.1 Admin Token Security

- Store your admin token securely
- Consider using environment variables instead of hardcoding
- Rotate your token periodically

### 6.2 Database Security

- Use strong, unique database credentials
- Implement proper access controls
- Regularly backup your database

### 6.3 Email Provider Security

- Use API keys with minimal required permissions
- Monitor email usage to prevent abuse
- Implement rate limiting if necessary

## Step 7: Maintenance

### 7.1 Regular Backups

Create regular backups of your database:

```bash
wrangler d1 execute bucksy-db --command="SELECT * FROM waitlist" > backup-$(date +%Y%m%d).sql
wrangler d1 execute bucksy-db --command="SELECT * FROM admin_actions" >> backup-$(date +%Y%m%d).sql
```

### 7.2 Monitoring

Monitor your dashboard for:
- Performance issues
- Error rates
- Unusual activity patterns
- Email delivery failures

### 7.3 Updates

Regularly update:
- Dependencies (`npm update`)
- Wrangler CLI
- Cloudflare Pages features

## Troubleshooting

### Common Issues

1. **Database Connection Issues**
   - Verify your D1 binding is correct in wrangler.toml
   - Ensure your database is created and accessible
   - Check your database ID and name

2. **Authentication Issues**
   - Verify your admin token is correct
   - Check that the token is properly set in environment variables
   - Ensure the token is being passed in the Authorization header

3. **Email Delivery Issues**
   - Verify your email provider API key is correct
   - Check that your email provider is properly configured
   - Monitor email logs for delivery failures

4. **Build/Deploy Issues**
   - Check your build command and output directory
   - Ensure all dependencies are installed
   - Verify your environment variables are set correctly

### Debug Mode

For debugging, you can enable debug mode:

```bash
wrangler pages dev --debug
```

This will provide more detailed logs and error information.

## Support

If you encounter issues not covered in this guide:

1. Check the Cloudflare Pages documentation
2. Review the Wrangler CLI documentation
3. Open an issue in the project repository
4. Contact the development team

## Additional Resources

- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
- [Wrangler CLI Documentation](https://developers.cloudflare.com/workers/wrangler/)
- [D1 Database Documentation](https://developers.cloudflare.com/d1/)
- [Resend Email API Documentation](https://resend.com/docs)