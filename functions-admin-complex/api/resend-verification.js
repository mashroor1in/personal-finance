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

import { json } from "../../../_lib/common.js";
import { requireAdmin } from "../../../_lib/admin-auth.js";
import { queryD1, queryFirstD1, runD1, getDatabaseFromEnv } from "../../../_lib/d1-helper.js";

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
 * Send verification email
 */
async function sendVerification(env, email, name, verificationLink) {
  const { sendVerification } = await import("../../../_lib/email.js");
  await sendVerification(env, email, name, verificationLink);
}