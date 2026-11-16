-- Private polls (made by the owner): results and who voted what are shown only to the owner.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS private boolean NOT NULL DEFAULT false;
INSERT INTO schema_migrations (version) VALUES ('0060_private_polls') ON CONFLICT DO NOTHING;
