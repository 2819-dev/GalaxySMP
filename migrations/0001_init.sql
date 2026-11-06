-- GalaxySMP database schema, migration 0001.
-- Covers every stage: accounts, Minecraft linking, chat, moderation and audit log.
-- Safe to read top to bottom; each table has a short comment explaining it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- bcrypt password hashing (crypt / gen_salt)

-- Keeps track of which migrations have been applied.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- Roles. "power" decides who outranks whom (higher = more powerful).
CREATE TABLE roles (
  id     smallint PRIMARY KEY,
  key    text NOT NULL UNIQUE,
  name   text NOT NULL,
  color  text NOT NULL,             -- name color in chat, e.g. #F23F42
  power  smallint NOT NULL
);

INSERT INTO roles (id, key, name, color, power) VALUES
  (1, 'member',    'Member',    '#C9CDFB', 10),
  (2, 'vip',       'VIP',       '#F5C542', 20),
  (3, 'moderator', 'Moderator', '#3BD67A', 50),
  (4, 'admin',     'Admin',     '#FF5C7A', 100);

-- Accounts. No email, no real name, no birthday: only the Minecraft identity.
CREATE TABLE users (
  id              bigserial PRIMARY KEY,
  mc_uuid         uuid NOT NULL UNIQUE,           -- permanent Minecraft player id
  username        text NOT NULL,                  -- exact in-game name (Bedrock names keep their dot)
  username_lower  text NOT NULL UNIQUE,
  platform        text NOT NULL CHECK (platform IN ('java', 'bedrock')),
  password_hash   text NOT NULL,                  -- bcrypt, made by pgcrypto
  role_id         smallint NOT NULL DEFAULT 1 REFERENCES roles(id),
  muted_until     timestamptz,
  mute_reason     text,
  banned          boolean NOT NULL DEFAULT false,
  ban_reason      text,
  failed_logins   integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz
);

-- One-time codes for /link. Stores the bcrypt password chosen on the website
-- until the player proves ownership in game.
CREATE TABLE link_codes (
  id              bigserial PRIMARY KEY,
  code            text NOT NULL UNIQUE,           -- e.g. K7Q4MZ (shown as K7Q-4MZ)
  requested_name  text NOT NULL,                  -- what the player typed on the website
  password_hash   text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  user_id         bigint REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX link_codes_expires_idx ON link_codes (expires_at);

-- Login sessions. Only a SHA-256 hash of the cookie token is stored.
CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Channel categories and channels.
CREATE TABLE categories (
  id        serial PRIMARY KEY,
  name      text NOT NULL,
  position  integer NOT NULL DEFAULT 0
);

CREATE TABLE channels (
  id               serial PRIMARY KEY,
  category_id      integer NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  slug             text NOT NULL UNIQUE,
  name             text NOT NULL,
  topic            text NOT NULL DEFAULT '',
  position         integer NOT NULL DEFAULT 0,
  min_post_power   smallint NOT NULL DEFAULT 10   -- 50 = only Moderators and Admins may post
);

INSERT INTO categories (id, name, position) VALUES
  (1, 'Information', 0),
  (2, 'Community',   1),
  (3, 'Game Modes',  2);
SELECT setval('categories_id_seq', 3);

INSERT INTO channels (category_id, slug, name, topic, position, min_post_power) VALUES
  (1, 'announcements',     'announcements',     'News from the GalaxySMP team. Only staff can post here.', 0, 50),
  (2, 'general',           'general',           'Chat about anything GalaxySMP. Be kind!',                 0, 10),
  (2, 'help',              'help',              'Stuck? Ask here and someone will help.',                  1, 10),
  (2, 'off-topic',         'off-topic',         'Chat about other (kid-friendly) stuff.',                  2, 10),
  (3, 'survival',          'survival',          'Survival world chat.',                                    0, 10),
  (3, 'minigames',         'minigames',         'Minigames chat. Find a team!',                            1, 10),
  (3, 'skyblock-creative', 'skyblock-creative', 'Skyblock and Creative worlds.',                           2, 10);

-- Chat messages. Deleted messages are hidden but kept for staff review.
CREATE TABLE messages (
  id          bigserial PRIMARY KEY,
  channel_id  integer NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     text NOT NULL,
  reply_to    bigint REFERENCES messages(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  deleted_by  bigint REFERENCES users(id)
);
CREATE INDEX messages_channel_idx ON messages (channel_id, id DESC);
CREATE INDEX messages_user_idx ON messages (user_id, created_at DESC);

-- Emoji reactions (fixed emoji set, enforced by the app).
CREATE TABLE reactions (
  message_id  bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- Reported messages, reviewed by staff.
CREATE TABLE reports (
  id            bigserial PRIMARY KEY,
  message_id    bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reporter_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason        text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_by   bigint REFERENCES users(id),
  resolved_at   timestamptz,
  resolution    text,
  UNIQUE (message_id, reporter_id)
);
CREATE INDEX reports_status_idx ON reports (status, created_at);

-- Staff-editable word filter.
-- match = 'word'     : blocks the word on its own (so "ass" does not block "class")
-- match = 'contains' : blocks it anywhere, even hidden inside other letters
CREATE TABLE filter_words (
  id          serial PRIMARY KEY,
  word        text NOT NULL UNIQUE,
  match       text NOT NULL DEFAULT 'word' CHECK (match IN ('word', 'contains')),
  added_by    bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Every staff action: who did what, to whom, when.
CREATE TABLE audit_log (
  id                 bigserial PRIMARY KEY,
  actor_id           bigint REFERENCES users(id) ON DELETE SET NULL,
  action             text NOT NULL,
  target_user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  target_message_id  bigint REFERENCES messages(id) ON DELETE SET NULL,
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('0001_init');
