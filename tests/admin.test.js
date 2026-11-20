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

// Mock fetch for API calls
let mockFetchCalls = [];
const originalFetch = globalThis.fetch;

function resetMockFetch() {
  mockFetchCalls = [];
  globalThis.fetch = async (url, init) => {
    mockFetchCalls.push({ url, init });
    
    if (String(url).includes("resend.com")) {
      // Mock email delivery
      const body = JSON.parse(String(init?.body || "{}"));
      return { ok: true, json: async () => ({ id: "msg-123" }) };
    }
    
    return { ok: true, json: async () => ({}) };
  };
}

function restoreMockFetch() {
  globalThis.fetch = originalFetch;
}

// Test admin authentication
test("admin authentication - valid token", () => {
  resetMockFetch();
  
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
  const { requireAdmin } = eval(`(${readFileSync("./functions/_lib/admin-auth.js", "utf8")})`);
  
  // Should return null (no error) for valid token
  const result = requireAdmin(request, env);
  assert.equal(result, null);
  
  restoreMockFetch();
});

test("admin authentication - invalid token", () => {
  resetMockFetch();
  
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
  const { requireAdmin } = eval(`(${readFileSync("./functions/_lib/admin-auth.js", "utf8")})`);
  
  // Should return an error response for invalid token
  const result = requireAdmin(request, env);
  assert.ok(result);
  assert.equal(result.status, 401);
  
  restoreMockFetch();
});

test("admin authentication - no token provided", () => {
  resetMockFetch();
  
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
  const { requireAdmin } = eval(`(${readFileSync("./functions/_lib/admin-auth.js", "utf8")})`);
  
  // Should return an error response for missing token
  const result = requireAdmin(request, env);
  assert.ok(result);
  assert.equal(result.status, 401);
  
  restoreMockFetch();
});

// Test admin login
test("admin login - valid token", () => {
  resetMockFetch();
  
  const db = createTestDatabase();
  const env = { ...mockEnv, DB: d1Shim(db) };
  
  // Mock session storage
  const sessionData = {};
  env.SESSIONS = {
    put: async (key, value, options) => {
      sessionData[key] = value;
    },
    get: async (key) => sessionData[key] || null,
    delete: async (key) => {
      delete sessionData[key];
    }
  };
  
  // Create a mock request with valid admin token
  const request = {
    json: async () => ({ token: "test-admin-token-12345" })
  };
  
  // Test login function
  const { onRequestPost } = eval(`(${readFileSync("./functions/admin/login.js", "utf8")})`);
  
  // Should return success response
  onRequestPost({ request, env }).then((response) => {
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body);
    assert.ok(data.success);
    assert.ok(data.token);
    assert.ok(data.expiresAt);
    
    // Verify session was stored
    assert.ok(sessionData[`admin_${data.token}`]);
  });
  
  restoreMockFetch();
});

test("admin login - invalid token", () => {
  resetMockFetch();
  
  const db = createTestDatabase();
  const env = { ...mockEnv, DB: d1Shim(db) };
  
  // Create a mock request with invalid admin token
  const request = {
    json: async () => ({ token: "invalid-token" })
  };
  
  // Test login function
  const { onRequestPost } = eval(`(${readFileSync("./functions/admin/login.js", "utf8")})`);
  
  // Should return error response
  onRequestPost({ request, env }).then((response) => {
    assert.equal(response.status, 401);
    const data = JSON.parse(response.body);
    assert.equal(data.error, "Invalid credentials");
  });
  
  restoreMockFetch();
});

