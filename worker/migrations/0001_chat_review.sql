-- Splash chat review store on the existing D1 database jupwash-tokens
-- (binding TOKENS_DB). Does not create a new database or KV namespace.
--
-- Apply once, before deploying the worker that writes these tables:
--   npx wrangler d1 execute jupwash-tokens --remote --file=migrations/0001_chat_review.sql
--
-- Rows older than 30 days are deleted by the worker on later chat writes.

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_visitor_at INTEGER,
  last_reply_at INTEGER,
  escalated_reason TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  outcome TEXT,
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id)
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation
  ON chat_messages (conversation_id, id);

CREATE INDEX IF NOT EXISTS chat_conversations_status
  ON chat_conversations (status, updated_at);
