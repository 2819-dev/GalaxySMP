-- Community update: special channels (info, auction house, suggestions, voice, events),
-- new layout, and old channels hidden (their messages are kept).
ALTER TABLE channels ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'text'
  CHECK (kind IN ('text', 'info', 'events', 'auction', 'suggestions', 'voice'));
ALTER TABLE channels ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

UPDATE categories SET name = 'ℹ️ Information', position = 0 WHERE id = 1;
UPDATE categories SET name = '💭 General', position = 1 WHERE id = 2;

-- Old channels: hidden, messages kept.
UPDATE channels SET hidden = true WHERE slug IN ('help', 'off-topic', 'survival', 'minigames', 'skyblock-creative');

-- #general becomes #Chat (keeps its messages).
UPDATE channels SET slug = 'chat', name = 'Chat', topic = 'The main chat. Be kind!', position = 0, category_id = 2
 WHERE slug = 'general';
UPDATE channels SET name = 'Announcements', position = 1 WHERE slug = 'announcements';

INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind) VALUES
  (1, 'info',          'Information',   'About GalaxySMP, the website and the rules.',                   0, 100, 'info'),
  (1, 'events',        'Events',        'Server events. Coming soon!',                                   2, 100, 'events'),
  (2, 'auction-house', 'Auction House', 'Buy from the in-game Auction House (/ah) with your game money.', 1, 100, 'auction'),
  (2, 'suggestions',   'Suggestions',   'Share ideas for the server and vote on them.',                   2, 100, 'suggestions'),
  (2, 'voice-chat',    'Voice Chat',    'Proximity voice chat for the server.',                           3, 100, 'voice')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS suggestions (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  anonymous   boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planned', 'done', 'declined')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS suggestions_created_idx ON suggestions (created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS suggestion_votes (
  suggestion_id bigint NOT NULL REFERENCES suggestions (id) ON DELETE CASCADE,
  user_id       bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  value         smallint NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (suggestion_id, user_id)
);
