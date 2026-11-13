-- #Jobs (players pay other players for in-game work), Store wishlists, and Galaxy Wrapped recaps.

-- ---------- #Jobs ----------
-- The reward is taken from the poster's in-game money when they post (held), paid to the worker when the
-- poster confirms, or given back if the job is cancelled or nobody takes it.
CREATE TABLE IF NOT EXISTS jobs (
  id             bigserial PRIMARY KEY,
  poster_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poster_xuid    text NOT NULL,
  poster_name    text NOT NULL,
  title          text NOT NULL,
  details        text NOT NULL DEFAULT '',
  reward_cents   bigint NOT NULL CHECK (reward_cents > 0),
  charged        boolean NOT NULL DEFAULT true,   -- false when the poster is an operator (nothing was taken, nothing is given back)
  mode           text NOT NULL DEFAULT 'pick' CHECK (mode IN ('first', 'pick')),
  status         text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'open', 'taken', 'submitted', 'done', 'cancelled', 'expired')),
  worker_id      bigint REFERENCES users(id) ON DELETE SET NULL,
  worker_xuid    text,
  worker_name    text,
  note           text NOT NULL DEFAULT '',        -- the last "not done yet" note, or how staff settled it
  settled_by     text,                            -- 'poster', 'auto', 'staff:<name>'
  created_at     timestamptz NOT NULL DEFAULT now(),
  taken_at       timestamptz,
  submitted_at   timestamptz,
  finished_at    timestamptz
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_poster_idx ON jobs (poster_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_worker_idx ON jobs (worker_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_applicants (
  job_id      bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  xuid        text NOT NULL,
  name        text NOT NULL,
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id)
);

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check
  CHECK (kind IN ('text', 'info', 'events', 'auction', 'suggestions', 'voice', 'support', 'news', 'polls', 'builds',
                  'team', 'timeline', 'applications', 'stafflogs', 'reports', 'shifts', 'jobs'));
INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind)
SELECT (SELECT id FROM categories WHERE name = 'Market'), 'jobs', 'Jobs',
       'Pay other players to gather, build or craft for you, or earn money doing jobs.', 1, 100, 'jobs'
 WHERE EXISTS (SELECT 1 FROM categories WHERE name = 'Market')
ON CONFLICT (slug) DO NOTHING;

-- ---------- Store wishlist ----------
CREATE TABLE IF NOT EXISTS wishlist (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item        text NOT NULL,          -- a plan key ("plus", "pro") or a Shop item id
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS wishlist_hidden boolean NOT NULL DEFAULT false;
-- Promo codes can tell members who wished for an item that it's on sale (once per promo and member).
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS wishlist_alert boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS wishlist_alerts (
  promo_id  bigint NOT NULL,
  user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (promo_id, user_id)
);

-- ---------- Galaxy Wrapped ----------
-- More stats in the daily history, so recaps can show what changed in a period (they're running totals).
ALTER TABLE player_stats_daily ADD COLUMN IF NOT EXISTS kills bigint;
ALTER TABLE player_stats_daily ADD COLUMN IF NOT EXISTS quests integer;
ALTER TABLE player_stats_daily ADD COLUMN IF NOT EXISTS achievements integer;
ALTER TABLE player_stats_daily ADD COLUMN IF NOT EXISTS bw_wins integer;
ALTER TABLE player_stats_daily ADD COLUMN IF NOT EXISTS bw_kills integer;

-- Each player's recap, worked out once when it's first opened. period: '2026' (the year) or '2026-09' (September + October).
CREATE TABLE IF NOT EXISTS wrapped (
  xuid        text NOT NULL,
  period      text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (xuid, period)
);

INSERT INTO schema_migrations (version) VALUES ('0047_jobs_wishlist_wrapped') ON CONFLICT DO NOTHING;
