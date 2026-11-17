-- #Suggestions: categories, an "In progress" status, and merging duplicates. Also in src/lib/autoschema.js
ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS suggestions_status_check;
ALTER TABLE suggestions ADD CONSTRAINT suggestions_status_check CHECK (status IN ('open', 'planned', 'progress', 'done', 'declined', 'duplicate'));
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS merged_into bigint REFERENCES suggestions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS suggestions_status_cat_idx ON suggestions (status, category) WHERE deleted_at IS NULL;
INSERT INTO schema_migrations (version) VALUES ('0069_suggestion_organize') ON CONFLICT DO NOTHING;
