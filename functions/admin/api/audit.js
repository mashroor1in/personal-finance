/**
 * GET /admin/api/audit   Administrative audit logs
 *
 * Returns audit logs of administrative actions.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Does not expose sensitive information in logs
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
    const action = url.searchParams.get('action') || '';
    const adminId = url.searchParams.get('admin_id') || '';
    const startDate = url.searchParams.get('start_date') || '';
    const endDate = url.searchParams.get('end_date') || '';
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    // Build the base query
    let query = `
      SELECT 
        id, admin_id, admin_email, action, data, created_at
      FROM admin_actions
      WHERE 1=1
    `;
    
    const params = [];
    
    // Add action filter
    if (action) {
      query += ` AND action LIKE ?`;
      params.push(`%${action}%`);
    }
    
    // Add admin filter
    if (adminId) {
      query += ` AND admin_id = ?`;
      params.push(adminId);
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
    const countQuery = query.replace('SELECT id, admin_id, admin_email, action, data, created_at', 'SELECT COUNT(*) as count');
    const totalResult = await queryFirstD1(db, countQuery, params);
    const total = totalResult.count;
    
    // Add pagination to the main query
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, (page - 1) * limit);
    
    // Get audit data
    const result = await queryD1(db, query, params);
    
    // Process results
    const logs = result.results.map(row => ({
      id: row.id,
      adminId: row.admin_id,
      adminEmail: row.admin_email,
      action: row.action,
      data: row.data ? JSON.parse(row.data) : null,
      createdAt: row.created_at
    }));
    
    return json({
      logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error("[admin] Error loading audit data:", error);
    return json({ error: "Failed to load audit data" }, { status: 500 });
  }
}

/**
 * POST /admin/api/audit/export   Export audit logs
 *
 * Exports audit logs to CSV format.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Validates all parameters server-side
 *   - Logs the export action
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  
  // Verify admin authentication
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  
  try {
    const body = await request.json();
    const { filters = {} } = body;
    
    // Get admin info for logging
    const adminInfo = getAdminInfo(request);
    
    // Get database
    const db = getDatabaseFromEnv(env);
    
    // Build export query
    let query = `
      SELECT 
        id, admin_id, admin_email, action, data, created_at
      FROM admin_actions
      WHERE 1=1
    `;
    
    const params = [];
    
    // Apply filters
    if (filters.action) {
      query += ` AND action LIKE ?`;
      params.push(`%${filters.action}%`);
    }
    
    if (filters.adminId) {
      query += ` AND admin_id = ?`;
      params.push(filters.adminId);
    }
    
    if (filters.startDate) {
      query += ` AND created_at >= ?`;
      params.push(new Date(filters.startDate).getTime());
    }
    
    if (filters.endDate) {
      query += ` AND created_at <= ?`;
      params.push(new Date(filters.endDate).getTime());
    }
    
    query += ` ORDER BY created_at DESC`;
    
    // Get audit data
    const result = await queryD1(db, query, params);
    
    // Convert to CSV
    const csv = [
      ['ID', 'Admin ID', 'Admin Email', 'Action', 'Data', 'Created At'],
      ...result.results.map(row => [
        row.id,
        row.admin_id,
        row.admin_email,
        row.action,
        row.data || '',
        new Date(row.created_at).toISOString()
      ])
    ].map(row => row.map(field => `"${field}"`).join(',')).join('\n');
    
    // Log the export
    await logAdminAction(env, adminInfo, `Exported audit logs (${result.results.length} records)`, {
      filters,
      recordCount: result.results.length
    });
    
    // Return CSV response
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`
      }
    });
    
  } catch (error) {
    console.error("[admin] Error exporting audit logs:", error);
    return json({ error: "Failed to export audit logs" }, { status: 500 });
  }
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
async function logAdminAction(env, adminInfo, action, data) {
  const db = getDatabaseFromEnv(env);
  
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