-- Staff shifts (clock in, breaks, weekly quotas, leave of absence), profile showcase, referrals,
-- season pass, server-wide goals, and a queue of in-game rewards the plugin hands out (even to offline players).

-- In-game rewards (money and crate keys) waiting to be given by the plugin.
CREATE TABLE IF NOT EXISTS game_rewards (
  id          bigserial PRIMARY KEY,
  xuid        text NOT NULL,
  name        text NOT NULL,
  cents       bigint NOT NULL DEFAULT 0,
  keys        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"common": 1, "rare": 0, "galaxy": 0}
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX IF NOT EXISTS game_rewards_waiting_idx ON game_rewards (id) WHERE sent_at IS NULL;

-- ---------- staff shifts ----------
ALTER TABLE ranks ADD COLUMN IF NOT EXISTS shift_quota_min integer NOT NULL DEFAULT 0;  -- minutes per week (0 = no quota)
CREATE TABLE IF NOT EXISTS staff_shifts (
  id                bigserial PRIMARY KEY,
  user_id           bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  break_started_at  timestamptz,
  break_secs        integer NOT NULL DEFAULT 0,
  source            text NOT NULL DEFAULT 'web',      -- web or game
  ended_by          text                              -- null, 'auto' (left open too long) or a staff name
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_shifts_open_idx ON staff_shifts (user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS staff_shifts_user_idx ON staff_shifts (user_id, started_at DESC);
CREATE TABLE IF NOT EXISTS staff_loa (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  reason      text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'declined', 'cancelled')),
  decided_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  decided_at  timestamptz,
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_loa_user_idx ON staff_loa (user_id, starts_on DESC);

-- ---------- profile showcase: up to 3 pinned achievements or builds ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS showcase jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------- referrals ----------
ALTER TABLE link_codes ADD COLUMN IF NOT EXISTS ref_user_id bigint REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by bigint REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded_at timestamptz;
CREATE INDEX IF NOT EXISTS users_referred_by_idx ON users (referred_by) WHERE referred_by IS NOT NULL;
INSERT INTO badges (name, description, icon, style)
SELECT 'Recruiter', 'Invited 15 or more friends who play on GalaxySMP', 'handshake', 'galaxy'
 WHERE NOT EXISTS (SELECT 1 FROM badges WHERE name = 'Recruiter');

-- ---------- season pass ----------
CREATE TABLE IF NOT EXISTS seasons (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  starts_at  timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz NOT NULL,
  tiers      jsonb NOT NULL,          -- [{ xp, free: {cents, keys}, pro: {cents, keys} }]
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS season_progress (
  season_id    integer NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  xuid         text NOT NULL,
  base_play    bigint NOT NULL DEFAULT 0,   -- stats when the season started (XP counts what's earned after)
  base_quests  integer NOT NULL DEFAULT 0,
  base_ach     integer NOT NULL DEFAULT 0,
  base_bw      integer NOT NULL DEFAULT 0,
  claimed_free integer[] NOT NULL DEFAULT '{}',
  claimed_pro  integer[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (season_id, xuid)
);

-- ---------- server-wide goals ----------
CREATE TABLE IF NOT EXISTS server_goals (
  id            serial PRIMARY KEY,
  title         text NOT NULL,
  stat          text NOT NULL CHECK (stat IN ('mined', 'placed', 'playtime', 'kills', 'quests', 'bw_wins', 'bw_games')),
  target        bigint NOT NULL CHECK (target > 0),
  reward_cents  bigint NOT NULL DEFAULT 0,
  starts_at     timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz NOT NULL,
  done_at       timestamptz,
  closed_at     timestamptz,                 -- finished (rewards queued) or ran out of time
  milestone     integer NOT NULL DEFAULT 0,  -- last announced: 25, 50, 75
  created_by    bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS server_goal_base (
  goal_id  integer NOT NULL REFERENCES server_goals(id) ON DELETE CASCADE,
  xuid     text NOT NULL,
  value    bigint NOT NULL,
  PRIMARY KEY (goal_id, xuid)
);

-- ---------- staff channel for shifts, release notes tag ----------
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check
  CHECK (kind IN ('text', 'info', 'events', 'auction', 'suggestions', 'voice', 'support', 'news', 'polls', 'builds',
                  'team', 'timeline', 'applications', 'stafflogs', 'reports', 'shifts'));
UPDATE channels SET position = position + 1 WHERE staff_only AND slug <> 'staff-announcements' AND position >= 1
   AND NOT EXISTS (SELECT 1 FROM channels WHERE slug = 'shifts');
INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind, staff_only)
SELECT (SELECT id FROM categories WHERE name = 'Staff'), 'shifts', 'Shifts', 'Clock in and out, see who''s on duty, and ask for time off.', 1, 100, 'shifts', true
 WHERE EXISTS (SELECT 1 FROM categories WHERE name = 'Staff')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE news_posts DROP CONSTRAINT IF EXISTS news_posts_tag_check;
ALTER TABLE news_posts ADD CONSTRAINT news_posts_tag_check CHECK (tag IN ('news', 'update', 'event', 'store', 'fix', 'recap', 'release'));

INSERT INTO schema_migrations (version) VALUES ('0044_shifts_seasons_referrals_goals') ON CONFLICT DO NOTHING;
