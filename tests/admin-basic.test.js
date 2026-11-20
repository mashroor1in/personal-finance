import { test } from "node:test";
import assert from "node:assert/strict";

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

// Test constant-time comparison
test("constantTimeEqual - prevents timing attacks", () => {
  // Test with equal strings
  assert.equal(constantTimeEqual("test", "test"), true);
  
  // Test with different strings of same length
  assert.equal(constantTimeEqual("test", "tesx"), false);
  
  // Test with different strings of different lengths
  assert.equal(constantTimeEqual("test", "testing"), false);
  
  // Test with empty strings
  assert.equal(constantTimeEqual("", ""), true);
  
  // Test with one empty string
  assert.equal(constantTimeEqual("", "test"), false);
});