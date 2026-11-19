# Bucksy Early Access Landing Page

A premium fintech landing page for Bucksy's early access program, designed to collect waitlist registrations and attract a global audience.

## Features

- **Premium Design**: Modern, minimal, professional aesthetic following Bucksy's brand identity
- **Fully Responsive**: Works seamlessly on desktop, tablet, and mobile devices
- **SEO Optimized**: Meta descriptions, Open Graph tags, and structured data
- **Accessible Forms**: Proper labels, error messages, loading states, and keyboard navigation
- **Analytics Ready**: Google Analytics integration with event tracking
- **API Integration**: Real waitlist signup functionality
- **Brand Consistency**: Follows Bucksy's color palette, typography, and design system

## Page Structure

1. **Hero Section**
   - Brand logo
   - Headline: "Your money. Your goals. Your control."
   - Supporting description
   - Email signup form with "Join the Waitlist" CTA

2. **Product Showcase**
   - Dashboard preview
   - Transaction management
   - Spending analytics
   - Uses icon placeholders (can be replaced with actual screenshots)

3. **Features Section**
   - Expense tracking
   - Income management
   - Budget planning
   - Spending analytics
   - Financial organization
   - Savings goals

4. **Early Access Benefits**
   - Priority access
   - Founding member pricing
   - Influence product development
   - Early feature access

5. **FAQ Section**
   - Expandable questions and answers
   - Keyboard navigation support
   - Smooth animations

6. **Final CTA**
   - Bottom section with email signup
   - Reinforces value proposition

7. **Footer**
   - Company links
   - Legal information
   - Copyright notice

## Technical Implementation

### Files
- `early-access.html` - Main landing page
- `functions/early-access/api/waitlist.js` - Waitlist API endpoint
- `early-access-og-image.jpg` - Open Graph image placeholder

### API Endpoint
- **URL**: `/early-access/api/waitlist`
- **Method**: POST
- **Content-Type**: application/json
- **Body**: `{ email: string }`
- **Response**: 
  ```json
  {
    "success": true,
    "message": "Successfully joined the waitlist",
    "email": "user@example.com",
    "timestamp": "2026-11-21T..."
  }
  ```

### Analytics Tracking
- Page views
- Form submissions
- FAQ interactions
- Custom events for user behavior

### Brand Assets
- Uses official Bucksy logo from `brand/assets/bucksy-mark-large.png`
- Follows brand color palette:
  - Pine: #0B3D2E
  - Fern: #18815A
  - Cream: #F9F6EE
  - Stone: #E6E1D7
- Inter font family

## Deployment

The landing page is automatically deployed with the main application to Cloudflare Pages.

### Local Testing
1. Open `early-access.html` in a browser
2. Test form submissions (will log to console)
3. Verify responsive design on different devices
4. Check accessibility with keyboard navigation

### Production Deployment
- The page is served at `/early-access`
- API endpoint is available at `/early-access/api/waitlist`
- Middleware is configured to allow the route
- Analytics tracking is active

## Customization

### Update Analytics ID
Replace `G-XXXXXXXXXX` in the HTML with your actual Google Analytics ID.

### Update API Integration
In production, update the API endpoint to:
- Store emails in a database
- Integrate with a mailing service (Mailchimp, etc.)
- Send confirmation emails
- Track analytics

### Update Content
- Modify text content in the HTML
- Update feature descriptions
- Change FAQ questions and answers
- Adjust branding colors if needed

### Add Screenshots
Replace the placeholder icons with actual app screenshots by:
1. Taking screenshots of the Bucksy application
2. Adding them to the `assets/` directory
3. Updating the `showcase-image` elements

## Security Considerations

- Email validation is implemented
- CORS headers are configured
- Error handling is in place
- Form submissions are logged for debugging

## Accessibility

- Semantic HTML structure
- Proper ARIA labels
- Keyboard navigation support
- Focus management
- Screen reader friendly

## Browser Support

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## License

This landing page is part of the Bucksy project and follows the same license terms.