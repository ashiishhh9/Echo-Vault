import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = resolve(root, 'backend', '.env');
if (existsSync(envFile) && process.loadEnvFile) process.loadEnvFile(envFile);
const emailArg = process.argv.slice(2).find((value) => value.startsWith('--email='))?.slice('--email='.length)?.trim().toLowerCase();
if (!emailArg || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailArg)) {
  console.error('Usage: node backend/scripts/provision-admin.mjs --email=trusted-account@example.com');
  process.exit(2);
}
const configuredDb = process.env.DATABASE_PATH || resolve(root, 'database', 'digital-time-capsule.sqlite');
const dbPath = isAbsolute(configuredDb) ? configuredDb : resolve(root, configuredDb);
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
try {
  db.exec('PRAGMA busy_timeout=5000');
  const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
  if (!userColumns.has('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'))");
  if (!userColumns.has('account_status')) db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active','disabled'))");
  const user = db.prepare('SELECT id,email FROM users WHERE email=? COLLATE NOCASE').get(emailArg);
  if (!user) throw new Error(`No registered account found for ${emailArg}. Create and verify the account before provisioning it.`);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const confirmation = await terminal.question(`Promote ${user.email} to administrator in ${dbPath}? Type the exact email to confirm: `);
    if (confirmation.trim().toLowerCase() !== user.email.toLowerCase()) throw new Error('Confirmation did not match; no changes were made.');
  } finally { terminal.close(); }
  db.prepare("UPDATE users SET role='admin',account_status='active' WHERE id=?").run(user.id);
  console.log(`Administrator role provisioned for ${user.email}.`);
} finally { db.close(); }
