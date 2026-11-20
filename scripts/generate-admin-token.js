#!/usr/bin/env node

/**
 * Generate Admin Token
 * 
 * This script generates a secure admin token for the Bucksy admin dashboard.
 */

const crypto = require('crypto');

function generateAdminToken() {
  return crypto.randomBytes(32).toString('base64');
}

function generateSecureToken() {
  // Generate a more secure token with timestamp and randomness
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(16).toString('base64');
  const combined = `${timestamp}-${random}`;
  
  // Hash the combined string for consistent length
  const hash = crypto.createHash('sha256').update(combined).digest('base64');
  
  // Remove non-alphanumeric characters and truncate to appropriate length
  const clean = hash.replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  
  return clean;
}

console.log('🔑 Generating admin tokens for Bucksy...');
console.log('');

// Generate different types of tokens
console.log('Basic Base64 Token:');
console.log(generateAdminToken());
console.log('');

console.log('Secure Hashed Token:');
console.log(generateSecureToken());
console.log('');

console.log('UUID Format:');
console.log(crypto.randomUUID());
console.log('');

console.log('💡 Recommended: Use the Secure Hashed Token above');
console.log('   Copy this token and add it to your pages.toml file:');
console.log('');
console.log('   ADMIN_TOKEN = "' + generateSecureToken() + '"');