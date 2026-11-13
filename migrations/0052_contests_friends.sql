-- Build Contest results (from the plugin's Build Contest minigame) and wins on player profiles.
ALTER TABLE players ADD COLUMN IF NOT EXISTS contest_wins integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS build_contests (
  id          bigserial PRIMARY KEY,
  theme       text NOT NULL,
  host_name   text NOT NULL,
  prize_cents bigint NOT NULL DEFAULT 0,
  results     jsonb NOT NULL DEFAULT '[]',   -- [{xuid, name, place, score, votes, prize}]
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Friends: one row per pair (a < b). pending = a request from requested_by; accepted = friends.
CREATE TABLE IF NOT EXISTS friends (
  a            bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b            bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by bigint NOT NULL,
  status       text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  PRIMARY KEY (a, b),
  CHECK (a < b)
);
CREATE INDEX IF NOT EXISTS friends_b_idx ON friends (b);
-- "Your friend joined GalaxySMP" alerts: at most one per player every couple of hours.
ALTER TABLE players ADD COLUMN IF NOT EXISTS friend_alert_at timestamptz;

INSERT INTO schema_migrations (version) VALUES ('0052_contests_friends') ON CONFLICT DO NOTHING;
