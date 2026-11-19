/**
 * Referral API Endpoint
 * 
 * Handles referral tracking and information retrieval.
 * 
 * Features:
 * - Referral code validation
 * - Referral tracking
 * - Referral statistics
 * - Security logging
 */

import { generateUUID, createSuccessResponse, createErrorResponse, 
         logSecurityEvent, validateWaitlistData, sanitizeInput } from '../../utils.js';

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

  // Handle GET requests (get referral information)
  if (context.request.method === 'GET') {
    try {
      const referralCode = new URL(context.request.url).searchParams.get('code');
      
      if (!referralCode) {
        return new Response(JSON.stringify(createErrorResponse('Referral code is required', 'MISSING_CODE')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Get referral information
      const referralInfo = await getReferralInfo(context.env.DB, referralCode);
      
      if (!referralInfo) {
        logSecurityEvent(context, 'INVALID_REFERRAL_CODE', { code: referralCode });
        return new Response(JSON.stringify(createErrorResponse('Invalid referral code', 'INVALID_CODE')), {
          status: 404,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify(createSuccessResponse(referralInfo)), {
        status: 200,
        headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Referral info error:', error);
      logSecurityEvent(context, 'REFERRAL_INFO_ERROR', { error: error.message });
      
      return new Response(JSON.stringify(createErrorResponse('An error occurred while retrieving referral information', 'INTERNAL_ERROR')), {
        status: 500,
        headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // Handle POST requests (track referral)
  if (context.request.method === 'POST') {
    try {
      const data = await context.request.json();
      const { referral_code, email, name } = data;
      
      // Validate input
      if (!referral_code) {
        return new Response(JSON.stringify(createErrorResponse('Referral code is required', 'MISSING_CODE')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Sanitize input
      const sanitizedData = {
        referral_code: sanitizeInput(referral_code),
        email: sanitizeInput(email),
        name: sanitizeInput(name)
      };
      
      // Validate email if provided
      if (sanitizedData.email && !validateWaitlistData(sanitizedData).isValid) {
        return new Response(JSON.stringify(createErrorResponse('Invalid email address', 'INVALID_EMAIL')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Validate referral code
      const referrer = await context.env.DB.prepare('SELECT id, email, name FROM waitlist WHERE referral_code = ?')
        .bind(sanitizedData.referral_code)
        .first();
      
      if (!referrer) {
        logSecurityEvent(context, 'INVALID_REFERRAL_CODE', { code: sanitizedData.referral_code });
        return new Response(JSON.stringify(createErrorResponse('Invalid referral code', 'INVALID_CODE')), {
          status: 404,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Log the referral event
      await logReferralEvent(context.env.DB, referrer.id, 'REFerral_VIEW', {
        referral_code: sanitizedData.referral_code,
        referrer_email: referrer.email,
        referrer_name: referrer.name,
        prospect_email: sanitizedData.email,
        prospect_name: sanitizedData.name
      });
      
      logSecurityEvent(context, 'REFERRAL_TRACKED', { 
        code: sanitizedData.referral_code, 
        referrer: referrer.email,
        prospect: sanitizedData.email 
      });
      
      return new Response(JSON.stringify(createSuccessResponse({
        referrer: {
          id: referrer.id,
          email: referrer.email,
          name: referrer.name
        },
        referral_code: sanitizedData.referral_code,
        message: 'Referral tracked successfully'
      })), {
        status: 200,
        headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Referral tracking error:', error);
      logSecurityEvent(context, 'REFERRAL_TRACKING_ERROR', { error: error.message });
      
      return new Response(JSON.stringify(createErrorResponse('An error occurred while tracking referral', 'INTERNAL_ERROR')), {
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
async function getReferralInfo(DB, referralCode) {
  try {
    // Get referrer information
    const referrer = await DB.prepare('SELECT id, email, name, country FROM waitlist WHERE referral_code = ?')
      .bind(referralCode)
      .first();
    
    if (!referrer) {
      return null;
    }
    
    // Get referral statistics
    const stats = await DB.prepare(`
      SELECT 
        COUNT(*) as total_referrals,
        COUNT(CASE WHEN status = 'verified' THEN 1 END) as verified_referrals,
        COUNT(CASE WHEN status = 'invited' THEN 1 END) as invited_referrals,
        MAX(created_at) as latest_referral
      FROM waitlist 
      WHERE referred_by = ?
    `).bind(referrer.id).first();
    
    // Get recent referrals
    const recentReferrals = await DB.prepare(`
      SELECT email, name, created_at, status 
      FROM waitlist 
      WHERE referred_by = ? 
      ORDER BY created_at DESC 
      LIMIT 5
    `).bind(referrer.id).all();
    
    return {
      referrer: {
        id: referrer.id,
        email: referrer.email,
        name: referrer.name,
        country: referrer.country
      },
      statistics: {
        total_referrals: parseInt(stats.total_referrals) || 0,
        verified_referrals: parseInt(stats.verified_referrals) || 0,
        invited_referrals: parseInt(stats.invited_referrals) || 0,
        latest_referral: stats.latest_referral
      },
      recent_referrals: recentReferrals.results.map(r => ({
        email: r.email,
        name: r.name,
        created_at: r.created_at,
        status: r.status
      }))
    };
    
  } catch (error) {
    console.error('Error getting referral info:', error);
    throw error;
  }
}

async function logReferralEvent(DB, referrerId, eventType, eventData = {}) {
  try {
    const id = generateUUID();
    const now = Date.now();
    
    await DB.prepare(`
      INSERT INTO waitlist_events (id, waitlist_id, event_type, event_data, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      id,
      referrerId,
      eventType,
      JSON.stringify(eventData),
      now
    ).run();
  } catch (error) {
    console.error('Error logging referral event:', error);
  }
}