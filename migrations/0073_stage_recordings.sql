-- Stage recordings uploaded to Cloudflare R2 (only the Owner and staff with "Moderate stages" can watch them). Also in src/lib/autoschema.js
CREATE TABLE IF NOT EXISTS stream_recordings (id bigserial PRIMARY KEY, stream_id bigint REFERENCES streams(id) ON DELETE SET NULL, user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '', r2_key text, upload_id text, mime text NOT NULL DEFAULT 'video/webm', parts jsonb NOT NULL DEFAULT '[]', size bigint NOT NULL DEFAULT 0,
  seconds int, status text NOT NULL DEFAULT 'uploading', started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, deleted_at timestamptz);
CREATE INDEX IF NOT EXISTS stream_recordings_time_idx ON stream_recordings (started_at DESC);
INSERT INTO schema_migrations (version) VALUES ('0073_stage_recordings') ON CONFLICT DO NOTHING;
