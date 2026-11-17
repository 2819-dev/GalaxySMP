-- Team Admins, and Streams (live video streams and live podcasts). Also in src/lib/autoschema.js
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';

-- A "Voice & Streams" category (after Community) holding #Voice Chat and the new #Streams
UPDATE categories SET position = position + 1 WHERE position >= 2 AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Voice & Streams');
INSERT INTO categories (name, position) SELECT 'Voice & Streams', 2 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Voice & Streams');
UPDATE channels SET category_id = (SELECT id FROM categories WHERE name = 'Voice & Streams'), position = 0 WHERE slug = 'voice-chat';
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check CHECK (kind IN ('text', 'info', 'events', 'auction', 'suggestions', 'voice', 'support', 'news', 'polls', 'builds', 'team', 'timeline', 'applications', 'stafflogs', 'reports', 'shifts', 'jobs', 'streams'));
INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind)
  SELECT (SELECT id FROM categories WHERE name = 'Voice & Streams'), 'streams', 'Streams', 'Live streams and podcasts from players and teams.', 1, 100, 'streams'
  ON CONFLICT (slug) DO NOTHING;

-- A stream belongs to one member (host_user_id) or one team (team_id).
CREATE TABLE IF NOT EXISTS streams (
  id bigserial PRIMARY KEY,
  host_user_id bigint REFERENCES users(id) ON DELETE CASCADE,
  team_id bigint REFERENCES teams(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'video',          -- video | audio (podcast)
  status text NOT NULL DEFAULT 'scheduled',    -- scheduled | live | ended
  scheduled_at timestamptz, started_at timestamptz, ended_at timestamptz,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  peak_viewers int NOT NULL DEFAULT 0,
  ended_by text,
  reminded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS streams_status_idx ON streams (status, scheduled_at);
-- A member's crew: Editors run their streams, Streamers can be on them.
CREATE TABLE IF NOT EXISTS stream_crew (host_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'streamer', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (host_user_id, user_id));
CREATE TABLE IF NOT EXISTS stream_follows (user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, host_user_id bigint REFERENCES users(id) ON DELETE CASCADE,
  team_id bigint REFERENCES teams(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS stream_follows_user_idx ON stream_follows (user_id, host_user_id) WHERE host_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stream_follows_team_idx ON stream_follows (user_id, team_id) WHERE team_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS stream_reminders (stream_id bigint NOT NULL REFERENCES streams(id) ON DELETE CASCADE, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (stream_id, user_id));
-- streams + host name/picture fields + team name/tag
CREATE OR REPLACE VIEW streams_v AS SELECT s.*, hu.username AS host_name, hp.xuid AS host_xuid, hp.head_at AS host_head_at, hp.gamerpic_at AS host_gamerpic_at, t.name AS team_name, t.tag AS team_tag FROM streams s LEFT JOIN users hu ON hu.id = s.host_user_id LEFT JOIN players hp ON hp.uuid = hu.mc_uuid LEFT JOIN teams t ON t.id = s.team_id;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stream_banned_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stream_ban_reason text;

INSERT INTO schema_migrations (version) VALUES ('0067_team_admins_streams') ON CONFLICT DO NOTHING;
