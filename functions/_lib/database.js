/**
 * Cloudflare Pages Database Client
 * 
 * Provides a database interface for Cloudflare Pages functions.
 * Connects to D1 database through environment variables.
 */

import { Database } from "sqlite3";
import { open } from "sqlite";
import { sqlite3 } from "sqlite3";

// Database connection cache
let dbConnection = null;

/**
 * Get database connection
 */
export async function getDatabase(env) {
  if (dbConnection) {
    return dbConnection;
  }
  
  try {
    // For Cloudflare Pages, we need to use the D1 binding
    // In Pages, D1 databases are accessed through the env object
    if (env.bucksy_db) {
      // This is a Cloudflare Pages environment with D1 binding
      dbConnection = env.bucksy_db;
      return dbConnection;
    }
    
    // For local development or fallback
    const databaseUrl = env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("No database connection available");
    }
    
    // Open database connection
    dbConnection = await open({
      filename: databaseUrl,
      driver: sqlite3.Database
    });
    
    // Enable foreign keys
    await dbConnection.exec("PRAGMA foreign_keys = ON;");
    
    return dbConnection;
  } catch (error) {
    console.error("[database] Error connecting to database:", error);
    throw new Error("Failed to connect to database");
  }
}

/**
 * Execute a query with parameters
 */
export async function query(env, sql, params = []) {
  const db = await getDatabase(env);
  
  try {
    // For Cloudflare Pages D1 binding
    if (db && typeof db.prepare === 'function') {
      const stmt = db.prepare(sql);
      const result = await stmt.all(...params);
      return result.results || result;
    }
    
    // For SQLite directly
    const stmt = db.prepare(sql);
    const result = await stmt.all(...params);
    return result;
  } catch (error) {
    console.error("[database] Error executing query:", error);
    throw error;
  }
}

/**
 * Execute a query that returns a single row
 */
export async function queryFirst(env, sql, params = []) {
  const db = await getDatabase(env);
  
  try {
    // For Cloudflare Pages D1 binding
    if (db && typeof db.prepare === 'function') {
      const stmt = db.prepare(sql);
      const result = await stmt.get(...params);
      return result;
    }
    
    // For SQLite directly
    const stmt = db.prepare(sql);
    const result = await stmt.get(...params);
    return result;
  } catch (error) {
    console.error("[database] Error executing query:", error);
    throw error;
  }
}

/**
 * Execute a query that modifies data
 */
export async function run(env, sql, params = []) {
  const db = await getDatabase(env);
  
  try {
    // For Cloudflare Pages D1 binding
    if (db && typeof db.prepare === 'function') {
      const stmt = db.prepare(sql);
      const result = await stmt.run(...params);
      return result;
    }
    
    // For SQLite directly
    const stmt = db.prepare(sql);
    const result = await stmt.run(...params);
    return result;
  } catch (error) {
    console.error("[database] Error executing query:", error);
    throw error;
  }
}

/**
 * Begin a transaction
 */
export async function beginTransaction(env) {
  const db = await getDatabase(env);
  await db.exec("BEGIN TRANSACTION;");
}

/**
 * Commit a transaction
 */
export async function commitTransaction(env) {
  const db = await getDatabase(env);
  await db.exec("COMMIT;");
}

/**
 * Rollback a transaction
 */
export async function rollbackTransaction(env) {
  const db = await getDatabase(env);
  await db.exec("ROLLBACK;");
}

/**
 * Execute multiple queries in a transaction
 */
export async function transaction(env, queries) {
  await beginTransaction(env);
  
  try {
    for (const query of queries) {
      await run(env, query.sql, query.params);
    }
    await commitTransaction(env);
  } catch (error) {
    await rollbackTransaction(env);
    throw error;
  }
}

/**
 * Close database connection
 */
export async function closeDatabase() {
  if (dbConnection) {
    await dbConnection.close();
    dbConnection = null;
  }
}