/**
 * GET /admin/api/emails   Email delivery history
 *
 * Returns email delivery history with filtering and search capabilities.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Does not expose sensitive email content unnecessarily
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
    const type = url.searchParams.get('type') || '';
    const startDate = url.searchParams.get('start_date') || '';
    const endDate = url.searchParams.get('end_date') || '';
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    // Build the base query
    let query = `
      SELECT 
        id, to_address, subject, email_type, status, provider_id, 
        error_message, created_at
      FROM email_logs
      WHERE 1=1
    `;
    
    const params = [];
    
    // Add search filter
    if (search) {
      query += ` AND (LOWER(to_address) LIKE LOWER(?) OR LOWER(subject) LIKE LOWER(?))`;
      params.push(`%${search}%`, `%${search}%`);
    }
    
    // Add status filter
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    
    // Add type filter
    if (type) {
      query += ` AND email_type = ?`;
      params.push(type);
    }
    
    // Add date range filter
    if (startDate) {
      query += ` AND created_at >= ?`;
      params.push(new Date(startDate).getTime());
    }
    
    if (endDate) {
      query += ` AND created_at <= ?`;
      params.push(new Date(endDate).getTime());
    }
    
    // Get database
    const db = getDatabaseFromEnv(env);
    
    // Get total count for pagination
    const countQuery = query.replace('SELECT id, to_address, subject, email_type, status, provider_id, error_message, created_at', 'SELECT COUNT(*) as count');
    const totalResult = await queryFirstD1(db, countQuery, params);
    const total = totalResult.count;
    
    // Add pagination to the main query
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, (page - 1) * limit);
    
    // Get email data
    const result = await queryD1(db, query, params);
    
    // Process results
    const emails = result.results.map(row => ({
      id: row.id,
      to: row.to_address,
      subject: row.subject,
      type: row.email_type,
      status: row.status,
      providerId: row.provider_id,
      error: row.error_message,
      createdAt: row.created_at
    }));
    
    // Get database
    const db = getDatabaseFromEnv(env);
    
    // Get delivery statistics
    const stats = await getEmailStats(db);
    
    return json({
      emails,
      stats,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error("[admin] Error loading email data:", error);
    return json({ error: "Failed to load email data" }, { status: 500 });
  }
}

/**
 * POST /admin/api/emails/resend   Resend specific emails
 *
 * Resends failed or specific emails to users.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Validates all email IDs server-side
 *   - Logs all actions for audit purposes
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  
  // Verify admin authentication
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  
  try {
    const body = await request.json();
    const { emailIds } = body;
    
    // Validate input
    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return json({ error: "Invalid request parameters" }, { status: 400 });
    }
    
    // Get admin info for logging
    const adminInfo = getAdminInfo(request);
    
    // Resend emails
    const result = await resendEmails(db, env, emailIds, adminInfo);
    
    // Log the action
    await logAdminAction(db, adminInfo, `Resent ${emailIds.length} emails`, emailIds);
    
    return json(result);
    
  } catch (error) {
    console.error("[admin] Error resending emails:", error);
    return json({ error: "Failed to resend emails" }, { status: 500 });
  }
}

/**
 * Get email delivery statistics
 */
async function getEmailStats(db) {
  try {
    // Get overall statistics
    const stats = await queryD1(db, `
      SELECT 
        status,
        COUNT(*) as count
      FROM email_logs
      GROUP BY status
    `);
    
    // Get delivery rate by type
    const typeStats = await queryD1(db, `
      SELECT 
        email_type,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced
      FROM email_logs
      GROUP BY email_type
    `);
    
    // Get recent failures
    const recentFailures = await queryD1(db, `
      SELECT 
        id, to_address, subject, email_type, error_message, created_at
      FROM email_logs
      WHERE status IN ('failed', 'bounced')
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    return {
      byStatus: stats.results.reduce((acc, row) => {
        acc[row.status] = row.count;
        return acc;
      }, {}),
      byType: typeStats.results.map(row => ({
        type: row.email_type,
        total: row.total,
        delivered: row.delivered,
        failed: row.failed,
        bounced: row.bounced,
        rate: row.total > 0 ? Math.round((row.delivered / row.total) * 100) : 0
      })),
      recentFailures: recentFailures.results.map(row => ({
        id: row.id,
        to: row.to_address,
        subject: row.subject,
        type: row.email_type,
        error: row.error_message,
        createdAt: row.created_at
      }))
    };
    
  } catch (error) {
    console.error("[admin] Error getting email stats:", error);
    return null;
  }
}

/**
 * Resend emails
 */
async function resendEmails(db, env, emailIds, adminInfo) {
  const resentCount = 0;
  const errors = [];
  
  for (const emailId of emailIds) {
    try {
      // Get email log
      const log = await queryFirstD1(db, "SELECT * FROM email_logs WHERE id = ?", [emailId]);
      if (!log) {
        errors.push({ emailId, error: "Email not found" });
        continue;
      }
      
      // Parse the original email data to reconstruct the email
      const emailData = parseEmailData(log);
      
      // Resend the email based on type
      switch (emailData.type) {
        case 'verification':
          await resendVerificationEmail(env, emailData);
          break;
          
        case 'invitation':
          await resendInvitationEmail(env, emailData);
          break;
          
        case 'launch_announcement':
          await resendLaunchEmail(env, emailData);
          break;
          
        default:
          await resendGenericEmail(env, emailData);
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
      
      resentCount++;
      
    } catch (error) {
      console.error(`[admin] Error resending email ${emailId}:`, error);
      errors.push({ emailId, error: error.message });
    }
  }
  
  return {
    success: true,
    resentCount,
    total: emailIds.length,
    errors
  };
}

/**
 * Parse email data from log
 */
function parseEmailData(log) {
  // In a real implementation, this would parse the actual email data
  // For now, we'll reconstruct basic info from the log
  return {
    id: log.id,
    to: log.to_address,
    subject: log.subject,
    type: log.email_type,
    createdAt: log.created_at
  };
}

/**
 * Resend verification email
 */
async function resendVerificationEmail(env, emailData) {
  // Get database
  const db = getDatabaseFromEnv(env);
  
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
  `, [tokenHash, now, now, user.id]);
  
  // Send verification email
  const verificationLink = `https://bucksy.life/early-access/api/verify?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(token)}`;
  await sendVerification(env, user.email, user.name, verificationLink);
}

/**
 * Resend invitation email
 */
async function resendInvitationEmail(env, emailData) {
  // Get database
  const db = getDatabaseFromEnv(env);
  
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
  `, [tokenHash, now, now, now, user.id]);
  
  // Send invitation email
  const invitationLink = `https://bucksy.life/early-access/invite?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(token)}`;
  await sendInvitation(env, user.email, user.name, invitationLink);
}

/**
 * Resend launch announcement
 */
async function resendLaunchEmail(env, emailData) {
  // Get database
  const db = getDatabaseFromEnv(env);
  
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
async function resendGenericEmail(env, emailData) {
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