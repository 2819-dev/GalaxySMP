-- Chat threads: a reply in a thread points at the message that started it (it doesn't show in the channel itself).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS thread_root bigint REFERENCES messages(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_root, id) WHERE thread_root IS NOT NULL;
-- Voice messages (Galaxy+ and Pro+, up to 1 minute) in chat and DMs.
CREATE TABLE IF NOT EXISTS message_audio (id bigserial PRIMARY KEY, user_id bigint NOT NULL, mime text NOT NULL, duration_ms integer NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_id bigint REFERENCES message_audio(id) ON DELETE SET NULL;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS audio_id bigint REFERENCES message_audio(id) ON DELETE SET NULL;
-- Slow mode: seconds each member must wait between messages in a channel (0 = off).
ALTER TABLE channels ADD COLUMN IF NOT EXISTS slow_seconds integer NOT NULL DEFAULT 0;
-- Suggestions posted by GalaxySMP itself (shown with the GalaxySMP name) for the community to vote on.
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS official boolean NOT NULL DEFAULT false;
INSERT INTO schema_migrations (version) VALUES ('0056_threads_voice_slowmode') ON CONFLICT DO NOTHING;
