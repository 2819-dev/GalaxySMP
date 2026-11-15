-- Screenshots wall (a tab in #Builds): posts in the builds table with kind = 'shot'.
ALTER TABLE builds ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'build';
CREATE INDEX IF NOT EXISTS builds_kind_idx ON builds (kind, id DESC) WHERE deleted_at IS NULL;
INSERT INTO schema_migrations (version) VALUES ('0059_screenshots') ON CONFLICT DO NOTHING;
