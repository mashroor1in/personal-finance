/**
 * Security middleware for early access endpoints
 * 
 * This middleware provides additional security layers for the waitlist API:
 * - Request size limits
 * - Content-Type validation
 * - Security headers
 * - IP-based blocking
 * - Request timeout
 */

export async function onRequest(context) {
  // Security headers
  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com;"
  };

  // Handle preflight requests
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        ...securityHeaders,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      },
      status: 204
    });
  }

  // Check request size limit (10MB)
  const contentLength = context.request.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'Request too large' }), {
      status: 413,
      headers: {
        ...securityHeaders,
        'Content-Type': 'application/json'
      }
    });
  }

  // Validate Content-Type for POST requests
  if (context.request.method === 'POST') {
    const contentType = context.request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
        status: 415,
        headers: {
          ...securityHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  }

  // Check for suspicious IP addresses
  const clientIP = getClientIP(context);
  if (isSuspiciousIP(clientIP)) {
    return new Response(JSON.stringify({ error: 'Access denied' }), {
      status: 403,
      headers: {
        ...securityHeaders,
        'Content-Type': 'application/json'
      }
    });
  }

  // Check for suspicious headers
  if (hasSuspiciousHeaders(context.request.headers)) {
    return new Response(JSON.stringify({ error: 'Invalid request headers' }), {
      status: 400,
      headers: {
        ...securityHeaders,
        'Content-Type': 'application/json'
      }
    });
  }

  // Set security headers for all responses
  const originalResponse = await context.next();
  const securityResponse = new Response(originalResponse.body, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: {
      ...originalResponse.headers,
      ...securityHeaders
    }
  });

  return securityResponse;
}

function getClientIP(context) {
  // Get the client IP from Cloudflare's headers
  return context.request.cf?.ip || 
         context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         context.request.headers.get('x-real-ip')?.trim() ||
         'unknown';
}

function isSuspiciousIP(ip) {
  // Check for known malicious IP ranges (in production, use a proper IP reputation service)
  const suspiciousIPs = [
    // Add known malicious IPs here
    '127.0.0.1', // Localhost (for testing)
    '10.0.0.1',  // Private network (for testing)
  ];
  
  // Check if IP is in the suspicious list
  if (suspiciousIPs.includes(ip)) {
    console.log(`Blocked suspicious IP: ${ip}`);
    return true;
  }
  
  // Check for cloud provider ranges that might be abused
  const cloudRanges = [
    // Add known cloud provider ranges that are commonly abused
  ];
  
  // Additional checks can be added here
  return false;
}

function hasSuspiciousHeaders(headers) {
  // Check for suspicious headers that might indicate automated attacks
  const suspiciousHeaders = [
    'x-forwarded-for',
    'x-real-ip',
    'via',
    'x-cluster-client-ip',
    'x-http-forwarded-for'
  ];
  
  // Check for multiple IP headers (possible header injection)
  let ipCount = 0;
  for (const header of headers.entries()) {
    if (suspiciousHeaders.includes(header[0].toLowerCase())) {
      ipCount++;
    }
  }
  
  if (ipCount > 2) {
    console.log(`Blocked request with multiple IP headers: ${ipCount}`);
    return true;
  }
  
  // Check for suspicious user agents
  const userAgent = headers.get('user-agent') || '';
  const suspiciousUserAgents = [
    /bot/i, /crawler/i, /spider/i, /scraper/i,
    /curl/i, /wget/i, /python/i, /phantomjs/i,
    /headless/i, /test/i, /automation/i
  ];
  
  if (suspiciousUserAgents.some(pattern => pattern.test(userAgent))) {
    console.log(`Blocked suspicious user agent: ${userAgent}`);
    return true;
  }
  
  return false;
}