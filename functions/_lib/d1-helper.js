/**
 * Cloudflare Pages D1 Database Helper
 * 
 * Provides direct access to D1 database bindings for Cloudflare Pages.
 */

/**
 * Execute a query with D1 binding
 */
export async function queryD1(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    const result = await stmt.all(...params);
    return result.results || result;
  } catch (error) {
    console.error("[database] Error executing query:", error);
    throw error;
  }
}

/**
 * Execute a query that returns a single row with D1 binding
 */
export async function queryFirstD1(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    const result = await stmt.get(...params);
    return result;
  } catch (error) {
    console.error("[database] Error executing query:", error);
    throw error;
  }
}

/**
 * Execute a query that modifies data with D1 binding
 */
export async function runD1(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    const result = await stmt.run(...params);
    return result;
  } catch (error) {
    console.error("[database] Error executing query:", error);
    throw error;
  }
}

/**
 * Get database from environment (for Pages)
 */
export function getDatabaseFromEnv(env) {
  // For Cloudflare Pages, D1 databases are available as properties on env
  if (env.bucksy_db) {
    return env.bucksy_db;
  }
  
  throw new Error("Database binding not found in environment");
}