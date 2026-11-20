/**
 * POST /admin/api/resend-email/:emailId   Resend specific email
 *
 * Resends a specific email from the email logs.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Validates email ID server-side
 *   - Logs all actions for audit purposes
 */

import { json } from "../../../_lib/common.js";
import { requireAdmin } from "../../../_lib/admin-auth.js";
import { queryD1, queryFirstD1, runD1, getDatabaseFromEnv } from "../../../_lib/d1-helper.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const { emailId } = context.params;
  
  // Verify admin authentication
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  
  try {
    // Validate email ID
    if (!emailId) {
      return json({ error: "Invalid email ID" }, { status: 400 });
    }
    
    // Get admin info for logging
    const adminInfo = getAdminInfo(request);
    
    // Get database
    const db = getDatabaseFromEnv(env);
    
    // Resend email
    const result = await resendSpecificEmail(db, env, emailId, adminInfo);
    
    // Log the action
    await logAdminAction(db, adminInfo, `Resent email ${emailId}`, { emailId });
    
    return json(result);
    
  } catch (error) {
    console.error("[admin] Error resending email:", error);
    return json({ error: "Failed to resend email" }, { status: 500 });
  }
}

/**
 * Resend specific email
 */
async function resendSpecificEmail(db, env, emailId, adminInfo) {
  // Get email log
  const log = await queryFirstD1(db, "SELECT * FROM email_logs WHERE id = ?", [emailId]);
  if (!log) {
    throw new Error("Email not found");
  }
  
  // Parse the original email data
  const emailData = parseEmailData(log);
  
  // Resend based on type
  switch (emailData.type) {
    case 'verification':
      await resendVerificationEmail(db, env, emailData);
      break;
      
    case 'invitation':
      await resendInvitationEmail(db, env, emailData);
      break;
      
    case 'launch_announcement':
      await resendLaunchEmail(db, env, emailData);
      break;
      
    default:
      await resendGenericEmail(db, env, emailData);
  }
  
  // Log the resend
  await runD1(db, `
    INSERT INTO email_logs (id, to_address, subject, email_type, status, provider_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    crypto.randomUUID(),
    log.to_address,
    log.subject,
    log.email_type,
    'sending',
    null,
    Date.now()
  ]);
  
  return {
    success: true,
    message: "Email resent successfully"
  };
}

/**
 * Parse email data from log
 */
function parseEmailData(log) {
  return {
    id: log.id,
    to: log.to_address,
    subject: log.subject,
    type: log.email_type,
    createdAt: log.created_at
  };
}

/**
 * Get admin info from request
 */
function getAdminInfo(request) {
  return {
    id: 'admin',
    email: 'admin@bucksy.life',
    ip: request.headers.get('cf-connecting-ip') || 'unknown'
  };
}

/**
 * Log admin action
 */
async function logAdminAction(db, adminInfo, action, data) {
  try {
    await runD1(db, `
      INSERT INTO admin_actions (id, admin_id, admin_email, action, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      crypto.randomUUID(),
      adminInfo.id,
      adminInfo.email,
      action,
      JSON.stringify(data),
      Date.now()
    ]);
  } catch (error) {
    console.error("[admin] Error logging admin action:", error);
  }
}

/**
 * Resend verification email
 */
async function resendVerificationEmail(db, env, emailData) {
  // Get user info
  const user = await queryFirstD1(db, "SELECT * FROM waitlist WHERE email = ?", [emailData.to]);
  if (!user) {
    throw new Error("User not found");
  }
  
  // Generate new verification token
  const { generateVerificationToken } = await import("../../../_lib/waitlist.js");
  const token = generateVerificationToken();
  const tokenHash = await hashVerificationToken(user.email, token);
  
  // Update user with new token
  const now = Date.now();
  await runD1(db, `
    UPDATE waitlist
    SET verification_token_hash = ?,
        verification_sent_at = ?,
        updated_at = ?
    WHERE id = ?
  `, [tokenHash, now, user.id]);
  
  // Send verification email
  const verificationLink = `https://bucksy.life/early-access/api/verify?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(token)}`;
  await sendVerification(env, user.email, user.name, verificationLink);
}

/**
 * Resend invitation email
 */
async function resendInvitationEmail(db, env, emailData) {
  // Get user info
  const user = await queryFirstD1(db, "SELECT * FROM waitlist WHERE email = ?", [emailData.to]);
  if (!user) {
    throw new Error("User not found");
  }
  
  // Generate new invitation token
  const { generateVerificationToken } = await import("../../../_lib/waitlist.js");
  const token = generateVerificationToken();
  const tokenHash = await hashVerificationToken(user.email, token);
  
  // Update user with new token
  const now = Date.now();
  await runD1(db, `
    UPDATE waitlist
    SET status = 'invited',
        verification_token_hash = ?,
        verification_sent_at = ?,
        invited_at = ?,
        updated_at = ?
    WHERE id = ?
  `, [tokenHash, now, now, user.id]);
  
  // Send invitation email
  const invitationLink = `https://bucksy.life/early-access/invite?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(token)}`;
  await sendInvitation(env, user.email, user.name, invitationLink);
}

/**
 * Resend launch announcement
 */
async function resendLaunchEmail(db, env, emailData) {
  // Get user info
  const user = await queryFirstD1(db, "SELECT * FROM waitlist WHERE email = ?", [emailData.to]);
  if (!user) {
    throw new Error("User not found");
  }
  
  // Send launch announcement
  await sendLaunchAnnouncement(env, user.email, user.name);
}

/**
 * Resend generic email
 */
async function resendGenericEmail(db, env, emailData) {
  // For generic emails, we'll need to store the email template data
  // This is a simplified implementation
  const { sendEmail } = await import("../../../_lib/email.js");
  await sendEmail(env, emailData.to, emailData.type, {});
}

/**
 * Hash verification token
 */
async function hashVerificationToken(email, token) {
  const { hashVerificationToken } = await import("../../../_lib/waitlist.js");
  return hashVerificationToken(email, token);
}

/**
 * Send verification email
 */
async function sendVerification(env, email, name, verificationLink) {
  const { sendVerification } = await import("../../../_lib/email.js");
  await sendVerification(env, email, name, verificationLink);
}

/**
 * Send invitation email
 */
async function sendInvitation(env, email, name, invitationLink) {
  const { sendInvitation } = await import("../../../_lib/email.js");
  await sendInvitation(env, email, name, invitationLink);
}

/**
 * Send launch announcement
 */
async function sendLaunchAnnouncement(env, email, name) {
  const { sendLaunchAnnouncement } = await import("../../../_lib/email.js");
  await sendLaunchAnnouncement(env, email, name);
}