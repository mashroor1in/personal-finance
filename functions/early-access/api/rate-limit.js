/**
 * Rate limiting endpoint for monitoring and managing request limits
 * 
 * This endpoint provides rate limiting information and can be used to
 * monitor and adjust security policies.
 */

export async function onRequest(context) {
  // Handle CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight requests
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders,
      status: 200,
    });
  }

  // Handle GET requests
  if (context.request.method === 'GET') {
    const clientIP = getClientIP(context);
    const currentTime = Date.now();
    
    // Get current rate limit status
    const rateLimitStatus = getRateLimitStatus(clientIP);
    
    return new Response(JSON.stringify({
      ip: clientIP,
      currentTime: currentTime,
      rateLimit: rateLimitStatus,
      security: {
        enabled: true,
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 10,
        remaining: rateLimitStatus.remaining,
        resetTime: rateLimitStatus.resetTime
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  // Handle other methods
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function getClientIP(context) {
  // Get the client IP from Cloudflare's headers
  return context.request.cf?.ip || 
         context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         context.request.headers.get('x-real-ip')?.trim() ||
         'unknown';
}

// Rate limiting implementation (simplified for demonstration)
const rateLimitStore = new Map();

function getRateLimitStatus(clientIP) {
  const now = Date.now();
  const windowStart = now - (15 * 60 * 1000); // 15 minutes
  
  // Clean old entries
  for (const [ip, timestamps] of rateLimitStore.entries()) {
    if (timestamps[0] < windowStart) {
      rateLimitStore.delete(ip);
    }
  }
  
  // Get existing timestamps for this IP
  const timestamps = rateLimitStore.get(clientIP) || [];
  
  // Calculate remaining requests
  const remaining = Math.max(0, 10 - timestamps.length);
  const resetTime = timestamps.length > 0 ? timestamps[0] + (15 * 60 * 1000) : null;
  
  return {
    requests: timestamps.length,
    remaining: remaining,
    resetTime: resetTime
  };
}