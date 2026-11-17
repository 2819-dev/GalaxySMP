-- #Stages: three types (Podcasts, Live Streams, More), setup before going live (backstage, rules),
-- live podcasts / streams saved automatically, chapters and comments on episodes.
ALTER TABLE streams ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS save_video boolean NOT NULL DEFAULT false;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS speak_mode text NOT NULL DEFAULT 'hand';
ALTER TABLE streams ADD COLUMN IF NOT EXISTS chat_on boolean NOT NULL DEFAULT true;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS team_only boolean NOT NULL DEFAULT false;
UPDATE streams SET kind = 'live' WHERE kind = 'video';
DROP VIEW IF EXISTS streams_v;
CREATE VIEW streams_v AS SELECT s.*, hu.username AS host_name, hp.xuid AS host_xuid, hp.head_at AS host_head_at, hp.gamerpic_at AS host_gamerpic_at, t.name AS team_name, t.tag AS team_tag FROM streams s LEFT JOIN users hu ON hu.id = s.host_user_id LEFT JOIN players hp ON hp.uuid = hu.mc_uuid LEFT JOIN teams t ON t.id = s.team_id;
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'podcast';
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS team_only boolean NOT NULL DEFAULT false;
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS chapters jsonb NOT NULL DEFAULT '[]';
ALTER TABLE stream_episodes ADD COLUMN IF NOT EXISTS stream_id bigint REFERENCES streams(id) ON DELETE SET NULL;
ALTER TABLE stream_recordings ADD COLUMN IF NOT EXISTS publish boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS episode_comments (id bigserial PRIMARY KEY, episode_id bigint NOT NULL REFERENCES stream_episodes(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);
CREATE INDEX IF NOT EXISTS episode_comments_ep_idx ON episode_comments (episode_id, created_at);
INSERT INTO schema_migrations (version) VALUES ('0077_stage_types') ON CONFLICT DO NOTHING;
