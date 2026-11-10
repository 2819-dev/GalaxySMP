-- Support tickets (live chat between a player and staff), staff notes on players, and the Support channel.
CREATE TABLE IF NOT EXISTS tickets (
  id               bigserial PRIMARY KEY,
  user_id          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject          text NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting', 'resolved', 'closed')),
  priority         text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  label            text NOT NULL DEFAULT 'question' CHECK (label IN ('question', 'bug', 'report', 'appeal', 'store', 'other')),
  assigned_to      bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  user_unread      integer NOT NULL DEFAULT 0,   -- staff replies the player hasn't seen
  staff_unread     integer NOT NULL DEFAULT 0    -- player messages staff haven't seen
);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS tickets_user_idx ON tickets (user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          bigserial PRIMARY KEY,
  ticket_id   bigint NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  from_staff  boolean NOT NULL DEFAULT false,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_messages_idx ON ticket_messages (ticket_id, id);

CREATE TABLE IF NOT EXISTS player_notes (
  id          bigserial PRIMARY KEY,
  xuid        text NOT NULL,
  author      text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_notes_idx ON player_notes (xuid, created_at DESC);

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check CHECK (kind IN ('text', 'info', 'events', 'auction', 'suggestions', 'voice', 'support'));
INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind)
SELECT c.id, 'support', 'Support', 'Talk to staff privately: questions, problems, appeals.', 5, 10, 'support'
  FROM categories c WHERE c.name ILIKE '%General%' AND NOT EXISTS (SELECT 1 FROM channels WHERE slug = 'support')
 ORDER BY c.position LIMIT 1;

INSERT INTO schema_migrations (version) VALUES ('0017_support_and_panels') ON CONFLICT DO NOTHING;
