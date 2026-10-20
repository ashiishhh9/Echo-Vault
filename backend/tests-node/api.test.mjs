import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.mjs';

let tempDir;
let databasePath;
let app;
let baseUrl;
let mediaDirectory;
let aiServer;
let aiServiceUrl;
let mockCounts;
let lastSearchPayload;
let embeddingTexts = [];
let lastSummaryPayload;
let failEmbeddings = false;
let failImageAnalysis = false;
let malformedChatResponse = false;
const secret = 'node-api-test-secret-with-enough-entropy';
const aiServiceTestKey = 'node-ai-service-test-secret-with-enough-entropy';
let previousAiServiceKey;

async function startApp() {
  app = createApp({ dbPath: databasePath, mediaDir: mediaDirectory, aiServiceUrl, secret });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${app.server.address().port}/api/v1`;
}

async function call(path, { method = 'GET', body, token, origin } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
}

before(async () => {
  previousAiServiceKey = process.env.AI_SERVICE_API_KEY;
  process.env.AI_SERVICE_API_KEY = aiServiceTestKey;
  tempDir = await mkdtemp(join(tmpdir(), 'digital-time-capsule-node-'));
  databasePath = join(tempDir, 'test.sqlite');
  mediaDirectory = join(tempDir, 'media');
  mockCounts = { embeddings: 0, batch: 0, query: 0, searches: 0, moodBatches: 0 };
  embeddingTexts = [];
  aiServer = createHttpServer(async (req, res) => {
    if (req.headers['x-ai-service-key'] !== aiServiceTestKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ detail: 'Not authenticated' })); return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (value) => { const data = JSON.stringify(value); res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }); res.end(data); };
    const vectorFor = (text) => { const values = Array(384).fill(0); values[[...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 384] = 1; return values; };
    if (url.pathname === '/health') return send({ status: 'ok', embedding_model: 'test-embed-v1', embedding_dimensions: 384 });
    if (url.pathname === '/embeddings') {
      if (url.searchParams.get('query') === 'true') mockCounts.query += 1; else mockCounts.embeddings += 1;
      if (failEmbeddings && url.searchParams.get('query') !== 'true') { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ detail: 'mock embedding failure' })); return; }
      embeddingTexts.push(body.text);
      return send({ model: 'test-embed-v1', dimensions: 384, embedding: vectorFor(body.text) });
    }
    if (url.pathname === '/embeddings/batch') {
      mockCounts.batch += 1; embeddingTexts.push(...body.texts);
      return send({ model: 'test-embed-v1', dimensions: 384, embeddings: body.texts.map(vectorFor) });
    }
    if (url.pathname === '/image-description') {
      if (failImageAnalysis) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ detail: 'mock vision failure' })); return; }
      return send({ description: 'a red bicycle beside a lake', model: 'test-vision-v1', mode: 'local_image_captioning' });
    }
    if (url.pathname === '/search' || url.pathname === '/chat') {
      mockCounts.searches += 1; lastSearchPayload = body;
      if (url.pathname === '/chat' && malformedChatResponse) return send({ answer: 'Untrusted response', mode: 'retrieval_only', grounded: true, references: [{ id: 'another-users-memory', similarity: 1 }] });
      return send(url.pathname === '/chat' ? { answer: 'Retrieved memory.', mode: 'retrieval_only', grounded: true, references: body.memories.slice(0, 3).map((item) => ({ id: item.id, created_at: item.created_at, similarity: 1 })) } : { query: body.query, model: 'test-embed-v1', dimensions: 384, results: body.memories.slice(0, 3).map((item) => ({ id: item.id, text: item.text, similarity: 1 })) });
    }
    if (url.pathname === '/mood/batch') { mockCounts.moodBatches += 1; return send({ results: body.texts.map(() => ({ mood_score_0_100: 50, label: 'neutral' })) }); }
    if (url.pathname === '/summarize') { lastSummaryPayload = body; return send({ summary: body.text, method: 'test' }); }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { aiServer.once('error', reject); aiServer.listen(0, '127.0.0.1', resolve); });
  aiServiceUrl = `http://127.0.0.1:${aiServer.address().port}`;
  await startApp();
});

