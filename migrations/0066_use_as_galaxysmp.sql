-- The owner can use the site as GalaxySMP (a full session, not look-only). Also in src/lib/autoschema.js
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner_as bigint;
INSERT INTO schema_migrations (version) VALUES ('0066_use_as_galaxysmp') ON CONFLICT DO NOTHING;
