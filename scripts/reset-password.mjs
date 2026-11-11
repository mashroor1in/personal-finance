/**
 * Generate a password-reset SQL file for one account.
 *
 *   node scripts/reset-password.mjs <username> <new-password>
 *
 * Writes `reset-<username>.sql` and prints the wrangler command to apply it.
 * It never touches the database itself — you run the printed command.
 *
 * Why this exists: writing the hash inline into `wrangler d1 execute --command
 * "..."` corrupts it in PowerShell, because `$` starts a variable. The
 * `pbkdf2-sha256$100000$...` string silently collapses to `pbkdf2-sha256`.
 * Going through a .sql file avoids the shell entirely.
 *
 * The generated file contains a password hash (not the password). It is
 * gitignored, and should be deleted after use.
 */
import { writeFileSync } from "node:fs";
import { hashPassword, verifyPassword } from "../functions/_lib/common.js";

const [username, password] = process.argv.slice(2);

function usage(message) {
  if (message) console.error(`\n  ${message}`);
  console.error("\n  Usage: node scripts/reset-password.mjs <username> <new-password>\n");
  process.exit(1);
}

if (!username || !password) usage("Both arguments are required.");
if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
  usage("Username must be 3-32 chars: a-z, 0-9, dot, underscore, hyphen.");
}
if (password.length < 6) usage("Password must be at least 6 characters.");

const { salt, pinHash } = await hashPassword(password, {});

// Refuse to emit a verifier that cannot verify, before anyone depends on it.
const check = await verifyPassword(password, { salt, pin_hash: pinHash }, {});
if (!check.ok) {
  console.error("\n  Self-check failed: the generated verifier does not verify. Nothing written.\n");
  process.exit(1);
}

const file = `reset-${username}.sql`;
const sql = [
  "UPDATE users",
  `SET salt = '${salt}', pin_hash = '${pinHash}', updated_at = ${Date.now()}`,
  `WHERE id = '${username}';`,
  "",
].join("\n");

writeFileSync(file, sql, "utf8");

console.log(`\n  Wrote ${file}`);
console.log(`  iterations: ${pinHash.split("$")[1]}`);
console.log(`  self-check: ok`);
console.log("\n  Apply it with:\n");
console.log(`    wrangler d1 execute personal-expenses-db --file ${file} --remote -y`);
console.log("\n  Then delete the file:\n");
console.log(`    Remove-Item ${file}\n`);
