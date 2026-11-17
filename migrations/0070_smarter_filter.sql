-- Smarter word filter: "safe" words (never blocked), a log of blocked messages (kept 7 days). Also in src/lib/autoschema.js
-- When the word filter is off (Control Panel or /chatfilter), economy_config has the key 'chatfilter_off'.
ALTER TABLE filter_words DROP CONSTRAINT IF EXISTS filter_words_match_check;
ALTER TABLE filter_words ADD CONSTRAINT filter_words_match_check CHECK (match IN ('word', 'contains', 'safe'));
CREATE TABLE IF NOT EXISTS filter_blocks (id bigserial PRIMARY KEY, user_id bigint REFERENCES users(id) ON DELETE CASCADE, place text NOT NULL, content text NOT NULL, reason text NOT NULL, detail text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS filter_blocks_time_idx ON filter_blocks (created_at DESC);
INSERT INTO schema_migrations (version) VALUES ('0070_smarter_filter') ON CONFLICT DO NOTHING;
