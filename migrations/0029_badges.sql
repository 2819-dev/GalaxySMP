-- Badges: special awards for events and roles (e.g. "GalaxySMP 25th Anniversary"), shown as hexagons on
-- profiles. Not the same as achievements (those are earned in game). The Owner badge is built in.
CREATE TABLE IF NOT EXISTS badges (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  description text,
  icon        text NOT NULL DEFAULT 'star',
  style       text NOT NULL DEFAULT 'gold',
  created_by  bigint,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id    bigint NOT NULL,
  badge_id   bigint NOT NULL REFERENCES badges (id) ON DELETE CASCADE,
  awarded_by bigint,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX IF NOT EXISTS user_badges_badge_idx ON user_badges (badge_id);

INSERT INTO schema_migrations (version) VALUES ('0029_badges') ON CONFLICT DO NOTHING;
