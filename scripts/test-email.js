#!/usr/bin/env node

/**
 * Email Delivery Test Script
 * 
 * Tests the email delivery functionality in a development environment
 * without actually sending emails. This script validates:
 * - Email templates render correctly
 * - Email provider configuration is valid
 * - Email service methods work as expected
 * 
 * Usage:
 *   node scripts/test-email.js
 */

import { EmailProvider, EmailTemplate, EmailService, EMAIL_TYPE } from "../functions/_lib/email.js";

// Mock environment for testing
const testEnv = {
  NODE_ENV: "development",
  RESEND_API_KEY: "test-key",
  WAITLIST_FROM_EMAIL: "test@example.com",
  DB: {
    prepare: () => ({
      bind: () => ({
        run: () => {}, // Mock successful run
      }),
    }),
  },
};

console.log("📧 Testing Bucksy Email Delivery System\n");

// Test 1: Email Provider Configuration
console.log("1. Testing Email Provider Configuration...");
try {
  const provider = new EmailProvider(testEnv);
  console.log(`✅ Provider: ${provider.provider}`);
  console.log(`✅ API URL: ${provider.config.api}`);
  console.log(`✅ From Email: ${provider.config.from}`);
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}

// Test 2: Email Templates
console.log("\n2. Testing Email Templates...");
const templateTypes = [
  EMAIL_TYPE.WELCOME,
  EMAIL_TYPE.VERIFICATION, 
  EMAIL_TYPE.VERIFICATION_CONFIRMATION,
  EMAIL_TYPE.INVITATION,
  EMAIL_TYPE.INVITATION_REMINDER,
  EMAIL_TYPE.LAUNCH_ANNOUNCEMENT
];

for (const type of templateTypes) {
  try {
    const template = new EmailTemplate(type, { 
      name: "Test User",
      verificationLink: "https://bucksy.life/verify?token=test123",
      invitationLink: "https://bucksy.life/invite?token=test456",
      countdown: "3 days"
    });
    
    const html = template.renderHTML();
    const text = template.renderText();
    
    console.log(`✅ ${type}: HTML (${html.length} chars), Text (${text.length} chars)`);
    
    // Basic validation
    if (!html.includes("Bucksy")) {
      console.log(`❌ ${type}: Missing Bucksy branding`);
    }
    
    if (!text.includes("Bucksy Team")) {
      console.log(`❌ ${type}: Missing signature`);
    }
  } catch (error) {
    console.log(`❌ ${type}: Error - ${error.message}`);
  }
}

// Test 3: Email Service
console.log("\n3. Testing Email Service...");
try {
  const service = new EmailService(testEnv);
  
  // Mock the provider to not actually send
  const mockSend = async () => ({ success: true, id: "msg-123" });
  service.provider.send = mockSend;
  
  // Test each email type
  const testResults = await Promise.all([
    service.sendWelcome("test@example.com", "Test User"),
    service.sendVerification("test@example.com", "Test User", "https://bucksy.life/verify?token=test123"),
    service.sendVerificationConfirmation("test@example.com", "Test User"),
    service.sendInvitation("test@example.com", "Test User", "https://bucksy.life/invite?token=test456"),
    service.sendInvitationReminder("test@example.com", "Test User", "https://bucksy.life/invite?token=test456", "3 days"),
    service.sendLaunchAnnouncement("test@example.com", "Test User")
  ]);
  
  testResults.forEach((result, index) => {
    const types = ["welcome", "verification", "verification_confirmation", "invitation", "invitation_reminder", "launch_announcement"];
    console.log(`✅ ${types[index]}: ${result.success ? "Success" : "Failed"}`);
  });
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}

// Test 4: Error Handling
console.log("\n4. Testing Error Handling...");
try {
  const service = new EmailService({ ...testEnv, NODE_ENV: "production" });
  
  // Mock provider to throw
  const mockSend = async () => { throw new Error("Provider error"); };
  service.provider.send = mockSend;
  
  const result = await service.sendEmail("test@example.com", EMAIL_TYPE.WELCOME, { name: "Test User" });
  
  if (result.success === false && result.error) {
    console.log("✅ Error handling works correctly");
  } else {
    console.log("❌ Error handling failed");
  }
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}

console.log("\n🎉 Email delivery system test completed!");
console.log("\nNext steps:");
console.log("1. Configure your email provider with real API keys");
console.log("2. Test with a real email address in development");
console.log("3. Apply the email_logs migration to your database");
console.log("4. Set up admin token for protected endpoints");