-- PvP (2.94): stats on profiles and leaderboards, match history, season pass XP for PvP wins.
ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_kills integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_deaths integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_wins integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_losses integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_best_streak integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_rating integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_events integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_paid_wins integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pvp_ratings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE season_progress ADD COLUMN IF NOT EXISTS base_pvp integer;
CREATE TABLE IF NOT EXISTS pvp_matches (id bigserial PRIMARY KEY, started_at timestamptz NOT NULL, seconds integer NOT NULL DEFAULT 0, mode text NOT NULL, kit text NOT NULL, arena text, winner text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS pvp_matches_time_idx ON pvp_matches (started_at DESC);
CREATE TABLE IF NOT EXISTS pvp_match_players (match_id bigint NOT NULL REFERENCES pvp_matches(id) ON DELETE CASCADE, xuid text NOT NULL, name text NOT NULL, team text NOT NULL, won boolean NOT NULL DEFAULT false, kills integer NOT NULL DEFAULT 0, hits integer NOT NULL DEFAULT 0, rating_before integer, rating_after integer, PRIMARY KEY (match_id, xuid));
CREATE INDEX IF NOT EXISTS pvp_match_players_xuid_idx ON pvp_match_players (xuid, match_id DESC);
INSERT INTO schema_migrations (version) VALUES ('0095_pvp') ON CONFLICT DO NOTHING;
