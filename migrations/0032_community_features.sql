-- Events calendar, News, Polls and Builds channels, better Suggestions, stats history,
-- server timeline, ban appeals and the live server map.

-- New channel kinds and channels.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check
  CHECK (kind IN ('text', 'info', 'events', 'auction', 'suggestions', 'voice', 'support', 'news', 'polls', 'builds'));

UPDATE channels SET position = 3, topic = 'Upcoming server events and minigames running now.' WHERE slug = 'events';
INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind)
SELECT category_id, 'news', 'News', 'What''s new on GalaxySMP.', 2, 100, 'news' FROM channels WHERE slug = 'info'
ON CONFLICT (slug) DO NOTHING;

UPDATE channels SET position = 5 WHERE slug = 'voice-chat';
UPDATE channels SET position = 6 WHERE slug = 'support';
INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind)
SELECT category_id, 'builds', 'Builds', 'Show off what you built. The most liked build each week becomes Build of the Week.', 3, 100, 'builds'
  FROM channels WHERE slug = 'chat'
ON CONFLICT (slug) DO NOTHING;
INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind)
SELECT category_id, 'polls', 'Polls', 'Vote on what happens next.', 4, 100, 'polls' FROM channels WHERE slug = 'chat'
ON CONFLICT (slug) DO NOTHING;

-- Events calendar.
CREATE TABLE IF NOT EXISTS events (
  id           bigserial PRIMARY KEY,
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  kind         text NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'bedwars', 'build', 'party', 'update')),
  location     text NOT NULL DEFAULT '',
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz,
  created_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reminded     boolean NOT NULL DEFAULT false,   -- the "starting soon" notification went out
  announced    boolean NOT NULL DEFAULT false,   -- the in-game announcement went out
  deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS events_starts_idx ON events (starts_at) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS event_reminders (
  event_id  bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

-- News.
CREATE TABLE IF NOT EXISTS news_posts (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL,
  body        text NOT NULL,
  tag         text NOT NULL DEFAULT 'news' CHECK (tag IN ('news', 'update', 'event', 'store', 'fix')),
  author_id   bigint REFERENCES users(id) ON DELETE SET NULL,
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS news_created_idx ON news_posts (created_at DESC) WHERE deleted_at IS NULL;

-- Polls.
CREATE TABLE IF NOT EXISTS polls (
  id          bigserial PRIMARY KEY,
  question    text NOT NULL,
  multi       boolean NOT NULL DEFAULT false,
  author_id   bigint REFERENCES users(id) ON DELETE SET NULL,
  closes_at   timestamptz,
  closed      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE TABLE IF NOT EXISTS poll_options (
  id        bigserial PRIMARY KEY,
  poll_id   bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label     text NOT NULL,
  position  smallint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id    bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id  bigint NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (poll_id, option_id, user_id)
);

-- Builds gallery.
CREATE TABLE IF NOT EXISTS builds (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  location     text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  botw_week    date,          -- set when it won Build of the Week (the Monday of that week)
  deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS builds_created_idx ON builds (created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS build_images (
  id         bigserial PRIMARY KEY,
  build_id   bigint NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  position   smallint NOT NULL DEFAULT 0,
  mime       text NOT NULL,
  width      integer NOT NULL,
  height     integer NOT NULL,
  data       bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS build_images_build_idx ON build_images (build_id, position);
CREATE TABLE IF NOT EXISTS build_likes (
  build_id  bigint NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (build_id, user_id)
);

-- Suggestions: comments and a staff response.
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS staff_reply text;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS staff_reply_by bigint REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS staff_reply_at timestamptz;
CREATE TABLE IF NOT EXISTS suggestion_comments (
  id             bigserial PRIMARY KEY,
  suggestion_id  bigint NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  user_id        bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX IF NOT EXISTS suggestion_comments_idx ON suggestion_comments (suggestion_id, id);

-- Stats history for profile charts (one row per player per day).
CREATE TABLE IF NOT EXISTS player_stats_daily (
  xuid           text NOT NULL REFERENCES players(xuid) ON DELETE CASCADE,
  day            date NOT NULL,
  playtime_s     bigint NOT NULL DEFAULT 0,
  balance_cents  bigint NOT NULL DEFAULT 0,
  mined          bigint NOT NULL DEFAULT 0,
  placed         bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (xuid, day)
);

-- Server timeline: when each player played, and when the server was online.
CREATE TABLE IF NOT EXISTS player_sessions (
  id          bigserial PRIMARY KEY,
  xuid        text NOT NULL REFERENCES players(xuid) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS player_sessions_time_idx ON player_sessions (ended_at DESC);
CREATE INDEX IF NOT EXISTS player_sessions_xuid_idx ON player_sessions (xuid, ended_at DESC);
CREATE TABLE IF NOT EXISTS server_uptime (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz NOT NULL,
  peak        integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS server_uptime_time_idx ON server_uptime (ended_at DESC);

-- Ban appeals (game and website bans). The token lets the person check the answer.
CREATE TABLE IF NOT EXISTS appeals (
  id           bigserial PRIMARY KEY,
  token        text NOT NULL UNIQUE,
  gamertag     text NOT NULL,
  xuid         text,
  which        text NOT NULL CHECK (which IN ('game', 'website', 'both')),
  message      text NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined')),
  staff_reply  text,
  handled_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  handled_at   timestamptz
);
CREATE INDEX IF NOT EXISTS appeals_status_idx ON appeals (status, created_at DESC);

-- Live server map: the colour of the top block of every column, 16x16 per chunk (RGB, 768 bytes).
CREATE TABLE IF NOT EXISTS map_chunks (
  dim         text NOT NULL,
  cx          integer NOT NULL,
  cz          integer NOT NULL,
  rgb         bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dim, cx, cz)
);

INSERT INTO schema_migrations (version) VALUES ('0032_community_features') ON CONFLICT DO NOTHING;
