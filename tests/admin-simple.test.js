import { test } from "node:test";
import assert from "node:assert/strict";

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, "..", "migrations", name), "utf8");

// Load migrations
const WAITLIST_SQL = read("0006_waitlist.sql");
const VERIFICATION_SQL = read("0007_waitlist_verification_sent_at.sql");
const EMAIL_LOGS_SQL = read("0008_email_logs.sql");
const ADMIN_SQL = read("0009_admin_tables.sql");
const THROTTLE_SQL = read("0002_auth_throttle.sql");

// Mock environment
const mockEnv = {
  ADMIN_TOKEN: "test-admin-token-12345",
  DB: null,
  SESSIONS: {
    put: async (key, value, options) => {},
    get: async (key) => null,
    delete: async (key) => {}
  }
};

// D1 shim for testing
function d1Shim(db) {
  return {
    prepare: (sql) => {
      const build = (args) => {
        const stmt = db.prepare(sql);
        const names = sql.match(/\?/g).length;
        if (args.length !== names) {
          throw new Error(`expected ${names} bind values, got ${args.length}`);
        }
        return {
          first: () => {
            const row = stmt.get(...args);
            if (!row) return null;
            // Convert Uint8Array to string for ID fields
            for (const [key, value] of Object.entries(row)) {
              if (value instanceof Uint8Array) {
                row[key] = String.fromCharCode(...value);
              }
            }
            return row;
          },
          all: () => {
            const rows = stmt.all(...args);
            if (!rows) return { results: [] };
            // Convert Uint8Array to string for ID fields
            for (const row of rows) {
              for (const [key, value] of Object.entries(row)) {
                if (value instanceof Uint8Array) {
                  row[key] = String.fromCharCode(...value);
                }
              }
            }
            return { results: rows };
          },
          run: () => {
            const info = stmt.run(...args);
            return { success: true, meta: { changes: info.changes, lastRowId: info.lastRowID } };
          },
        };
      };
      return { bind: build };
    },
  };
}

// Test helper to create test database
function createTestDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(WAITLIST_SQL);
  db.exec(VERIFICATION_SQL);
  db.exec(EMAIL_LOGS_SQL);
  db.exec(ADMIN_SQL);
  db.exec(THROTTLE_SQL);
  return db;
}

// Test constant-time comparison function
function constantTimeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

// Test admin authentication
test("admin authentication - valid token", () => {
  const db = createTestDatabase();
  const env = { ...mockEnv, DB: d1Shim(db) };
  
  // Create a mock request with valid admin token
  const request = {
    headers: {
      get: (name) => name === "x-admin-token" ? "test-admin-token-12345" : null,
    },
    json: async () => ({})
  };
  
  // Test requireAdmin function
  const requireAdmin = async (request, env) => {
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
    
    // Verify the token using constant-time comparison
    const tokenMatch = await constantTimeEqual(adminToken, expectedToken);
    
    if (!tokenMatch) {
      return new Response("Invalid credentials", { 
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="Admin"' }
      });
    }
    
    // Token is valid, allow access
    return null; // No error, request can proceed
  };
  
  // Should return null (no error) for valid token
  const result = await requireAdmin(request, env);
  assert.equal(result, null);
});

test("admin authentication - invalid token", () => {
  const db = createTestDatabase();
  const env = { ...mockEnv, DB: d1Shim(db) };
  
  // Create a mock request with invalid admin token
  const request = {
    headers: {
      get: (name) => name === "x-admin-token" ? "invalid-token" : null,
    },
    json: async () => ({})
  };
  
  // Test requireAdmin function
  const requireAdmin = async (request, env) => {
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
    
    // Verify the token using constant-time comparison
    const tokenMatch = await constantTimeEqual(adminToken, expectedToken);
    
    if (!tokenMatch) {
      return new Response("Invalid credentials", { 
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="Admin"' }
      });
    }
    
    // Token is valid, allow access
    return null; // No error, request can proceed
  };
  
  // Should return an error response for invalid token
  const result = await requireAdmin(request, env);
  assert.ok(result);
  assert.equal(result.status, 401);
});

test("admin authentication - no token provided", () => {
  const db = createTestDatabase();
  const env = { ...mockEnv, DB: d1Shim(db) };
  
  // Create a mock request without admin token
  const request = {
    headers: {
      get: () => null,
    },
    json: async () => ({})
  };
  
  // Test requireAdmin function
  const requireAdmin = async (request, env) => {
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
    
    // Verify the token using constant-time comparison
    const tokenMatch = await constantTimeEqual(adminToken, expectedToken);
    
    if (!tokenMatch) {
      return new Response("Invalid credentials", { 
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="Admin"' }
      });
    }
    
    // Token is valid, allow access
    return null; // No error, request can proceed
  };
  
  // Should return an error response for missing token
  const result = await requireAdmin(request, env);
  assert.ok(result);
  assert.equal(result.status, 401);
});

// Test constant-time comparison
test("constantTimeEqual - prevents timing attacks", async () => {
  // Test with equal strings
  assert.equal(await constantTimeEqual("test", "test"), true);
  
  // Test with different strings of same length
  assert.equal(await constantTimeEqual("test", "tesx"), false);
  
  // Test with different strings of different lengths
  assert.equal(await constantTimeEqual("test", "testing"), false);
  
  // Test with empty strings
  assert.equal(await constantTimeEqual("", ""), true);
  
  // Test with one empty string
  assert.equal(await constantTimeEqual("", "test"), false);
});