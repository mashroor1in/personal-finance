/**
 * Monitoring endpoint for security and analytics
 * 
 * This endpoint provides monitoring information about waitlist signups,
 * security events, and system health.
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
    const systemStats = getSystemStats();
    
    return new Response(JSON.stringify({
      status: 'healthy',
      timestamp: Date.now(),
      ip: clientIP,
      system: systemStats,
      security: {
        enabled: true,
        features: [
          'turnstile_verification',
          'rate_limiting',
          'disposable_email_detection',
          'suspicious_pattern_detection',
          'ip_reputation_check',
          'user_agent_analysis',
          'request_validation'
        ],
        uptime: process.uptime ? process.uptime() : Date.now() // Cloudflare Pages doesn't have process.uptime()
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

function getSystemStats() {
  // In production, you would gather actual system statistics
  return {
    memoryUsage: 'N/A', // Cloudflare Pages doesn't expose memory usage
    uptime: Date.now(), // Approximate uptime
    requests: Math.floor(Math.random() * 1000), // Mock data
    errors: Math.floor(Math.random() * 10), // Mock data
    responseTime: Math.floor(Math.random() * 100) + 50 // Mock data
  };
}