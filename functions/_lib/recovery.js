import { constantTimeEqual, randomToken, sha256Hex } from "./common.js";

/**
 * Backup sign-in codes.
 *
 * A user who forgets their password can redeem one of these instead. That is
 * the whole point: without it, a forgotten password locks the account away
 * behind an operator with SQL access.
 *
 * Design notes:
 *
 * - 10 codes, each 12 characters from a 32-symbol alphabet. 32 symbols is
 *   exactly 5 bits, so `byte & 31` is uniform with no rejection sampling.
 *   12 * 5 = 60 bits per code.
 * - Only a salted hash is stored. Sixty bits is far past the point where an
 *   offline search over a leaked table is practical, so a plain SHA-256 is
 *   enough; stretching a 60-bit secret buys nothing and would cost CPU on
 *   every redeption.
 * - The plaintext leaves the server exactly once, in the response that
 *   created it. It is never logged and never stored.
 */

export const RECOVERY_CODE_COUNT = 10;

const CODE_LENGTH = 12;
// No 0/O/1/I: these codes get written on paper and typed back in.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Uppercase and strip separators, so `abcd-efgh-ijkl` matches `ABCDEFGHIJKL`. */
export function normalizeRecoveryCode(input) {
  return String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidRecoveryCode(input) {
  const code = normalizeRecoveryCode(input);
  if (code.length !== CODE_LENGTH) return false;
  for (const char of code) {
    if (!ALPHABET.includes(char)) return false;
  }
  return true;
}

/** `AAAA-BBBB-CCCC`. Unrecognised input is returned normalized, not padded. */
export function formatRecoveryCode(input) {
  const code = normalizeRecoveryCode(input);
  if (code.length !== CODE_LENGTH) return code;
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = [];
  const bytes = new Uint8Array(CODE_LENGTH);
  for (let i = 0; i < count; i += 1) {
    crypto.getRandomValues(bytes);
    let raw = "";
    for (let j = 0; j < CODE_LENGTH; j += 1) raw += ALPHABET[bytes[j] & 31];
    codes.push(formatRecoveryCode(raw));
  }
  return codes;
}

export async function hashRecoveryCode(code, salt) {
  return sha256Hex(`${salt}:${normalizeRecoveryCode(code)}`);
}

/**
 * Turn a fresh set of plaintext codes into insert-ready rows.
 *
 * Only `codeHash` leaves this function; the caller keeps the plaintext list
 * solely to return it to its owner.
 */
export async function buildRecoveryCodeRows(userID, codes) {
  const createdAt = Date.now();
  const rows = [];
  for (const code of codes) {
    const salt = randomToken(16);
    rows.push({
      id: randomToken(12),
      userID,
      salt,
      codeHash: await hashRecoveryCode(code, salt),
      createdAt,
    });
  }
  return rows;
}

/** Constant-time match of a submitted code against one stored row. */
export async function matchesRecoveryCode(code, row) {
  if (!row?.salt || !row?.code_hash) return false;
  const computed = await hashRecoveryCode(code, row.salt);
  return constantTimeEqual(computed, row.code_hash);
}
