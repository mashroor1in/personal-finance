/**
 * GET /admin/api/countries   Country distribution data
 *
 * Returns countries with waitlist registrations for filtering.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Returns aggregated data without exposing sensitive user information
 */

import { json } from "../../../_lib/common.js";
import { requireAdmin } from "../../../_lib/admin-auth.js";
import { queryD1, queryFirstD1, runD1, getDatabaseFromEnv } from "../../../_lib/d1-helper.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  
  // Verify admin authentication
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  
  try {
    // Get database
    const db = getDatabaseFromEnv(env);
    
    // Get countries with registration counts
    const countries = await queryD1(db, `
      SELECT 
        country,
        COUNT(*) as count
      FROM waitlist
      WHERE country IS NOT NULL AND country != ''
      GROUP BY country
      ORDER BY count DESC
    `);
    
    // Process results
    const countryList = countries.map(row => ({
      code: row.country,
      name: row.country, // In a real implementation, you'd map country codes to names
      count: row.count
    }));
    
    return json({
      countries: countryList
    });
    
  } catch (error) {
    console.error("[admin] Error loading countries:", error);
    return json({ error: "Failed to load countries" }, { status: 500 });
  }
}

/**
 * POST /admin/api/invite   Send invitations to users
 *
 * Sends invitations to selected users with configurable expiry.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Validates all user IDs and options server-side
 *   - Logs all actions for audit purposes
 *   - Does not expose sensitive user information
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  
  // Verify admin authentication
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  
  try {
    const body = await request.json();
    const { userIds, expiryDays } = body;
    
    // Validate input
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return json({ error: "No users selected" }, { status: 400 });
    }
    
    if (!expiryDays || expiryDays < 1 || expiryDays > 90) {
      return json({ error: "Invalid expiry days" }, { status: 400 });
    }
    
    // Get admin info for logging
    const adminInfo = getAdminInfo(request);
    
    // Get database
    const db = getDatabaseFromEnv(env);
    
    // Send invitations to users
    const result = await sendBulkInvitations(db, env, userIds, expiryDays, adminInfo);
    
    // Log the action
    await logAdminAction(db, adminInfo, `Sent invitations to ${userIds.length} users`, {
      userIds,
      expiryDays
    });
    
    return json(result);
    
  } catch (error) {
    console.error("[admin] Error sending invitations:", error);
    return json({ error: "Failed to send invitations" }, { status: 500 });
  }
}

/**
 * POST /admin/api/resend-verification/:userId   Resend verification to specific user
 *
 * Resends verification email to a specific user.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Validates user ID server-side
 *   - Logs all actions for audit purposes
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const { userId } = context.params;
  
  // Verify admin authentication
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  
  try {
    // Validate user ID
    if (!userId) {
      return json({ error: "Invalid user ID" }, { status: 400 });
    }
    
    // Get admin info for logging
    const adminInfo = getAdminInfo(request);
    
    // Get database
    const db = getDatabaseFromEnv(env);
    
    // Resend verification
    const result = await resendVerificationToUser(db, env, userId, adminInfo);
    
    // Log the action
    await logAdminAction(db, adminInfo, `Resent verification to user ${userId}`, { userId });
    
    return json(result);
    
  } catch (error) {
    console.error("[admin] Error resending verification:", error);
    return json({ error: "Failed to resend verification" }, { status: 500 });
  }
}

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
 * Send bulk invitations
 */
async function sendBulkInvitations(db, env, userIds, expiryDays, adminInfo) {
  const sentCount = 0;
  const errors = [];
  
  for (const userId of userIds) {
    try {
      // Get user info
      const user = await queryFirstD1(db, "SELECT * FROM waitlist WHERE id = ?", [userId]);
      if (!user) {
        errors.push({ userId, error: "User not found" });
        continue;
      }
      
      // Check if user is already invited
      if (user.status === 'invited' || user.status === 'joined') {
        errors.push({ userId, error: "User already invited or joined" });
        continue;
      }
      
      // Check if user is verified
      if (user.status !== 'verified') {
        errors.push({ userId, error: "User must be verified before invitation" });
        continue;
      }
      
      // Generate invitation token
      const { generateVerificationToken } = await import("../../../_lib/waitlist.js");
      const token = generateVerificationToken();
      const tokenHash = await hashVerificationToken(user.email, token);
      
      // Calculate expiry date
      const expiryDate = Date.now() + (expiryDays * 24 * 60 * 60 * 1000);
      
      // Update user with invitation
      const now = Date.now();
      await runD1(db, `
        UPDATE waitlist
        SET status = 'invited',
            verification_token_hash = ?,
            verification_sent_at = ?,
            invited_at = ?,
            expires_at = ?,
            updated_at = ?
        WHERE id = ?
      `, [tokenHash, now, now, expiryDate, now, userId]);
      
      // Send invitation email
      const invitationLink = `https://bucksy.life/early-access/invite?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(token)}`;
      await sendInvitation(env, user.email, user.name, invitationLink);
      
      sentCount++;
      
    } catch (error) {
      console.error(`[admin] Error inviting user ${userId}:`, error);
      errors.push({ userId, error: error.message });
    }
  }
  
  return {
    success: true,
    sentCount,
    total: userIds.length,
    errors
  };
}

/**
 * Resend verification to specific user
 */
async function resendVerificationToUser(db, env, userId, adminInfo) {
  // Get user info
  const user = await queryFirstD1(db, "SELECT * FROM waitlist WHERE id = ?", [userId]);
  if (!user) {
    throw new Error("User not found");
  }
  
  if (user.status !== 'pending') {
    throw new Error("User is not pending verification");
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
  `, [tokenHash, now, userId]);
  
  // Send verification email
  const verificationLink = `https://bucksy.life/early-access/api/verify?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(token)}`;
  await sendVerification(env, user.email, user.name, verificationLink);
  
  return {
    success: true,
    message: "Verification resent successfully"
  };
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