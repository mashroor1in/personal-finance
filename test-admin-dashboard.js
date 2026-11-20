#!/usr/bin/env node

/**
 * Admin Dashboard Test Script
 * 
 * This script tests the admin dashboard functionality by:
 * 1. Testing admin authentication
 * 2. Testing waitlist management
 * 3. Testing email communication
 * 4. Testing audit logging
 * 5. Testing invitation management
 */

const fs = require('fs');
const path = require('path');

// Test configuration
const config = {
  adminToken: 'mehgEdEV3aeASWuaqvgsJK0NfziQev2B',
  baseUrl: 'http://localhost:8787',
  testEmails: [
    'test1@example.com',
    'test2@example.com',
    'test3@example.com'
  ]
};

// Test results
const results = {
  passed: 0,
  failed: 0,
  errors: []
};

// Helper function to make HTTP requests
async function makeRequest(endpoint, options = {}) {
  const url = `${config.baseUrl}${endpoint}`;
  const defaultOptions = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.adminToken}`
    }
  };
  
  const mergedOptions = { ...defaultOptions, ...options };
  
  try {
    const response = await fetch(url, mergedOptions);
    const data = await response.text();
    
    return {
      status: response.status,
      ok: response.ok,
      data: data,
      json: data ? JSON.parse(data) : null
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      error: error.message
    };
  }
}

// Test 1: Admin Authentication
async function testAdminAuthentication() {
  console.log('Testing admin authentication...');
  
  const response = await makeRequest('/admin/login');
  
  if (response.status === 200 && response.json.success) {
    results.passed++;
    console.log('✓ Admin authentication test passed');
  } else {
    results.failed++;
    results.errors.push('Admin authentication failed');
    console.log('✗ Admin authentication test failed');
  }
}

// Test 2: Dashboard Data
async function testDashboardData() {
  console.log('Testing dashboard data...');
  
  const response = await makeRequest('/admin/api/dashboard');
  
  if (response.status === 200 && 
      response.json.waitlistStats && 
      response.json.emailStats && 
      response.json.referralStats) {
    results.passed++;
    console.log('✓ Dashboard data test passed');
  } else {
    results.failed++;
    results.errors.push('Dashboard data test failed');
    console.log('✗ Dashboard data test failed');
  }
}

// Test 3: Waitlist Management
async function testWaitlistManagement() {
  console.log('Testing waitlist management...');
  
  // Test getting waitlist data
  const response = await makeRequest('/admin/api/waitlist');
  
  if (response.status === 200 && response.json.users) {
    results.passed++;
    console.log('✓ Waitlist data test passed');
  } else {
    results.failed++;
    results.errors.push('Waitlist data test failed');
    console.log('✗ Waitlist data test failed');
    return;
  }
  
  // Test waitlist search
  const searchResponse = await makeRequest('/admin/api/waitlist?search=test');
  
  if (searchResponse.status === 200 && searchResponse.json.users) {
    results.passed++;
    console.log('✓ Waitlist search test passed');
  } else {
    results.failed++;
    results.errors.push('Waitlist search test failed');
    console.log('✗ Waitlist search test failed');
  }
  
  // Test waitlist export
  const exportResponse = await makeRequest('/admin/api/waitlist/export', {
    method: 'POST',
    body: JSON.stringify({ format: 'csv' })
  });
  
  if (exportResponse.status === 200 && exportResponse.data.includes('ID,Email,Name,Status')) {
    results.passed++;
    console.log('✓ Waitlist export test passed');
  } else {
    results.failed++;
    results.errors.push('Waitlist export test failed');
    console.log('✗ Waitlist export test failed');
  }
}

// Test 4: Email Communication
async function testEmailCommunication() {
  console.log('Testing email communication...');
  
  // Test getting email logs
  const response = await makeRequest('/admin/api/emails');
  
  if (response.status === 200 && response.json.emails) {
    results.passed++;
    console.log('✓ Email logs test passed');
  } else {
    results.failed++;
    results.errors.push('Email logs test failed');
    console.log('✗ Email logs test failed');
    return;
  }
  
  // Test email statistics
  if (response.json.stats) {
    results.passed++;
    console.log('✓ Email statistics test passed');
  } else {
    results.failed++;
    results.errors.push('Email statistics test failed');
    console.log('✗ Email statistics test failed');
  }
}

// Test 5: Audit Logging
async function testAuditLogging() {
  console.log('Testing audit logging...');
  
  // Test getting audit logs
  const response = await makeRequest('/admin/api/audit');
  
  if (response.status === 200 && response.json.logs) {
    results.passed++;
    console.log('✓ Audit logs test passed');
  } else {
    results.failed++;
    results.errors.push('Audit logs test failed');
    console.log('✗ Audit logs test failed');
  }
  
  // Test audit export
  const exportResponse = await makeRequest('/admin/api/audit/export', {
    method: 'POST',
    body: JSON.stringify({ filters: {} })
  });
  
  if (exportResponse.status === 200 && exportResponse.data.includes('ID,Admin ID,Admin Email,Action')) {
    results.passed++;
    console.log('✓ Audit export test passed');
  } else {
    results.failed++;
    results.errors.push('Audit export test failed');
    console.log('✗ Audit export test failed');
  }
}

// Test 6: Invitation Management
async function testInvitationManagement() {
  console.log('Testing invitation management...');
  
  // Test getting countries
  const response = await makeRequest('/admin/api/countries');
  
  if (response.status === 200 && response.json.countries) {
    results.passed++;
    console.log('✓ Countries test passed');
  } else {
    results.failed++;
    results.errors.push('Countries test failed');
    console.log('✗ Countries test failed');
  }
}

// Run all tests
async function runTests() {
  console.log('Starting admin dashboard tests...\n');
  
  await testAdminAuthentication();
  await testDashboardData();
  await testWaitlistManagement();
  await testEmailCommunication();
  await testAuditLogging();
  await testInvitationManagement();
  
  // Print results
  console.log('\n=== Test Results ===');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Total: ${results.passed + results.failed}`);
  
  if (results.errors.length > 0) {
    console.log('\n=== Errors ===');
    results.errors.forEach(error => console.log(`- ${error}`));
  }
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run the tests
runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});