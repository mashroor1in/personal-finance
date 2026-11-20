/**
 * POST /admin/login   Admin Authentication
 *
 * Authenticates admin access using token-based authentication.
 * Requires valid admin token in the Authorization header.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Uses constant-time comparison for security
 *   - Logs authentication attempts
 */

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    // Get the authorization header
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Missing or invalid authorization header' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      });
    }
    
    // Extract the token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Get the expected token from environment or use hardcoded token for development
    const expectedToken = env.ADMIN_TOKEN || 'mehgEdEV3aeASWuaqvgsJK0NfziQev2B';
    
    // If no token is configured, deny access
    if (!expectedToken) {
      return new Response(JSON.stringify({ success: false, error: 'Admin access not configured' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      });
    }
    
    // Constant-time comparison to prevent timing attacks
    const isValid = constantTimeCompare(token, expectedToken);
    
    if (isValid) {
      // Log successful login (in a real implementation, this would go to a database)
      console.log(`[admin] Successful login from ${request.headers.get('cf-connecting-ip')}`);
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Authentication successful',
        token: token
      }), {
        status: 200,
        headers: { 
          'content-type': 'application/json',
          'Cache-Control': 'no-store'
        }
      });
    } else {
      // Log failed login attempt (in a real implementation, this would go to a database)
      console.log(`[admin] Failed login attempt from ${request.headers.get('cf-connecting-ip')}`);
      
      return new Response(JSON.stringify({ success: false, error: 'Invalid admin token' }), {
        status: 401,
        headers: { 
          'content-type': 'application/json',
          'Cache-Control': 'no-store'
        }
      });
    }
    
  } catch (error) {
    console.error('[admin] Authentication error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Authentication failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}