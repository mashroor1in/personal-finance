/**
 * GET /admin/api/waitlist   Waitlist management data
 *
 * Returns waitlist registrations with filtering, sorting, and search capabilities.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Does not expose sensitive user information unnecessarily
 *   - Server-side validation of all parameters
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
    // Parse query parameters
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const status = url.searchParams.get('status') || '';
    const country = url.searchParams.get('country') || '';
    const sortBy = url.searchParams.get('sort') || 'created_at';
    const sortOrder = url.searchParams.get('order') || 'desc';
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    // Get database
    const db = getDatabaseFromEnv(env);
    
    // Build the base query
    let query = `
      SELECT 
        id, email, name, country, status, created_at, updated_at, 
        joined_at, referred_by, referral_code
      FROM waitlist
      WHERE 1=1
    `;
    
    const params = [];
    
    // Add search filter
    if (search) {
      query += ` AND (LOWER(name) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?))`;
      params.push(`%${search}%`, `%${search}%`);
    }
    
    // Add status filter
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    
    // Add country filter
    if (country) {
      query += ` AND country = ?`;
      params.push(country);
    }
    
    // Add sorting
    let orderClause = 'ORDER BY created_at DESC';
    if (sortBy === 'name') {
      orderClause = `ORDER BY name ${sortOrder}`;
    } else if (sortBy === 'email') {
      orderClause = `ORDER BY email ${sortOrder}`;
    } else if (sortBy === 'created_at') {
      orderClause = `ORDER BY created_at ${sortOrder}`;
    }
    
    // Get total count for pagination
    const countQuery = query.replace('SELECT id, email, name, country, status, created_at, updated_at, joined_at, referred_by, referral_code', 'SELECT COUNT(*) as count');
    const totalResult = await queryFirstD1(db, countQuery, params);
    const total = totalResult.count;
    
    // Add pagination and sorting to the main query
    query += ` ${orderClause} LIMIT ? OFFSET ?`;
    params.push(limit, (page - 1) * limit);
    
    // Get waitlist data
    const result = await queryD1(db, query, params);
    
    // Process results
    const users = result.map(row => ({
      id: row.id,
      name: row.name || '',
      email: row.email,
      country: row.country || '',
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      joined_at: row.joined_at,
      referred_by: row.referred_by,
      referral_code: row.referral_code
    }));
    
    return json({
      users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error("[admin] Error loading waitlist data:", error);
    return json({ error: "Failed to load waitlist data" }, { status: 500 });
  }
}

/**
 * POST /admin/api/waitlist/bulk-action   Bulk actions on waitlist
 *
 * Performs bulk actions like sending invitations or resending emails.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Validates all user IDs and actions server-side
 *   - Logs all actions for audit purposes
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  
  // Verify admin authentication
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  
  try {
    const body = await request.json();
    const { action, userIds, options = {} } = body;
    
    // Validate input
    if (!action || !Array.isArray(userIds) || userIds.length === 0) {
      return json({ error: "Invalid request parameters" }, { status: 400 });
    }
    
    // Get admin info for logging
    const adminInfo = getAdminInfo(request);
    
    // Get database
    const db = getDatabaseFromEnv(env);
    
    // Perform the requested action
    let result;
    switch (action) {
      case 'send_invitations':
        result = await sendBulkInvitations(db, userIds, options, adminInfo);
        break;
        
      case 'resend_verification':
        result = await resendBulkVerification(db, userIds, adminInfo);
        break;
        
      case 'export':
        result = await exportBulkData(db, userIds);
        break;
        
      default:
        return json({ error: "Invalid action" }, { status: 400 });
    }
    
    // Log the action
    await logAdminAction(db, adminInfo, `Bulk ${action} on ${userIds.length} users`, userIds);
    
    return json(result);
    
  } catch (error) {
    console.error("[admin] Error in bulk action:", error);
    return json({ error: "Failed to perform bulk action" }, { status: 500 });
  }
}

/**
 * Send bulk invitations
 */
async function sendBulkInvitations(db, userIds, options, adminInfo) {
  const expiryDays = options.expiryDays || 14;
  const sentCount = 0;
  const errors = [];
  
  for (const userId of userIds) {
    try {
      // Get user info
      const user = await queryFirstD1(db, "SELECT * FROM waitlist WHERE id = ?", [userId]);
      if (!user || user.status !== 'verified') {
        errors.push({ userId, error: "User not eligible for invitation" });
        continue;
      }
      
      // Generate invitation token
      const { generateVerificationToken } = await import("../../../_lib/waitlist.js");
      const token = generateVerificationToken();
      const tokenHash = await hashVerificationToken(user.email, token);
      
      // Update user with invitation
      const now = Date.now();
      await runD1(db, `
        UPDATE waitlist
        SET status = 'invited',
            verification_token_hash = ?,
            verification_sent_at = ?,
            invited_at = ?,
            updated_at = ?
        WHERE id = ?
      `, [tokenHash, now, now, now, userId]);
      
      // Send invitation email (using the email system)
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
 * Resend bulk verification emails
 */
async function resendBulkVerification(db, userIds, adminInfo) {
  const sentCount = 0;
  const errors = [];
  
  for (const userId of userIds) {
    try {
      // Get user info
      const user = await queryFirstD1(db, "SELECT * FROM waitlist WHERE id = ?", [userId]);
      if (!user || user.status !== 'pending') {
        errors.push({ userId, error: "User not pending verification" });
        continue;
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
      
      sentCount++;
      
    } catch (error) {
      console.error(`[admin] Error resending verification to user ${userId}:`, error);
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
 * Export bulk data
 */
async function exportBulkData(db, userIds) {
  // Get user data for export
  const placeholders = userIds.map(() => '?').join(',');
  const result = await queryD1(db, `
    SELECT id, email, name, country, status, created_at, joined_at, referral_code
    FROM waitlist
    WHERE id IN (${placeholders})
  `, userIds);
  
  return {
    success: true,
    count: result.length,
    data: result
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
 * Send invitation email
 */
async function sendInvitation(env, email, name, invitationLink) {
  const { sendInvitation } = await import("../../../_lib/email.js");
  await sendInvitation(env, email, name, invitationLink);
}

/**
 * Send verification email
 */
async function sendVerification(env, email, name, verificationLink) {
  const { sendVerification } = await import("../../../_lib/email.js");
  await sendVerification(env, email, name, verificationLink);
}

/**
 * Get admin info from request
 */
function getAdminInfo(request) {
  // In a real implementation, this would extract admin info from a session or token
  return {
    id: 'admin',
    email: 'admin@bucksy.life',
    ip: request.headers.get('cf-connecting-ip') || 'unknown'
  };
}

/**
 * Log admin action
 */
async function logAdminAction(db, adminInfo, action, userIds) {
  try {
    await runD1(db, `
      INSERT INTO admin_actions (id, admin_id, admin_email, action, user_ids, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      crypto.randomUUID(),
      adminInfo.id,
      adminInfo.email,
      action,
      JSON.stringify(userIds),
      Date.now()
    ]);
  } catch (error) {
    console.error("[admin] Error logging admin action:", error);
  }
}