after(async () => {
  if (previousAiServiceKey === undefined) delete process.env.AI_SERVICE_API_KEY;
  else process.env.AI_SERVICE_API_KEY = previousAiServiceKey;
  if (app) await app.close();
  if (aiServer) await new Promise((resolve) => aiServer.close(resolve));
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

test('auth, persistence, ownership, locking, memories, notifications, and CORS', async () => {
  const health = await call('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.storage, 'sqlite');
  assert.equal(health.response.headers.get('x-frame-options'), 'DENY');
  assert.match(health.response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(health.response.headers.get('content-security-policy'), /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(health.response.headers.get('content-security-policy'), /font-src[^;]*https:\/\/fonts\.gstatic\.com/);

  const email = `owner-${Date.now()}@example.test`;
  const registration = await call('/auth/register', { method: 'POST', body: { name: 'Owner User', email, password: 'secret123' } });
  assert.equal(registration.response.status, 201);
  assert.ok(registration.payload.id);
  assert.equal('password_hash' in registration.payload, false);
  const storedPassword = app.db.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').get(registration.payload.id);
  assert.notEqual(storedPassword.password_hash, 'secret123');
  assert.ok(storedPassword.password_salt);
  const duplicate = await call('/auth/register', { method: 'POST', body: { name: 'Owner User', email, password: 'secret123' } });
  assert.equal(duplicate.response.status, 409);
  const login = await call('/auth/login', { method: 'POST', body: { email, password: 'secret123' } });
  assert.equal(login.response.status, 200);
  const ownerToken = login.payload.access_token;
  assert.equal((await call('/auth/me')).response.status, 401);
  const expiredHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const expiredPayload = Buffer.from(JSON.stringify({ sub: registration.payload.id, jti: randomUUID(), exp: Math.floor(Date.now() / 1000) - 1 })).toString('base64url');
  const expiredInput = `${expiredHeader}.${expiredPayload}`;
  const expiredToken = `${expiredInput}.${createHmac('sha256', secret).update(expiredInput).digest('base64url')}`;
  assert.equal((await call('/auth/me', { token: expiredToken })).response.status, 401);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email, password: 'x'.repeat(70_000) } })).response.status, 413);
  assert.equal((await call('/auth/logout', { method: 'POST', token: 'malformed.token' })).response.status, 401);

  const futureDate = new Date(Date.now() + 60_000).toISOString();
  const created = await call('/capsules', { method: 'POST', token: ownerToken, body: { title: 'Future capsule', description: 'Private', unlock_at: futureDate } });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.status, 'LOCKED');
  const capsuleId = created.payload.id;
  const savedMemory = await call(`/capsules/${capsuleId}/memories`, { method: 'POST', token: ownerToken, body: { type: 'text', content_text: 'A note for later', media_url: '' } });
  assert.equal(savedMemory.response.status, 201);
  const memoryId = savedMemory.payload.id;
  assert.equal((await call(`/capsules/${capsuleId}/memories`, { token: ownerToken })).response.status, 403);
  assert.equal((await call(`/memories/${memoryId}`, { token: ownerToken })).response.status, 403);
  assert.equal((await call(`/capsules/${capsuleId}/unlock`, { method: 'POST', token: ownerToken })).response.status, 403);

  const secondEmail = `other-${Date.now()}@example.test`;
  await call('/auth/register', { method: 'POST', body: { name: 'Other User', email: secondEmail, password: 'secret123' } });
  const secondLogin = await call('/auth/login', { method: 'POST', body: { email: secondEmail, password: 'secret123' } });
  const secondToken = secondLogin.payload.access_token;
  assert.equal((await call(`/capsules/${capsuleId}`, { token: secondToken })).response.status, 403);
  assert.equal((await call(`/capsules/${capsuleId}`, { method: 'PUT', token: secondToken, body: { title: 'stolen' } })).response.status, 403);
  assert.equal((await call(`/capsules/${capsuleId}`, { method: 'DELETE', token: secondToken })).response.status, 403);
  assert.equal((await call(`/memories/${memoryId}`, { method: 'PUT', token: secondToken, body: { content_text: 'stolen' } })).response.status, 403);
  assert.equal((await call(`/memories/${memoryId}`, { method: 'DELETE', token: secondToken })).response.status, 403);
  assert.deepEqual((await call('/capsules', { token: secondToken })).payload, []);
  assert.deepEqual((await call('/export', { token: secondToken })).payload.data.capsules, []);
  assert.equal((await call('/profile', { token: secondToken })).payload.email, secondEmail);
  assert.equal((await call('/settings', { token: secondToken })).payload.compact_mode, false);
  assert.deepEqual((await call('/ai/mood-summary', { token: secondToken })).payload, { count: 0, average_mood_score: null, distribution: {}, series: [] });
  const ownerNotifications = await call('/notifications', { token: ownerToken });
  assert.equal((await call(`/notifications/${ownerNotifications.payload[0].id}/read`, { method: 'PATCH', token: secondToken })).response.status, 403);

  const earlyReschedule = await call(`/capsules/${capsuleId}`, { method: 'PUT', token: ownerToken, body: { unlock_at: new Date(Date.now() - 1000).toISOString() } });
  assert.equal(earlyReschedule.response.status, 403);
  // Controlled clock fixture: the capsule remains locked through the API until its stored unlock time has arrived.
  app.db.prepare('UPDATE capsules SET unlock_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), capsuleId);
  const dueCapsule = await call(`/capsules/${capsuleId}`, { token: ownerToken });
  assert.equal(dueCapsule.payload.status, 'UNLOCKED');
  const memories = await call(`/capsules/${capsuleId}/memories`, { token: ownerToken });
  assert.equal(memories.response.status, 200);
  assert.equal(memories.payload[0].content_text, 'A note for later');
  const notifications = await call('/notifications', { token: ownerToken });
  assert.equal(notifications.response.status, 200);
  assert.equal(notifications.payload.filter((item) => item.type === 'capsule_unlocked').length, 1);

  const profile = await call('/profile', { token: ownerToken });
  assert.equal(profile.payload.name, 'Owner User');
  const changedProfile = await call('/profile', { method: 'PUT', token: ownerToken, body: { name: 'Owner Updated', email, location: 'Ahmedabad', bio: 'A future note', initials: 'OU' } });
  assert.equal(changedProfile.payload.name, 'Owner Updated');
  const settings = await call('/settings', { method: 'PATCH', token: ownerToken, body: { notifications: false, compact_mode: true, export_format: 'text' } });
  assert.equal(settings.payload.compact_mode, true);

  const cors = await fetch(`${baseUrl}/auth/me`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5174', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5174');

  await app.close();
  await startApp();
  const relogin = await call('/auth/login', { method: 'POST', body: { email, password: 'secret123' } });
  assert.equal(relogin.response.status, 200);
  const restored = await call('/capsules', { token: relogin.payload.access_token });
  assert.equal(restored.payload.length, 1);
  assert.equal(restored.payload[0].status, 'UNLOCKED');
  const persistedMemory = await call(`/memories/${memoryId}`, { token: relogin.payload.access_token });
  assert.equal(persistedMemory.payload.content_text, 'A note for later');

  const updatedCapsule = await call(`/capsules/${capsuleId}`, { method: 'PUT', token: relogin.payload.access_token, body: { title: 'Owner Updated' } });
  assert.equal(updatedCapsule.response.status, 200);
  assert.equal(updatedCapsule.payload.title, 'Owner Updated');
  assert.equal((await call(`/capsules/${capsuleId}`, { method: 'DELETE', token: relogin.payload.access_token })).response.status, 200);
  assert.deepEqual((await call('/capsules', { token: relogin.payload.access_token })).payload, []);
  assert.equal((await call(`/memories/${memoryId}`, { token: relogin.payload.access_token })).response.status, 404);

  const logout = await call('/auth/logout', { method: 'POST', token: relogin.payload.access_token });
  assert.equal(logout.response.status, 200);
  assert.equal((await call('/auth/me', { token: relogin.payload.access_token })).response.status, 401);
  for (let attempt = 0; attempt < 8; attempt += 1) assert.equal((await call('/auth/login', { method: 'POST', body: { email, password: 'wrong-secret' } })).response.status, 401);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email, password: 'wrong-secret' } })).response.status, 429);
});

