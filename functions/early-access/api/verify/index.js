/**
 * Email Verification Endpoint
 * 
 * Handles email verification with secure token validation and expiration.
 * 
 * Features:
 * - Secure token validation
 * - Token expiration handling
 * - Status updates
 * - Security logging
 */

import { generateUUID, hashToken, createSuccessResponse, createErrorResponse, 
         logSecurityEvent, isTokenExpired, formatDate } from '../../utils.js';

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

  // Handle GET requests (verification link)
  if (context.request.method === 'GET') {
    try {
      const token = new URL(context.request.url).searchParams.get('token');
      const email = new URL(context.request.url).searchParams.get('email');
      
      if (!token || !email) {
        logSecurityEvent(context, 'MISSING_VERIFICATION_PARAMS', { token: !!token, email: !!email });
        return new Response(JSON.stringify(createErrorResponse('Verification token and email are required', 'MISSING_PARAMS')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Hash the token for comparison
      const tokenHash = await hashToken(token);
      
      // Find the waitlist entry with this token
      const user = await context.env.DB.prepare(`
        SELECT id, email, name, status, verification_token_hash, created_at, verified_at
        FROM waitlist 
        WHERE email = ? AND verification_token_hash = ?
      `).bind(email, tokenHash).first();
      
      if (!user) {
        logSecurityEvent(context, 'INVALID_VERIFICATION_TOKEN', { email });
        return new Response(JSON.stringify(createErrorResponse('Invalid verification token', 'INVALID_TOKEN')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Check if already verified
      if (user.status === 'verified') {
        logSecurityEvent(context, 'ALREADY_VERIFIED', { email });
        return new Response(JSON.stringify(createSuccessResponse({
          status: 'already_verified',
          message: 'This email is already verified',
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            verified_at: user.verified_at
          }
        })), {
          status: 200,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Check if token is expired
      if (isTokenExpired(user.created_at)) {
        logSecurityEvent(context, 'EXPIRED_VERIFICATION_TOKEN', { email });
        return new Response(JSON.stringify(createErrorResponse('Verification token has expired', 'EXPIRED_TOKEN')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Mark email as verified
      const now = Date.now();
      await context.env.DB.prepare(`
        UPDATE waitlist 
        SET status = 'verified', email_verified = 1, verified_at = ?, verification_token_hash = null
        WHERE id = ?
      `).bind(now, user.id).run();
      
      // Log the verification event
      await logWaitlistEvent(context.env.DB, user.id, 'VERIFICATION', {
        email: user.email,
        token_used: token.substring(0, 8) + '...' // Log first 8 chars for debugging
      });
      
      logSecurityEvent(context, 'VERIFICATION_SUCCESS', { email: user.email, id: user.id });
      
      return new Response(JSON.stringify(createSuccessResponse({
        status: 'verified',
        message: 'Email verified successfully',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          verified_at: now
        }
      })), {
        status: 200,
        headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Email verification error:', error);
      logSecurityEvent(context, 'VERIFICATION_ERROR', { error: error.message });
      
      return new Response(JSON.stringify(createErrorResponse('An error occurred during verification', 'INTERNAL_ERROR')), {
        status: 500,
        headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // Handle POST requests (resend verification)
  if (context.request.method === 'POST') {
    try {
      const data = await context.request.json();
      const email = data.email;
      
      if (!email) {
        return new Response(JSON.stringify(createErrorResponse('Email is required', 'MISSING_EMAIL')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Find the waitlist entry
      const user = await context.env.DB.prepare('SELECT id, email, status, created_at FROM waitlist WHERE email = ?')
        .bind(email)
        .first();
      
      if (!user) {
        logSecurityEvent(context, 'RESEND_VERIFICATION_NOT_FOUND', { email });
        return new Response(JSON.stringify(createErrorResponse('No registration found', 'NOT_FOUND')), {
          status: 404,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Check if already verified
      if (user.status === 'verified') {
        return new Response(JSON.stringify(createErrorResponse('Email is already verified', 'ALREADY_VERIFIED')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Generate new verification token
      const verificationToken = generateVerificationToken();
      const tokenHash = await hashToken(verificationToken);
      const now = Date.now();
      
      // Update the verification token
      await context.env.DB.prepare(`
        UPDATE waitlist 
        SET verification_token_hash = ?, updated_at = ?
        WHERE id = ?
      `).bind(tokenHash, now, user.id).run();
      
      // Log the resend event
      await logWaitlistEvent(context.env.DB, user.id, 'RESEND_VERIFICATION', {
        email: user.email
      });
      
      // In production, send new verification email
      // await sendVerificationEmail(user.email, verificationToken);
      
      logSecurityEvent(context, 'RESEND_VERIFICATION_SUCCESS', { email: user.email });
      
      return new Response(JSON.stringify(createSuccessResponse({
        message: 'Verification email resent successfully',
        email: user.email
      })), {
        status: 200,
        headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Resend verification error:', error);
      
      return new Response(JSON.stringify(createErrorResponse('An error occurred while resending verification email', 'INTERNAL_ERROR')), {
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
async function logWaitlistEvent(DB, waitlistId, eventType, eventData = {}) {
  try {
    const id = generateUUID();
    const now = Date.now();
    
    await DB.prepare(`
      INSERT INTO waitlist_events (id, waitlist_id, event_type, event_data, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      id,
      waitlistId,
      eventType,
      JSON.stringify(eventData),
      now
    ).run();
  } catch (error) {
    console.error('Error logging waitlist event:', error);
  }
}

// Note: generateVerificationToken should be imported from utils.js
// For now, let's define it here
function generateVerificationToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}