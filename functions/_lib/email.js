/**
 * Bucksy Email Delivery System
 * 
 * Provides a unified interface for sending transactional and marketing emails
 * with proper branding, logging, and error handling.
 * 
 * Supports multiple providers through a common interface.
 */

import { json } from "./common.js";

// Email provider interfaces
const PROVIDER = Object.freeze({
  RESEND: "resend",
  SENDGRID: "sendgrid",
  MAILGUN: "mailgun",
});

// Email types for different workflows
export const EMAIL_TYPE = Object.freeze({
  WELCOME: "welcome",
  VERIFICATION: "verification",
  VERIFICATION_CONFIRMATION: "verification_confirmation",
  INVITATION: "invitation",
  INVITATION_REMINDER: "invitation_reminder",
  LAUNCH_ANNOUNCEMENT: "launch_announcement",
});

// Default template content
const TEMPLATES = {
  [EMAIL_TYPE.WELCOME]: {
    subject: "Welcome to Bucksy — Your Expense Planning Journey Starts Here",
    preheader: "Let's get your finances in order, one month at a time.",
  },
  [EMAIL_TYPE.VERIFICATION]: {
    subject: "Confirm your email for Bucksy Early Access",
    preheader: "One last step to secure your spot in the waitlist.",
  },
  [EMAIL_TYPE.VERIFICATION_CONFIRMATION]: {
    subject: "Your Bucksy Early Access is Confirmed!",
    preheader: "You're all set. We'll notify you when we're ready.",
  },
  [EMAIL_TYPE.INVITATION]: {
    subject: "You're In! Your Bucksy Early Access Invitation is Ready",
    preheader: "Your exclusive invitation to Bucksy is waiting for you.",
  },
  [EMAIL_TYPE.INVITATION_REMINDER]: {
    subject: "Your Bucksy Invitation Expires Soon",
    preheader: "Don't miss your chance to join Early Access.",
  },
  [EMAIL_TYPE.LAUNCH_ANNOUNCEMENT]: {
    subject: "Bucksy is Here! Track, Plan, and Grow Your Finances",
    preheader: "The expense planner that adapts to your life is now live.",
  },
};

/**
 * Email delivery configuration and factory
 */
export class EmailProvider {
  constructor(env) {
    this.env = env;
    this.provider = env.WAITLIST_EMAIL_PROVIDER || PROVIDER.RESEND;
    this.config = this.getConfig();
  }

  getConfig() {
    switch (this.provider) {
      case PROVIDER.RESEND:
        return {
          apiKey: this.env.RESEND_API_KEY,
          from: this.env.WAITLIST_FROM_EMAIL || "noreply@bucksy.life",
          api: "https://api.resend.com/emails",
        };
      case PROVIDER.SENDGRID:
        return {
          apiKey: this.env.SENDGRID_API_KEY,
          from: this.env.WAITLIST_FROM_EMAIL || "noreply@bucksy.life",
          api: "https://api.sendgrid.com/v3/mail/send",
        };
      case PROVIDER.MAILGUN:
        return {
          apiKey: this.env.MAILGUN_API_KEY,
          domain: this.env.MAILGUN_DOMAIN,
          from: this.env.WAITLIST_FROM_EMAIL || "noreply@bucksy.life",
          api: `https://api.mailgun.net/v3/${this.env.MAILGUN_DOMAIN}/messages`,
        };
      default:
        throw new Error(`Unsupported email provider: ${this.provider}`);
    }
  }

