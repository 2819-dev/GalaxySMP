-- Bedwars match history (one row per game, one per player in it).
CREATE TABLE IF NOT EXISTS bw_matches (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL,
  seconds     integer NOT NULL DEFAULT 0,
  mode        text,
  winner      text,
  feed        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bw_matches_time_idx ON bw_matches (started_at DESC);
CREATE TABLE IF NOT EXISTS bw_match_players (
  match_id  bigint NOT NULL REFERENCES bw_matches(id) ON DELETE CASCADE,
  xuid      text NOT NULL,
  name      text NOT NULL,
  team      text NOT NULL,
  kills     integer NOT NULL DEFAULT 0,
  finals    integer NOT NULL DEFAULT 0,
  beds      integer NOT NULL DEFAULT 0,
  won       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (match_id, xuid)
);
CREATE INDEX IF NOT EXISTS bw_match_players_xuid_idx ON bw_match_players (xuid, match_id DESC);
INSERT INTO schema_migrations (version) VALUES ('0058_bedwars_matches') ON CONFLICT DO NOTHING;
