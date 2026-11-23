-- Secure forms in DMs (the owner only): questions sent in a DM; the answers are encrypted and only the owner can read them.
CREATE TABLE IF NOT EXISTS dm_forms (id bigserial PRIMARY KEY, from_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, to_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, title text, questions jsonb NOT NULL, answers text, status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'answered', 'declined', 'deleted')), created_at timestamptz NOT NULL DEFAULT now(), answered_at timestamptz);
CREATE INDEX IF NOT EXISTS dm_forms_to_idx ON dm_forms (to_id, created_at DESC);
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS form_id bigint REFERENCES dm_forms(id) ON DELETE SET NULL;
INSERT INTO schema_migrations (version) VALUES ('0088_dm_forms') ON CONFLICT DO NOTHING;