  /**
   * Send an email with the given parameters
   */
  async send(to, subject, html, text = null, options = {}) {
    const email = this.buildEmail(to, subject, html, text, options);
    
    try {
      const response = await fetch(this.config.api, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(email),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Provider error: ${response.status} - ${errorBody}`);
      }

      const result = await response.json();
      return {
        success: true,
        id: result.id || result.messageId || null,
        provider: this.provider,
      };
    } catch (error) {
      throw new Error(`Email delivery failed: ${error.message}`);
    }
  }

  /**
   * Build email payload for the specific provider
   */
  buildEmail(to, subject, html, text, options) {
    const base = {
      to,
      from: this.config.from,
      subject,
      html,
      ...(text && { text }),
    };

    switch (this.provider) {
      case PROVIDER.RESEND:
        return {
          ...base,
          from: this.config.from,
          tags: options.tags || [],
          cc: options.cc || [],
          bcc: options.bcc || [],
        };
      case PROVIDER.SENDGRID:
        return {
          personalizations: [{ to: [{ email: to }], cc: options.cc || [], bcc: options.bcc || [] }],
          from: { email: this.config.from },
          subject,
          content: [
            { type: "text/html", value: html },
            ...(text ? [{ type: "text/plain", value: text }] : []),
          ],
          categories: options.tags || [],
        };
      case PROVIDER.MAILGUN:
        const formData = new FormData();
        formData.append("to", to);
        formData.append("from", this.config.from);
        formData.append("subject", subject);
        formData.append("html", html);
        if (text) formData.append("text", text);
        if (options.cc) options.cc.forEach(email => formData.append("h:cc", email));
        if (options.bcc) options.bcc.forEach(email => formData.append("h:bcc", email));
        if (options.tags) options.tags.forEach(tag => formData.append("h:tag", tag));
        return formData;
      default:
        throw new Error(`Unsupported provider: ${this.provider}`);
    }
  }

  /**
   * Get provider-specific headers
   */
  getHeaders() {
    switch (this.provider) {
      case PROVIDER.RESEND:
        return {
          "Authorization": `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        };
      case PROVIDER.SENDGRID:
        return {
          "Authorization": `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        };
      case PROVIDER.MAILGUN:
        return {
          "Authorization": `Basic ${btoa(`api:${this.config.apiKey}`)}`,
        };
      default:
        throw new Error(`Unsupported provider: ${this.provider}`);
    }
  }
}

/**
 * Email template renderer with Bucksy branding
 */
export class EmailTemplate {
  constructor(type, data = {}) {
    this.type = type;
    this.data = data;
    this.template = TEMPLATES[type];
    if (!this.template) {
      throw new Error(`Unknown email template type: ${type}`);
    }
  }

  /**
   * Render HTML email with Bucksy branding
   */
  renderHTML() {
    const { subject, preheader } = this.template;
    const { name, verificationLink, invitationLink, unsubscribeLink, countdown } = this.data;

    // Bucksy brand colors and styles
    const styles = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.6; color: #102F27; background: #F9F6EE; }
        .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
        .header { text-align: center; margin-bottom: 40px; }
        .logo { width: 80px; height: auto; margin-bottom: 16px; }
        .wordmark { font-family: Inter, sans-serif; font-weight: 800; font-size: 32px; letter-spacing: -0.075em; line-height: 1.2; color: #0B3D2E; }
        .tagline { font-family: Inter, sans-serif; font-weight: 600; font-size: 14px; letter-spacing: 0.23em; text-transform: uppercase; color: #18815A; margin-top: 4px; }
        .content { background: white; border-radius: 12px; padding: 40px; margin-bottom: 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .content h1 { font-family: Inter, sans-serif; font-weight: 800; font-size: 28px; line-height: 1.3; color: #0B3D2E; margin-bottom: 20px; }
        .content p { font-size: 16px; line-height: 1.6; color: #102F27; margin-bottom: 20px; }
        .content p:last-child { margin-bottom: 0; }
        .button { display: inline-block; padding: 16px 32px; background: #0B3D2E; color: #F9F6EE; text-decoration: none; border-radius: 8px; font-family: Inter, sans-serif; font-weight: 600; font-size: 16px; text-align: center; transition: background 0.2s; }
        .button:hover { background: #18815A; }
        .button.secondary { background: transparent; color: #0B3D2E; border: 2px solid #0B3D2E; }
        .button.secondary:hover { background: #0B3D2E; color: #F9F6EE; }
        .footer { text-align: center; font-size: 14px; color: #648177; }
        .footer a { color: #18815A; text-decoration: none; }
        .divider { height: 1px; background: #E6E1D7; margin: 30px 0; }
        .highlight { background: #EDF4EC; padding: 20px; border-radius: 8px; border-left: 4px solid #18815A; }
        .countdown { background: #FFFDF8; border: 1px solid #F7931A; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0; }
        .countdown strong { color: #F7931A; }
      </style>
    `;

    const logo = `https://bucksy.life/assets/mark.svg`;
    const bucksyUrl = "https://bucksy.life";

    // Template-specific content
    let content = "";
    switch (this.type) {
      case EMAIL_TYPE.WELCOME:
        content = `
          <p>Hi ${name || "there"},</p>
          <p>Welcome to Bucksy! We're excited to help you take control of your monthly expenses and plan for a brighter financial future.</p>
          <p>Bucksy makes it simple to track where your money goes, plan for upcoming expenses, and watch your financial health grow over time.</p>
          <div class="highlight">
            <p><strong>What you can do with Bucksy:</strong></p>
            <ul style="margin-left: 20px; margin-bottom: 0;">
              <li>Track all your monthly expenses in one place</li>
              <li>Set realistic budgets for different categories</li>
              <li>See exactly how much you have left to spend</li>
              <li>Plan for future expenses with ease</li>
            </ul>
          </div>
          <p>Your spot in our Early Access waitlist is secured. We'll be in touch soon with next steps.</p>
        `;
        break;

      case EMAIL_TYPE.VERIFICATION:
        content = `
          <p>Hi ${name || "there"},</p>
          <p>Thanks for joining the Bucksy waitlist! To secure your spot in our Early Access program, please confirm your email address.</p>
          <p>This verification helps us ensure we're building a product that truly meets your needs.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationLink}" class="button">Confirm Your Email</a>
          </div>
          <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
          <p style="background: #F5F5F5; padding: 12px; border-radius: 4px; font-family: monospace; word-break: break-all;">${verificationLink}</p>
          <p>This link will expire in 24 hours for security reasons.</p>
        `;
        break;

      case EMAIL_TYPE.VERIFICATION_CONFIRMATION:
        content = `
          <p>Hi ${name || "there"},</p>
          <p>Great news! Your email address has been confirmed and your spot in the Bucksy Early Access waitlist is secure.</p>
          <p>We're working hard to make Bucksy the best expense planning experience possible. Your feedback will be invaluable as we refine the product.</p>
          <div class="highlight">
            <p><strong>What happens next:</strong></p>
            <ul style="margin-left: 20px; margin-bottom: 0;">
              <li>We'll continue to improve Bucksy based on early feedback</li>
              <li>You'll receive priority access when we launch</li>
              <li>We'll keep you updated on our progress</li>
            </ul>
          </div>
          <p>Thank you for being part of this journey with us!</p>
        `;
        break;

      case EMAIL_TYPE.INVITATION:
        content = `
          <p>Hi ${name || "there"},</p>
          <p>Exciting news! Your exclusive invitation to Bucksy Early Access is ready.</p>
          <p>You've been selected to join our first wave of users and experience the future of expense planning before anyone else.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${invitationLink}" class="button">Start Using Bucksy Now</a>
          </div>
          <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
          <p style="background: #F5F5F5; padding: 12px; border-radius: 4px; font-family: monospace; word-break: break-all;">${invitationLink}</p>
          <p>This invitation is valid for 14 days. Don't miss your chance to get early access!</p>
        `;
        break;

      case EMAIL_TYPE.INVITATION_REMINDER:
        content = `
          <p>Hi ${name || "there"},</p>
          <p>A friendly reminder that your exclusive invitation to Bucksy Early Access will expire soon.</p>
          ${countdown ? `
          <div class="countdown">
            <p>Your invitation expires in <strong>${countdown}</strong></p>
          </div>
          ` : ''}
          <p>Bucksy is ready to help you take control of your finances with intuitive expense tracking and planning.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${invitationLink}" class="button">Claim Your Access Now</a>
          </div>
          <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
          <p style="background: #F5F5F5; padding: 12px; border-radius: 4px; font-family: monospace; word-break: break-all;">${invitationLink}</p>
        `;
        break;

      case EMAIL_TYPE.LAUNCH_ANNOUNCEMENT:
        content = `
          <p>Hi ${name || "Bucksy enthusiast"},</p>
          <p>We're thrilled to announce that Bucksy is officially live and ready to help you take control of your finances!</p>
          <p>After months of development and valuable feedback from our Early Access users, we're excited to open our doors to everyone.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${bucksyUrl}" class="button">Start Planning Your Finances</a>
          </div>
          <div class="highlight">
            <p><strong>Why Bucksy is different:</strong></p>
            <ul style="margin-left: 20px; margin-bottom: 0;">
              <li>Simple, intuitive expense tracking that actually works</li>
              <li>Smart budget planning that adapts to your income</li>
              <li>Beautiful visualizations of your financial health</li>
              <li>100% private - your data stays yours</li>
            </ul>
          </div>
          <p>Thank you for being part of our journey. We can't wait to see how Bucksy helps you grow your financial future!</p>
        `;
        break;

      default:
        content = "<p>We'll be in touch soon.</p>";
    }

    const unsubscribe = unsubscribeLink || `${bucksyUrl}/unsubscribe`;
    const currentYear = new Date().getFullYear();

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="color-scheme" content="light">
        ${styles}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <img src="${logo}" alt="Bucksy logo" class="logo">
            <div class="wordmark">Bucksy</div>
            <div class="tagline">Track. Plan. Grow.</div>
          </div>
          
          <div class="content">
            <h1>${subject}</h1>
            ${preheader ? `<p style="color: #648177; margin-bottom: 30px;">${preheader}</p>` : ''}
            ${content}
          </div>
          
          <div class="divider"></div>
          
          <div class="footer">
            <p>© ${currentYear} Bucksy. All rights reserved.</p>
            <p>
              <a href="${bucksyUrl}">Visit Bucksy</a> • 
              <a href="${unsubscribe}">Unsubscribe</a> • 
              <a href="${bucksyUrl}/privacy">Privacy Policy</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate plain text version
   */
  renderText() {
    const { subject } = this.template;
    const { name, verificationLink, invitationLink, unsubscribeLink, countdown } = this.data;

    let content = "";
    switch (this.type) {
      case EMAIL_TYPE.WELCOME:
        content = `Hi ${name || "there"},\n\nWelcome to Bucksy! We're excited to help you take control of your monthly expenses and plan for a brighter financial future.\n\nBucksy makes it simple to track where your money goes, plan for upcoming expenses, and watch your financial health grow over time.\n\nYour spot in our Early Access waitlist is secured. We'll be in touch soon with next steps.\n\nThank you,\nThe Bucksy Team`;
        break;

      case EMAIL_TYPE.VERIFICATION:
        content = `Hi ${name || "there"},\n\nThanks for joining the Bucksy waitlist! To secure your spot in our Early Access program, please confirm your email address.\n\nThis verification helps us ensure we're building a product that truly meets your needs.\n\nConfirm your email: ${verificationLink}\n\nThis link will expire in 24 hours for security reasons.\n\nThank you,\nThe Bucksy Team`;
        break;

      case EMAIL_TYPE.VERIFICATION_CONFIRMATION:
        content = `Hi ${name || "there"},\n\nGreat news! Your email address has been confirmed and your spot in the Bucksy Early Access waitlist is secure.\n\nWe're working hard to make Bucksy the best expense planning experience possible. Your feedback will be invaluable as we refine the product.\n\nThank you for being part of this journey with us!\n\nThe Bucksy Team`;
        break;

      case EMAIL_TYPE.INVITATION:
        content = `Hi ${name || "there"},\n\nExciting news! Your exclusive invitation to Bucksy Early Access is ready.\n\nYou've been selected to join our first wave of users and experience the future of expense planning before anyone else.\n\nClaim your access: ${invitationLink}\n\nThis invitation is valid for 14 days. Don't miss your chance to get early access!\n\nThank you,\nThe Bucksy Team`;
        break;

      case EMAIL_TYPE.INVITATION_REMINDER:
        content = `Hi ${name || "there"},\n\nA friendly reminder that your exclusive invitation to Bucksy Early Access will expire soon.\n\n${countdown ? `Your invitation expires in ${countdown}.\n\n` : ''}Bucksy is ready to help you take control of your finances with intuitive expense tracking and planning.\n\nClaim your access: ${invitationLink}\n\nThank you,\nThe Bucksy Team`;
        break;

      case EMAIL_TYPE.LAUNCH_ANNOUNCEMENT:
        content = `Hi ${name || "Bucksy enthusiast"},\n\nWe're thrilled to announce that Bucksy is officially live and ready to help you take control of your finances!\n\nAfter months of development and valuable feedback from our Early Access users, we're excited to open our doors to everyone.\n\nStart using Bucksy: https://bucksy.life\n\nThank you for being part of our journey. We can't wait to see how Bucksy helps you grow your financial future!\n\nThe Bucksy Team`;
        break;

      default:
        content = "We'll be in touch soon.";
    }

    const unsubscribe = unsubscribeLink || "https://bucksy.life/unsubscribe";
    const currentYear = new Date().getFullYear();

    return `
Bucksy — Track. Plan. Grow.

${subject}

${content}

---
© ${currentYear} Bucksy. All rights reserved.
https://bucksy.life | Unsubscribe: ${unsubscribe} | Privacy: https://bucksy.life/privacy
    `.trim();
  }
}

/**
 * Email delivery service with logging and retry logic
 */
export class EmailService {
  constructor(env) {
    this.provider = new EmailProvider(env);
    this.env = env;
  }

  /**
   * Send an email with logging and error handling
   */
  async sendEmail(to, type, data = {}, options = {}) {
    const template = new EmailTemplate(type, data);
    const html = template.renderHTML();
    const text = template.renderText();
    const { subject } = template.template;

    try {
      // Log the attempt
      await this.logDelivery({
        to,
        subject,
        type,
        status: "sending",
        options,
      });

      // Send the email
      const result = await this.provider.send(to, subject, html, text, {
        tags: [`waitlist_${type}`],
        ...options,
      });

      // Log success
      await this.logDelivery({
        to,
        subject,
        type,
        status: "delivered",
        provider: this.provider.provider,
        id: result.id,
        options,
      });

      return result;
    } catch (error) {
      // Log failure
      await this.logDelivery({
        to,
        subject,
        type,
        status: "failed",
        error: error.message,
        options,
      });

      // In production, don't fail the entire operation just because email failed
      // This is especially important for transactional emails
      if (this.env.NODE_ENV === "production") {
        console.error(`[email] Failed to send ${type} to ${to}:`, error.message);
        return { success: false, error: error.message };
      } else {
        // In development, rethrow to catch issues
        throw error;
      }
    }
  }

  /**
   * Log email delivery attempts
   */
  async logDelivery(logData) {
    try {
      // Store in database for analytics and debugging
      if (this.env.DB) {
        await this.env.DB.prepare(
          `INSERT INTO email_logs (id, to_address, subject, email_type, status, provider_id, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            crypto.randomUUID(),
            logData.to,
            logData.subject,
            logData.type,
            logData.status,
            logData.provider || null,
            logData.error || null,
            Date.now()
          )
          .run();
      }

      // Also log to console for development
      console.log(`[email] ${logData.status}: ${logData.type} to ${logData.to}`, {
        id: logData.id,
        error: logData.error,
      });
    } catch (error) {
      console.error("[email] Failed to log delivery:", error);
    }
  }

  /**
   * Send a specific email type
   */
  async sendWelcome(to, name) {
    return this.sendEmail(to, EMAIL_TYPE.WELCOME, { name });
  }

  async sendVerification(to, name, verificationLink) {
    return this.sendEmail(to, EMAIL_TYPE.VERIFICATION, { name, verificationLink });
  }

  async sendVerificationConfirmation(to, name) {
    return this.sendEmail(to, EMAIL_TYPE.VERIFICATION_CONFIRMATION, { name });
  }

  async sendInvitation(to, name, invitationLink) {
    return this.sendEmail(to, EMAIL_TYPE.INVITATION, { name, invitationLink });
  }

  async sendInvitationReminder(to, name, invitationLink, countdown) {
    return this.sendEmail(to, EMAIL_TYPE.INVITATION_REMINDER, { 
      name, 
      invitationLink, 
      countdown 
    });
  }

  async sendLaunchAnnouncement(to, name) {
    return this.sendEmail(to, EMAIL_TYPE.LAUNCH_ANNOUNCEMENT, { name });
  }
}

// Export convenience functions
export async function sendWelcome(env, to, name) {
  const service = new EmailService(env);
  return service.sendWelcome(to, name);
}

export async function sendVerification(env, to, name, verificationLink) {
  const service = new EmailService(env);
  return service.sendVerification(to, name, verificationLink);
}

export async function sendVerificationConfirmation(env, to, name) {
  const service = new EmailService(env);
  return service.sendVerificationConfirmation(to, name);
}

export async function sendInvitation(env, to, name, invitationLink) {
  const service = new EmailService(env);
  return service.sendInvitation(to, name, invitationLink);
}

export async function sendInvitationReminder(env, to, name, invitationLink, countdown) {
  const service = new EmailService(env);
  return service.sendInvitationReminder(to, name, invitationLink, countdown);
}

export async function sendLaunchAnnouncement(env, to, name) {
  const service = new EmailService(env);
  return service.sendLaunchAnnouncement(to, name);
}