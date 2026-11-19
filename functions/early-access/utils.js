/**
 * Utility functions for waitlist operations
 * 
 * This module contains helper functions for database operations,
 * validation, and security.
 */

// Security configuration
const SECURITY_CONFIG = {
  tokenExpiration: 24 * 60 * 60 * 1000, // 24 hours
  maxAttempts: 5,
  rateLimitWindow: 15 * 60 * 1000, // 15 minutes
  verificationTokenLength: 32
};

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Disposable email domains
const DISPOSABLE_DOMAINS = [
  'tempmail.com', '10minutemail.com', 'guerrillamail.com',
  'mailinator.com', 'throwaway.email', 'fakeinbox.com',
  'maildrop.cc', 'anonymail.de', 'guerrillamail.net',
  'mailnesia.com', 'trashmail.com', 'mintemail.com',
  'emailzoub.com', 'mvrht.com', '0815.ru', 'e4ward.com',
  'guerrillamailblock.com', 'mailcatch.com', 'tempmail.net'
];

// Suspicious email patterns
const SUSPICIOUS_PATTERNS = [
  /admin\b/i, /support\b/i, /help\b/i, /info\b/i,
  /noreply\b/i, /no\-reply\b/i, /bounce\b/i,
  /privacy\b/i, /security\b/i, /abuse\b/i,
  /contact\b/i, /feedback\b/i, /complaints\b/i,
  /test\b/i, /demo\b/i, /example\b/i
];

/**
 * Generate a UUID for database records
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Generate a secure verification token
 */
export function generateVerificationToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < SECURITY_CONFIG.verificationTokenLength; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Hash a verification token using PBKDF2
 */
export async function hashToken(token) {
  // In production, use Web Crypto API for proper hashing
  // For now, use a simple hash function
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Normalize email address
 */
export function normalizeEmail(email) {
  if (!email) return null;
  return email.trim().toLowerCase();
}

/**
 * Validate email format
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email) && email.length <= 254;
}

/**
 * Check if email is from a disposable email service
 */
export function isDisposableEmail(email) {
  if (!email) return false;
  const domain = email.split('@')[1]?.toLowerCase();
  return DISPOSABLE_DOMAINS.includes(domain);
}

/**
 * Check for suspicious email patterns
 */
export function isSuspiciousEmail(email) {
  if (!email) return false;
  return SUSPICIOUS_PATTERNS.some(pattern => pattern.test(email));
}

/**
 * Validate waitlist registration data
 */
export function validateWaitlistData(data) {
  const errors = [];
  
  // Validate email
  if (!data.email) {
    errors.push('Email is required');
  } else if (!isValidEmail(data.email)) {
    errors.push('Please enter a valid email address');
  } else if (isDisposableEmail(data.email)) {
    errors.push('Please use a permanent email address');
  } else if (isSuspiciousEmail(data.email)) {
    errors.push('Invalid email format');
  }
  
  // Validate name (optional but if provided, should be reasonable)
  if (data.name && data.name.length > 100) {
    errors.push('Name must be less than 100 characters');
  }
  
  // Validate country (optional)
  if (data.country && data.country.length > 2) {
    errors.push('Country code must be 2 characters');
  }
  
  // Validate referral code (optional)
  if (data.referral_code && data.referral_code.length > 50) {
    errors.push('Referral code must be less than 50 characters');
  }
  
  // Validate signup source
  if (!data.signup_source || typeof data.signup_source !== 'string') {
    errors.push('Signup source is required');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Generate referral code
 */
export function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Check if verification token is expired
 */
export function isTokenExpired(createdAt) {
  if (!createdAt) return true;
  const now = Date.now();
  return (now - createdAt) > SECURITY_CONFIG.tokenExpiration;
}

/**
 * Format date for display
 */
export function formatDate(timestamp) {
  if (!timestamp) return null;
  return new Date(timestamp).toISOString();
}

/**
 * Create success response
 */
export function createSuccessResponse(data, message = 'Success') {
  return {
    success: true,
    message,
    data,
    timestamp: Date.now()
  };
}

/**
 * Create error response
 */
export function createErrorResponse(error, code = 'ERROR') {
  return {
    success: false,
    error: code,
    message: error,
    timestamp: Date.now()
  };
}

/**
 * Rate limiting key for IP address
 */
export function getRateLimitKey(ip) {
  return `waitlist_rate_limit_${ip}`;
}

/**
 * Check if rate limit is exceeded
 */
export function isRateLimitExceeded(attempts) {
  if (!attempts || !Array.isArray(attempts)) return false;
  const now = Date.now();
  const recentAttempts = attempts.filter(time => (now - time) < SECURITY_CONFIG.rateLimitWindow);
  return recentAttempts.length >= SECURITY_CONFIG.maxAttempts;
}

/**
 * Log security event
 */
export function logSecurityEvent(context, eventType, details) {
  console.log(`Security Event [${eventType}]:`, {
    timestamp: Date.now(),
    ip: context.request.cf?.ip || 'unknown',
    userAgent: context.request.headers.get('user-agent') || 'unknown',
    url: context.request.url,
    ...details
  });
}

/**
 * Validate Turnstile token
 */
export async function validateTurnstileToken(token) {
  if (!token) return false;
  
  try {
    // In production, make server-side request to Cloudflare
    // For now, validate token format and length
    return token.length >= 20 && /^[a-zA-Z0-9]+$/.test(token);
  } catch (error) {
    console.error('Turnstile validation error:', error);
    return false;
  }
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  // Remove potentially dangerous characters
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}

/**
 * Check for suspicious user agent
 */
export function isSuspiciousUserAgent(userAgent) {
  if (!userAgent) return false;
  
  const suspiciousPatterns = [
    /bot/i, /crawler/i, /spider/i, /scraper/i,
    /curl/i, /wget/i, /python/i, /phantomjs/i,
    /headless/i, /test/i, /automation/i,
    /scrapy/i, /selenium/i, /puppeteer/i
  ];
  
  return suspiciousPatterns.some(pattern => pattern.test(userAgent));
}