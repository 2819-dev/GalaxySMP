-- Channel layout (Information / Community / Market / Help), new channels #Meet The Team, #Timeline and
-- #Applications, the Timeline feed, Moderator applications, staff bios, Help Center articles,
-- pictures in chat, profile banners and member-uploaded profile pictures.

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check
  CHECK (kind IN ('text', 'info', 'events', 'auction', 'suggestions', 'voice', 'support', 'news', 'polls', 'builds',
                  'team', 'timeline', 'applications'));

-- categories: Information (0), Community (1), Market (2), Help (3); the old Game Modes category goes last
UPDATE categories SET name = 'Community', position = 1 WHERE name IN ('General', 'Community');
UPDATE categories SET position = 9 WHERE name = 'Game Modes';
INSERT INTO categories (name, position) SELECT 'Market', 2 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Market');
INSERT INTO categories (name, position) SELECT 'Help', 3 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Help');

INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind)
SELECT (SELECT id FROM categories WHERE name = 'Information'), 'meet-the-team', 'Meet The Team', 'The people who run GalaxySMP.', 5, 100, 'team'
 WHERE NOT EXISTS (SELECT 1 FROM channels WHERE slug = 'meet-the-team');
INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind)
SELECT (SELECT id FROM categories WHERE name = 'Community'), 'timeline', 'Timeline', 'What''s happening on GalaxySMP right now.', 1, 100, 'timeline'
 WHERE NOT EXISTS (SELECT 1 FROM channels WHERE slug = 'timeline');
INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind)
SELECT (SELECT id FROM categories WHERE name = 'Help'), 'applications', 'Applications', 'Apply to join the GalaxySMP staff team.', 1, 10, 'applications'
 WHERE NOT EXISTS (SELECT 1 FROM channels WHERE slug = 'applications');

-- order inside each category
UPDATE channels SET category_id = (SELECT id FROM categories WHERE name = 'Information'), position = v.pos
  FROM (VALUES ('info', 0), ('announcements', 1), ('updates', 2), ('events', 3), ('meet-the-team', 4)) AS v(slug, pos) WHERE channels.slug = v.slug;
UPDATE channels SET category_id = (SELECT id FROM categories WHERE name = 'Community'), position = v.pos
  FROM (VALUES ('chat', 0), ('timeline', 1), ('polls', 2), ('builds', 3), ('suggestions', 4), ('voice-chat', 5)) AS v(slug, pos) WHERE channels.slug = v.slug;
UPDATE channels SET category_id = (SELECT id FROM categories WHERE name = 'Market'), position = 0 WHERE slug = 'auction-house';
UPDATE channels SET category_id = (SELECT id FROM categories WHERE name = 'Help'), position = v.pos
  FROM (VALUES ('support', 0), ('applications', 1)) AS v(slug, pos) WHERE channels.slug = v.slug;

-- ---------- Timeline (feed cards with likes and comments) ----------
CREATE TABLE IF NOT EXISTS timeline_posts (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,                  -- first_join, achievement, potw, botw, rank, plan, staff
  xuid        text,                           -- the player it's about (for the picture and profile link)
  name        text NOT NULL,                  -- their name, as shown
  title       text NOT NULL,                  -- "joined GalaxySMP for the first time"
  detail      text NOT NULL DEFAULT '',       -- e.g. the achievement's description
  icon        text,                           -- line icon name
  build_id    bigint,                         -- Build of the Week: shows the build's first picture
  dedupe      text UNIQUE,                    -- so the same moment is never posted twice
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS timeline_posts_created_idx ON timeline_posts (created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS timeline_likes (
  post_id     bigint NOT NULL REFERENCES timeline_posts(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS timeline_comments (
  id          bigserial PRIMARY KEY,
  post_id     bigint NOT NULL REFERENCES timeline_posts(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS timeline_comments_post_idx ON timeline_comments (post_id, id);

-- ---------- Moderator applications (only the owner reviews) ----------
CREATE TABLE IF NOT EXISTS staff_applications (
  id            bigserial PRIMARY KEY,
  user_id       bigint NOT NULL,
  role          text NOT NULL DEFAULT 'moderator',
  answers       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined', 'withdrawn')),
  owner_unread  integer NOT NULL DEFAULT 1,
  user_unread   integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);
CREATE INDEX IF NOT EXISTS staff_applications_user_idx ON staff_applications (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS staff_application_messages (
  id              bigserial PRIMARY KEY,
  application_id  bigint NOT NULL REFERENCES staff_applications(id) ON DELETE CASCADE,
  from_owner      boolean NOT NULL DEFAULT false,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- Meet The Team ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_bio text;

-- ---------- Help Center (#Support) ----------
CREATE TABLE IF NOT EXISTS help_articles (
  id          bigserial PRIMARY KEY,
  category    text NOT NULL DEFAULT 'General',
  question    text NOT NULL,
  answer      text NOT NULL,
  keywords    text NOT NULL DEFAULT '',
  position    integer NOT NULL DEFAULT 0,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- Pictures ----------
CREATE TABLE IF NOT EXISTS message_images (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL,
  mime        text NOT NULL,
  width       integer NOT NULL,
  height      integer NOT NULL,
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_id bigint REFERENCES message_images(id) ON DELETE SET NULL;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS image_id bigint REFERENCES message_images(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner bytea;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_type text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS uploads_blocked boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version) VALUES ('0039_timeline_team_applications_help') ON CONFLICT DO NOTHING;
