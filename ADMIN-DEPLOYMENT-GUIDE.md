# Bucksy Admin Dashboard - Cloudflare Pages Deployment Guide

This guide will walk you through deploying the Bucksy admin dashboard to Cloudflare Pages production.

## Prerequisites

1. Cloudflare account with Pages access
2. GitHub repository connected to Cloudflare
3. Admin token generated (`mehgEdEV3aeASWuaqvgsJK0NfziQev2B`)
4. D1 database created and migrations applied

## Step 1: Connect GitHub Repository to Cloudflare Pages

1. Go to the [Cloudflare Pages dashboard](https://pages.cloudflare.com/)
2. Click "Create project"
3. Select "Connect to Git"
4. Choose your GitHub repository (`mashroor1in/personal-finance`)
5. Click "Begin setup"

## Step 2: Configure Build Settings

In the Cloudflare Pages setup screen:

1. **Project name**: `bucksy-admin`
2. **Build command**: `npm run build` (or leave empty as we don't need a build step)
3. **Build output directory**: `public` (or leave empty)
4. **Root directory**: `/` (default)

## Step 3: Configure Environment Variables

In the "Environment variables" section, add the following variables:

```
ADMIN_TOKEN=mehgEdEV3aeASWuaqvgsJK0NfziQev2B
WAITLIST_EMAIL_PROVIDER=resend
RESEND_API_KEY=your_resend_api_key_here
WAITLIST_FROM_EMAIL=noreply@bucksy.life
```

**Note**: Replace `your_resend_api_key_here` with your actual Resend API key when you're ready to send emails.

## Step 4: Configure D1 Database Binding

Cloudflare Pages doesn't have direct D1 binding like Workers, but we can access it through environment variables.

1. In your Cloudflare dashboard, go to your D1 database
2. Note your database ID and name
3. Add these environment variables if needed:
   ```
   DATABASE_ID=your_database_id_here
   DATABASE_NAME=your_database_name_here
   ```

## Step 5: Deploy

1. Click "Save and Deploy"
2. Cloudflare will build and deploy your project
3. You'll see a progress screen showing the deployment status
4. Once complete, you'll get a URL like `https:// bucksy-admin.pages.dev`

## Step 6: Test the Admin Dashboard

Once deployed, test the admin dashboard:

1. **Access the admin page**: `https:// bucksy-admin.pages.dev/admin`
2. **Test login**: 
   - Click the "Access Dashboard" button
   - Use the admin token: `mehgEdEV3aeASWuaqvgsJK0NfziQev2B`
3. **Test dashboard API**: 
   - The dashboard should show waitlist statistics
   - Verify all UI elements are working

## Step 7: Configure Custom Domain (Optional)

If you want to use a custom domain:

1. In your Cloudflare Pages project settings
2. Go to "Custom domains"
3. Add your domain (e.g., `admin.bucksy.life`)
4. Follow the DNS configuration instructions

## Step 8: Set Up Redirects (Optional)

If you want to redirect from `admin.bucksy.life` to your Pages project:

1. In your Cloudflare dashboard, go to "Rules" > "Transform Rules"
2. Create a rule to redirect `/admin` to your Pages URL

## Troubleshooting

### Common Issues

1. **Build Errors**:
   - Check that all files are in the correct location
   - Verify your package.json has the correct scripts
   - Ensure all dependencies are installed

2. **Environment Variables Not Working**:
   - Verify the variable names and values are correct
   - Make sure you're using the correct environment (Production/Preview)
   - Check for any typos in variable names

3. **Admin Login Not Working**:
   - Ensure the ADMIN_TOKEN is set correctly
   - Check that the token matches what's expected in the code
   - Verify the Authorization header format: `Bearer <token>`

4. **Database Connection Issues**:
   - Ensure your D1 database is properly configured
   - Check that your database ID and name are correct
   - Verify you have the necessary permissions

### Debug Commands

You can test your deployment locally with these commands:

```bash
# Test admin login
curl -X POST https:// bucksy-admin.pages.dev/admin/login \
  -H "Authorization: Bearer mehgEdEV3aeASWuaqvgsJK0NfziQev2B" \
  -H "Content-Type: application/json"

# Test dashboard API
curl -X GET https:// bucksy-admin.pages.dev/admin/dashboard \
  -H "Authorization: Bearer mehgEdEV3aeASWuaqvgsJK0NfziQev2B" \
  -H "Content-Type: application/json"
```

## Post-Deployment Checklist

Once deployed, verify:

- [ ] Admin page loads correctly
- [ ] Login functionality works
- [ ] Dashboard API returns data
- [ ] All UI elements are functional
- [ ] Error messages display correctly
- [ ] Responsive design works on mobile
- [ ] Custom domain (if configured) works

## Security Considerations

1. **Admin Token Security**:
   - Keep your admin token secure
   - Rotate it periodically
   - Never commit it to public repositories

2. **Environment Variables**:
   - Use production-specific environment variables
   - Don't use development tokens in production
   - Regularly audit your environment variables

3. **Access Control**:
   - Restrict access to the admin dashboard
   - Consider adding IP whitelisting
   - Implement rate limiting

## Monitoring and Maintenance

1. **Monitor Deployments**:
   - Check deployment logs for errors
   - Monitor performance metrics
   - Set up alerts for failed deployments

2. **Regular Updates**:
   - Keep dependencies updated
   - Regularly check for security patches
   - Update Wrangler CLI when new versions are available

3. **Backup and Recovery**:
   - Regularly backup your D1 database
   - Keep deployment logs for troubleshooting
   - Have a rollback plan for critical issues

## Next Steps

Once the admin dashboard is deployed and working:

1. **Gather Feedback**: Collect feedback from users and make improvements
2. **Enhance Features**: Add more advanced admin functionality
3. **Integrate with Email Provider**: Set up actual email delivery
4. **Add Analytics**: Implement more detailed analytics and reporting
5. **Phase 4 - Identity System**: Start building user authentication and profiles

## Support

If you encounter issues:

1. Check the Cloudflare Pages documentation
2. Review Wrangler CLI documentation
3. Check GitHub issues for similar problems
4. Open an issue in the project repository if needed