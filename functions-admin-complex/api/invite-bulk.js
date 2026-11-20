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

import { json } from "../../../_lib/common.js";
import { requireAdmin } from "../../../_lib/admin-auth.js";
import { queryD1, queryFirstD1, runD1, getDatabaseFromEnv } from "../../../_lib/d1-helper.js";

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
 * Send bulk invitations
 */
async function sendBulkInvitations(db, env, userIds, expiryDays, adminInfo) {
  let sentCount = 0;
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
 * Hash verification token
 */
async function hashVerificationToken(email, token) {
  const { hashVerificationToken } = await import("../../../_lib/waitlist.js");
  return hashVerificationToken(email, token);
}

/**
 * Send invitation email
 */
async function sendInvitation(env, email, name, invitationLink) {
  const { sendInvitation } = await import("../../../_lib/email.js");
  await sendInvitation(env, email, name, invitationLink);
}