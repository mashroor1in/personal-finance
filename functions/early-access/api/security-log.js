/**
 * Security audit log endpoint
 * 
 * This endpoint logs security events and provides audit trails for
 * monitoring and debugging security incidents.
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

  // Handle POST requests (security event logging)
  if (context.request.method === 'POST') {
    try {
      const data = await context.request.json();
      const eventType = data.eventType;
      const severity = data.severity || 'info';
      const message = data.message;
      const metadata = data.metadata || {};
      
      // Log the security event
      logSecurityEvent({
        eventType,
        severity,
        message,
        metadata,
        timestamp: Date.now(),
        ip: getClientIP(context),
        userAgent: context.request.headers.get('user-agent') || '',
        url: context.request.url
      });
      
      return new Response(JSON.stringify({ 
        success: true,
        eventId: generateEventId(),
        timestamp: Date.now()
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
      
    } catch (error) {
      console.error('Error logging security event:', error);
      return new Response(JSON.stringify({ error: 'Failed to log security event' }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  }

  // Handle GET requests (retrieve recent logs)
  if (context.request.method === 'GET') {
    const logs = getRecentSecurityLogs();
    return new Response(JSON.stringify({
      logs,
      count: logs.length,
      timestamp: Date.now()
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

// Security event logging (simplified for demonstration)
const securityLogStore = [];

function logSecurityEvent(event) {
  const logEntry = {
    id: generateEventId(),
    ...event,
    processedAt: Date.now()
  };
  
  securityLogStore.push(logEntry);
  
  // Keep only last 1000 entries (in production, use proper logging service)
  if (securityLogStore.length > 1000) {
    securityLogStore.shift();
  }
  
  // Log to console for debugging
  console.log(`Security Event [${event.severity.toUpperCase()}]: ${event.eventType}`, event);
  
  // In production, you would send this to a logging service
  // Examples: Sentry, Loggly, Datadog, etc.
}

function getRecentSecurityLogs(limit = 50) {
  return securityLogStore.slice(-limit).reverse();
}

function generateEventId() {
  return 'sec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}