test('additive SQLite startup migration preserves existing memory and legacy media data', async () => {
  const legacyPath = join(tempDir, 'legacy.sqlite');
  const legacyDb = new DatabaseSync(legacyPath);
  legacyDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',bio TEXT NOT NULL DEFAULT '',initials TEXT NOT NULL DEFAULT '',notifications INTEGER NOT NULL DEFAULT 1,compact_mode INTEGER NOT NULL DEFAULT 0,export_format TEXT NOT NULL DEFAULT 'json',created_at TEXT NOT NULL);
    CREATE TABLE capsules (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',color TEXT NOT NULL DEFAULT 'gold',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,unlock_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('LOCKED','UNLOCKED')));
    CREATE TABLE memories (id TEXT PRIMARY KEY,capsule_id TEXT NOT NULL REFERENCES capsules(id) ON DELETE CASCADE,type TEXT NOT NULL CHECK(type IN ('text','image','video','audio')),content_text TEXT NOT NULL DEFAULT '',media_url TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  `);
  const time = new Date().toISOString();
  const legacyData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0m8AAAAASUVORK5CYII=';
  legacyDb.prepare('INSERT INTO users (id,name,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?)').run('legacy-user', 'Legacy', 'legacy@example.test', 'salt', 'hash', time);
  legacyDb.prepare('INSERT INTO capsules (id,owner_id,title,created_at,updated_at,unlock_at,status) VALUES (?,?,?,?,?,?,?)').run('legacy-capsule', 'legacy-user', 'Old capsule', time, time, time, 'UNLOCKED');
  legacyDb.prepare('INSERT INTO memories (id,capsule_id,type,content_text,media_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('legacy-memory', 'legacy-capsule', 'image', 'Old text', legacyData, time, time);
  legacyDb.close();

  const migratedApp = createApp({ dbPath: legacyPath, mediaDir: join(tempDir, 'legacy-media'), aiServiceUrl, secret });
  await new Promise((resolve, reject) => { migratedApp.server.once('error', reject); migratedApp.server.listen(0, '127.0.0.1', resolve); });
  const columns = new Set(migratedApp.db.prepare('PRAGMA table_info(memories)').all().map((column) => column.name));
  const userColumns = new Set(migratedApp.db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
  const memory = migratedApp.db.prepare('SELECT * FROM memories WHERE id=?').get('legacy-memory');
  assert.ok(columns.has('embedding_json'));
  assert.ok(columns.has('embedding_status'));
  assert.ok(userColumns.has('role'));
  assert.ok(userColumns.has('account_status'));
  assert.ok(new Set(migratedApp.db.prepare('PRAGMA table_info(media_assets)').all().map((column) => column.name)).has('original_filename'));
  assert.ok(migratedApp.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'").get());
  assert.ok(migratedApp.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'").get());
  assert.equal(migratedApp.db.prepare('SELECT role,account_status FROM users WHERE id=?').get('legacy-user').role, 'user');
  assert.equal(memory.content_text, 'Old text');
  assert.equal(memory.media_url, legacyData);
  assert.equal(memory.embedding_status, 'pending');
  assert.ok(migratedApp.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='media_assets'").get());
  await migratedApp.close();
});

test('persistent embeddings are refreshed, reused by search, backfilled, and owner/lock scoped', async () => {
  mockCounts = { embeddings: 0, batch: 0, query: 0, searches: 0, moodBatches: 0 };
  const email = `embedding-${Date.now()}@example.test`;
  await call('/auth/register', { method: 'POST', body: { name: 'Embedding User', email, password: 'secret123' } });
  const login = await call('/auth/login', { method: 'POST', body: { email, password: 'secret123' } });
  const token = login.payload.access_token;
  const capsule = await call('/capsules', { method: 'POST', token, body: { title: 'Embedding capsule', unlock_at: new Date(Date.now() - 60_000).toISOString() } });
  const created = await call(`/capsules/${capsule.payload.id}/memories`, { method: 'POST', token, body: { type: 'text', content_text: 'A saved text with a persistent vector.' } });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.embedding_status, 'ready');
  let stored = app.db.prepare('SELECT * FROM memories WHERE id=?').get(created.payload.id);
  assert.equal(stored.embedding_model, 'test-embed-v1');
  assert.equal(stored.embedding_dimensions, 384);
  assert.equal(JSON.parse(stored.embedding_json).length, 384);
  assert.equal(mockCounts.embeddings, 1);

  await call(`/memories/${created.payload.id}`, { method: 'PUT', token, body: { type: 'text', content_text: 'A changed searchable text.' } });
  assert.equal(mockCounts.embeddings, 2);
  await call(`/capsules/${capsule.payload.id}`, { method: 'PUT', token, body: { title: 'Metadata changed only' } });
  assert.equal(mockCounts.embeddings, 2);

  const firstSearch = await call('/ai/search', { method: 'POST', token, body: { query: 'saved searchable text' } });
  assert.equal(firstSearch.response.status, 200);
  assert.equal(lastSearchPayload.memories.length, 1);
  assert.equal(lastSearchPayload.memories[0].embedding.length, 384);
  assert.equal(lastSearchPayload.query_embedding.length, 384);
  assert.equal(mockCounts.batch, 0);
  await call('/ai/search', { method: 'POST', token, body: { query: 'same search again' } });
  assert.equal(mockCounts.embeddings, 2); // The two text versions were embedded once each.
  assert.equal(mockCounts.query, 2); // Each query receives its own query vector.
  assert.equal(mockCounts.batch, 0);
  assert.equal(app.embeddingStats.generated, 2);
  assert.equal(app.embeddingStats.reused, 2);

  app.db.prepare("UPDATE memories SET embedding_json=NULL,embedding_status='pending',embedding_model=NULL,embedding_dimensions=NULL WHERE id=?").run(created.payload.id);
  const backfill = await call('/ai/embeddings/backfill', { method: 'POST', token, body: { limit: 1 } });
  assert.deepEqual({ attempted: backfill.payload.attempted, migrated: backfill.payload.migrated, failed: backfill.payload.failed, remaining: backfill.payload.remaining }, { attempted: 1, migrated: 1, failed: 0, remaining: 0 });
  assert.equal(mockCounts.batch, 1);
  app.db.prepare("UPDATE memories SET embedding_model='old-model' WHERE id=?").run(created.payload.id);
  const modelBackfill = await call('/ai/embeddings/backfill', { method: 'POST', token, body: { limit: 1 } });
  assert.equal(modelBackfill.payload.migrated, 1);
  assert.equal(app.db.prepare('SELECT embedding_model FROM memories WHERE id=?').get(created.payload.id).embedding_model, 'test-embed-v1');
  const secondMemory = await call(`/capsules/${capsule.payload.id}/memories`, { method: 'POST', token, body: { type: 'text', content_text: 'A later page for embedding backfill.' } });
  app.db.prepare("UPDATE memories SET embedding_json=NULL,embedding_status='pending' WHERE id=?").run(secondMemory.payload.id);
  const firstPage = await call('/ai/embeddings/backfill', { method: 'POST', token, body: { limit: 1 } });
  assert.equal(firstPage.payload.next_cursor, created.payload.id);
  assert.equal(firstPage.payload.attempted, 0);
  const secondPage = await call('/ai/embeddings/backfill', { method: 'POST', token, body: { limit: 1, cursor: firstPage.payload.next_cursor } });
  assert.equal(secondPage.payload.attempted, 1);
  assert.equal(secondPage.payload.migrated, 1);
  assert.equal(secondPage.payload.next_cursor, null);

  const locked = await call('/capsules', { method: 'POST', token, body: { title: 'Locked capsule', unlock_at: new Date(Date.now() + 86_400_000).toISOString() } });
  const embeddingCountBeforeLocked = mockCounts.embeddings;
  const lockedMemory = await call(`/capsules/${locked.payload.id}/memories`, { method: 'POST', token, body: { type: 'text', content_text: 'Locked memory secret.' } });
  assert.equal(lockedMemory.payload.embedding_status, 'pending');
  const editedLockedMemory = await call(`/memories/${lockedMemory.payload.id}`, { method: 'PUT', token, body: { content_text: 'Edited locked memory secret.' } });
  assert.equal(editedLockedMemory.response.status, 403, 'locked memories cannot be edited or sent for embedding');
  assert.equal(mockCounts.embeddings, embeddingCountBeforeLocked, 'text from locked capsules is not sent for embedding');
  await call(`/ai/search`, { method: 'POST', token, body: { query: 'search scope' } });
  assert.equal(lastSearchPayload.memories.some((item) => item.text.includes('locked memory secret')), false);
  assert.equal(mockCounts.embeddings, embeddingCountBeforeLocked, 'locked memory is not sent as AI search context');
  assert.equal((await call('/ai/summarize', { method: 'POST', token, body: { capsule_id: locked.payload.id } })).response.status, 403);
  await call('/ai/chat', { method: 'POST', token, body: { query: 'locked memory secret' } });
  assert.equal(lastSearchPayload.memories.some((item) => item.text.includes('locked memory secret')), false, 'locked text is excluded from Chat with Past You context');
  app.db.prepare('UPDATE capsules SET unlock_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), locked.payload.id);
  await app.runUnlockScheduler();
  const editedUnlockedMemory = await call(`/memories/${lockedMemory.payload.id}`, { method: 'PUT', token, body: { content_text: 'Edited locked memory secret.' } });
  assert.equal(editedUnlockedMemory.response.status, 200);
  await call('/ai/search', { method: 'POST', token, body: { query: 'search unlocked scope' } });
  assert.equal(lastSearchPayload.memories.some((item) => item.text === 'Edited locked memory secret.'), true);
  assert.equal(mockCounts.embeddings, embeddingCountBeforeLocked + 1, 'saved text becomes eligible only after server unlocks its capsule');
  const otherEmail = `embedding-other-${Date.now()}@example.test`;
  await call('/auth/register', { method: 'POST', body: { name: 'Other', email: otherEmail, password: 'secret123' } });
  const other = await call('/auth/login', { method: 'POST', body: { email: otherEmail, password: 'secret123' } });
  await call('/ai/search', { method: 'POST', token: other.payload.access_token, body: { query: 'owner isolation' } });
  assert.equal(lastSearchPayload.memories.length, 0);

  failEmbeddings = true;
  const failed = await call(`/capsules/${capsule.payload.id}/memories`, { method: 'POST', token, body: { type: 'text', content_text: 'Retry this embedding.' } });
  failEmbeddings = false;
  assert.equal(failed.response.status, 201);
  assert.equal(failed.payload.embedding_status, 'failed');
  const retry = await call('/ai/embeddings/backfill', { method: 'POST', token, body: { limit: 10 } });
  assert.equal(retry.payload.migrated, 1);
  assert.equal(app.db.prepare('SELECT embedding_status FROM memories WHERE id=?').get(failed.payload.id).embedding_status, 'ready');

  await app.close();
  await startApp();
  const persistent = await call(`/memories/${created.payload.id}`, { token });
  assert.equal(persistent.response.status, 200);
  assert.equal(app.db.prepare('SELECT embedding_model FROM memories WHERE id=?').get(created.payload.id).embedding_model, 'test-embed-v1');
  malformedChatResponse = true;
  const malformedChat = await call('/ai/chat', { method: 'POST', token, body: { query: 'What do I remember?' } });
  malformedChatResponse = false;
  assert.equal(malformedChat.response.status, 503, 'references outside the authorized memory set are rejected');
  await call(`/memories/${created.payload.id}`, { method: 'DELETE', token });
  await call('/ai/search', { method: 'POST', token, body: { query: 'deleted note' } });
  assert.equal(lastSearchPayload.memories.some((item) => item.id === created.payload.id), false, 'deleted memories are absent from search context');
  const longText = 'A long source sentence. '.repeat(800);
  for (let index = 0; index < 6; index += 1) {
    app.db.prepare('INSERT INTO memories (id,capsule_id,type,content_text,media_url,created_at,updated_at,embedding_status) VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), capsule.payload.id, 'text', longText, '', new Date(Date.now() + index).toISOString(), new Date().toISOString(), 'ready');
  }
  const boundedSummary = await call('/ai/summarize', { method: 'POST', token });
  assert.equal(boundedSummary.response.status, 200);
  assert.equal(boundedSummary.payload.truncated, true);
  assert.ok(lastSummaryPayload.text.length <= 100_000);
  for (let index = 0; index < 20; index += 1) {
    app.db.prepare('INSERT INTO memories (id,capsule_id,type,content_text,media_url,created_at,updated_at,embedding_status) VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), capsule.payload.id, 'text', longText, '', new Date(Date.now() + 10 + index).toISOString(), new Date().toISOString(), 'ready');
  }
  const beforeMoodBatches = mockCounts.moodBatches;
  const boundedMood = await call('/ai/mood-summary', { token });
  assert.equal(boundedMood.response.status, 200);
  assert.equal(mockCounts.moodBatches - beforeMoodBatches, 2, 'mood text is sent in batches of at most 25 memories');
  const largeUnicode = '😀'.repeat(18_000);
  const vectorJson = JSON.stringify([1, ...Array(383).fill(0)]);
  for (let index = 0; index < 200; index += 1) {
    app.db.prepare('INSERT INTO memories (id,capsule_id,type,content_text,media_url,created_at,updated_at,embedding_json,embedding_model,embedding_dimensions,embedding_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), capsule.payload.id, 'text', largeUnicode, '', new Date(Date.now() + 100 + index).toISOString(), new Date().toISOString(), vectorJson, 'test-embed-v1', 384, 'ready');
  }
  const boundedSearch = await call('/ai/search', { method: 'POST', token, body: { query: 'large archive' } });
  assert.equal(boundedSearch.response.status, 200);
  assert.equal(boundedSearch.payload.context_limited, true);
  assert.ok(lastSearchPayload.memories.length < 200);
  assert.ok(Buffer.byteLength(JSON.stringify(lastSearchPayload)) <= 12 * 1024 * 1024);
});

test('admin authorization, aggregate statistics, bounded user search, status changes, and audit trail', async () => {
  const suffix = Date.now();
  const adminEmail = `dashboard-admin-${suffix}@example.test`;
  const userEmail = `dashboard-user-${suffix}@example.test`;
  const adminRegistration = await call('/auth/register', { method: 'POST', body: { name: 'Dashboard Admin', email: adminEmail, password: 'secret123', role: 'admin' } });
  const userRegistration = await call('/auth/register', { method: 'POST', body: { name: 'Dashboard User', email: userEmail, password: 'secret123', role: 'admin' } });
  assert.equal(adminRegistration.response.status, 201);
  assert.equal(userRegistration.response.status, 201);
  assert.equal(app.db.prepare('SELECT role FROM users WHERE id=?').get(userRegistration.payload.id).role, 'user');
  app.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(adminRegistration.payload.id);
  const adminLogin = await call('/auth/login', { method: 'POST', body: { email: adminEmail, password: 'secret123' } });
  const userLogin = await call('/auth/login', { method: 'POST', body: { email: userEmail, password: 'secret123' } });
  const adminToken = adminLogin.payload.access_token;
  const userToken = userLogin.payload.access_token;

  assert.equal((await call('/admin/overview')).response.status, 401);
  assert.equal((await call('/admin/users')).response.status, 401);
  assert.equal((await call('/admin/users/x/status', { method: 'PATCH', body: { status: 'disabled' } })).response.status, 401);
  assert.equal((await call('/admin/overview', { token: userToken })).response.status, 403);
  assert.equal((await call('/admin/users', { token: userToken })).response.status, 403);
  assert.equal((await call(`/admin/users/${adminRegistration.payload.id}/status`, { method: 'PATCH', token: userToken, body: { status: 'disabled' } })).response.status, 403);

  const profileAttempt = await call('/profile', { method: 'PUT', token: userToken, body: { name: 'Dashboard User', email: userEmail, role: 'admin', account_status: 'disabled' } });
  assert.equal(profileAttempt.response.status, 200);
  const profileProtectedFields = app.db.prepare('SELECT role,account_status FROM users WHERE id=?').get(userRegistration.payload.id);
  assert.equal(profileProtectedFields.role, 'user');
  assert.equal(profileProtectedFields.account_status, 'active');

  const overview = await call('/admin/overview', { token: adminToken });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.payload.statistics.total_users, Number(app.db.prepare('SELECT COUNT(*) AS count FROM users').get().count));
  assert.equal(overview.payload.statistics.total_capsules, Number(app.db.prepare('SELECT COUNT(*) AS count FROM capsules').get().count));
  assert.equal(typeof overview.payload.services.scheduler, 'string');
  assert.equal('private' in overview.payload, false);
  const searched = await call(`/admin/users?search=${encodeURIComponent(`dashboard-user-${suffix}`)}&page=1&limit=1`, { token: adminToken });
  assert.equal(searched.response.status, 200);
  assert.equal(searched.payload.total, 1);
  assert.equal(searched.payload.users[0].id, userRegistration.payload.id);
  assert.equal('password_hash' in searched.payload.users[0], false);
  assert.equal('content_text' in searched.payload.users[0], false);
  const bounded = await call('/admin/users?page=1&limit=101', { token: adminToken });
  assert.equal(bounded.response.status, 200);
  assert.equal(bounded.payload.limit, 100);

  const disabled = await call(`/admin/users/${userRegistration.payload.id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'disabled' } });
  assert.equal(disabled.response.status, 200);
  assert.equal(disabled.payload.account_status, 'disabled');
  assert.equal((await call('/auth/me', { token: userToken })).response.status, 403);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: userEmail, password: 'secret123' } })).response.status, 403);
  const selfLock = await call(`/admin/users/${adminRegistration.payload.id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'disabled' } });
  assert.equal(selfLock.response.status, 409);
  const reactivated = await call(`/admin/users/${userRegistration.payload.id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'active' } });
  assert.equal(reactivated.response.status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM admin_audit_log WHERE administrator_id=?').get(adminRegistration.payload.id).count, 3);
});

