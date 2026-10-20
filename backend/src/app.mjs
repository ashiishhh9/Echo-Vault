import { createServer as createHttpServer } from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { isIP } from 'node:net';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalMediaStorage, decodeMediaDataUrl } from './storage/localMediaStorage.mjs';
import { buildUnlockEmail, createResendEmailService, validEmail } from './email/resendEmailService.mjs';

const scrypt = promisify(scryptCallback);
const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..');
const backendDir = resolve(here, '..');
const apiPrefix = '/api/v1';
const allowedMedia = {
  text: new Set(), image: new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']),
  video: new Set(['mp4', 'mov', 'webm']), audio: new Set(['mp3', 'wav', 'm4a', 'ogg', 'webm']),
};
const maxMediaBytes = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 20 * 1024 * 1024 };
const dataMimeExtensions = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'webm',
};
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const nowIso = () => new Date().toISOString();
const json = (res, status, value) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
};
const parseJson = async (req, limit = 64 * 1024) => {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) fail(413, 'Request body is too large');
    chunks.push(chunk);
  }
  if (!length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, 'Request body must be valid JSON'); }
};
const requiredText = (value, label, maxLength) => {
  if (typeof value !== 'string' || !value.trim()) fail(422, `${label} is required`);
  if (value.trim().length > maxLength) fail(422, `${label} must be ${maxLength} characters or fewer`);
  return value.trim();
};
const consumeRateLimit = (buckets, key, limit, windowMs, maxBuckets = 10_000) => {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= maxBuckets) {
      for (const [storedKey, storedBucket] of buckets) {
        if (storedBucket.resetAt <= now) buckets.delete(storedKey);
      }
      if (buckets.size >= maxBuckets) buckets.delete(buckets.keys().next().value);
    }
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count > limit;
};
const clientAddress = (req) => {
  const peer = req.socket.remoteAddress || 'unknown';
  const isLocalProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer);
  const forwarded = req.headers['x-forwarded-for'];
  if (process.env.TRUST_PROXY === 'true' && isLocalProxy && typeof forwarded === 'string') {
    const address = forwarded.trim();
    if (isIP(address)) return address;
  }
  return peer;
};
const emailValue = (value) => {
  const email = requiredText(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(422, 'Email address is invalid');
  return email;
};
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
const safeEqual = (left, right) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, location: user.location, bio: user.bio, initials: user.initials });
const readUser = (db, id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const readCapsule = (db, id) => db.prepare('SELECT * FROM capsules WHERE id = ?').get(id);
const capsuleJson = (db, row) => ({
  id: row.id, owner_id: row.owner_id, title: row.title, description: row.description,
  created_at: row.created_at, updated_at: row.updated_at, unlock_at: row.unlock_at,
  status: row.status, memories: [], memory_count: Number(db.prepare('SELECT COUNT(*) AS count FROM memories WHERE capsule_id = ?').get(row.id).count),
});
const memoryJson = (row) => ({ id: row.id, capsule_id: row.capsule_id, type: row.type, content_text: row.content_text, media_url: row.media_url.startsWith('media:') ? `/api/v1/media/${row.media_url.slice(6)}` : row.media_url, media_filename: row.media_filename || '', created_at: row.created_at, updated_at: row.updated_at, embedding_status: row.embedding_status ?? 'pending', image_analysis_status: row.type === 'image' ? (row.image_analysis_status ?? 'pending') : null, image_description: row.type === 'image' && row.image_analysis_status === 'ready' ? row.image_description : '' });
const safeMediaFilename = (value) => typeof value === 'string'
  ? value.split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
  : '';
const notificationJson = (row) => ({ id: row.id, user_id: row.user_id, type: row.type, message: row.message, created_at: row.created_at, read: Boolean(row.is_read) });
const normalizeUnlock = (value) => {
  if (typeof value !== 'string') fail(422, 'unlock_at must be a valid date and time');
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  if (!Number.isFinite(Date.parse(normalized))) fail(422, 'unlock_at must be a valid date and time');
  return new Date(normalized).toISOString();
};

function setupDatabase(db) {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', initials TEXT NOT NULL DEFAULT '',
      notifications INTEGER NOT NULL DEFAULT 1, unlock_emails INTEGER NOT NULL DEFAULT 1, compact_mode INTEGER NOT NULL DEFAULT 0,
      export_format TEXT NOT NULL DEFAULT 'json', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS capsules (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'gold',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, unlock_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('LOCKED','UNLOCKED'))
    );
    CREATE INDEX IF NOT EXISTS capsules_owner_unlock_idx ON capsules(owner_id, unlock_at);
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, capsule_id TEXT NOT NULL REFERENCES capsules(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('text','image','video','audio')),
      content_text TEXT NOT NULL DEFAULT '', media_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      embedding_json TEXT, embedding_model TEXT, embedding_dimensions INTEGER,
      embedding_status TEXT NOT NULL DEFAULT 'pending' CHECK(embedding_status IN ('pending','ready','failed')),
      embedding_attempts INTEGER NOT NULL DEFAULT 0, embedding_error TEXT
    );
    CREATE INDEX IF NOT EXISTS memories_capsule_idx ON memories(capsule_id, created_at);
    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY, memory_id TEXT NOT NULL UNIQUE REFERENCES memories(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL, original_filename TEXT NOT NULL DEFAULT '',
      analysis_status TEXT NOT NULL DEFAULT 'pending' CHECK(analysis_status IN ('pending','ready','failed')),
      analysis_description TEXT NOT NULL DEFAULT '', analysis_sha256 TEXT, analysis_error TEXT,
      analysis_attempts INTEGER NOT NULL DEFAULT 0, analyzed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New conversation', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversations_user_updated_idx ON conversations(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
      references_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx ON chat_messages(conversation_id, created_at, id);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL, message TEXT NOT NULL, related_id TEXT, dedupe_key TEXT UNIQUE,
      created_at TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at);
    CREATE TABLE IF NOT EXISTS email_deliveries (
      id TEXT PRIMARY KEY, capsule_id TEXT NOT NULL REFERENCES capsules(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notification_type TEXT NOT NULL, recipient TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','sending','accepted','retry_scheduled','permanently_failed','disabled')),
      attempt_count INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT, provider_message_id TEXT,
      last_error TEXT, next_retry_at TEXT, sending_started_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(capsule_id, notification_type)
    );
    CREATE INDEX IF NOT EXISTS email_deliveries_due_idx ON email_deliveries(status, next_retry_at);
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id TEXT PRIMARY KEY, administrator_id TEXT NOT NULL, action TEXT NOT NULL,
      target_user_id TEXT, occurred_at TEXT NOT NULL, success INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_audit_log_time_idx ON admin_audit_log(occurred_at);
  `);
  const memoryColumns = new Set(db.prepare('PRAGMA table_info(memories)').all().map((column) => column.name));
  const migrations = [
    ['embedding_json', 'TEXT'], ['embedding_model', 'TEXT'], ['embedding_dimensions', 'INTEGER'],
    ['embedding_status', "TEXT NOT NULL DEFAULT 'pending'"], ['embedding_attempts', 'INTEGER NOT NULL DEFAULT 0'], ['embedding_error', 'TEXT'],
  ];
  for (const [name, type] of migrations) if (!memoryColumns.has(name)) db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${type}`);
  const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
  if (!userColumns.has('unlock_emails')) db.exec('ALTER TABLE users ADD COLUMN unlock_emails INTEGER NOT NULL DEFAULT 1');
  if (!userColumns.has('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'))");
  if (!userColumns.has('account_status')) db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active','disabled'))");
  const mediaColumns = new Set(db.prepare('PRAGMA table_info(media_assets)').all().map((column) => column.name));
  if (!mediaColumns.has('original_filename')) db.exec("ALTER TABLE media_assets ADD COLUMN original_filename TEXT NOT NULL DEFAULT ''");
  const mediaMigrations = [
    ['analysis_status', "TEXT NOT NULL DEFAULT 'pending'"], ['analysis_description', "TEXT NOT NULL DEFAULT ''"],
    ['analysis_sha256', 'TEXT'], ['analysis_error', 'TEXT'], ['analysis_attempts', 'INTEGER NOT NULL DEFAULT 0'], ['analyzed_at', 'TEXT'],
  ];
  for (const [name, type] of mediaMigrations) if (!mediaColumns.has(name)) db.exec(`ALTER TABLE media_assets ADD COLUMN ${name} ${type}`);
}

function createNotification(db, userId, type, message, relatedId = null, dedupeKey = null) {
  const id = randomUUID();
  db.prepare('INSERT OR IGNORE INTO notifications (id,user_id,type,message,related_id,dedupe_key,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, userId, type, message, relatedId, dedupeKey, nowIso());
  return db.prepare('SELECT * FROM notifications WHERE dedupe_key = ?').get(dedupeKey) ?? db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
}

function queueUnlockEmail(db, capsule) {
  const owner = readUser(db, capsule.owner_id);
  if (!owner) return;
  const timestamp = nowIso();
  db.prepare(`INSERT OR IGNORE INTO email_deliveries
    (id,capsule_id,owner_id,notification_type,recipient,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'pending',?,?)`).run(randomUUID(), capsule.id, owner.id, 'capsule_unlocked', owner.email, timestamp, timestamp);
}

function processDueCapsules(db, ownerId = null) {
  const rows = ownerId
    ? db.prepare("SELECT * FROM capsules WHERE owner_id = ? AND status = 'LOCKED' AND unlock_at <= ?").all(ownerId, nowIso())
    : db.prepare("SELECT * FROM capsules WHERE status = 'LOCKED' AND unlock_at <= ?").all(nowIso());
  const update = db.prepare("UPDATE capsules SET status = 'UNLOCKED', updated_at = ? WHERE id = ? AND status = 'LOCKED'");
  for (const capsule of rows) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const changed = update.run(nowIso(), capsule.id).changes;
      if (changed) {
        createNotification(db, capsule.owner_id, 'capsule_unlocked', `Your capsule '${capsule.title}' has unlocked.`, capsule.id, `unlock:${capsule.id}`);
        queueUnlockEmail(db, capsule);
      }
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  }
  return rows.length;
}

