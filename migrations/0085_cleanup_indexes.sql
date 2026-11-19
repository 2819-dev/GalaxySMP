-- Indexes for cleaning up pictures and voice messages that were never sent.
CREATE INDEX IF NOT EXISTS messages_image_idx ON messages (image_id) WHERE image_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dm_messages_image_idx ON dm_messages (image_id) WHERE image_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_audio_idx ON messages (audio_id) WHERE audio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dm_messages_audio_idx ON dm_messages (audio_id) WHERE audio_id IS NOT NULL;
INSERT INTO schema_migrations (version) VALUES ('0085_cleanup_indexes') ON CONFLICT DO NOTHING;
