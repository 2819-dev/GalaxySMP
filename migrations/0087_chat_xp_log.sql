-- Chat XP: remember the XP each message earned (taken back if the message is deleted), and the last message
-- that earned XP (copies of it don't earn more). #Bot Commands is commands-only.
ALTER TABLE chat_xp ADD COLUMN IF NOT EXISTS last_key text;
CREATE TABLE IF NOT EXISTS chat_xp_log (message_id bigint PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, xp integer NOT NULL, day date NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS chat_xp_log_at_idx ON chat_xp_log (at);
UPDATE channels SET topic = 'Use commands here: type / or tap + then Commands. Level-ups show here too.' WHERE slug = 'bot-commands';
INSERT INTO schema_migrations (version) VALUES ('0087_chat_xp_log') ON CONFLICT DO NOTHING;
