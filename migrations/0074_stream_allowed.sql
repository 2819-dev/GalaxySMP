-- Members the Owner allows to host their own stages and post episodes without Galaxy Pro+. Also in src/lib/autoschema.js
ALTER TABLE users ADD COLUMN IF NOT EXISTS stream_allowed boolean NOT NULL DEFAULT false;
INSERT INTO schema_migrations (version) VALUES ('0074_stream_allowed') ON CONFLICT DO NOTHING;
