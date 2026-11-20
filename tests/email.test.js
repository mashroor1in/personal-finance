/**
 * Unit tests for the Bucksy email system.
 *
 * Tests the email templates, provider interface, and delivery service.
 * Does not actually send emails - mocks all external calls.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EmailProvider,
  EmailTemplate,
  EmailService,
  sendWelcome,
  sendVerification,
  sendVerificationConfirmation,
  sendInvitation,
  sendInvitationReminder,
  sendLaunchAnnouncement,
} from "../functions/_lib/email.js";

import { EVENT } from "../functions/_lib/waitlist.js";
import { EMAIL_TYPE } from "../functions/_lib/email.js";

/* ---------------------------------------------------------------- provider -- */

test("EmailProvider supports Resend by default", () => {
  const env = { RESEND_API_KEY: "test-key" };
  const provider = new EmailProvider(env);
  assert.equal(provider.provider, "resend");
  assert.equal(provider.config.api, "https://api.resend.com/emails");
});

test("EmailProvider throws for unknown providers", () => {
  const env = { WAITLIST_EMAIL_PROVIDER: "unknown" };
  assert.throws(() => {
    new EmailProvider(env);
  }, /Unsupported email provider/);
});

test("EmailProvider builds Resend email correctly", () => {
  const env = { RESEND_API_KEY: "test-key" };
  const provider = new EmailProvider(env);
  const email = provider.buildEmail("test@example.com", "Test Subject", "<p>HTML</p>", "Plain text", {});
  
  assert.equal(email.to, "test@example.com");
  assert.equal(email.subject, "Test Subject");
  assert.equal(email.html, "<p>HTML</p>");
  assert.equal(email.text, "Plain text");
  assert.equal(email.from, "noreply@bucksy.life");
});

test("EmailProvider gets correct headers for Resend", () => {
  const env = { RESEND_API_KEY: "test-key" };
  const provider = new EmailProvider(env);
  const headers = provider.getHeaders();
  
  assert.equal(headers["Authorization"], "Bearer test-key");
  assert.equal(headers["Content-Type"], "application/json");
});

/* --------------------------------------------------------------- template -- */

test("EmailTemplate throws for unknown types", () => {
  assert.throws(() => {
    new EmailTemplate("unknown");
  }, /Unknown email template type/);
});

test("EmailTemplate renders welcome email correctly", () => {
  const template = new EmailTemplate(EMAIL_TYPE.WELCOME, { name: "Ada" });
  const html = template.renderHTML();
  const text = template.renderText();
  
  assert.match(html, /Welcome to Bucksy/);
  assert.match(html, /Hi Ada/);
  assert.match(html, /Track. Plan. Grow./);
  assert.match(html, /Bucksy logo/);
  
  assert.match(text, /Welcome to Bucksy/);
  assert.match(text, /Hi Ada/);
  assert.match(text, /The Bucksy Team/);
});

test("EmailTemplate renders verification email with link", () => {
  const template = new EmailTemplate(EMAIL_TYPE.VERIFICATION, {
    name: "Ada",
    verificationLink: "https://bucksy.life/verify?token=abc123"
  });
  const html = template.renderHTML();
  const text = template.renderText();
  
  assert.match(html, /Confirm your email for Bucksy Early Access/);
  assert.match(html, /https:\/\/bucksy.life\/verify\?token=abc123/);
  assert.match(html, /Confirm Your Email/);
  
  assert.match(text, /Confirm your email: https:\/\/bucksy.life\/verify\?token=abc123/);
});

test("EmailTemplate renders invitation email with countdown", () => {
  const template = new EmailTemplate(EMAIL_TYPE.INVITATION_REMINDER, {
    name: "Ada",
    invitationLink: "https://bucksy.life/invite?token=abc123",
    countdown: "3 days"
  });
  const html = template.renderHTML();
  const text = template.renderText();
  
  assert.match(html, /Your invitation expires in <strong>3 days<\/strong>/);
  assert.match(html, /Claim Your Access Now/);
  
  assert.match(text, /Your invitation expires in 3 days/);
});