const signToken = (userId, secret) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const lifetime = Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 60);
  const jti = randomUUID(); const exp = Math.floor(Date.now() / 1000) + Math.max(5, Math.min(lifetime, 24 * 60)) * 60;
  const payload = Buffer.from(JSON.stringify({ sub: userId, jti, exp })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
};
const verifyToken = (token, secret, db) => {
  const parts = token.split('.');
  if (parts.length !== 3) fail(401, 'Invalid token');
  const input = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', secret).update(input).digest('base64url');
  if (!safeEqual(parts[2], expected)) fail(401, 'Invalid token');
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { fail(401, 'Invalid token'); }
  if (!payload.sub || !payload.jti || payload.exp <= Math.floor(Date.now() / 1000)) fail(401, 'Token expired or invalid');
  if (db.prepare('SELECT jti FROM revoked_tokens WHERE jti = ?').get(payload.jti)) fail(401, 'Token has been revoked');
  const user = readUser(db, payload.sub);
  if (!user) fail(401, 'User not found');
  if (user.account_status === 'disabled') fail(403, 'This account is disabled');
  return { user, payload };
};
const bearer = (req, secret, db) => {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) fail(401, 'Not authenticated');
  return verifyToken(value.slice(7), secret, db);
};
const validateMedia = (type, mediaUrl) => {
  if (!Object.hasOwn(allowedMedia, type)) fail(422, 'Unsupported memory type');
  if (!mediaUrl) return;
  if (typeof mediaUrl !== 'string') fail(422, 'media_url must be a string');
  let extension = '';
  let size = 0;
  if (mediaUrl.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(mediaUrl);
    if (!match) fail(422, 'media_url is not a valid base64 data URL');
    extension = dataMimeExtensions[match[1].toLowerCase()] ?? '';
    const encoded = match[2];
    size = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  } else {
    let parsed;
    try { parsed = new URL(mediaUrl); } catch { fail(422, 'media_url must be a valid URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) fail(422, 'media_url must use HTTP or HTTPS');
    extension = extname(parsed.pathname).slice(1).toLowerCase();
    size = Number(parsed.searchParams.get('size') ?? parsed.searchParams.get('file_size') ?? 0);
    if (!size && /large|huge|big/i.test(parsed.pathname)) size = maxMediaBytes[type] + 1;
  }
  if (!allowedMedia[type].has(extension)) fail(422, `Unsupported media file extension for ${type}`);
  if (Number.isFinite(size) && size > (maxMediaBytes[type] ?? 0)) fail(422, `Media exceeds the ${type} size limit`);
};
async function callAi(baseUrl, endpoint, payload, query = {}, timeoutMs = Number(process.env.AI_TIMEOUT_MS || 120_000)) {
  const url = new URL(`${baseUrl}${endpoint}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.AI_SERVICE_API_KEY ? { 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY } : {}) }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new HttpError(response.status === 422 ? 422 : 503, result.detail || 'AI service request failed');
    return result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'AI service is unavailable. Start ai-service on port 8100.');
  }
}

const validVector = (result) => result && typeof result.model === 'string' && Number(result.dimensions) === 384
  && Array.isArray(result.embedding) && result.embedding.length === 384
  && result.embedding.every((value) => typeof value === 'number' && Number.isFinite(value));

function embeddingText(db, memory) {
  const media = db.prepare('SELECT original_filename,mime_type,analysis_status,analysis_description FROM media_assets WHERE memory_id=?').get(memory.id);
  if (!media) return memory.content_text;
  return [memory.content_text, media.analysis_status === 'ready' ? media.analysis_description : '', media.original_filename, media.mime_type, memory.type]
    .filter((part) => typeof part === 'string' && part.trim()).join('\n');
}

const searchableText = (memory) => [memory.content_text, memory.image_analysis_status === 'ready' ? memory.image_description : '', memory.media_filename, memory.media_mime_type && memory.type !== 'text' ? memory.media_mime_type : '', memory.type !== 'text' ? memory.type : '']
  .filter((part) => typeof part === 'string' && part.trim()).join('\n');

function validateSearchResponse(result, memories) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.results) || result.results.length > 20) {
    fail(503, 'AI service returned an invalid search response');
  }
  const allowed = new Map(memories.map((memory) => [memory.id, memory.text]));
  const seen = new Set();
  for (const item of result.results) {
    if (!item || typeof item.id !== 'string' || !allowed.has(item.id) || seen.has(item.id) || item.text !== allowed.get(item.id)
      || typeof item.similarity !== 'number' || !Number.isFinite(item.similarity) || item.similarity < -1 || item.similarity > 1) {
      fail(503, 'AI service returned an invalid search result');
    }
    seen.add(item.id);
  }
  return result;
}

function validateChatResponse(result, memories) {
  if (!result || typeof result !== 'object' || typeof result.answer !== 'string' || result.answer.length > 20_000
    || result.mode !== 'retrieval_only' || typeof result.grounded !== 'boolean' || !Array.isArray(result.references) || result.references.length > 20) {
    fail(503, 'AI service returned an invalid memory chat response');
  }
  const allowed = new Set(memories.map((memory) => memory.id));
  const seen = new Set();
  for (const reference of result.references) {
    if (!reference || typeof reference.id !== 'string' || !allowed.has(reference.id) || seen.has(reference.id)
      || (reference.created_at !== undefined && reference.created_at !== null && typeof reference.created_at !== 'string')
      || typeof reference.similarity !== 'number' || !Number.isFinite(reference.similarity) || reference.similarity < -1 || reference.similarity > 1) {
      fail(503, 'AI service returned an invalid memory chat reference');
    }
    seen.add(reference.id);
  }
  return result;
}

function visibleChatReferences(db, ownerId, references) {
  const ids = [...new Set(references.map((reference) => reference.id))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const allowed = new Map(db.prepare(`SELECT m.id,m.content_text,m.created_at,a.original_filename,a.analysis_status,a.analysis_description FROM memories m JOIN capsules c ON c.id=m.capsule_id LEFT JOIN media_assets a ON a.memory_id=m.id WHERE c.owner_id=? AND c.status='UNLOCKED' AND m.id IN (${placeholders})`)
    .all(ownerId, ...ids).map((row) => [row.id, row]));
  return references.flatMap((reference) => {
    const memory = allowed.get(reference.id);
    if (!memory) return [];
    const media = db.prepare(`SELECT a.id,a.mime_type,a.original_filename,m.type FROM media_assets a JOIN memories m ON m.id=a.memory_id WHERE m.id=? AND m.type IN ('image','video')`)
      .all(memory.id).map((asset) => ({
        id: asset.id, type: asset.type, mime_type: asset.mime_type,
        media_url: `/api/v1/media/${asset.id}`, filename: asset.original_filename || memory.content_text || 'Saved media',
      }));
    return [{ id: memory.id, title: memory.analysis_status === 'ready' && memory.analysis_description ? memory.analysis_description : memory.content_text || memory.original_filename || 'Untitled memory', created_at: memory.created_at, similarity: reference.similarity, media }];
  });
}

function readChatReferences(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((reference) => reference && typeof reference.id === 'string') : [];
  } catch { return []; }
}

function conversationMessageJson(db, ownerId, row) {
  const rawReferences = row.role === 'assistant' ? readChatReferences(row.references_json) : [];
  const references = visibleChatReferences(db, ownerId, rawReferences);
  const invalidated = rawReferences.length > references.length;
  return {
    id: row.id, role: row.role,
    content: invalidated ? 'A memory cited in this reply is no longer available in your unlocked archive.' : row.content,
    created_at: row.created_at, references: invalidated ? [] : references,
  };
}

async function generateEmbedding(db, aiServiceUrl, memory, stats) {
  db.prepare("UPDATE memories SET embedding_status='pending',embedding_error=NULL,embedding_attempts=embedding_attempts+1 WHERE id=?").run(memory.id);
  try {
    const result = await callAi(aiServiceUrl, '/embeddings', { text: embeddingText(db, memory) }, {}, Number(process.env.EMBEDDING_REQUEST_TIMEOUT_MS || 30_000));
    if (!validVector(result)) throw new Error('AI service returned an invalid or incompatible embedding');
    db.prepare("UPDATE memories SET embedding_json=?,embedding_model=?,embedding_dimensions=?,embedding_status='ready',embedding_error=NULL WHERE id=? AND content_text=?")
      .run(JSON.stringify(result.embedding), result.model, result.dimensions, memory.id, memory.content_text);
    stats.generated += 1;
    return true;
  } catch (error) {
    db.prepare("UPDATE memories SET embedding_status='failed',embedding_error=? WHERE id=?")
      .run(String(error.message || 'Embedding generation failed').slice(0, 500), memory.id);
    return false;
  }
}

async function generateEmbeddingBatch(db, aiServiceUrl, memories, stats) {
  if (!memories.length) return { migrated: 0, failed: 0 };
  for (const memory of memories) db.prepare("UPDATE memories SET embedding_status='pending',embedding_error=NULL,embedding_attempts=embedding_attempts+1 WHERE id=?").run(memory.id);
  try {
    const result = await callAi(aiServiceUrl, '/embeddings/batch', { texts: memories.map((memory) => embeddingText(db, memory)) }, {}, Number(process.env.EMBEDDING_REQUEST_TIMEOUT_MS || 30_000));
    if (typeof result.model !== 'string' || Number(result.dimensions) !== 384 || !Array.isArray(result.embeddings) || result.embeddings.length !== memories.length
      || result.embeddings.some((vector) => !Array.isArray(vector) || vector.length !== 384 || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value)))) {
      throw new Error('AI service returned invalid or incompatible embeddings');
    }
    const persist = db.prepare("UPDATE memories SET embedding_json=?,embedding_model=?,embedding_dimensions=?,embedding_status='ready',embedding_error=NULL WHERE id=? AND content_text=?");
    let migrated = 0;
    for (const [index, memory] of memories.entries()) {
      migrated += persist.run(JSON.stringify(result.embeddings[index]), result.model, result.dimensions, memory.id, memory.content_text).changes;
    }
    stats.generated += migrated;
    return { migrated, failed: memories.length - migrated };
  } catch (error) {
    const mark = db.prepare("UPDATE memories SET embedding_status='failed',embedding_error=? WHERE id=?");
    for (const memory of memories) mark.run(String(error.message || 'Embedding generation failed').slice(0, 500), memory.id);
    return { migrated: 0, failed: memories.length };
  }
}

async function analyzeImage(db, aiServiceUrl, mediaStorage, memory, stats) {
  const asset = db.prepare('SELECT * FROM media_assets WHERE memory_id=? AND mime_type LIKE ?').get(memory.id, 'image/%');
  if (!asset) return { status: 'skipped', description: '' };
  db.prepare("UPDATE media_assets SET analysis_status='pending',analysis_error=NULL,analysis_attempts=analysis_attempts+1 WHERE id=?").run(asset.id);
  try {
    const bytes = await mediaStorage.read(asset.storage_key);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (asset.analysis_status === 'ready' && asset.analysis_sha256 === sha256 && asset.analysis_description) {
      stats.imageReused += 1;
      db.prepare("UPDATE media_assets SET analysis_status='ready',analysis_error=NULL WHERE id=?").run(asset.id);
      return { status: 'ready', description: asset.analysis_description };
    }
    const result = await callAi(aiServiceUrl, '/image-description', {
      mime_type: asset.mime_type,
      data_base64: bytes.toString('base64'),
    }, {}, Number(process.env.VISION_REQUEST_TIMEOUT_MS || 120_000));
    if (!result || typeof result.description !== 'string' || !result.description.trim() || result.description.length > 1000 || typeof result.model !== 'string') {
      throw new Error('AI service returned an invalid image description');
    }
    const description = result.description.trim();
    db.prepare("UPDATE media_assets SET analysis_status='ready',analysis_description=?,analysis_sha256=?,analysis_error=NULL,analyzed_at=? WHERE id=?")
      .run(description, sha256, nowIso(), asset.id);
    db.prepare("UPDATE memories SET embedding_json=NULL,embedding_model=NULL,embedding_dimensions=NULL,embedding_status='pending',embedding_error=NULL WHERE id=?").run(memory.id);
    stats.imagesAnalyzed += 1;
    return { status: 'ready', description };
  } catch (error) {
    db.prepare("UPDATE media_assets SET analysis_status='failed',analysis_error=? WHERE id=?")
      .run(String(error.message || 'Image analysis failed').slice(0, 500), asset.id);
    stats.imagesFailed += 1;
    return { status: 'failed', description: '' };
  }
}

function readStoredVector(row, model) {
  if (row.embedding_status !== 'ready' || row.embedding_model !== model || row.embedding_dimensions !== 384 || !row.embedding_json) return null;
  try {
    const vector = JSON.parse(row.embedding_json);
    return Array.isArray(vector) && vector.length === 384 && vector.every((value) => typeof value === 'number' && Number.isFinite(value)) ? vector : null;
  } catch { return null; }
}

export function createApp({ dbPath, mediaDir, aiServiceUrl: configuredAiServiceUrl, secret = process.env.SECRET_KEY || 'development-only-change-this-secret', frontendOrigin, emailSender, emailNotificationsEnabled, resendApiKey, emailFrom, appBaseUrl, emailRetryDelaysMs = [60_000, 300_000, 1_800_000, 7_200_000], emailMaxAttempts = 5 } = {}) {
  if (process.env.NODE_ENV === 'production' && (!process.env.SECRET_KEY || process.env.SECRET_KEY.length < 32)) {
    throw new Error('Set a random SECRET_KEY of at least 32 characters in production');
  }
  if (process.env.NODE_ENV === 'production' && (!process.env.AI_SERVICE_API_KEY || process.env.AI_SERVICE_API_KEY.length < 32)) {
    throw new Error('Set an AI_SERVICE_API_KEY of at least 32 characters in production');
  }
  const configuredDb = dbPath || process.env.DATABASE_PATH || join(repoRoot, 'database', 'digital-time-capsule.sqlite');
  const resolvedDb = isAbsolute(configuredDb) ? configuredDb : resolve(repoRoot, configuredDb);
  mkdirSync(resolve(resolvedDb, '..'), { recursive: true });
  const db = new DatabaseSync(resolvedDb);
  try { chmodSync(resolvedDb, 0o600); } catch { /* Windows ACLs control file access on Windows. */ }
  setupDatabase(db);
  const configuredMediaDir = mediaDir || process.env.MEDIA_STORAGE_DIR || join(repoRoot, 'storage', 'media');
  const mediaStorage = new LocalMediaStorage(isAbsolute(configuredMediaDir) ? configuredMediaDir : resolve(repoRoot, configuredMediaDir));
  const embeddingStats = { generated: 0, reused: 0, searches: 0, imagesAnalyzed: 0, imagesFailed: 0, imageReused: 0 };
  const defaultOrigins = process.env.NODE_ENV === 'production' ? [frontendOrigin].filter(Boolean) : [frontendOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'].filter(Boolean);
  const origins = new Set((process.env.BACKEND_CORS_ORIGINS ?? defaultOrigins.join(','))
    .split(',').map((origin) => origin.trim()).filter(Boolean));
  const aiServiceUrl = (configuredAiServiceUrl || process.env.AI_SERVICE_URL || 'http://127.0.0.1:8100').replace(/\/$/, '');
  const emailEnabled = String(emailNotificationsEnabled ?? process.env.EMAIL_NOTIFICATIONS_ENABLED ?? 'false').toLowerCase() === 'true';
  const configuredEmailBaseUrl = appBaseUrl || process.env.APP_BASE_URL || 'http://localhost:5173';
  let parsedEmailBaseUrl;
  try { parsedEmailBaseUrl = new URL(configuredEmailBaseUrl); } catch { throw new Error('APP_BASE_URL must be a valid HTTP or HTTPS URL'); }
  if (!['http:', 'https:'].includes(parsedEmailBaseUrl.protocol) || parsedEmailBaseUrl.username || parsedEmailBaseUrl.password) throw new Error('APP_BASE_URL must be a valid HTTP or HTTPS URL without credentials');
  const emailBaseUrl = parsedEmailBaseUrl.origin;
  const mailService = emailSender || createResendEmailService({ apiKey: resendApiKey ?? process.env.RESEND_API_KEY, from: emailFrom ?? process.env.EMAIL_FROM });
  if (emailEnabled && (emailSender || mailService.configured)) {
    db.prepare(`UPDATE email_deliveries SET status='pending',last_error=NULL,next_retry_at=NULL,updated_at=?
      WHERE status='disabled' AND last_error IN ('Email notifications are disabled','Email provider credentials or sender are not configured')`)
      .run(nowIso());
  }
  let deliveryPromise = null;
  const deliverPendingEmails = async () => {
    if (deliveryPromise) return deliveryPromise;
    deliveryPromise = (async () => {
      const now = Date.now();
      // A sender may have been terminated after claiming a row. Wait ten minutes before
      // recovering it; the provider idempotency key protects the retry if it accepted it.
      db.prepare(`UPDATE email_deliveries SET status=CASE WHEN attempt_count >= ? THEN 'permanently_failed' ELSE 'retry_scheduled' END,
        last_error='Previous attempt ended before its result was recorded',
        next_retry_at=CASE WHEN attempt_count >= ? THEN NULL ELSE ? END,sending_started_at=NULL,updated_at=?
        WHERE status='sending' AND sending_started_at <= ?`)
        .run(emailMaxAttempts, emailMaxAttempts, new Date(now).toISOString(), nowIso(), new Date(now - 10 * 60_000).toISOString());
      if (!emailEnabled || !mailService.configured && !emailSender) {
        db.prepare(`UPDATE email_deliveries SET status='disabled',last_error=?,next_retry_at=NULL,updated_at=?
          WHERE status IN ('pending','retry_scheduled')`)
          .run(!emailEnabled ? 'Email notifications are disabled' : 'Email provider credentials or sender are not configured', nowIso());
        return;
      }
      const due = db.prepare(`SELECT d.*,c.title,c.unlock_at,u.email AS registered_email,u.unlock_emails
        FROM email_deliveries d JOIN capsules c ON c.id=d.capsule_id JOIN users u ON u.id=d.owner_id
        WHERE d.status IN ('pending','retry_scheduled') AND (d.next_retry_at IS NULL OR d.next_retry_at <= ?)
        ORDER BY d.created_at LIMIT 100`).all(nowIso());
      for (const row of due) {
        if (!row.unlock_emails) {
          db.prepare("UPDATE email_deliveries SET status='disabled',last_error='Owner disabled unlock emails',next_retry_at=NULL,updated_at=? WHERE id=? AND status IN ('pending','retry_scheduled')").run(nowIso(), row.id);
          continue;
        }
        if (!validEmail(row.registered_email)) {
          db.prepare("UPDATE email_deliveries SET status='permanently_failed',last_error='Registered recipient address is invalid',next_retry_at=NULL,updated_at=? WHERE id=? AND status IN ('pending','retry_scheduled')").run(nowIso(), row.id);
          continue;
        }
        const claimedAt = nowIso();
        const claimed = db.prepare(`UPDATE email_deliveries SET status='sending',attempt_count=attempt_count+1,last_attempt_at=?,
          recipient=?,sending_started_at=?,next_retry_at=?,updated_at=? WHERE id=? AND status IN ('pending','retry_scheduled')
          AND (next_retry_at IS NULL OR next_retry_at <= ?) AND attempt_count < ?`)
          .run(claimedAt, row.registered_email.trim(), claimedAt, new Date(now + 10 * 60_000).toISOString(), claimedAt, row.id, claimedAt, emailMaxAttempts).changes;
        if (!claimed) continue;
        const { subject, html, text } = buildUnlockEmail({ title: row.title, unlockAt: row.unlock_at, appBaseUrl: emailBaseUrl });
        let result;
        try {
          result = await mailService.send({ recipient: row.registered_email.trim(), subject, html, text, idempotencyKey: `capsule-unlock/${row.id}` });
        } catch {
          result = { accepted: false, retryable: true, error: 'Email service failed unexpectedly; provider acceptance is unknown' };
        }
        if (result?.accepted && result.messageId) {
          db.prepare("UPDATE email_deliveries SET status='accepted',provider_message_id=?,last_error=NULL,next_retry_at=NULL,sending_started_at=NULL,updated_at=? WHERE id=? AND status='sending'")
            .run(String(result.messageId).slice(0, 300), nowIso(), row.id);
          continue;
        }
        const attempts = row.attempt_count + 1;
        const retryable = Boolean(result?.retryable) && attempts < emailMaxAttempts;
        const delay = emailRetryDelaysMs[Math.max(0, attempts - 1)] ?? emailRetryDelaysMs.at(-1) ?? 0;
        db.prepare(`UPDATE email_deliveries SET status=?,last_error=?,next_retry_at=?,sending_started_at=NULL,updated_at=? WHERE id=? AND status='sending'`)
          .run(retryable ? 'retry_scheduled' : 'permanently_failed', String(result?.error || 'Email submission failed').slice(0, 240), retryable ? new Date(Date.now() + delay).toISOString() : null, nowIso(), row.id);
      }
    })().finally(() => { deliveryPromise = null; });
    return deliveryPromise;
  };
  const kickEmailDelivery = () => { void deliverPendingEmails().catch((error) => console.error('Email delivery worker error:', error)); };
  const runUnlockScheduler = async () => { const processed = processDueCapsules(db); await deliverPendingEmails(); return processed; };
  const schedulerStatus = { state: 'starting', lastStartedAt: null, lastCompletedAt: null, lastError: null };
  const scheduledUnlockRun = async () => {
    schedulerStatus.state = 'running'; schedulerStatus.lastStartedAt = nowIso();
    try { await runUnlockScheduler(); schedulerStatus.state = 'healthy'; schedulerStatus.lastCompletedAt = nowIso(); schedulerStatus.lastError = null; }
    catch (error) { schedulerStatus.state = 'error'; schedulerStatus.lastError = String(error?.message || 'Scheduler run failed').slice(0, 200); throw error; }
  };
  const frontendDist = join(repoRoot, 'frontend', 'dist');
  const loginFailures = new Map();
  const loginRequests = new Map();
  const registrationRequests = new Map();
  const aiRequests = new Map();
  const unlockTimer = setInterval(() => {
    void scheduledUnlockRun().catch((error) => console.error('Capsule unlock scheduler error:', error));
  }, 30_000);
  unlockTimer.unref();

  const server = createHttpServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https:");
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;
    try {
      if (pathname === `${apiPrefix}/health` && req.method === 'GET') {
        db.prepare('SELECT 1').get();
        return json(res, 200, { status: 'ok', service: 'digital-time-capsule-api', storage: 'sqlite' });
      }

      if (pathname === `${apiPrefix}/auth/register` && req.method === 'POST') {
        if (consumeRateLimit(registrationRequests, clientAddress(req), 30, 60 * 60_000)) fail(429, 'Too many registration attempts. Try again later.');
        const input = await parseJson(req);
        const name = requiredText(input.name, 'Name', 120);
        const email = emailValue(input.email);
        if (typeof input.password !== 'string' || input.password.length < 6 || input.password.length > 128) fail(422, 'Password must be between 6 and 128 characters');
        if (db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email)) fail(409, 'User already exists');
        const id = randomUUID(); const salt = randomBytes(16).toString('hex');
        const passwordHash = (await scrypt(input.password, salt, 64)).toString('hex');
        db.prepare('INSERT INTO users (id,name,email,password_salt,password_hash,initials,created_at) VALUES (?,?,?,?,?,?,?)')
          .run(id, name, email, salt, passwordHash, initials(name), nowIso());
        return json(res, 201, { id, name, email });
      }

      if (pathname === `${apiPrefix}/auth/login` && req.method === 'POST') {
        const input = await parseJson(req); const email = emailValue(input.email);
        const address = clientAddress(req);
        const source = `${address}:${email}`;
        if (consumeRateLimit(loginRequests, address, 120, 15 * 60_000)) fail(429, 'Too many login attempts. Try again later.');
        const failures = loginFailures.get(source) || { count: 0, until: 0 };
        if (failures.until > Date.now()) fail(429, 'Too many login attempts. Try again later.');
        const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
        const supplied = user && typeof input.password === 'string' ? (await scrypt(input.password, user.password_salt, 64)).toString('hex') : '';
        if (!user || !safeEqual(supplied, user.password_hash)) {
          const count = failures.count + 1;
          loginFailures.set(source, count >= 8 ? { count: 0, until: Date.now() + 15 * 60_000 } : { count, until: 0 });
          if (loginFailures.size > 10_000) {
            for (const [storedKey, storedFailure] of loginFailures) if (!storedFailure.until || storedFailure.until <= Date.now()) loginFailures.delete(storedKey);
            if (loginFailures.size > 10_000) loginFailures.delete(loginFailures.keys().next().value);
          }
          fail(401, 'Invalid credentials');
        }
        if (user.account_status === 'disabled') fail(403, 'This account is disabled');
        loginFailures.delete(source);
        return json(res, 200, { access_token: signToken(user.id, secret), token_type: 'bearer' });
      }

      if (pathname.startsWith(`${apiPrefix}/`)) {
        const { user, payload: token } = bearer(req, secret, db);
        if (pathname.startsWith(`${apiPrefix}/admin/`)) {
          if (user.role !== 'admin') fail(403, 'Administrator access required');
          if (pathname === `${apiPrefix}/admin/overview` && req.method === 'GET') {
            const counts = db.prepare(`SELECT
              (SELECT COUNT(*) FROM users) AS total_users,
              (SELECT COUNT(*) FROM users WHERE account_status='active') AS active_users,
              (SELECT COUNT(*) FROM users WHERE account_status='disabled') AS disabled_users,
              (SELECT COUNT(*) FROM users WHERE role='admin') AS admin_users,
              (SELECT COUNT(*) FROM capsules) AS total_capsules,
              (SELECT COUNT(*) FROM capsules WHERE status='LOCKED') AS locked_capsules,
              (SELECT COUNT(*) FROM capsules WHERE status='UNLOCKED') AS unlocked_capsules,
              (SELECT COUNT(*) FROM memories) AS total_memories,
              (SELECT COUNT(*) FROM capsules WHERE status='LOCKED' AND unlock_at > ?) AS upcoming_unlocks`).get(nowIso());
            const emailRows = db.prepare('SELECT status,COUNT(*) AS count FROM email_deliveries GROUP BY status').all();
            const emailDeliveries = Object.fromEntries(['pending','sending','accepted','retry_scheduled','permanently_failed','disabled'].map((status) => [status, 0]));
            for (const row of emailRows) emailDeliveries[row.status] = Number(row.count);
            const recentUnlocks = Number(db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE type='capsule_unlocked' AND created_at >= ?").get(new Date(Date.now() - 7 * 86400_000).toISOString()).count);
            let aiService = { status: 'unavailable' };
            try {
              const response = await fetch(`${aiServiceUrl}/health`, { headers: { 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY || '' }, signal: AbortSignal.timeout(1800) });
              if (response.ok) aiService = { status: 'healthy' };
              else aiService = { status: 'unhealthy' };
            } catch { aiService = { status: 'unavailable' }; }
            const schedulerFresh = schedulerStatus.lastCompletedAt && Date.now() - Date.parse(schedulerStatus.lastCompletedAt) < 90_000;
            return json(res, 200, {
              statistics: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)])),
              recent_unlocks_7d: recentUnlocks,
              email_deliveries: emailDeliveries,
              services: {
                node_api: 'healthy', ai_service: aiService.status,
                scheduler: schedulerFresh ? schedulerStatus.state : schedulerStatus.state === 'error' ? 'error' : 'unavailable',
                scheduler_last_completed_at: schedulerFresh ? schedulerStatus.lastCompletedAt : null,
              },
            });
          }
          if (pathname === `${apiPrefix}/admin/users` && req.method === 'GET') {
            const rawPage = url.searchParams.get('page') ?? '1';
            const rawLimit = url.searchParams.get('limit') ?? '20';
            if (!/^\d{1,6}$/.test(rawPage) || !/^\d{1,3}$/.test(rawLimit)) fail(422, 'Invalid pagination parameters');
            const page = Math.max(1, Math.min(100_000, Number(rawPage)));
            const limit = Math.max(1, Math.min(100, Number(rawLimit)));
            const search = (url.searchParams.get('search') ?? '').trim();
            if (search.length > 120) fail(422, 'Search must be 120 characters or fewer');
            const escaped = search.replace(/[\\%_]/g, '\\$&');
            const pattern = `%${escaped}%`;
            const where = search ? "WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'" : '';
            const params = search ? [pattern, pattern] : [];
            const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM users ${where}`).get(...params).count);
            const users = db.prepare(`SELECT id,name,email,created_at,role,account_status FROM users ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`)
              .all(...params, limit, (page - 1) * limit);
            return json(res, 200, { users, page, limit, total, pages: Math.ceil(total / limit) });
          }
          const adminUserMatch = pathname.match(new RegExp(`^${apiPrefix}/admin/users/([^/]+)/status$`));
          if (adminUserMatch && req.method === 'PATCH') {
            const targetId = decodeURIComponent(adminUserMatch[1]);
            let success = false;
            try {
              const input = await parseJson(req);
              if (!['active','disabled'].includes(input.status)) fail(422, 'status must be active or disabled');
              if (targetId === user.id && input.status === 'disabled') fail(409, 'You cannot disable your own account');
              const target = readUser(db, targetId);
              if (!target) fail(404, 'User not found');
              db.prepare('UPDATE users SET account_status=? WHERE id=?').run(input.status, targetId);
              success = true;
              return json(res, 200, { id: targetId, account_status: input.status });
            } finally {
              db.prepare('INSERT INTO admin_audit_log(id,administrator_id,action,target_user_id,occurred_at,success) VALUES(?,?,?,?,?,?)')
                .run(randomUUID(), user.id, 'user_status_change', targetId, nowIso(), Number(success));
            }
          }
          fail(404, 'Admin API endpoint not found');
        }
        if (pathname.startsWith(`${apiPrefix}/ai/`) && consumeRateLimit(aiRequests, user.id, 60, 60_000)) fail(429, 'Too many AI requests. Try again later.');
        if (pathname === `${apiPrefix}/auth/me` && req.method === 'GET') return json(res, 200, { id: user.id, name: user.name, email: user.email, role: user.role, account_status: user.account_status });
        if (pathname === `${apiPrefix}/auth/logout` && req.method === 'POST') {
          db.prepare('INSERT OR REPLACE INTO revoked_tokens (jti,expires_at) VALUES (?,?)').run(token.jti, token.exp);
          db.prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
          return json(res, 200, { detail: 'Logged out' });
        }

        const mediaMatch = pathname.match(new RegExp(`^${apiPrefix}/media/([0-9a-f-]{36})$`, 'i'));
        if (mediaMatch && req.method === 'GET') {
          processDueCapsules(db, user.id); kickEmailDelivery();
          const asset = db.prepare('SELECT a.*,c.owner_id,c.status FROM media_assets a JOIN memories m ON m.id=a.memory_id JOIN capsules c ON c.id=m.capsule_id WHERE a.id=?').get(mediaMatch[1]);
          if (!asset || asset.owner_id !== user.id) fail(404, 'Media not found');
          if (asset.status === 'LOCKED') fail(403, 'Capsule is locked and cannot expose media');
          let content;
          try { content = await mediaStorage.read(asset.storage_key); }
          catch (error) { if (error.code === 'ENOENT') fail(404, 'Media file is missing'); throw new HttpError(503, 'Media storage is unavailable'); }
          res.writeHead(200, { 'Content-Type': asset.mime_type, 'Content-Length': content.length, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
          return res.end(content);
        }
        if (pathname === `${apiPrefix}/media/migrate` && req.method === 'POST') {
          processDueCapsules(db, user.id); kickEmailDelivery();
          const input = await parseJson(req);
          const limit = Math.min(50, Math.max(1, Number(input.limit) || 25));
          const rows = db.prepare("SELECT m.* FROM memories m JOIN capsules c ON c.id=m.capsule_id WHERE c.owner_id=? AND c.status='UNLOCKED' AND m.media_url LIKE 'data:%' ORDER BY m.created_at LIMIT ?").all(user.id, limit);
          let migrated = 0; let failed = 0;
          for (const memory of rows) {
            let stored;
            try {
              decodeMediaDataUrl(memory.type, memory.media_url);
              stored = await mediaStorage.save(memory.type, memory.media_url);
              const persisted = await mediaStorage.read(stored.storageKey);
              const original = decodeMediaDataUrl(memory.type, memory.media_url);
              if (!persisted.equals(original.buffer)) throw new Error('Stored media did not match source data');
              db.exec('BEGIN IMMEDIATE');
              db.prepare('INSERT INTO media_assets (id,memory_id,storage_key,mime_type,byte_size,created_at,original_filename) VALUES (?,?,?,?,?,?,?)').run(stored.id, memory.id, stored.storageKey, stored.mimeType, stored.size, nowIso(), safeMediaFilename(memory.content_text));
              const changed = db.prepare('UPDATE memories SET media_url=? WHERE id=? AND media_url=?').run(`media:${stored.id}`, memory.id, memory.media_url).changes;
              if (changed !== 1) throw new Error('Media record changed during migration');
              db.exec('COMMIT');
              migrated += 1;
            } catch {
              try { db.exec('ROLLBACK'); } catch {}
              if (stored) await mediaStorage.delete(stored.storageKey).catch(() => undefined);
              failed += 1;
            }
          }
          const remaining = Number(db.prepare("SELECT COUNT(*) AS count FROM memories m JOIN capsules c ON c.id=m.capsule_id WHERE c.owner_id=? AND c.status='UNLOCKED' AND m.media_url LIKE 'data:%'").get(user.id).count);
          const lockedRemaining = Number(db.prepare("SELECT COUNT(*) AS count FROM memories m JOIN capsules c ON c.id=m.capsule_id WHERE c.owner_id=? AND c.status='LOCKED' AND m.media_url LIKE 'data:%'").get(user.id).count);
          return json(res, 200, { migrated, failed, remaining, locked_remaining: lockedRemaining, next_limit: limit });
        }

        if (pathname === `${apiPrefix}/profile` && req.method === 'GET') return json(res, 200, publicUser(user));
        if (pathname === `${apiPrefix}/profile` && req.method === 'PUT') {
          const input = await parseJson(req); const name = input.name === undefined ? user.name : requiredText(input.name, 'Name', 120);
          const email = input.email === undefined ? user.email : emailValue(input.email);
          const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?').get(email, user.id);
          if (existing) fail(409, 'Email already in use');
          db.prepare('UPDATE users SET name=?, email=?, location=?, bio=?, initials=? WHERE id=?').run(
            name, email, typeof input.location === 'string' ? input.location.slice(0, 200) : user.location,
            typeof input.bio === 'string' ? input.bio.slice(0, 2000) : user.bio,
            typeof input.initials === 'string' && input.initials.trim() ? input.initials.trim().slice(0, 5) : initials(name), user.id,
          );
          return json(res, 200, publicUser(readUser(db, user.id)));
        }
        if (pathname === `${apiPrefix}/settings` && req.method === 'GET') return json(res, 200, { notifications: Boolean(user.notifications), unlock_emails: Boolean(user.unlock_emails), compact_mode: Boolean(user.compact_mode), export_format: user.export_format });
        if (pathname === `${apiPrefix}/settings` && req.method === 'PATCH') {
          const input = await parseJson(req);
          const notifications = input.notifications === undefined ? user.notifications : Number(Boolean(input.notifications));
          const unlockEmails = input.unlock_emails === undefined ? user.unlock_emails : Number(Boolean(input.unlock_emails));
          const compact = input.compact_mode === undefined ? user.compact_mode : Number(Boolean(input.compact_mode));
          const format = input.export_format === undefined ? user.export_format : input.export_format;
          if (!['json', 'text'].includes(format)) fail(422, 'export_format must be json or text');
          db.prepare('UPDATE users SET notifications=?, unlock_emails=?, compact_mode=?, export_format=? WHERE id=?').run(notifications, unlockEmails, compact, format, user.id);
          if (unlockEmails) db.prepare("UPDATE email_deliveries SET status='pending',last_error=NULL,next_retry_at=NULL,updated_at=? WHERE owner_id=? AND status='disabled' AND last_error='Owner disabled unlock emails'").run(nowIso(), user.id);
          else db.prepare("UPDATE email_deliveries SET status='disabled',last_error='Owner disabled unlock emails',next_retry_at=NULL,updated_at=? WHERE owner_id=? AND status IN ('pending','retry_scheduled')").run(nowIso(), user.id);
          return json(res, 200, { notifications: Boolean(notifications), unlock_emails: Boolean(unlockEmails), compact_mode: Boolean(compact), export_format: format });
        }
        if (pathname === `${apiPrefix}/export` && req.method === 'GET') {
          processDueCapsules(db, user.id); kickEmailDelivery();
          const capsules = db.prepare('SELECT * FROM capsules WHERE owner_id=? ORDER BY created_at DESC').all(user.id).map((capsule) => ({ ...capsuleJson(db, capsule), memories: capsule.status === 'UNLOCKED' ? db.prepare('SELECT m.*,a.original_filename AS media_filename FROM memories m LEFT JOIN media_assets a ON a.memory_id=m.id WHERE m.capsule_id=? ORDER BY m.created_at').all(capsule.id).map(memoryJson) : undefined }));
          return json(res, 200, { data: { profile: publicUser(user), settings: { notifications: Boolean(user.notifications), unlock_emails: Boolean(user.unlock_emails), compact_mode: Boolean(user.compact_mode), export_format: user.export_format }, capsules }, generated_at: nowIso() });
        }

        if (pathname === `${apiPrefix}/ai/health` && req.method === 'GET') {
          try {
            const aiResponse = await fetch(`${aiServiceUrl}/health`, { headers: process.env.AI_SERVICE_API_KEY ? { 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY } : {}, signal: AbortSignal.timeout(3000) });
            if (!aiResponse.ok) fail(503, 'AI service is unavailable');
            return json(res, 200, await aiResponse.json());
          } catch { fail(503, 'AI service is unavailable. Start ai-service on port 8100.'); }
        }
        if (pathname === `${apiPrefix}/ai/sentiment` && req.method === 'POST') {
          const input = await parseJson(req);
          if (typeof input.text !== 'string' || !input.text.trim()) fail(422, 'Text is required');
          return json(res, 200, await callAi(aiServiceUrl, '/sentiment', { text: input.text }));
        }
        if (pathname === `${apiPrefix}/ai/mood` && req.method === 'POST') {
          const input = await parseJson(req);
          if (typeof input.text !== 'string' || !input.text.trim()) fail(422, 'Text is required');
          return json(res, 200, await callAi(aiServiceUrl, '/mood', { text: input.text }));
        }
        if (pathname === `${apiPrefix}/ai/mood-summary` && req.method === 'GET') {
          processDueCapsules(db, user.id); kickEmailDelivery();
          const memories = db.prepare("SELECT m.content_text,m.created_at FROM memories m JOIN capsules c ON c.id=m.capsule_id WHERE c.owner_id=? AND c.status='UNLOCKED' AND TRIM(m.content_text) != '' ORDER BY m.created_at ASC,m.id ASC LIMIT 500").all(user.id);
          if (!memories.length) return json(res, 200, { count: 0, average_mood_score: null, distribution: {}, series: [] });
          const results = [];
          for (let index = 0; index < memories.length; index += 25) {
            const analysis = await callAi(aiServiceUrl, '/mood/batch', { texts: memories.slice(index, index + 25).map((memory) => memory.content_text) });
            if (!Array.isArray(analysis.results) || analysis.results.length !== Math.min(25, memories.length - index)
              || analysis.results.some((result) => !result || !['positive', 'neutral', 'negative'].includes(result.label)
                || typeof result.mood_score_0_100 !== 'number' || !Number.isFinite(result.mood_score_0_100) || result.mood_score_0_100 < 0 || result.mood_score_0_100 > 100)) {
              fail(503, 'AI service returned invalid sentiment results');
            }
            results.push(...analysis.results);
          }
          const distribution = results.reduce((counts, result) => { counts[result.label] = (counts[result.label] || 0) + 1; return counts; }, {});
          const average = results.reduce((sum, result) => sum + result.mood_score_0_100, 0) / results.length;
          const series = results.map((result, index) => ({ date: memories[index].created_at.slice(0, 10), value: result.mood_score_0_100, label: result.label }));
          return json(res, 200, { count: results.length, average_mood_score: Math.round(average * 10) / 10, distribution, series });
        }
        if (pathname === `${apiPrefix}/ai/embeddings` && req.method === 'POST') {
          const input = await parseJson(req);
          if (typeof input.text !== 'string' || !input.text.trim()) fail(422, 'Text is required');
          return json(res, 200, await callAi(aiServiceUrl, '/embeddings', { text: input.text }));
        }
        if (pathname === `${apiPrefix}/ai/embeddings/backfill` && req.method === 'POST') {
          processDueCapsules(db, user.id); kickEmailDelivery();
          const input = await parseJson(req);
          const limit = Math.min(100, Math.max(1, Number(input.limit) || 25));
          const health = await fetch(`${aiServiceUrl}/health`, { headers: process.env.AI_SERVICE_API_KEY ? { 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY } : {}, signal: AbortSignal.timeout(5000) }).then((response) => response.ok ? response.json() : Promise.reject(new Error('AI service unavailable'))).catch(() => fail(503, 'AI service is unavailable. Start ai-service on port 8100.'));
          let cursorClause = '';
          const cursorParams = [];
          if (input.cursor !== undefined) {
            const cursor = db.prepare("SELECT m.id,m.created_at FROM memories m JOIN capsules c ON c.id=m.capsule_id WHERE m.id=? AND c.owner_id=? AND c.status='UNLOCKED'").get(String(input.cursor), user.id);
            if (!cursor) fail(422, 'Backfill cursor is invalid for this account or capsule state');
            cursorClause = 'AND (m.created_at>? OR (m.created_at=? AND m.id>?))';
            cursorParams.push(cursor.created_at, cursor.created_at, cursor.id);
          }
          const rows = db.prepare(`SELECT m.* FROM memories m JOIN capsules c ON c.id=m.capsule_id WHERE c.owner_id=? AND c.status='UNLOCKED' AND (TRIM(m.content_text)!='' OR EXISTS (SELECT 1 FROM media_assets a WHERE a.memory_id=m.id AND TRIM(a.original_filename)!='')) ${cursorClause} ORDER BY m.created_at,m.id LIMIT ?`).all(user.id, ...cursorParams, limit);
          const pending = rows.filter((row) => !readStoredVector(row, health.embedding_model));
          let migrated = 0; let failed = 0;
          for (let index = 0; index < pending.length; index += 25) {
            const result = await generateEmbeddingBatch(db, aiServiceUrl, pending.slice(index, index + 25), embeddingStats);
            migrated += result.migrated; failed += result.failed;
          }
          const total = Number(db.prepare("SELECT COUNT(*) AS count FROM memories m JOIN capsules c ON c.id=m.capsule_id WHERE c.owner_id=? AND c.status='UNLOCKED' AND (TRIM(m.content_text)!='' OR EXISTS (SELECT 1 FROM media_assets a WHERE a.memory_id=m.id AND TRIM(a.original_filename)!=''))").get(user.id).count);
          const remaining = Number(db.prepare("SELECT COUNT(*) AS count FROM memories m JOIN capsules c ON c.id=m.capsule_id WHERE c.owner_id=? AND c.status='UNLOCKED' AND (TRIM(m.content_text)!='' OR EXISTS (SELECT 1 FROM media_assets a WHERE a.memory_id=m.id AND TRIM(a.original_filename)!='')) AND (m.embedding_status!='ready' OR m.embedding_model IS NOT ? OR m.embedding_dimensions!=384 OR m.embedding_json IS NULL OR CASE WHEN json_valid(m.embedding_json) THEN json_array_length(m.embedding_json)!=384 ELSE 1 END)").get(user.id, health.embedding_model).count);
          const last = rows.at(-1);
          const hasMore = Boolean(last && db.prepare("SELECT 1 FROM memories m JOIN capsules c ON c.id=m.capsule_id WHERE c.owner_id=? AND c.status='UNLOCKED' AND (TRIM(m.content_text)!='' OR EXISTS (SELECT 1 FROM media_assets a WHERE a.memory_id=m.id AND TRIM(a.original_filename)!='')) AND (m.created_at>? OR (m.created_at=? AND m.id>?)) LIMIT 1").get(user.id, last.created_at, last.created_at, last.id));
          return json(res, 200, { model: health.embedding_model, dimensions: health.embedding_dimensions, attempted: pending.length, scanned: rows.length, migrated, failed, remaining, progress: total ? Math.round((total - remaining) / total * 100) : 100, next_cursor: hasMore ? last.id : null });
        }
        if (pathname === `${apiPrefix}/ai/images/reprocess` && req.method === 'POST') {
          processDueCapsules(db, user.id); kickEmailDelivery();
          const input = await parseJson(req);
          const limit = Math.min(50, Math.max(1, Number(input.limit) || 10));
          const health = await fetch(`${aiServiceUrl}/health`, { headers: process.env.AI_SERVICE_API_KEY ? { 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY } : {}, signal: AbortSignal.timeout(5000) })
            .then((response) => response.ok ? response.json() : Promise.reject(new Error('AI service unavailable')))
            .catch(() => fail(503, 'AI service is unavailable. Start ai-service on port 8100.'));
          const rows = db.prepare("SELECT m.*,a.original_filename AS media_filename,a.mime_type AS media_mime_type,a.analysis_status AS image_analysis_status,a.analysis_description AS image_description FROM memories m JOIN capsules c ON c.id=m.capsule_id JOIN media_assets a ON a.memory_id=m.id WHERE c.owner_id=? AND c.status='UNLOCKED' AND m.type='image' ORDER BY m.created_at,m.id LIMIT ?").all(user.id, limit);
          let analyzed = 0; let reused = 0; let failed = 0; let embedded = 0;
          for (const row of rows) {
            const result = await analyzeImage(db, aiServiceUrl, mediaStorage, row, embeddingStats);
            if (result.status === 'ready') {
              if (row.image_analysis_status === 'ready') reused += 1; else analyzed += 1;
              const refreshed = db.prepare('SELECT * FROM memories WHERE id=?').get(row.id);
              if (!readStoredVector(refreshed, health.embedding_model)) {
                if (await generateEmbedding(db, aiServiceUrl, refreshed, embeddingStats)) embedded += 1;
              }
            } else if (result.status === 'failed') failed += 1;
          }
          return json(res, 200, { scanned: rows.length, analyzed, reused, failed, embedded });
        }
        if (pathname === `${apiPrefix}/ai/summarize` && req.method === 'POST') {
          const input = await parseJson(req);
          processDueCapsules(db, user.id); kickEmailDelivery();
          const maxSummaryChars = 100_000;
          let memories;
          if (input.capsule_id) {
            const capsule = readCapsule(db, String(input.capsule_id));
            if (!capsule) fail(404, 'Capsule not found');
            if (capsule.owner_id !== user.id) fail(403, 'Not authorized to access this capsule');
            if (capsule.status === 'LOCKED') fail(403, 'Capsule is locked and cannot expose memories');
            memories = db.prepare("SELECT content_text FROM memories WHERE capsule_id=? AND TRIM(content_text) != '' ORDER BY created_at,id LIMIT 501").all(capsule.id);
          } else {
            memories = db.prepare("SELECT m.content_text FROM memories m JOIN capsules c ON c.id=m.capsule_id WHERE c.owner_id=? AND c.status='UNLOCKED' AND TRIM(m.content_text) != '' ORDER BY m.created_at,m.id LIMIT 501").all(user.id);
          }
          const selectedMemories = memories.slice(0, 500);
          const parts = [];
          let sourceLength = 0;
          let includedMemoryCount = 0;
          let truncated = memories.length > selectedMemories.length;
          for (const memory of selectedMemories) {
            const separator = parts.length ? '. ' : '';
            const available = maxSummaryChars - sourceLength - separator.length;
            if (available <= 0) { truncated = true; break; }
            includedMemoryCount += 1;
            const content = memory.content_text.slice(0, available);
            parts.push(`${separator}${content}`);
            sourceLength += separator.length + content.length;
            if (content.length < memory.content_text.length) { truncated = true; break; }
          }
          const source = parts.join('');
          if (!source) return json(res, 200, { summary: '', method: 'extractive_frequency', source_sentences: 0, memory_count: 0, truncated });
          const result = await callAi(aiServiceUrl, '/summarize', { text: source }, { max_sentences: Math.min(5, Math.max(1, Number(input.max_sentences) || 3)) });
          return json(res, 200, { ...result, memory_count: includedMemoryCount, truncated });
        }
        if (pathname === `${apiPrefix}/ai/conversations` && req.method === 'GET') {
          return json(res, 200, db.prepare('SELECT id,title,created_at,updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC,id DESC LIMIT 50').all(user.id));
        }
        if (pathname === `${apiPrefix}/ai/conversations` && req.method === 'POST') {
          const count = Number(db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE user_id=?').get(user.id).count);
          if (count >= 100) fail(409, 'Delete an older conversation before starting another.');
          const id = randomUUID(); const timestamp = nowIso();
          db.prepare('INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, user.id, 'New conversation', timestamp, timestamp);
          return json(res, 201, { id, title: 'New conversation', created_at: timestamp, updated_at: timestamp });
        }
        const conversationMatch = pathname.match(new RegExp(`^${apiPrefix}/ai/conversations/([0-9a-f-]{36})$`, 'i'));
        if (conversationMatch) {
          const conversation = db.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').get(conversationMatch[1], user.id);
          if (!conversation) fail(404, 'Conversation not found');
          if (req.method === 'DELETE') {
            db.prepare('DELETE FROM conversations WHERE id=? AND user_id=?').run(conversation.id, user.id);
            return json(res, 200, { detail: 'Conversation deleted' });
          }
          if (req.method === 'GET') {
            const rows = db.prepare('SELECT * FROM chat_messages WHERE conversation_id=? ORDER BY rowid LIMIT 1000').all(conversation.id);
            return json(res, 200, { id: conversation.id, title: conversation.title, messages: rows.map((row) => conversationMessageJson(db, user.id, row)) });
          }
        }
        if ((pathname === `${apiPrefix}/ai/search` || pathname === `${apiPrefix}/ai/chat`) && req.method === 'POST') {
          const input = await parseJson(req); const query = requiredText(input.query, 'Query', 4000);
          const isChat = pathname.endsWith('/chat');
          processDueCapsules(db, user.id); kickEmailDelivery();
          let conversation = null; let priorMessages = [];
          if (isChat) {
            if (input.conversation_id !== undefined && (typeof input.conversation_id !== 'string' || input.conversation_id.length > 64)) fail(422, 'conversation_id is invalid');
            if (input.conversation_id) {
              conversation = db.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').get(input.conversation_id, user.id);
              if (!conversation) fail(404, 'Conversation not found');
            } else {
              const count = Number(db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE user_id=?').get(user.id).count);
              if (count >= 100) fail(409, 'Delete an older conversation before starting another.');
              const id = randomUUID(); const timestamp = nowIso();
              db.prepare('INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, user.id, 'New conversation', timestamp, timestamp);
              conversation = db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
            }
            priorMessages = db.prepare('SELECT * FROM chat_messages WHERE conversation_id=? ORDER BY rowid DESC LIMIT 12').all(conversation.id).reverse()
              .map((row) => conversationMessageJson(db, user.id, row));
          }
          const priorContext = priorMessages.map((message) => `${message.role === 'user' ? 'Past question' : 'Past reply'}: ${message.content}`).join('\n').slice(-3000);
          const retrievalQuery = isChat && priorContext ? `${priorContext}\nCurrent question: ${query}`.slice(-4000) : query;
          const queryEmbedding = await callAi(aiServiceUrl, '/embeddings', { text: retrievalQuery }, { query: true });
          if (!validVector(queryEmbedding)) fail(503, 'AI service returned an invalid query embedding');
          embeddingStats.searches += 1;
          const rows = db.prepare("SELECT m.*,a.original_filename AS media_filename,a.mime_type AS media_mime_type,a.analysis_status AS image_analysis_status,a.analysis_description AS image_description FROM memories m JOIN capsules c ON c.id=m.capsule_id LEFT JOIN media_assets a ON a.memory_id=m.id WHERE c.owner_id=? AND c.status='UNLOCKED' AND (TRIM(m.content_text) != '' OR TRIM(COALESCE(a.original_filename,'')) != '' OR (a.analysis_status='ready' AND TRIM(COALESCE(a.analysis_description,'')) != '')) ORDER BY m.created_at DESC,m.id ASC LIMIT 500").all(user.id);
          const availableCount = Number(db.prepare("SELECT COUNT(*) AS count FROM memories m JOIN capsules c ON c.id=m.capsule_id LEFT JOIN media_assets a ON a.memory_id=m.id WHERE c.owner_id=? AND c.status='UNLOCKED' AND (TRIM(m.content_text) != '' OR TRIM(COALESCE(a.original_filename,'')) != '' OR (a.analysis_status='ready' AND TRIM(COALESCE(a.analysis_description,'')) != ''))").get(user.id).count);
          const missing = rows.filter((memory) => !readStoredVector(memory, queryEmbedding.model));
          for (let index = 0; index < missing.length; index += 25) await generateEmbeddingBatch(db, aiServiceUrl, missing.slice(index, index + 25), embeddingStats);
          const refreshedRows = rows.length
            ? db.prepare(`SELECT * FROM memories WHERE id IN (${rows.map(() => '?').join(',')})`).all(...rows.map((memory) => memory.id))
            : [];
          const refreshedById = new Map(refreshedRows.map((memory) => [memory.id, memory]));
          const memories = rows.map((memory) => {
            const refreshed = refreshedById.get(memory.id);
            if (!refreshed || refreshed.content_text !== memory.content_text) return null;
            const embedding = readStoredVector(refreshed, queryEmbedding.model);
            if (embedding) embeddingStats.reused += 1;
            return embedding ? { id: memory.id, text: searchableText(memory), created_at: memory.created_at, embedding, embedding_model: refreshed.embedding_model } : null;
          }).filter(Boolean);
          const requestPayload = {
            query: retrievalQuery, query_embedding: queryEmbedding.embedding, query_embedding_model: queryEmbedding.model,
            memories, ...(input.limit ? { limit: Math.min(20, Math.max(1, Number(input.limit))) } : {}),
          };
          const maxSearchPayloadBytes = 12 * 1024 * 1024;
          let encodedSize = Buffer.byteLength(JSON.stringify(requestPayload));
          while (memories.length && encodedSize > maxSearchPayloadBytes) {
            const hadMultiple = memories.length > 1;
            encodedSize -= Buffer.byteLength(JSON.stringify(memories.pop())) + Number(hadMultiple);
          }
          const contextLimited = memories.length < availableCount;
          const result = await callAi(aiServiceUrl, isChat ? '/chat' : '/search', requestPayload);
          const safeResult = isChat ? validateChatResponse(result, memories) : validateSearchResponse(result, memories);
          if (!isChat) return json(res, 200, { ...safeResult, context_limited: contextLimited });

          const references = visibleChatReferences(db, user.id, safeResult.references);
          const userTimestamp = Date.now();
          const userMessage = { id: randomUUID(), content: query, created_at: new Date(userTimestamp).toISOString() };
          const assistantMessage = { id: randomUUID(), content: safeResult.answer, created_at: new Date(Math.max(Date.now(), userTimestamp + 1)).toISOString() };
          db.exec('BEGIN IMMEDIATE');
          try {
            const messageCount = Number(db.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id=?').get(conversation.id).count);
            if (messageCount > 990) fail(409, 'This conversation has reached its message limit. Start a new conversation.');
            db.prepare("INSERT INTO chat_messages(id,conversation_id,role,content,references_json,created_at) VALUES(?,?,'user',?,'[]',?)")
              .run(userMessage.id, conversation.id, userMessage.content, userMessage.created_at);
            db.prepare("INSERT INTO chat_messages(id,conversation_id,role,content,references_json,created_at) VALUES(?,?,'assistant',?,?,?)")
              .run(assistantMessage.id, conversation.id, assistantMessage.content, JSON.stringify(references), assistantMessage.created_at);
            db.prepare("UPDATE conversations SET title=CASE WHEN title='New conversation' THEN ? ELSE title END,updated_at=? WHERE id=? AND user_id=?")
              .run(query.slice(0, 100), assistantMessage.created_at, conversation.id, user.id);
            db.exec('COMMIT');
          } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
          return json(res, 200, {
            ...safeResult, references, context_limited: contextLimited, conversation_id: conversation.id,
            user_message: userMessage, assistant_message: assistantMessage,
          });
        }

        if (pathname === `${apiPrefix}/capsules` && req.method === 'POST') {
          const input = await parseJson(req); const title = requiredText(input.title, 'Title', 200);
          const unlockAt = normalizeUnlock(input.unlock_at); const id = randomUUID(); const timestamp = nowIso();
          const status = Date.parse(unlockAt) <= Date.now() ? 'UNLOCKED' : 'LOCKED';
          const color = ['gold', 'blue', 'rose'].includes(input.color) ? input.color : 'gold';
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare('INSERT INTO capsules (id,owner_id,title,description,color,created_at,updated_at,unlock_at,status) VALUES (?,?,?,?,?,?,?,?,?)')
              .run(id, user.id, title, typeof input.description === 'string' ? input.description.slice(0, 2000) : '', color, timestamp, timestamp, unlockAt, status);
            if (status === 'UNLOCKED') {
              createNotification(db, user.id, 'capsule_unlocked', `Your capsule '${title}' has unlocked.`, id, `unlock:${id}`);
              queueUnlockEmail(db, { id, owner_id: user.id });
            } else createNotification(db, user.id, 'capsule_created', `Your capsule '${title}' has been sealed.`, id, `created:${id}`);
            db.exec('COMMIT');
          } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
          if (status === 'UNLOCKED') kickEmailDelivery();
          return json(res, 201, capsuleJson(db, readCapsule(db, id)));
        }
        if (pathname === `${apiPrefix}/capsules` && req.method === 'GET') {
          processDueCapsules(db, user.id); kickEmailDelivery();
          return json(res, 200, db.prepare('SELECT * FROM capsules WHERE owner_id=? ORDER BY created_at DESC').all(user.id).map((capsule) => capsuleJson(db, capsule)));
        }

        const capsuleMatch = pathname.match(new RegExp(`^${apiPrefix}/capsules/([^/]+)(?:/(lock|unlock|memories))?$`));
        if (capsuleMatch) {
          const capsuleId = decodeURIComponent(capsuleMatch[1]); const action = capsuleMatch[2];
          if (req.method === 'GET') { processDueCapsules(db, user.id); kickEmailDelivery(); }
          const capsule = readCapsule(db, capsuleId);
          if (!capsule) fail(404, 'Capsule not found');
          if (capsule.owner_id !== user.id) fail(403, 'Not authorized to access this capsule');
          if (!action && req.method === 'GET') return json(res, 200, capsuleJson(db, capsule));
          if (!action && req.method === 'PUT') {
            const input = await parseJson(req);
            const title = input.title === undefined ? capsule.title : requiredText(input.title, 'Title', 200);
            const description = input.description === undefined ? capsule.description : (typeof input.description === 'string' ? input.description.slice(0, 2000) : fail(422, 'Description must be text'));
            const unlockAt = input.unlock_at === undefined ? capsule.unlock_at : normalizeUnlock(input.unlock_at);
            if (capsule.status === 'LOCKED' && Date.parse(unlockAt) < Date.parse(capsule.unlock_at)) fail(403, 'The unlock date cannot be moved earlier while a capsule is locked');
            const status = Date.parse(unlockAt) <= Date.now() ? 'UNLOCKED' : 'LOCKED';
            db.exec('BEGIN IMMEDIATE');
            try {
              db.prepare('UPDATE capsules SET title=?,description=?,unlock_at=?,status=?,updated_at=? WHERE id=?').run(title, description, unlockAt, status, nowIso(), capsule.id);
              if (status === 'UNLOCKED') {
                createNotification(db, user.id, 'capsule_unlocked', `Your capsule '${title}' has unlocked.`, capsule.id, `unlock:${capsule.id}`);
                if (capsule.status === 'LOCKED') queueUnlockEmail(db, capsule);
              }
              db.exec('COMMIT');
            } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
            if (status === 'UNLOCKED' && capsule.status === 'LOCKED') kickEmailDelivery();
            return json(res, 200, capsuleJson(db, readCapsule(db, capsule.id)));
          }
          if (!action && req.method === 'DELETE') {
            const assets = db.prepare('SELECT a.storage_key FROM media_assets a JOIN memories m ON m.id=a.memory_id WHERE m.capsule_id=?').all(capsule.id);
            db.prepare('DELETE FROM capsules WHERE id=?').run(capsule.id);
            for (const asset of assets) await mediaStorage.delete(asset.storage_key).catch(() => undefined);
            return json(res, 200, { detail: 'Capsule deleted' });
          }
          if (action === 'lock' && req.method === 'POST') {
            db.prepare("UPDATE capsules SET status='LOCKED',updated_at=? WHERE id=?").run(nowIso(), capsule.id);
            return json(res, 200, capsuleJson(db, readCapsule(db, capsule.id)));
          }
          if (action === 'unlock' && req.method === 'POST') {
            if (Date.parse(capsule.unlock_at) > Date.now()) fail(403, 'Capsule is not ready to unlock yet');
            db.prepare("UPDATE capsules SET status='UNLOCKED',updated_at=? WHERE id=?").run(nowIso(), capsule.id);
            createNotification(db, user.id, 'capsule_unlocked', `Your capsule '${capsule.title}' has unlocked.`, capsule.id, `unlock:${capsule.id}`);
            queueUnlockEmail(db, capsule); kickEmailDelivery();
            return json(res, 200, capsuleJson(db, readCapsule(db, capsule.id)));
          }
          if (action === 'memories' && req.method === 'POST') {
            const input = await parseJson(req, 70 * 1024 * 1024);
            const type = input.type;
            if (!Object.hasOwn(allowedMedia, type)) fail(422, 'Unsupported memory type');
            const content = typeof input.content_text === 'string' ? input.content_text.trim() : '';
            const mediaUrl = typeof input.media_url === 'string' ? input.media_url : '';
            const mediaFilename = safeMediaFilename(input.file_name);
            if (!content && !mediaUrl) fail(422, 'A memory needs text or media');
            if (content.length > 20000) fail(422, 'Memory text is too long');
            validateMedia(type, mediaUrl);
            const id = randomUUID(); const timestamp = nowIso(); let savedMedia = null; let reference = mediaUrl;
            if (mediaUrl.startsWith('data:')) {
              try { decodeMediaDataUrl(type, mediaUrl); savedMedia = await mediaStorage.save(type, mediaUrl); reference = `media:${savedMedia.id}`; }
              catch (error) { if (error.code) fail(503, 'Media storage is unavailable'); fail(422, error.message); }
            }
            try {
              db.exec('BEGIN IMMEDIATE');
              db.prepare('INSERT INTO memories (id,capsule_id,type,content_text,media_url,created_at,updated_at,embedding_status) VALUES (?,?,?,?,?,?,?,?)').run(id, capsule.id, type, content, reference, timestamp, timestamp, content || mediaFilename ? 'pending' : 'ready');
              if (savedMedia) db.prepare('INSERT INTO media_assets (id,memory_id,storage_key,mime_type,byte_size,created_at,original_filename) VALUES (?,?,?,?,?,?,?)').run(savedMedia.id, id, savedMedia.storageKey, savedMedia.mimeType, savedMedia.size, timestamp, mediaFilename);
              db.exec('COMMIT');
            } catch (error) {
              try { db.exec('ROLLBACK'); } catch {}
              if (savedMedia) await mediaStorage.delete(savedMedia.storageKey).catch(() => undefined);
              throw error;
            }
            // A locked capsule's contents must stay out of the AI service until unlock.
            let current = db.prepare('SELECT m.*,a.original_filename AS media_filename,a.analysis_status AS image_analysis_status,a.analysis_description AS image_description FROM memories m LEFT JOIN media_assets a ON a.memory_id=m.id WHERE m.id=?').get(id);
            if (type === 'image' && savedMedia && capsule.status === 'UNLOCKED') {
              await analyzeImage(db, aiServiceUrl, mediaStorage, current, embeddingStats);
              current = db.prepare('SELECT m.*,a.original_filename AS media_filename,a.analysis_status AS image_analysis_status,a.analysis_description AS image_description FROM memories m LEFT JOIN media_assets a ON a.memory_id=m.id WHERE m.id=?').get(id);
            }
            if ((content || mediaFilename || current.image_analysis_status === 'ready') && capsule.status === 'UNLOCKED') await generateEmbedding(db, aiServiceUrl, current, embeddingStats);
            current = db.prepare('SELECT m.*,a.original_filename AS media_filename,a.analysis_status AS image_analysis_status,a.analysis_description AS image_description FROM memories m LEFT JOIN media_assets a ON a.memory_id=m.id WHERE m.id=?').get(id);
            return json(res, 201, memoryJson(current));
          }
          if (action === 'memories' && req.method === 'GET') {
            const current = readCapsule(db, capsule.id);
            if (current.status === 'LOCKED') fail(403, 'Capsule is locked and cannot expose memories');
            return json(res, 200, db.prepare('SELECT m.*,a.original_filename AS media_filename,a.analysis_status AS image_analysis_status,a.analysis_description AS image_description FROM memories m LEFT JOIN media_assets a ON a.memory_id=m.id WHERE m.capsule_id=? ORDER BY m.created_at').all(capsule.id).map(memoryJson));
          }
        }

        const memoryMatch = pathname.match(new RegExp(`^${apiPrefix}/memories/([^/]+)$`));
        if (memoryMatch) {
          const memory = db.prepare('SELECT m.*,a.original_filename AS media_filename,a.analysis_status AS image_analysis_status,a.analysis_description AS image_description FROM memories m LEFT JOIN media_assets a ON a.memory_id=m.id WHERE m.id=?').get(decodeURIComponent(memoryMatch[1]));
          if (!memory) fail(404, 'Memory not found');
          const parent = readCapsule(db, memory.capsule_id);
          if (!parent || parent.owner_id !== user.id) fail(403, 'Not authorized to access this memory');
          if (parent.status === 'LOCKED') fail(403, 'Capsule is locked and cannot expose memories');
          if (req.method === 'GET') return json(res, 200, memoryJson(memory));
          if (req.method === 'PUT') {
            const input = await parseJson(req, 70 * 1024 * 1024); const type = input.type ?? memory.type;
            if (!Object.hasOwn(allowedMedia, type)) fail(422, 'Unsupported memory type');
            const content = input.content_text === undefined ? memory.content_text : String(input.content_text).trim();
            const mediaFilename = safeMediaFilename(input.file_name) || memory.media_filename;
            let mediaUrl = input.media_url === undefined ? memory.media_url : String(input.media_url);
            if (!content && !mediaUrl) fail(422, 'A memory needs text or media');
            if (content.length > 20000) fail(422, 'Memory text is too long');
            const oldAsset = db.prepare('SELECT * FROM media_assets WHERE memory_id=?').get(memory.id);
            if (oldAsset && mediaUrl !== memory.media_url) {
              try { if (new URL(mediaUrl, 'http://localhost').pathname === `/api/v1/media/${oldAsset.id}`) mediaUrl = memory.media_url; } catch {}
            }
            if (mediaUrl !== memory.media_url || !mediaUrl.startsWith('media:')) validateMedia(type, mediaUrl);
            const contentChanged = content !== memory.content_text;
            const metadataChanged = mediaFilename !== memory.media_filename;
            const searchable = Boolean(content || mediaFilename || memory.image_analysis_status === 'ready');
            const reindex = contentChanged || metadataChanged;
            let savedMedia = null; let reference = mediaUrl;
            if (mediaUrl.startsWith('data:')) {
              try { decodeMediaDataUrl(type, mediaUrl); savedMedia = await mediaStorage.save(type, mediaUrl); reference = `media:${savedMedia.id}`; }
              catch (error) { if (error.code) fail(503, 'Media storage is unavailable'); fail(422, error.message); }
            }
            const retainsExistingAsset = Boolean(oldAsset && reference === memory.media_url);
            try {
              db.exec('BEGIN IMMEDIATE');
              if (!retainsExistingAsset) db.prepare('DELETE FROM media_assets WHERE memory_id=?').run(memory.id);
              db.prepare("UPDATE memories SET type=?,content_text=?,media_url=?,updated_at=?,embedding_json=CASE WHEN ? THEN NULL ELSE embedding_json END,embedding_model=CASE WHEN ? THEN NULL ELSE embedding_model END,embedding_dimensions=CASE WHEN ? THEN NULL ELSE embedding_dimensions END,embedding_status=CASE WHEN ? AND ? THEN 'pending' WHEN ? THEN 'ready' ELSE embedding_status END,embedding_error=CASE WHEN ? THEN NULL ELSE embedding_error END WHERE id=?")
                .run(type, content, reference, nowIso(), Number(reindex), Number(reindex), Number(reindex), Number(reindex), Number(searchable), Number(reindex), Number(reindex), memory.id);
              if (savedMedia) db.prepare('INSERT INTO media_assets (id,memory_id,storage_key,mime_type,byte_size,created_at,original_filename) VALUES (?,?,?,?,?,?,?)').run(savedMedia.id, memory.id, savedMedia.storageKey, savedMedia.mimeType, savedMedia.size, nowIso(), mediaFilename);
              else if (oldAsset) db.prepare('UPDATE media_assets SET original_filename=? WHERE memory_id=?').run(mediaFilename, memory.id);
              db.exec('COMMIT');
            } catch (error) {
              try { db.exec('ROLLBACK'); } catch {}
              if (savedMedia) await mediaStorage.delete(savedMedia.storageKey).catch(() => undefined);
              throw error;
            }
            if (oldAsset && !retainsExistingAsset && oldAsset.storage_key !== savedMedia?.storageKey) await mediaStorage.delete(oldAsset.storage_key).catch(() => undefined);
            let current = db.prepare('SELECT m.*,a.original_filename AS media_filename,a.analysis_status AS image_analysis_status,a.analysis_description AS image_description FROM memories m LEFT JOIN media_assets a ON a.memory_id=m.id WHERE m.id=?').get(memory.id);
            if (type === 'image' && savedMedia && parent.status === 'UNLOCKED') {
              await analyzeImage(db, aiServiceUrl, mediaStorage, current, embeddingStats);
              current = db.prepare('SELECT m.*,a.original_filename AS media_filename,a.analysis_status AS image_analysis_status,a.analysis_description AS image_description FROM memories m LEFT JOIN media_assets a ON a.memory_id=m.id WHERE m.id=?').get(memory.id);
            }
            if ((reindex || current.image_analysis_status === 'ready') && searchable && parent.status === 'UNLOCKED') await generateEmbedding(db, aiServiceUrl, current, embeddingStats);
            return json(res, 200, memoryJson(current));
          }
          if (req.method === 'DELETE') {
            const assets = db.prepare('SELECT storage_key FROM media_assets WHERE memory_id=?').all(memory.id);
            db.prepare('DELETE FROM memories WHERE id=?').run(memory.id);
            for (const asset of assets) await mediaStorage.delete(asset.storage_key).catch(() => undefined);
            return json(res, 200, { detail: 'Memory deleted' });
          }
        }

        if (pathname === `${apiPrefix}/notifications` && req.method === 'GET') {
          const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC').all(user.id);
          if (!rows.length) createNotification(db, user.id, 'system', 'Welcome to your Digital Time Capsule.');
          return json(res, 200, db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC').all(user.id).map(notificationJson));
        }
        const notificationMatch = pathname.match(new RegExp(`^${apiPrefix}/notifications/([^/]+)/read$`));
        if (notificationMatch && req.method === 'PATCH') {
          const notification = db.prepare('SELECT * FROM notifications WHERE id=?').get(decodeURIComponent(notificationMatch[1]));
          if (!notification) fail(404, 'Notification not found');
          if (notification.user_id !== user.id) fail(403, 'Not authorized to access this notification');
          db.prepare('UPDATE notifications SET is_read=1 WHERE id=?').run(notification.id);
          return json(res, 200, notificationJson(db.prepare('SELECT * FROM notifications WHERE id=?').get(notification.id)));
        }
        if (pathname.startsWith(`${apiPrefix}/`)) fail(404, 'API endpoint not found');
      }

      if (pathname === '/' || !pathname.startsWith('/api/')) {
        const requestPath = pathname === '/' ? '/index.html' : normalize(decodeURIComponent(pathname));
        const target = resolve(frontendDist, `.${requestPath}`);
        if (target !== frontendDist && !target.startsWith(`${frontendDist}${sep}`)) fail(404, 'Not found');
        try {
          const content = await (await import('node:fs/promises')).readFile(target);
          res.writeHead(200, { 'Content-Type': mimeTypes[extname(target)] || 'application/octet-stream', 'Cache-Control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600' });
          return res.end(content);
        } catch {
          if (extname(pathname)) fail(404, 'Not found');
          const html = await (await import('node:fs/promises')).readFile(join(frontendDist, 'index.html'));
          res.writeHead(200, { 'Content-Type': mimeTypes['.html'], 'Cache-Control': 'no-cache' });
          return res.end(html);
        }
      }
      fail(404, 'Not found');
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error('Unhandled API error:', error);
      return json(res, status, { detail: status === 500 ? 'Internal server error' : error.message });
    }
  });

  return { server, db, embeddingStats, schedulerStatus, runUnlockScheduler, deliverPendingEmails, close: () => new Promise((resolveClose, reject) => { clearInterval(unlockTimer); server.close((error) => { try { db.close(); } catch {} error ? reject(error) : resolveClose(); }); }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const envFile = join(backendDir, '.env');
  if (existsSync(envFile) && process.loadEnvFile) process.loadEnvFile(envFile);
  const app = createApp();
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  app.server.listen(port, host, () => console.log(`Digital Time Capsule API and web app listening on ${host}:${port}`));
  const shutdown = () => app.close().finally(() => process.exit(0));
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
