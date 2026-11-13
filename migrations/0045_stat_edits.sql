-- The owner can set players' leaderboard stats; the change goes to the game with the rewards queue.
ALTER TABLE game_rewards ADD COLUMN IF NOT EXISTS stats jsonb;
INSERT INTO schema_migrations (version) VALUES ('0045_stat_edits') ON CONFLICT DO NOTHING;
