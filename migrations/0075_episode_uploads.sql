-- Podcast episodes are uploaded audio files (Cloudflare R2), not YouTube links. Also in src/lib/autoschema.js
ALTER TABLE stream_episodes ALTER COLUMN youtube_id DROP NOT NULL;
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS r2_key text;
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS upload_id text;
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS mime text;
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS parts jsonb NOT NULL DEFAULT '[]';
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS size bigint NOT NULL DEFAULT 0;
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS seconds int;
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
INSERT INTO schema_migrations (version) VALUES ('0075_episode_uploads') ON CONFLICT DO NOTHING;