test('Chat with Past You persists multiple turns, scopes history, and cites authorized media', async () => {
  const email = `chat-${Date.now()}@example.test`;
  await call('/auth/register', { method: 'POST', body: { name: 'Chat Owner', email, password: 'secret123' } });
  const login = await call('/auth/login', { method: 'POST', body: { email, password: 'secret123' } });
  const token = login.payload.access_token;
  const otherEmail = `chat-other-${Date.now()}@example.test`;
  await call('/auth/register', { method: 'POST', body: { name: 'Other', email: otherEmail, password: 'secret123' } });
  const other = await call('/auth/login', { method: 'POST', body: { email: otherEmail, password: 'secret123' } });
  const capsule = await call('/capsules', { method: 'POST', token, body: { title: 'Photo and video memories', unlock_at: new Date(Date.now() - 60_000).toISOString() } });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0m8AAAAASUVORK5CYII=';
  const videoBytes = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
  const video = `data:video/mp4;base64,${videoBytes.toString('base64')}`;
  const textMemory = await call(`/capsules/${capsule.payload.id}/memories`, { method: 'POST', token, body: { type: 'text', content_text: 'The family picnic was beside the lake.' } });
  const imageMemory = await call(`/capsules/${capsule.payload.id}/memories`, { method: 'POST', token, body: { type: 'image', content_text: '', file_name: 'lake-picnic.png', media_url: png } });
  const videoMemory = await call(`/capsules/${capsule.payload.id}/memories`, { method: 'POST', token, body: { type: 'video', content_text: 'The children waved from the lake shore.', file_name: 'lake-shore.mp4', media_url: video } });
  assert.equal(textMemory.response.status, 201);
  assert.equal(imageMemory.payload.media_filename, 'lake-picnic.png');
  assert.equal(imageMemory.payload.image_analysis_status, 'ready');
  assert.equal(imageMemory.payload.image_description, 'a red bicycle beside a lake');
  assert.equal(imageMemory.payload.embedding_status, 'ready');
  assert.ok(embeddingTexts.some((text) => /lake-picnic\.png/.test(text) && /image\/png/.test(text)));
  assert.equal(videoMemory.payload.media_filename, 'lake-shore.mp4');
  assert.ok(embeddingTexts.some((text) => /lake-shore\.mp4/.test(text) && /video\/mp4/.test(text)));

  // Mirror the UI workflow: list history, create a conversation, send a turn,
  // then reload its persisted history and authenticated media references.
  const emptyHistory = await call('/ai/conversations', { token });
  assert.equal(emptyHistory.response.status, 200);
  assert.deepEqual(emptyHistory.payload, []);
  const createdConversation = await call('/ai/conversations', { method: 'POST', token, body: {} });
  assert.equal(createdConversation.response.status, 201);
  assert.match(createdConversation.payload.id, /^[0-9a-f-]{36}$/i);
  const listedConversation = await call('/ai/conversations', { token });
  assert.equal(listedConversation.response.status, 200);
  assert.equal(listedConversation.payload[0].id, createdConversation.payload.id);

  const first = await call('/ai/chat', { method: 'POST', token, body: { query: 'What happened at the lake?', conversation_id: createdConversation.payload.id } });
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.conversation_id, createdConversation.payload.id);
  assert.ok(Date.parse(first.payload.user_message.created_at));
  assert.ok(Date.parse(first.payload.assistant_message.created_at));
  const citedMedia = first.payload.references.flatMap((reference) => reference.media);
  assert.ok(citedMedia.some((media) => media.type === 'image' && media.mime_type === 'image/png'));
  assert.ok(citedMedia.some((media) => media.type === 'video' && media.mime_type === 'video/mp4'));
  assert.ok(citedMedia.every((media) => media.media_url.startsWith('/api/v1/media/') && !media.media_url.includes('storage')));
  assert.match(lastSearchPayload.memories.find((memory) => memory.id === imageMemory.payload.id).text, /red bicycle beside a lake/);
  const imagePath = citedMedia.find((media) => media.type === 'image').media_url;
  assert.equal((await fetch(`${baseUrl.replace('/api/v1', '')}${imagePath}`, { headers: { Authorization: `Bearer ${other.payload.access_token}` } })).status, 404);

  const conversationId = first.payload.conversation_id;
  const second = await call('/ai/chat', { method: 'POST', token, body: { query: 'Who was there?', conversation_id: conversationId } });
  assert.equal(second.response.status, 200);
  assert.match(lastSearchPayload.query, /Past question: What happened at the lake\?/);
  assert.match(lastSearchPayload.query, /Current question: Who was there\?/);
  const filenameSearch = await call('/ai/search', { method: 'POST', token, body: { query: 'lake-picnic.png' } });
  assert.equal(filenameSearch.response.status, 200);
  assert.ok(lastSearchPayload.memories.some((memory) => memory.text.includes('lake-picnic.png')));
  const history = await call(`/ai/conversations/${conversationId}`, { token });
  assert.equal(history.response.status, 200);
  assert.deepEqual(history.payload.messages.map((message) => message.role), ['user', 'assistant', 'user', 'assistant']);
  assert.ok(history.payload.messages.every((message) => Date.parse(message.created_at)));
  assert.equal((await call(`/ai/conversations/${conversationId}`, { token: other.payload.access_token })).response.status, 404);
  assert.equal((await call('/ai/chat', { method: 'POST', token: other.payload.access_token, body: { query: 'peek', conversation_id: conversationId } })).response.status, 404);

  await app.close();
  await startApp();
  const restored = await call(`/ai/conversations/${conversationId}`, { token });
  assert.equal(restored.payload.messages.length, 4, 'conversation and message history survive a server restart');

  const deletedMemory = await call(`/memories/${videoMemory.payload.id}`, { method: 'DELETE', token });
  assert.equal(deletedMemory.response.status, 200);
  const historyWithoutMedia = await call(`/ai/conversations/${conversationId}`, { token });
  const redactedTurn = historyWithoutMedia.payload.messages.find((message) => message.role === 'assistant');
  assert.match(redactedTurn.content, /no longer available/);
  assert.equal(redactedTurn.references.length, 0, 'deleted memory references cannot be revived from chat history');

  await call(`/capsules/${capsule.payload.id}/lock`, { method: 'POST', token });
  app.db.prepare('UPDATE capsules SET unlock_at=? WHERE id=?').run(new Date(Date.now() + 86_400_000).toISOString(), capsule.payload.id);
  const lockedHistory = await call(`/ai/conversations/${conversationId}`, { token });
  const assistantTurns = lockedHistory.payload.messages.filter((message) => message.role === 'assistant');
  assert.ok(assistantTurns.every((message) => message.references.length === 0 && message.content.includes('no longer available')));
  assert.equal((await fetch(`${baseUrl.replace('/api/v1', '')}${imagePath}`, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
});

test('image analysis failures are explicit and unchanged images are reused on reprocessing', async () => {
  const email = `vision-${Date.now()}@example.test`;
  await call('/auth/register', { method: 'POST', body: { name: 'Vision User', email, password: 'secret123' } });
  const login = await call('/auth/login', { method: 'POST', body: { email, password: 'secret123' } });
  const token = login.payload.access_token;
  const capsule = await call('/capsules', { method: 'POST', token, body: { title: 'Vision', unlock_at: new Date(Date.now() - 60_000).toISOString() } });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0m8AAAAASUVORK5CYII=';
  failImageAnalysis = true;
  const failed = await call(`/capsules/${capsule.payload.id}/memories`, { method: 'POST', token, body: { type: 'image', file_name: 'failed.png', media_url: png } });
  failImageAnalysis = false;
  assert.equal(failed.response.status, 201);
  assert.equal(failed.payload.image_analysis_status, 'failed');
  assert.equal(failed.payload.image_description, '');
  const retry = await call('/ai/images/reprocess', { method: 'POST', token, body: { limit: 10 } });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.payload.analyzed, 1);
  const ready = await call(`/memories/${failed.payload.id}`, { token });
  assert.equal(ready.payload.image_analysis_status, 'ready');
  const reused = await call('/ai/images/reprocess', { method: 'POST', token, body: { limit: 10 } });
  assert.equal(reused.payload.analyzed, 0);
  assert.equal(reused.payload.reused, 1);
  const locked = await call('/capsules', { method: 'POST', token, body: { title: 'Locked vision', unlock_at: new Date(Date.now() + 86_400_000).toISOString() } });
  const lockedImage = await call(`/capsules/${locked.payload.id}/memories`, { method: 'POST', token, body: { type: 'image', file_name: 'locked.png', media_url: png } });
  assert.equal(lockedImage.payload.image_analysis_status, 'pending');
  const lockedReprocess = await call('/ai/images/reprocess', { method: 'POST', token, body: { limit: 50 } });
  assert.equal(lockedReprocess.payload.scanned, 1);
  assert.equal(lockedReprocess.payload.analyzed, 0);
  assert.equal((await call(`/capsules/${locked.payload.id}/memories`, { token })).response.status, 403);
});

test('local media storage validates, authorizes, migrates legacy data URLs, and deletes files safely', async () => {
  const email = `media-${Date.now()}@example.test`;
  await call('/auth/register', { method: 'POST', body: { name: 'Media User', email, password: 'secret123' } });
  const login = await call('/auth/login', { method: 'POST', body: { email, password: 'secret123' } });
  const token = login.payload.access_token;
  const capsule = await call('/capsules', { method: 'POST', token, body: { title: 'Media capsule', unlock_at: new Date(Date.now() - 60_000).toISOString() } });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0m8AAAAASUVORK5CYII=';
  const created = await call(`/capsules/${capsule.payload.id}/memories`, { method: 'POST', token, body: { type: 'image', content_text: 'A saved lake view.', file_name: 'lake-view.png', media_url: png } });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.media_filename, 'lake-view.png');
  assert.match(created.payload.media_url, /^\/api\/v1\/media\/[0-9a-f-]{36}$/i);
  const mediaPath = created.payload.media_url;
  const retrieved = await fetch(`${baseUrl.replace('/api/v1', '')}${mediaPath}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(retrieved.status, 200);
  assert.equal(retrieved.headers.get('content-type'), 'image/png');
  assert.match(retrieved.headers.get('content-disposition'), /inline/);
  assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const invalid = await call(`/capsules/${capsule.payload.id}/memories`, { method: 'POST', token, body: { type: 'image', media_url: 'data:image/png;base64,AAAA' } });
  assert.equal(invalid.response.status, 422);
  const oversized = await call(`/capsules/${capsule.payload.id}/memories`, { method: 'POST', token, body: { type: 'image', media_url: `data:image/png;base64,${'A'.repeat(14 * 1024 * 1024)}` } });
  assert.equal(oversized.response.status, 422);
  const traversal = await fetch(`${baseUrl}/media/%2e%2e%2f..%2foutside`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(traversal.status, 404);

  const otherEmail = `media-other-${Date.now()}@example.test`;
  await call('/auth/register', { method: 'POST', body: { name: 'Other', email: otherEmail, password: 'secret123' } });
  const other = await call('/auth/login', { method: 'POST', body: { email: otherEmail, password: 'secret123' } });
  const denied = await fetch(`${baseUrl.replace('/api/v1', '')}${mediaPath}`, { headers: { Authorization: `Bearer ${other.payload.access_token}` } });
  assert.equal(denied.status, 404);
  await call(`/capsules/${capsule.payload.id}/lock`, { method: 'POST', token });
  app.db.prepare('UPDATE capsules SET unlock_at=? WHERE id=?').run(new Date(Date.now() + 86_400_000).toISOString(), capsule.payload.id);
  const lockedMedia = await fetch(`${baseUrl.replace('/api/v1', '')}${mediaPath}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(lockedMedia.status, 403);
  app.db.prepare('UPDATE capsules SET unlock_at=? WHERE id=?').run(new Date(Date.now() - 60_000).toISOString(), capsule.payload.id);
  await call(`/capsules/${capsule.payload.id}/unlock`, { method: 'POST', token });
  const sameMediaUpdate = await call(`/memories/${created.payload.id}`, { method: 'PUT', token, body: { type: 'image', content_text: '', media_url: created.payload.media_url } });
  assert.equal(sameMediaUpdate.response.status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE memory_id=?').get(created.payload.id).count, 1);
  const fs = await import('node:fs/promises');
  const missing = await call(`/capsules/${capsule.payload.id}/memories`, { method: 'POST', token, body: { type: 'image', content_text: '', media_url: png } });
  const missingAsset = app.db.prepare('SELECT storage_key,id FROM media_assets WHERE memory_id=?').get(missing.payload.id);
  await fs.rm(join(mediaDirectory, missingAsset.storage_key));
  assert.equal((await fetch(`${baseUrl.replace('/api/v1', '')}${missing.payload.media_url}`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);
  await call(`/memories/${missing.payload.id}`, { method: 'DELETE', token });

  const legacyId = 'legacy-media-memory';
  app.db.prepare('INSERT INTO memories (id,capsule_id,type,content_text,media_url,created_at,updated_at,embedding_status) VALUES (?,?,?,?,?,?,?,?)')
    .run(legacyId, capsule.payload.id, 'image', '', png, new Date().toISOString(), new Date().toISOString(), 'ready');
  const migrated = await call('/media/migrate', { method: 'POST', token, body: { limit: 10 } });
  assert.deepEqual({ migrated: migrated.payload.migrated, failed: migrated.payload.failed, remaining: migrated.payload.remaining }, { migrated: 1, failed: 0, remaining: 0 });
  const migratedMemory = await call(`/memories/${legacyId}`, { token });
  assert.match(migratedMemory.payload.media_url, /^\/api\/v1\/media\//);
  const again = await call('/media/migrate', { method: 'POST', token, body: { limit: 10 } });
  assert.equal(again.payload.migrated, 0);
  assert.equal(again.payload.remaining, 0);
  const asset = app.db.prepare('SELECT storage_key FROM media_assets WHERE memory_id=?').get(legacyId);
  await fs.access(join(mediaDirectory, asset.storage_key));
  await app.close();
  await startApp();
  const restoredMedia = await fetch(`${baseUrl.replace('/api/v1', '')}${migratedMemory.payload.media_url}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(restoredMedia.status, 200);
  assert.equal(restoredMedia.headers.get('content-type'), 'image/png');
  await call(`/memories/${legacyId}`, { method: 'DELETE', token });
  await assert.rejects(fs.access(join(mediaDirectory, asset.storage_key)));
  assert.equal((await fetch(`${baseUrl.replace('/api/v1', '')}${migratedMemory.payload.media_url}`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);
  const originalAsset = app.db.prepare('SELECT storage_key FROM media_assets WHERE memory_id=?').get(created.payload.id);
  await call(`/capsules/${capsule.payload.id}`, { method: 'DELETE', token });
  await assert.rejects(fs.access(join(mediaDirectory, originalAsset.storage_key)));

  const lockedCapsule = await call('/capsules', { method: 'POST', token, body: { title: 'Legacy locked', unlock_at: new Date(Date.now() + 86_400_000).toISOString() } });
  app.db.prepare('INSERT INTO memories (id,capsule_id,type,content_text,media_url,created_at,updated_at,embedding_status) VALUES (?,?,?,?,?,?,?,?)')
    .run('locked-legacy-media', lockedCapsule.payload.id, 'image', '', png, new Date().toISOString(), new Date().toISOString(), 'ready');
  const failureCapsule = await call('/capsules', { method: 'POST', token, body: { title: 'Legacy failure', unlock_at: new Date(Date.now() - 60_000).toISOString() } });
  app.db.prepare('INSERT INTO memories (id,capsule_id,type,content_text,media_url,created_at,updated_at,embedding_status) VALUES (?,?,?,?,?,?,?,?)')
    .run('invalid-legacy-media', failureCapsule.payload.id, 'image', '', 'data:image/png;base64,AAAA', new Date().toISOString(), new Date().toISOString(), 'ready');
  const lockedMigration = await call('/media/migrate', { method: 'POST', token, body: { limit: 10 } });
  assert.equal(lockedMigration.payload.locked_remaining, 1);
  assert.equal(lockedMigration.payload.failed, 1);
  assert.equal(lockedMigration.payload.remaining, 1);
  assert.match(app.db.prepare('SELECT media_url FROM memories WHERE id=?').get('locked-legacy-media').media_url, /^data:/);
  assert.equal(app.db.prepare('SELECT media_url FROM memories WHERE id=?').get('invalid-legacy-media').media_url, 'data:image/png;base64,AAAA');
});

test('production startup requires the internal AI key and does not enable development CORS by default', async () => {
  const envNames = ['NODE_ENV', 'SECRET_KEY', 'AI_SERVICE_API_KEY', 'BACKEND_CORS_ORIGINS', 'TRUST_PROXY'];
  const original = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  let productionApp;
  try {
    process.env.NODE_ENV = 'production';
    process.env.SECRET_KEY = 'node-production-test-secret-with-entropy';
    process.env.BACKEND_CORS_ORIGINS = '';
    delete process.env.AI_SERVICE_API_KEY;
    assert.throws(() => createApp({ dbPath: join(tempDir, 'should-not-create.sqlite') }), /AI_SERVICE_API_KEY/);

    process.env.AI_SERVICE_API_KEY = aiServiceTestKey;
    productionApp = createApp({ dbPath: join(tempDir, 'production-cors.sqlite'), mediaDir: join(tempDir, 'production-media') });
    await new Promise((resolve, reject) => {
      productionApp.server.once('error', reject);
      productionApp.server.listen(0, '127.0.0.1', resolve);
    });
    const response = await fetch(`http://127.0.0.1:${productionApp.server.address().port}/api/v1/health`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);

    process.env.TRUST_PROXY = 'true';
    const registerUrl = `http://127.0.0.1:${productionApp.server.address().port}/api/v1/auth/register`;
    const forwardedHeaders = { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.10' };
    const registerBody = { name: 'Proxy Test', email: `proxy-${Date.now()}@example.test`, password: 'secret123' };
    assert.equal((await fetch(registerUrl, { method: 'POST', headers: forwardedHeaders, body: JSON.stringify(registerBody) })).status, 201);
    for (let attempt = 0; attempt < 29; attempt += 1) {
      assert.equal((await fetch(registerUrl, { method: 'POST', headers: forwardedHeaders, body: JSON.stringify(registerBody) })).status, 409);
    }
    assert.equal((await fetch(registerUrl, { method: 'POST', headers: forwardedHeaders, body: JSON.stringify(registerBody) })).status, 429);
    const otherProxyClient = await fetch(registerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.11' },
      body: JSON.stringify({ ...registerBody, email: `proxy-other-${Date.now()}@example.test` }),
    });
    assert.equal(otherProxyClient.status, 201);
  } finally {
    if (productionApp) await productionApp.close();
    for (const name of envNames) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});

test('AI operations have a per-account request limit', async () => {
  const email = `ai-limit-${Date.now()}@example.test`;
  assert.equal((await call('/auth/register', { method: 'POST', body: { name: 'AI Limit User', email, password: 'secret123' } })).response.status, 201);
  const login = await call('/auth/login', { method: 'POST', body: { email, password: 'secret123' } });
  assert.equal(login.response.status, 200);
  for (let request = 0; request < 60; request += 1) {
    assert.equal((await call('/ai/health', { token: login.payload.access_token })).response.status, 200);
  }
  assert.equal((await call('/ai/health', { token: login.payload.access_token })).response.status, 429);
});