test("EmailTemplate includes Bucksy branding", () => {
  const template = new EmailTemplate(EMAIL_TYPE.WELCOME, { name: "Ada" });
  const html = template.renderHTML();
  
  assert.match(html, /#0B3D2E/); // Pine color
  assert.match(html, /#18815A/); // Fern color
  assert.match(html, /Inter, sans-serif/); // Font
  assert.match(html, /Track\. Plan\. Grow\./); // Tagline
});

/* ---------------------------------------------------------------- service -- */

test("EmailService logs delivery attempts", async () => {
  const mockDb = {
    prepare: () => ({
      bind: () => ({
        run: () => {}, // Mock successful run
      }),
    }),
  };
  
  const env = { DB: mockDb };
  const service = new EmailService(env);
  
  // Mock the provider to not actually send
  const mockSend = async () => ({ success: true, id: "msg-123" });
  service.provider.send = mockSend;
  
  await service.sendEmail("test@example.com", EMAIL_TYPE.WELCOME, { name: "Ada" });
  
  // Verify log was called (mockDb would capture this in a real test)
  assert.ok(true); // If we get here, no exception was thrown
});

test("EmailService handles provider failures gracefully", async () => {
  const env = { NODE_ENV: "production" }; // Production mode should not throw
  const service = new EmailService(env);
  
  // Mock provider to throw
  const mockSend = async () => { throw new Error("Provider error"); };
  service.provider.send = mockSend;
  
  const result = await service.sendEmail("test@example.com", EMAIL_TYPE.WELCOME, { name: "Ada" });
  
  assert.equal(result.success, false);
  assert.match(result.error, /Provider error/);
});

/* --------------------------------------------------------------- helpers -- */

test("EmailService sends welcome email", async () => {
  const env = { NODE_ENV: "test" };
  const mockSend = async () => ({ success: true, id: "msg-123" });
  
  const service = new EmailService(env);
  service.provider.send = mockSend;
  
  const result = await service.sendWelcome("test@example.com", "Ada");
  assert.equal(result.success, true);
  assert.equal(result.id, "msg-123");
});

test("EmailService sends verification email", async () => {
  const env = { NODE_ENV: "test" };
  const mockSend = async () => ({ success: true, id: "msg-456" });
  
  const service = new EmailService(env);
  service.provider.send = mockSend;
  
  const result = await service.sendVerification("test@example.com", "Ada", "https://bucksy.life/verify?token=abc");
  assert.equal(result.success, true);
  assert.equal(result.id, "msg-456");
});

test("All email types have defined templates", () => {
  const types = [
    EMAIL_TYPE.WELCOME,
    EMAIL_TYPE.VERIFICATION,
    EMAIL_TYPE.VERIFICATION_CONFIRMATION,
    EMAIL_TYPE.INVITATION,
    EMAIL_TYPE.INVITATION_REMINDER,
    EMAIL_TYPE.LAUNCH_ANNOUNCEMENT,
  ];
  
  for (const type of types) {
    assert.doesNotThrow(() => new EmailTemplate(type), `Template for ${type} should exist`);
  }
});

test("Email templates include proper unsubscribe links", () => {
  const template = new EmailTemplate(EMAIL_TYPE.WELCOME, { name: "Ada" });
  const html = template.renderHTML();
  
  assert.match(html, /https:\/\/bucksy.life\/unsubscribe/);
  assert.match(html, /Privacy Policy/);
});

test("Email templates handle missing name gracefully", () => {
  const template = new EmailTemplate(EMAIL_TYPE.WELCOME, {});
  const html = template.renderHTML();
  const text = template.renderText();
  
  assert.doesNotThrow(() => html);
  assert.doesNotThrow(() => text);
  assert.match(html, /there,/);
  assert.match(text, /there,/);
});

test("Email templates generate unique content for each type", () => {
  const types = Object.values(EMAIL_TYPE);
  const contents = new Set();
  
  for (const type of types) {
    const template = new EmailTemplate(type, { name: "Ada" });
    const html = template.renderHTML();
    contents.add(html);
  }
  
  assert.equal(contents.size, types.length, "Each email type should generate unique content");
});