// Test dashboard API
test("dashboard API - returns overview data", () => {
  resetMockFetch();
  
  const db = createTestDatabase();
  const env = { ...mockEnv, DB: d1Shim(db) };
  
  // Add test data
  const now = Date.now();
  db.prepare(`
    INSERT INTO waitlist (id, email, name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "test-user-1",
    "user1@example.com",
    "User One",
    "verified",
    now,
    now
  );
  
  db.prepare(`
    INSERT INTO waitlist (id, email, name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "test-user-2",
    "user2@example.com",
    "User Two",
    "pending",
    now,
    now
  );
  
  // Add test admin action
  db.prepare(`
    INSERT INTO admin_actions (id, admin_id, admin_email, action, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "test-action-1",
    "admin",
    "admin@bucksy.life",
    "Test action",
    now
  );
  
  // Create a mock request with valid admin token
  const request = {
    headers: {
      get: (name) => name === "Authorization" ? "Bearer test-admin-token-12345" : null,
    },
  };
  
  // Test dashboard API
  const { onRequestGet } = eval(`(${readFileSync("./functions/admin/api/dashboard.js", "utf8")})`);
  
  // Should return dashboard data
  onRequestGet({ request, env }).then((response) => {
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body);
    
    // Check that we have the expected data structure
    assert.ok(data.totalRegistrations);
    assert.ok(data.verifiedRegistrations);
    assert.ok(data.pendingRegistrations);
    assert.ok(data.growthData);
    assert.ok(data.countryData);
    assert.ok(data.totalReferrals);
    assert.ok(data.topReferrer);
    assert.ok(data.conversionRate);
    
    // Check that the data matches our test data
    assert.equal(data.totalRegistrations, 2);
    assert.equal(data.verifiedRegistrations, 1);
    assert.equal(data.pendingRegistrations, 1);
  });
  
  restoreMockFetch();
});

// Test waitlist API
test("waitlist API - returns user data", () => {
  resetMockFetch();
  
  const db = createTestDatabase();
  const env = { ...mockEnv, DB: d1Shim(db) };
  
  // Add test data
  const now = Date.now();
  db.prepare(`
    INSERT INTO waitlist (id, email, name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "test-user-1",
    "user1@example.com",
    "User One",
    "verified",
    now,
    now
  );
  
  // Create a mock request with valid admin token
  const request = {
    headers: {
      get: (name) => name === "Authorization" ? "Bearer test-admin-token-12345" : null,
    },
    url: new URL("http://localhost/admin/api/waitlist?status=verified"),
  };
  
  // Test waitlist API
  const { onRequestGet } = eval(`(${readFileSync("./functions/admin/api/waitlist.js", "utf8")})`);
  
  // Should return waitlist data
  onRequestGet({ request, env }).then((response) => {
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body);
    
    // Check that we have the expected data structure
    assert.ok(data.users);
    assert.ok(data.pagination);
    
    // Check that the data matches our test data
    assert.equal(data.users.length, 1);
    assert.equal(data.users[0].email, "user1@example.com");
    assert.equal(data.users[0].status, "verified");
  });
  
  restoreMockFetch();
});

// Test invite API
test("invite API - sends invitations to users", () => {
  resetMockFetch();
  
  const db = createTestDatabase();
  const env = { ...mockEnv, DB: d1Shim(db) };
  
  // Add test data
  const now = Date.now();
  db.prepare(`
    INSERT INTO waitlist (id, email, name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "test-user-1",
    "user1@example.com",
    "User One",
    "verified",
    now,
    now
  );
  
  // Create a mock request with valid admin token
  const request = {
    headers: {
      get: (name) => name === "Authorization" ? "Bearer test-admin-token-12345" : null,
    },
    json: async () => ({ userIds: ["test-user-1"], expiryDays: 14 })
  };
  
  // Test invite API
  const { onRequestPost } = eval(`(${readFileSync("./functions/admin/api/invite.js", "utf8")})`);
  
  // Should send invitations
  onRequestPost({ request, env }).then((response) => {
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body);
    
    // Check that the operation was successful
    assert.ok(data.success);
    assert.equal(data.sentCount, 1);
    assert.equal(data.total, 1);
    
    // Check that the user status was updated
    const user = db.prepare("SELECT * FROM waitlist WHERE id = ?").bind("test-user-1").first();
    assert.equal(user.status, "invited");
  });
  
  restoreMockFetch();
});

// Test audit API
test("audit API - returns admin actions", () => {
  resetMockFetch();
  
  const db = createTestDatabase();
  const env = { ...mockEnv, DB: d1Shim(db) };
  
  // Add test data
  const now = Date.now();
  db.prepare(`
    INSERT INTO admin_actions (id, admin_id, admin_email, action, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "test-action-1",
    "admin",
    "admin@bucksy.life",
    "Test action",
    JSON.stringify({ userId: "test-user-1" }),
    now
  );
  
  // Create a mock request with valid admin token
  const request = {
    headers: {
      get: (name) => name === "Authorization" ? "Bearer test-admin-token-12345" : null,
    },
  };
  
  // Test audit API
  const { onRequestGet } = eval(`(${readFileSync("./functions/admin/api/audit.js", "utf8")})`);
  
  // Should return audit data
  onRequestGet({ request, env }).then((response) => {
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body);
    
    // Check that we have the expected data structure
    assert.ok(data.logs);
    assert.ok(data.pagination);
    
    // Check that the data matches our test data
    assert.equal(data.logs.length, 1);
    assert.equal(data.logs[0].adminId, "admin");
    assert.equal(data.logs[0].adminEmail, "admin@bucksy.life");
    assert.equal(data.logs[0].action, "Test action");
  });
  
  restoreMockFetch();
});

// Test constant-time comparison
test("constantTimeEqual - prevents timing attacks", async () => {
  const { constantTimeEqual } = eval(`(${readFileSync("./functions/_lib/admin-auth.js", "utf8")})`);
  
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