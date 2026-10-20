-- Digital Time Capsule PostgreSQL draft.
-- Review-only: this file is not executed by the application.
-- The migration should preserve existing text IDs and ISO timestamps.

BEGIN;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  initials TEXT NOT NULL DEFAULT '',
  notifications BOOLEAN NOT NULL DEFAULT TRUE,
  unlock_emails BOOLEAN NOT NULL DEFAULT TRUE,
  compact_mode BOOLEAN NOT NULL DEFAULT FALSE,
  export_format TEXT NOT NULL DEFAULT 'json',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE capsules (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'gold',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  unlock_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('LOCKED', 'UNLOCKED'))
);
CREATE INDEX capsules_owner_unlock_idx ON capsules (owner_id, unlock_at);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  capsule_id TEXT NOT NULL REFERENCES capsules(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('text', 'image', 'video', 'audio')),
  content_text TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  embedding_json JSONB,
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  embedding_status TEXT NOT NULL DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'ready', 'failed')),
  embedding_attempts INTEGER NOT NULL DEFAULT 0,
  embedding_error TEXT
);
CREATE INDEX memories_capsule_idx ON memories (capsule_id, created_at);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL UNIQUE REFERENCES memories(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  original_filename TEXT NOT NULL DEFAULT '',
  analysis_status TEXT NOT NULL DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'ready', 'failed')),
  analysis_description TEXT NOT NULL DEFAULT '',
  analysis_sha256 TEXT,
  analysis_error TEXT,
  analysis_attempts INTEGER NOT NULL DEFAULT 0,
  analyzed_at TIMESTAMPTZ
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX conversations_user_updated_idx ON conversations (user_id, updated_at DESC);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  references_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX chat_messages_conversation_idx ON chat_messages (conversation_id, created_at, id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  related_id TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at);

CREATE TABLE email_deliveries (
  id TEXT PRIMARY KEY,
  capsule_id TEXT NOT NULL REFERENCES capsules(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'accepted', 'retry_scheduled', 'permanently_failed', 'disabled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  sending_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (capsule_id, notification_type)
);
CREATE INDEX email_deliveries_due_idx ON email_deliveries (status, next_retry_at);

CREATE TABLE revoked_tokens (
  jti TEXT PRIMARY KEY,
  expires_at BIGINT NOT NULL
);

CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  administrator_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  success BOOLEAN NOT NULL
);
CREATE INDEX admin_audit_log_time_idx ON admin_audit_log (occurred_at);

COMMIT;
