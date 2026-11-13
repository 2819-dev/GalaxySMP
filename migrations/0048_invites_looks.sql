-- Invite links lead to a join request (the owner still approves everyone): remember who invited them.
ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS invited_by bigint REFERENCES users(id) ON DELETE SET NULL;

-- Season Pass unlocks: website themes, profile titles and profile frames.
CREATE TABLE IF NOT EXISTS user_unlocks (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('theme', 'title', 'frame')),
  item        text NOT NULL,
  source      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, item)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS look_theme text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS look_title text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS look_frame text;

INSERT INTO schema_migrations (version) VALUES ('0048_invites_looks') ON CONFLICT DO NOTHING;
