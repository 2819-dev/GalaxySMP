-- Daily streaks: Streak Freezes (copied from the plugin) and the last three weeks of played / frozen days.
ALTER TABLE players ADD COLUMN IF NOT EXISTS freezes integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS streak_log jsonb;
-- Galaxy Pro+ gets one free freeze each month (one row per player per month).
CREATE TABLE IF NOT EXISTS streak_grants (xuid text NOT NULL, month text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (xuid, month));

-- Teams: a name, a tag (up to 5 letters/numbers, shown gray in chat) and an organizer; members are Minecraft
-- players (one team each); invites wait until accepted; a private team chat (website + /tc in game).
CREATE TABLE IF NOT EXISTS teams (id bigserial PRIMARY KEY, name text NOT NULL, tag text NOT NULL, leader_xuid text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS teams_tag_idx ON teams (upper(tag));
CREATE UNIQUE INDEX IF NOT EXISTS teams_name_idx ON teams (lower(name));
CREATE TABLE IF NOT EXISTS team_members (team_id bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE, xuid text PRIMARY KEY, joined_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS team_members_team_idx ON team_members (team_id);
CREATE TABLE IF NOT EXISTS team_invites (team_id bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE, xuid text NOT NULL, invited_by text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (team_id, xuid));
CREATE TABLE IF NOT EXISTS team_messages (id bigserial PRIMARY KEY, team_id bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE, xuid text, name text NOT NULL, content text NOT NULL, from_game boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS team_messages_idx ON team_messages (team_id, id DESC);
INSERT INTO schema_migrations (version) VALUES ('0054_streaks_teams') ON CONFLICT DO NOTHING;
