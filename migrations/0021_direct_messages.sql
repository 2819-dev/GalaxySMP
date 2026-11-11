-- Direct messages between community members (also sent and received in game with /dm).
-- The server owners can read them for safety (stated in the privacy policy).
CREATE TABLE IF NOT EXISTS dm_threads (
  id              bigserial PRIMARY KEY,
  user_a          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- the lower user id
  user_b          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- the higher user id
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  a_unread        integer NOT NULL DEFAULT 0,
  b_unread        integer NOT NULL DEFAULT 0,
  CHECK (user_a < user_b),
  UNIQUE (user_a, user_b)
);
CREATE INDEX IF NOT EXISTS dm_threads_a_idx ON dm_threads (user_a, last_message_at DESC);
CREATE INDEX IF NOT EXISTS dm_threads_b_idx ON dm_threads (user_b, last_message_at DESC);

CREATE TABLE IF NOT EXISTS dm_messages (
  id          bigserial PRIMARY KEY,
  thread_id   bigint NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_id   bigint REFERENCES users(id) ON DELETE SET NULL,
  body        text NOT NULL,
  via         text NOT NULL DEFAULT 'web' CHECK (via IN ('web', 'game')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dm_messages_idx ON dm_messages (thread_id, id);

CREATE TABLE IF NOT EXISTS dm_blocks (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blocked_id)
);

INSERT INTO schema_migrations (version) VALUES ('0021_direct_messages') ON CONFLICT DO NOTHING;
