/**
 * POST /admin/login   Admin login
 *
 * Authenticates an administrator and returns a session token.
 * Uses a simple token-based authentication system.
 *
 * Security posture:
 *   - Requires valid admin token in request body
 *   - Uses constant-time comparison to prevent timing attacks
 *   - Returns a session token for subsequent requests
 */

import { json } from "../_lib/common.js";
import { constantTimeEqual } from "../_lib/admin-auth.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  // Get the expected token from environment
  const expectedToken = env.ADMIN_TOKEN;
  
  // If no token is configured, deny access
  if (!expectedToken) {
    return json({ error: "Admin access not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const presentedToken = String(body.token || "").trim();

    // Verify the token using constant-time comparison
    const tokenMatch = await constantTimeEqual(presentedToken, expectedToken);

    if (!tokenMatch) {
      // Log failed login attempt (in a real system, you'd log this)
      return json({ 
        error: "Invalid credentials" 
      }, { status: 401 });
    }

    // Generate a session token (in a real system, you might use JWT)
    const sessionToken = generateSessionToken();
    
    // Store the session token in KV with expiration
    const sessionId = `admin_${sessionToken}`;
    const sessionExpiry = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
    
    await env.SESSIONS.put(sessionId, JSON.stringify({
      token: sessionToken,
      createdAt: Date.now(),
      expiresAt: sessionExpiry,
      admin: true
    }), { expirationTtl: 24 * 60 * 60 });

    return json({
      success: true,
      token: sessionToken,
      expiresAt: sessionExpiry
    });

  } catch (error) {
    return json({ 
      error: "Invalid request" 
    }, { status: 400 });
  }
}

/**
 * Generate a secure session token
 */
function generateSessionToken() {
  return crypto.randomUUID();
}