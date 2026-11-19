/**
 * Waitlist Analytics Endpoint
 * 
 * Provides analytics and statistics for the waitlist program.
 * 
 * Features:
 * - Registration statistics
 * - Referral analytics
 * - Geographic distribution
 * - Time-based analytics
 * - Security monitoring
 */

import { generateUUID, createSuccessResponse, createErrorResponse, 
         logSecurityEvent } from '../../utils.js';

export async function onRequest(context) {
  // Handle CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };

  // Handle preflight requests
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders,
      status: 204
    });
  }

  // Security headers
  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com;"
  };

  // Handle GET requests (analytics data)
  if (context.request.method === 'GET') {
    try {
      const clientIP = context.request.cf?.ip || 'unknown';
      
      // Check if client is authorized (in production, implement proper auth)
      if (!isAuthorizedRequest(context)) {
        logSecurityEvent(context, 'UNAUTHORIZED_ANALYTICS_ACCESS', { ip: clientIP });
        return new Response(JSON.stringify(createErrorResponse('Unauthorized access', 'UNAUTHORIZED')), {
          status: 401,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Get analytics data
      const analytics = await getWaitlistAnalytics(context.env.DB);
      
      return new Response(JSON.stringify(createSuccessResponse(analytics)), {
        status: 200,
        headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Analytics error:', error);
      logSecurityEvent(context, 'ANALYTICS_ERROR', { error: error.message });
      
      return new Response(JSON.stringify(createErrorResponse('An error occurred while retrieving analytics', 'INTERNAL_ERROR')), {
        status: 500,
        headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // Handle other methods
  return new Response(JSON.stringify(createErrorResponse('Method not allowed', 'METHOD_NOT_ALLOWED')), {
    status: 405,
    headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
  });
}

// Helper functions
async function getWaitlistAnalytics(DB) {
  try {
    const now = Date.now();
    const yesterday = now - (24 * 60 * 60 * 1000);
    const lastWeek = now - (7 * 24 * 60 * 60 * 1000);
    const lastMonth = now - (30 * 24 * 60 * 60 * 1000);
    
    // Basic statistics
    const totalStats = await DB.prepare(`
      SELECT 
        COUNT(*) as total_registrations,
        COUNT(CASE WHEN status = 'verified' THEN 1 END) as verified_registrations,
        COUNT(CASE WHEN status = 'invited' THEN 1 END) as invited_registrations,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_registrations,
        COUNT(CASE WHEN email_verified = 1 THEN 1 END) as email_verified_count
      FROM waitlist
    `).first();
    
    // Time-based statistics
    const timeStats = await DB.prepare(`
      SELECT 
        COUNT(CASE WHEN created_at > ? THEN 1 END) as registrations_last_24h,
        COUNT(CASE WHEN created_at > ? THEN 1 END) as registrations_last_7d,
        COUNT(CASE WHEN created_at > ? THEN 1 END) as registrations_last_30d,
        COUNT(CASE WHEN verified_at > ? THEN 1 END) as verifications_last_24h,
        COUNT(CASE WHEN verified_at > ? THEN 1 END) as verifications_last_7d,
        COUNT(CASE WHEN verified_at > ? THEN 1 END) as verifications_last_30d
      FROM waitlist
    `).bind(
      yesterday, yesterday, yesterday,
      yesterday, lastWeek, lastMonth
    ).first();
    
    // Geographic distribution
    const geoStats = await DB.prepare(`
      SELECT 
        country,
        COUNT(*) as count
      FROM waitlist
      WHERE country IS NOT NULL AND country != ''
      GROUP BY country
      ORDER BY count DESC
      LIMIT 10
    `).all();
    
    // Signup source distribution
    const sourceStats = await DB.prepare(`
      SELECT 
        signup_source,
        COUNT(*) as count
      FROM waitlist
      GROUP BY signup_source
      ORDER BY count DESC
    `).all();
    
    // Referral statistics
    const referralStats = await DB.prepare(`
      SELECT 
        COUNT(CASE WHEN referral_code IS NOT NULL THEN 1 END) as total_with_referral,
        COUNT(CASE WHEN referred_by IS NOT NULL THEN 1 END) as total_referred,
        COUNT(CASE WHEN status = 'verified' AND referred_by IS NOT NULL THEN 1 END) as verified_referred
      FROM waitlist
    `).first();
    
    // Top referrers
    const topReferrers = await DB.prepare(`
      SELECT 
        w.email,
        w.name,
        COUNT(r.id) as referral_count,
        COUNT(CASE WHEN r.status = 'verified' THEN 1 END) as verified_referrals
      FROM waitlist w
      LEFT JOIN waitlist r ON w.id = r.referred_by
      WHERE w.referral_code IS NOT NULL
      GROUP BY w.id, w.email, w.name
      ORDER BY referral_count DESC
      LIMIT 10
    `).all();
    
    // Event statistics
    const eventStats = await DB.prepare(`
      SELECT 
        event_type,
        COUNT(*) as count
      FROM waitlist_events
      GROUP BY event_type
      ORDER BY count DESC
    `).all();
    
    // Recent activity
    const recentActivity = await DB.prepare(`
      SELECT 
        event_type,
        event_data,
        created_at
      FROM waitlist_events
      ORDER BY created_at DESC
      LIMIT 20
    `).all();
    
    return {
      overview: {
        total_registrations: parseInt(totalStats.total_registrations) || 0,
        verified_registrations: parseInt(totalStats.verified_registrations) || 0,
        invited_registrations: parseInt(totalStats.invited_registrations) || 0,
        pending_registrations: parseInt(totalStats.pending_registrations) || 0,
        email_verified_count: parseInt(totalStats.email_verified_count) || 0,
        verification_rate: calculateRate(totalStats.email_verified_count, totalStats.total_registrations)
      },
      time_series: {
        registrations_last_24h: parseInt(timeStats.registrations_last_24h) || 0,
        registrations_last_7d: parseInt(timeStats.registrations_last_7d) || 0,
        registrations_last_30d: parseInt(timeStats.registrations_last_30d) || 0,
        verifications_last_24h: parseInt(timeStats.verifications_last_24h) || 0,
        verifications_last_7d: parseInt(timeStats.verifications_last_7d) || 0,
        verifications_last_30d: parseInt(timeStats.verifications_last_30d) || 0
      },
      geographic_distribution: geoStats.results.map(row => ({
        country: row.country,
        count: parseInt(row.count)
      })),
      signup_sources: sourceStats.results.map(row => ({
        source: row.signup_source,
        count: parseInt(row.count)
      })),
      referral_statistics: {
        total_with_referral: parseInt(referralStats.total_with_referral) || 0,
        total_referred: parseInt(referralStats.total_referred) || 0,
        verified_referred: parseInt(referralStats.verified_referred) || 0,
        referral_rate: calculateRate(referralStats.total_referred, totalStats.total_registrations),
        verified_referral_rate: calculateRate(referralStats.verified_referred, referralStats.total_referred)
      },
      top_referrers: topReferrers.results.map(row => ({
        email: row.email,
        name: row.name,
        referral_count: parseInt(row.referral_count),
        verified_referrals: parseInt(row.verified_referrals)
      })),
      event_statistics: eventStats.results.map(row => ({
        event_type: row.event_type,
        count: parseInt(row.count)
      })),
      recent_activity: recentActivity.results.map(row => ({
        event_type: row.event_type,
        event_data: JSON.parse(row.event_data || '{}'),
        created_at: row.created_at
      })),
      generated_at: now
    };
    
  } catch (error) {
    console.error('Error getting waitlist analytics:', error);
    throw error;
  }
}

function calculateRate(numerator, denominator) {
  if (!denominator || denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function isAuthorizedRequest(context) {
  // In production, implement proper authorization
  // For now, allow all requests for development
  return true;
  
  // Example implementation:
  // const authHeader = context.request.headers.get('authorization');
  // return authHeader === 'Bearer ' + process.env.ANALYTICS_API_KEY;
}