/**
 * Bucksy Early Access Waitlist API
 * 
 * Main endpoint for waitlist registration with comprehensive security measures.
 * 
 * Features:
 * - Server-side Turnstile validation
 * - Email validation and normalization
 * - Rate limiting
 * - Disposable email detection
 * - Security logging
 * - Database integration
 */

import { validateWaitlistData, normalizeEmail, generateUUID, generateReferralCode, 
         hashToken, createSuccessResponse, createErrorResponse, logSecurityEvent,
         validateTurnstileToken, isRateLimitExceeded, getRateLimitKey, sanitizeInput } from '../../utils.js';

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

  // Handle POST requests (waitlist registration)
  if (context.request.method === 'POST') {
    try {
      const clientIP = getClientIP(context);
      const userAgent = context.request.headers.get('user-agent') || '';
      
      // Check for suspicious user agent
      if (isSuspiciousUserAgent(userAgent)) {
        logSecurityEvent(context, 'SUSPICIOUS_USER_AGENT', { userAgent });
        return new Response(JSON.stringify(createErrorResponse('Invalid request', 'INVALID_USER_AGENT')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Rate limiting check
      const rateLimitKey = getRateLimitKey(clientIP);
      const rateLimitData = context.env.WAITLIST_RATE_LIMIT?.get(rateLimitKey);
      if (isRateLimitExceeded(rateLimitData)) {
        logSecurityEvent(context, 'RATE_LIMIT_EXCEEDED', { ip: clientIP });
        return new Response(JSON.stringify(createErrorResponse('Too many attempts. Please try again later.', 'RATE_LIMIT_EXCEEDED')), {
          status: 429,
          headers: { 
            ...corsHeaders, 
            ...securityHeaders, 
            'Content-Type': 'application/json',
            'Retry-After': '900'
          }
        });
      }

      // Validate content type
      const contentType = context.request.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        logSecurityEvent(context, 'INVALID_CONTENT_TYPE', { contentType });
        return new Response(JSON.stringify(createErrorResponse('Content-Type must be application/json', 'INVALID_CONTENT_TYPE')), {
          status: 415,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Parse and validate request data
      const rawData = await context.request.json();
      const data = {
        email: sanitizeInput(rawData.email),
        name: sanitizeInput(rawData.name),
        country: sanitizeInput(rawData.country),
        referral_code: sanitizeInput(rawData.referral_code),
        referred_by: sanitizeInput(rawData.referred_by),
        signup_source: sanitizeInput(rawData.signup_source) || 'early-access',
        turnstile_token: sanitizeInput(rawData.turnstile_token)
      };

      // Validate input data
      const validation = validateWaitlistData(data);
      if (!validation.isValid) {
        logSecurityEvent(context, 'VALIDATION_ERROR', { errors: validation.errors, email: data.email });
        return new Response(JSON.stringify(createErrorResponse(validation.errors.join(', '), 'VALIDATION_ERROR')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Validate Turnstile token
      if (!await validateTurnstileToken(data.turnstile_token)) {
        logSecurityEvent(context, 'TURNSTILE_FAILED', { email: data.email });
        return new Response(JSON.stringify(createErrorResponse('Security verification failed', 'TURNSTILE_FAILED')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Check for existing registration
      const existingUser = await context.env.DB.prepare('SELECT id, email, status FROM waitlist WHERE email = ?')
        .bind(data.email)
        .first();
      
      if (existingUser) {
        if (existingUser.status === 'verified') {
          logSecurityEvent(context, 'DUPLICATE_REGISTRATION', { email: data.email, status: existingUser.status });
          return new Response(JSON.stringify(createErrorResponse('This email is already registered', 'DUPLICATE_REGISTRATION')), {
            status: 409,
            headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
          });
        } else {
          // Update existing pending registration
          const verificationToken = generateVerificationToken();
          const tokenHash = await hashToken(verificationToken);
          const now = Date.now();
          
          await context.env.DB.prepare(`
            UPDATE waitlist 
            SET name = ?, country = ?, referral_code = ?, referred_by = ?, 
                signup_source = ?, verification_token_hash = ?, updated_at = ?
            WHERE email = ?
          `).bind(
            data.name || null,
            data.country || null,
            data.referral_code || null,
            data.referred_by || null,
            data.signup_source,
            tokenHash,
            now,
            data.email
          ).run();
          
          // Log the update
          await logWaitlistEvent(context.env.DB, existingUser.id, 'REGISTRATION_UPDATE', {
            email: data.email,
            name: data.name,
            country: data.country,
            referral_code: data.referral_code,
            referred_by: data.referred_by
          });
          
          // In production, send verification email
          // await sendVerificationEmail(data.email, verificationToken);
          
          logSecurityEvent(context, 'REGISTRATION_UPDATED', { email: data.email });
          return new Response(JSON.stringify(createSuccessResponse({
            id: existingUser.id,
            email: data.email,
            status: 'pending',
            message: 'Registration updated. Please check your email for verification.'
          })), {
            status: 200,
            headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // Create new registration
      const id = generateUUID();
      const verificationToken = generateVerificationToken();
      const tokenHash = await hashToken(verificationToken);
      const now = Date.now();
      
      // Generate referral code if not provided
      const referralCode = data.referral_code || generateReferralCode();
      
      // Insert new waitlist entry
      await context.env.DB.prepare(`
        INSERT INTO waitlist (
          id, email, name, country, referral_code, referred_by, 
          signup_source, verification_token_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        data.email,
        data.name || null,
        data.country || null,
        referralCode,
        data.referred_by || null,
        data.signup_source,
        tokenHash,
        now
      ).run();
      
      // Log the registration event
      await logWaitlistEvent(context.env.DB, id, 'REGISTRATION', {
        email: data.email,
        name: data.name,
        country: data.country,
        referral_code: referralCode,
        referred_by: data.referred_by,
        signup_source: data.signup_source,
        ip: clientIP,
        userAgent: userAgent
      });
      
      // In production, send verification email
      // await sendVerificationEmail(data.email, verificationToken);
      
      // Update rate limit
      await updateRateLimit(context.env.WAITLIST_RATE_LIMIT, rateLimitKey);
      
      logSecurityEvent(context, 'REGISTRATION_SUCCESS', { email: data.email, id });
      
      return new Response(JSON.stringify(createSuccessResponse({
        id,
        email: data.email,
        referral_code: referralCode,
        status: 'pending',
        message: 'Registration successful. Please check your email for verification.'
      })), {
        status: 201,
        headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Waitlist registration error:', error);
      logSecurityEvent(context, 'REGISTRATION_ERROR', { error: error.message });
      
      return new Response(JSON.stringify(createErrorResponse('An error occurred while processing your request', 'INTERNAL_ERROR')), {
        status: 500,
        headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // Handle GET requests (check registration status)
  if (context.request.method === 'GET') {
    try {
      const email = normalizeEmail(new URL(context.request.url).searchParams.get('email'));
      
      if (!email) {
        return new Response(JSON.stringify(createErrorResponse('Email parameter is required', 'MISSING_EMAIL')), {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      const user = await context.env.DB.prepare('SELECT id, email, name, country, status, created_at, invited_at FROM waitlist WHERE email = ?')
        .bind(email)
        .first();
      
      if (!user) {
        return new Response(JSON.stringify(createErrorResponse('No registration found', 'NOT_FOUND')), {
          status: 404,
          headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify(createSuccessResponse({
        id: user.id,
        email: user.email,
        name: user.name,
        country: user.country,
        status: user.status,
        created_at: user.created_at,
        invited_at: user.invited_at
      })), {
        status: 200,
        headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Error checking registration status:', error);
      
      return new Response(JSON.stringify(createErrorResponse('An error occurred while checking registration status', 'INTERNAL_ERROR')), {
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
function getClientIP(context) {
  return context.request.cf?.ip || 
         context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         context.request.headers.get('x-real-ip')?.trim() ||
         'unknown';
}

function isSuspiciousUserAgent(userAgent) {
  if (!userAgent) return false;
  
  const suspiciousPatterns = [
    /bot/i, /crawler/i, /spider/i, /scraper/i,
    /curl/i, /wget/i, /python/i, /phantomjs/i,
    /headless/i, /test/i, /automation/i,
    /scrapy/i, /selenium/i, /puppeteer/i
  ];
  
  return suspiciousPatterns.some(pattern => pattern.test(userAgent));
}

async function updateRateLimit(rateLimitKV, key) {
  try {
    const now = Date.now();
    const existing = await rateLimitKV.get(key);
    const attempts = existing ? JSON.parse(existing) : [];
    attempts.push(now);
    await rateLimitKV.put(key, JSON.stringify(attempts));
  } catch (error) {
    console.error('Error updating rate limit:', error);
  }
}

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