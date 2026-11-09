-- Player stats from the server (leaderboards and public profiles), and when each player was last online.
ALTER TABLE players ADD COLUMN IF NOT EXISTS playtime_s   bigint  NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS mined        bigint  NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS placed       bigint  NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS kills        bigint  NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS deaths       bigint  NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS quests_done  integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS streak       integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS best_streak  integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS achievements text[]  NOT NULL DEFAULT '{}';
ALTER TABLE players ADD COLUMN IF NOT EXISTS stats_at     timestamptz;
ALTER TABLE players ADD COLUMN IF NOT EXISTS online_at    timestamptz;
INSERT INTO schema_migrations (version) VALUES ('0015_player_stats') ON CONFLICT DO NOTHING;
