-- Friend Streaks (also applied automatically by src/lib/autoschema.js)
CREATE TABLE IF NOT EXISTS friend_streaks (
  a            bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b            bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  length       int NOT NULL DEFAULT 0,
  best         int NOT NULL DEFAULT 0,
  last_day     date,
  started_on   date,
  nudged_at    timestamptz,
  nudged_by    bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS friend_streaks_b ON friend_streaks (b);
INSERT INTO schema_migrations (version) VALUES ('0061_friend_streaks') ON CONFLICT DO NOTHING;
