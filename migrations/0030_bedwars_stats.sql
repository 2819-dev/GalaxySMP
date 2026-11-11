-- Bedwars stats (sent by the game server with the other player stats).
ALTER TABLE players ADD COLUMN IF NOT EXISTS bw_games  integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS bw_wins   integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS bw_kills  integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS bw_finals integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS bw_beds   integer NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (version) VALUES ('0030_bedwars_stats') ON CONFLICT DO NOTHING;
