-- Round 3: polls inside chat channels, Player of the Week, website shop listings.

-- Polls posted in a chat channel (Galaxy+ / Galaxy Pro+ members and staff). Staff polls in #polls keep channel_id NULL.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS channel_id bigint REFERENCES channels(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS poll_id bigint REFERENCES polls(id) ON DELETE SET NULL;

-- Player of the Week: picked every Monday with the weekly recap (most time played last week, staff not included).
CREATE TABLE IF NOT EXISTS player_of_week (
  week        date PRIMARY KEY,            -- the Monday the week started
  xuid        text NOT NULL,
  gamertag    text NOT NULL,
  secs        bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_of_week_xuid_idx ON player_of_week (xuid);

INSERT INTO schema_migrations (version) VALUES ('0037_chat_polls_potw_shops') ON CONFLICT DO NOTHING;
