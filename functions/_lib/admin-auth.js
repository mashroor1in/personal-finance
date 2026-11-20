/**
 * Bucksy Admin Authentication Middleware
 * 
 * Provides secure authentication for admin endpoints using a token-based system.
 * Validates the admin token from environment variables and enforces authorization.
 */

export async function requireAdmin(request, env) {
  // Get the admin token from the request header
  const adminToken = request.headers.get("x-admin-token");
  
  // Get the expected token from environment
  const expectedToken = env.ADMIN_TOKEN;
  
  // If no token is configured, deny access
  if (!expectedToken) {
    return new Response("Admin access not configured", { status: 401 });
  }
  
  // If no token provided, deny access
  if (!adminToken) {
    return new Response("Authentication required", { 
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="Admin"' }
    });
  }
  
  // Verify the token using constant-time comparison to prevent timing attacks
  const tokenMatch = await constantTimeEqual(adminToken, expectedToken);
  
  if (!tokenMatch) {
    return new Response("Invalid credentials", { 
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="Admin"' }
    });
  }
  
  // Token is valid, allow access
  return null; // No error, request can proceed
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
async function constantTimeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}