import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.mjs';
import { buildUnlockEmail, createResendEmailService } from '../src/email/resendEmailService.mjs';

let tempDir;
let app;
let baseUrl;
let token;
let ownerEmail = 'capsule-owner@example.test';
const submissions = [];
let nextMailResult = { accepted: true, messageId: 'mock-message-1' };
const dbPath = () => join(tempDir, 'mail-test.sqlite');

async function startApp(options = {}) {
  app = createApp({
    dbPath: dbPath(), mediaDir: join(tempDir, 'media'), secret: 'email-test-secret-with-enough-entropy',
    emailNotificationsEnabled: true, appBaseUrl: 'https://archive.example.test',
    emailSender: { configured: true, send: async (message) => { submissions.push(message); return nextMailResult; } },
    emailRetryDelaysMs: [0], emailMaxAttempts: 3, ...options,
  });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${app.server.address().port}/api/v1`;
}

async function call(path, { method = 'GET', body, auth = token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, payload: response.status === 204 ? null : await response.json() };
}

async function createFutureCapsule(title) {
  const result = await call('/capsules', { method: 'POST', body: { title, unlock_at: new Date(Date.now() + 86_400_000).toISOString() } });
  assert.equal(result.response.status, 201);
  return result.payload.id;
}

async function makeDue(capsuleId) {
  app.db.prepare('UPDATE capsules SET unlock_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), capsuleId);
}

after(async () => { if (app) await app.close(); if (tempDir) await rm(tempDir, { recursive: true, force: true }); });

test('unlock email outbox, retry behavior, privacy, preferences, and access checks', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'digital-time-capsule-email-'));
  await startApp();
  const registered = await call('/auth/register', { method: 'POST', auth: null, body: { name: 'Capsule Owner', email: ownerEmail, password: 'secret123' } });
  assert.equal(registered.response.status, 201);
  const login = await call('/auth/login', { method: 'POST', auth: null, body: { email: ownerEmail, password: 'secret123' } });
  token = login.payload.access_token;

  const dueId = await createFutureCapsule('Letters & <starlight>');
  await makeDue(dueId);
  await app.runUnlockScheduler();
  let delivery = app.db.prepare('SELECT * FROM email_deliveries WHERE capsule_id=?').get(dueId);
  assert.equal(delivery.status, 'accepted', 'due capsule is submitted');
  assert.equal(delivery.attempt_count, 1);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].recipient, ownerEmail, 'only the capsule owner address is used');
  assert.equal(submissions[0].subject, 'Your memory is ready to be opened!');
  assert.match(submissions[0].html, /Letters &amp; &lt;starlight&gt;/, 'user title is escaped in HTML');
  assert.match(submissions[0].html, /https:\/\/archive\.example\.test\//);
  assert.match(submissions[0].text, /https:\/\/archive\.example\.test\//, 'plain text has a fallback link');
  assert.doesNotMatch(submissions[0].html + submissions[0].text, /Bearer|token|secret123|private memory/i);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE related_id=? AND type='capsule_unlocked'").get(dueId).n, 1);
  await app.runUnlockScheduler();
  assert.equal(submissions.length, 1, 'repeated scheduler run cannot resubmit accepted mail');
  assert.equal((await call(`/capsules/${dueId}`)).response.status, 200, 'owner can open unlocked capsule');
  assert.equal((await call(`/capsules/${dueId}`, { auth: null })).response.status, 401, 'email link grants no authentication');
  const otherRegistration = await call('/auth/register', { method: 'POST', auth: null, body: { name: 'Other User', email: 'other-capsule-owner@example.test', password: 'secret123' } });
  assert.equal(otherRegistration.response.status, 201);
  const otherLogin = await call('/auth/login', { method: 'POST', auth: null, body: { email: 'other-capsule-owner@example.test', password: 'secret123' } });
  assert.equal((await call(`/capsules/${dueId}`, { auth: otherLogin.payload.access_token })).response.status, 403, 'email link does not bypass capsule ownership');

  const futureId = await createFutureCapsule('Not yet ready');
  await app.runUnlockScheduler();
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM email_deliveries WHERE capsule_id=?').get(futureId).n, 0, 'future capsules do not receive unlock email records');
  assert.equal(submissions.length, 1, 'future capsules do not trigger email');
  assert.equal((await call(`/capsules/${futureId}/memories`)).response.status, 403, 'locked capsule remains protected');

  nextMailResult = { accepted: false, retryable: true, error: 'temporary provider issue' };
  const retryId = await createFutureCapsule('Retry capsule'); await makeDue(retryId);
  await app.runUnlockScheduler();
  delivery = app.db.prepare('SELECT * FROM email_deliveries WHERE capsule_id=?').get(retryId);
  assert.equal(delivery.status, 'retry_scheduled');
  assert.equal(app.db.prepare('SELECT status FROM capsules WHERE id=?').get(retryId).status, 'UNLOCKED', 'provider failure does not affect unlocking');
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE related_id=? AND type='capsule_unlocked'").get(retryId).n, 1, 'in-app notification is independent');
  nextMailResult = { accepted: true, messageId: 'mock-retried' };
  app.db.prepare('UPDATE email_deliveries SET next_retry_at=? WHERE capsule_id=?').run(new Date(Date.now() - 1_000).toISOString(), retryId);
  await app.runUnlockScheduler();
  delivery = app.db.prepare('SELECT * FROM email_deliveries WHERE capsule_id=?').get(retryId);
  assert.equal(delivery.status, 'accepted');
  assert.equal(delivery.attempt_count, 2, 'transient failure retries within configured bounds');
  assert.equal(submissions.filter((item) => item.idempotencyKey === `capsule-unlock/${delivery.id}`).length, 2, 'retries reuse provider idempotency key');

  nextMailResult = { accepted: false, retryable: true, error: 'temporary provider issue' };
  const exhaustedId = await createFutureCapsule('Retry limit'); await makeDue(exhaustedId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    app.db.prepare('UPDATE email_deliveries SET next_retry_at=? WHERE capsule_id=?').run(new Date(Date.now() - 1000).toISOString(), exhaustedId);
    await app.runUnlockScheduler();
  }
  delivery = app.db.prepare('SELECT * FROM email_deliveries WHERE capsule_id=?').get(exhaustedId);
  assert.equal(delivery.status, 'permanently_failed');
  assert.equal(delivery.attempt_count, 3, 'transient retries stop at configured attempt limit');

  const badRecipientId = await createFutureCapsule('Bad recipient');
  app.db.prepare('UPDATE users SET email=? WHERE id=(SELECT owner_id FROM capsules WHERE id=?)').run('not-an-email', badRecipientId);
  await makeDue(badRecipientId); await app.runUnlockScheduler();
  delivery = app.db.prepare('SELECT * FROM email_deliveries WHERE capsule_id=?').get(badRecipientId);
  assert.equal(delivery.status, 'permanently_failed');
  assert.match(delivery.last_error, /invalid/i);

  app.db.prepare('UPDATE users SET email=? WHERE id=(SELECT owner_id FROM capsules WHERE id=?)').run(ownerEmail, badRecipientId);
  const optedOutId = await createFutureCapsule('Email preference');
  await call('/settings', { method: 'PATCH', body: { unlock_emails: false } });
  await makeDue(optedOutId); await app.runUnlockScheduler();
  delivery = app.db.prepare('SELECT * FROM email_deliveries WHERE capsule_id=?').get(optedOutId);
  assert.equal(delivery.status, 'disabled');
  const settings = await call('/settings');
  assert.equal(settings.payload.unlock_emails, false);
  const notifications = await call('/notifications');
  assert.ok(notifications.payload.some((item) => item.related_id === undefined && item.type === 'capsule_unlocked') || notifications.payload.length > 0, 'in-app notification records remain available while email is off');

  const restartId = await createFutureCapsule('Restart persistence'); await makeDue(restartId);
  nextMailResult = { accepted: true, messageId: 'mock-restart' };
  await call('/settings', { method: 'PATCH', body: { unlock_emails: true } });
  await app.runUnlockScheduler();
  const restartRow = app.db.prepare('SELECT * FROM email_deliveries WHERE capsule_id=?').get(restartId);
  const beforeRestartCount = submissions.length;
  await app.close(); app = null;
  await startApp({ emailSender: { configured: true, send: async (message) => { submissions.push(message); return nextMailResult; } } });
  assert.equal(app.db.prepare('SELECT status FROM email_deliveries WHERE id=?').get(restartRow.id).status, 'accepted', 'delivery state survives process restart');
  await Promise.all([app.runUnlockScheduler(), app.runUnlockScheduler()]);
  assert.equal(submissions.length, beforeRestartCount, 'concurrent scheduler runs do not duplicate accepted submissions');

  const concurrentId = await createFutureCapsule('Concurrent due'); await makeDue(concurrentId);
  await Promise.all([app.runUnlockScheduler(), app.runUnlockScheduler()]);
  assert.equal(app.db.prepare('SELECT attempt_count FROM email_deliveries WHERE capsule_id=?').get(concurrentId).attempt_count, 1);
  assert.equal(submissions.filter((item) => item.subject === 'Your memory is ready to be opened!' && item.text.includes('Concurrent due')).length, 1);

  const secondInstance = createApp({
    dbPath: dbPath(), mediaDir: join(tempDir, 'media'), secret: 'email-test-secret-with-enough-entropy',
    emailNotificationsEnabled: true, appBaseUrl: 'https://archive.example.test',
    emailSender: { configured: true, send: async (message) => { submissions.push(message); return nextMailResult; } },
  });
  await new Promise((resolve, reject) => { secondInstance.server.once('error', reject); secondInstance.server.listen(0, '127.0.0.1', resolve); });
  try {
    const multiInstanceId = await createFutureCapsule('Two instances'); await makeDue(multiInstanceId);
    await Promise.all([app.runUnlockScheduler(), secondInstance.runUnlockScheduler()]);
    assert.equal(app.db.prepare('SELECT attempt_count FROM email_deliveries WHERE capsule_id=?').get(multiInstanceId).attempt_count, 1, 'two SQLite-backed instances make one conditional claim');
    assert.equal(submissions.filter((item) => item.text.includes('Two instances')).length, 1);
  } finally { await secondInstance.close(); }

  const noCredentials = createResendEmailService({ apiKey: '', from: '' });
  assert.equal(noCredentials.configured, false);
  assert.deepEqual(await noCredentials.send({ recipient: 'person@example.test', subject: 'x', html: 'x', text: 'x' }), { accepted: false, retryable: false, error: 'Email delivery is not configured' });
  assert.match(buildUnlockEmail({ title: '<b>x</b>', unlockAt: new Date().toISOString(), appBaseUrl: 'http://localhost:5173' }).html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.throws(() => buildUnlockEmail({ title: 'x', unlockAt: new Date().toISOString(), appBaseUrl: 'https://user:secret@example.test/?token=private' }), /without credentials/);
});

test('email disabled configuration records disabled state without requiring Resend credentials', async () => {
  const local = createApp({ dbPath: join(tempDir, 'disabled.sqlite'), mediaDir: join(tempDir, 'disabled-media'), secret: 'email-test-secret-with-enough-entropy', emailNotificationsEnabled: false });
  await new Promise((resolve, reject) => { local.server.once('error', reject); local.server.listen(0, '127.0.0.1', resolve); });
  try {
    const userId = 'disabled-user'; const salt = 'salt';
    local.db.prepare("INSERT INTO users (id,name,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?)").run(userId, 'Disabled', 'disabled@example.test', salt, 'hash', new Date().toISOString());
    const capsuleId = 'disabled-capsule'; const timestamp = new Date().toISOString();
    local.db.prepare("INSERT INTO capsules (id,owner_id,title,created_at,updated_at,unlock_at,status) VALUES (?,?,?,?,?,?,'LOCKED')").run(capsuleId, userId, 'Disabled delivery', timestamp, timestamp, new Date(Date.now() - 1_000).toISOString());
    await local.runUnlockScheduler();
    assert.equal(local.db.prepare('SELECT status FROM capsules WHERE id=?').get(capsuleId).status, 'UNLOCKED');
    assert.equal(local.db.prepare('SELECT status FROM email_deliveries WHERE capsule_id=?').get(capsuleId).status, 'disabled');
  } finally { await local.close(); }

  const unconfigured = createApp({ dbPath: join(tempDir, 'missing-creds.sqlite'), mediaDir: join(tempDir, 'missing-creds-media'), secret: 'email-test-secret-with-enough-entropy', emailNotificationsEnabled: true, resendApiKey: '', emailFrom: '' });
  await new Promise((resolve, reject) => { unconfigured.server.once('error', reject); unconfigured.server.listen(0, '127.0.0.1', resolve); });
  try {
    const userId = 'missing-creds-user'; const timestamp = new Date().toISOString();
    unconfigured.db.prepare("INSERT INTO users (id,name,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?)").run(userId, 'Missing Credentials', 'missing@example.test', 'salt', 'hash', timestamp);
    unconfigured.db.prepare("INSERT INTO capsules (id,owner_id,title,created_at,updated_at,unlock_at,status) VALUES ('missing-creds-capsule',?,?,?,?,?,'LOCKED')").run(userId, 'Missing credentials', timestamp, timestamp, new Date(Date.now() - 1000).toISOString());
    await unconfigured.runUnlockScheduler();
    assert.equal(unconfigured.db.prepare("SELECT status FROM email_deliveries WHERE capsule_id='missing-creds-capsule'").get().status, 'disabled', 'missing credentials do not stop startup or unlocking');
    assert.equal(unconfigured.db.prepare("SELECT status FROM capsules WHERE id='missing-creds-capsule'").get().status, 'UNLOCKED');
  } finally { await unconfigured.close(); }
});
