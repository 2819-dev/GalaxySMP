// Small database changes the website makes by itself the first time it starts after an update
// (each one only adds things, so running it again is harmless). Checked once per worker instance.
import { getDb } from "./db.js";

const PENDING = [
  ["0048_invites_looks", [
    "ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS invited_by bigint REFERENCES users(id) ON DELETE SET NULL",
    `CREATE TABLE IF NOT EXISTS user_unlocks (
       user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       kind text NOT NULL CHECK (kind IN ('theme', 'title', 'frame')),
       item text NOT NULL, source text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (user_id, kind, item))`,
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS look_theme text",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS look_title text",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS look_frame text",
    "INSERT INTO schema_migrations (version) VALUES ('0048_invites_looks') ON CONFLICT DO NOTHING",
  ]],
  ["0049_game_chat_gifts_plots", [
    "ALTER TABLE messages ALTER COLUMN user_id DROP NOT NULL",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS game_xuid text",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS game_name text",
    `CREATE TABLE IF NOT EXISTS ah_sales (id bigserial PRIMARY KEY, item_id text NOT NULL, label text NOT NULL DEFAULT '',
       amount integer NOT NULL, price_cents bigint NOT NULL, unit_cents bigint NOT NULL, sold_at timestamptz NOT NULL DEFAULT now())`,
    "CREATE INDEX IF NOT EXISTS ah_sales_item_idx ON ah_sales (item_id, sold_at DESC)",
    `CREATE TABLE IF NOT EXISTS gift_cards (id bigserial PRIMARY KEY, code text NOT NULL UNIQUE, design text NOT NULL, amount_cents bigint NOT NULL,
       message text NOT NULL DEFAULT '', from_name text NOT NULL, to_name text NOT NULL DEFAULT '', buyer_id bigint REFERENCES users(id) ON DELETE SET NULL,
       status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'redeemed', 'refunded')),
       redeemed_by bigint REFERENCES users(id) ON DELETE SET NULL, redeemed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`,
    "ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_check",
    "ALTER TABLE payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('topup', 'item', 'giftcard'))",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS checklist_claimed_at timestamptz",
    "CREATE TABLE IF NOT EXISTS plot_showcase (plot_id text PRIMARY KEY, owner_xuid text NOT NULL, caption text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now())",
    `CREATE TABLE IF NOT EXISTS plot_photos (id bigserial PRIMARY KEY, plot_id text NOT NULL, position integer NOT NULL DEFAULT 0, mime text NOT NULL,
       width integer NOT NULL, height integer NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
    "CREATE INDEX IF NOT EXISTS plot_photos_idx ON plot_photos (plot_id, position)",
    "CREATE TABLE IF NOT EXISTS plot_likes (plot_id text NOT NULL, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (plot_id, user_id))",
    "INSERT INTO schema_migrations (version) VALUES ('0049_game_chat_gifts_plots') ON CONFLICT DO NOTHING",
  ]],
  ["0050_giftcard_style", [
    "ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS style jsonb",
    "INSERT INTO schema_migrations (version) VALUES ('0050_giftcard_style') ON CONFLICT DO NOTHING",
  ]],
  ["0051_map_heights", [
    "ALTER TABLE map_chunks ADD COLUMN IF NOT EXISTS heights bytea",
    "INSERT INTO schema_migrations (version) VALUES ('0051_map_heights') ON CONFLICT DO NOTHING",
  ]],
  ["0052_contests_friends", [
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS contest_wins integer NOT NULL DEFAULT 0",
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS friend_alert_at timestamptz",
    "CREATE TABLE IF NOT EXISTS build_contests (id bigserial PRIMARY KEY, theme text NOT NULL, host_name text NOT NULL, prize_cents bigint NOT NULL DEFAULT 0, results jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS friends (a bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, b bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, requested_by bigint NOT NULL, status text NOT NULL CHECK (status IN ('pending', 'accepted')), created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz, PRIMARY KEY (a, b), CHECK (a < b))",
    "CREATE INDEX IF NOT EXISTS friends_b_idx ON friends (b)",
    "INSERT INTO schema_migrations (version) VALUES ('0052_contests_friends') ON CONFLICT DO NOTHING",
  ]],
  ["0053_inbox_2fa_anniversaries", [
    "CREATE TABLE IF NOT EXISTS notifications (id bigserial PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind text, title text NOT NULL, body text NOT NULL DEFAULT '', url text NOT NULL DEFAULT '/', tag text, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz)",
    "CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC)",
    "CREATE UNIQUE INDEX IF NOT EXISTS notifications_tag_idx ON notifications (user_id, tag)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup text[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint",
    "CREATE TABLE IF NOT EXISTS login_challenges (token text PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, tries integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS anniversaries (xuid text NOT NULL, years integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (xuid, years))",
    "ALTER TABLE badges ADD COLUMN IF NOT EXISTS auto_key text",
    "CREATE UNIQUE INDEX IF NOT EXISTS badges_auto_key_idx ON badges (auto_key) WHERE auto_key IS NOT NULL",
    "ALTER TABLE badges ADD COLUMN IF NOT EXISTS finish text",
    "INSERT INTO schema_migrations (version) VALUES ('0053_inbox_2fa_anniversaries') ON CONFLICT DO NOTHING",
  ]],
  ["0054_streaks_teams", [
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS freezes integer NOT NULL DEFAULT 0",
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS streak_log jsonb",
    "CREATE TABLE IF NOT EXISTS streak_grants (xuid text NOT NULL, month text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (xuid, month))",
    "CREATE TABLE IF NOT EXISTS teams (id bigserial PRIMARY KEY, name text NOT NULL, tag text NOT NULL, leader_xuid text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE UNIQUE INDEX IF NOT EXISTS teams_tag_idx ON teams (upper(tag))",
    "CREATE UNIQUE INDEX IF NOT EXISTS teams_name_idx ON teams (lower(name))",
    "CREATE TABLE IF NOT EXISTS team_members (team_id bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE, xuid text PRIMARY KEY, joined_at timestamptz NOT NULL DEFAULT now())",
    "CREATE INDEX IF NOT EXISTS team_members_team_idx ON team_members (team_id)",
    "CREATE TABLE IF NOT EXISTS team_invites (team_id bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE, xuid text NOT NULL, invited_by text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (team_id, xuid))",
    "CREATE TABLE IF NOT EXISTS team_messages (id bigserial PRIMARY KEY, team_id bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE, xuid text, name text NOT NULL, content text NOT NULL, from_game boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE INDEX IF NOT EXISTS team_messages_idx ON team_messages (team_id, id DESC)",
    "INSERT INTO schema_migrations (version) VALUES ('0054_streaks_teams') ON CONFLICT DO NOTHING",
  ]],  ["0055_off_topic", [
    "INSERT INTO categories (name, position) SELECT 'Off-Topic', coalesce((SELECT position FROM categories WHERE name = 'Staff'), (SELECT coalesce(max(position), 0) + 1 FROM categories)) WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Off-Topic')",
    "UPDATE categories SET position = (SELECT position FROM categories WHERE name = 'Off-Topic') + 1 WHERE name = 'Staff' AND position <= (SELECT position FROM categories WHERE name = 'Off-Topic')",
    "INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind) SELECT (SELECT id FROM categories WHERE name = 'Off-Topic'), v.slug, v.name, v.topic, v.pos, v.power, 'text' FROM (VALUES ('ot-announcements', 'OT | Announcements', 'Off-topic news from the staff team.', 0, 50), ('ot-general', 'OT | General', 'Chat about anything that isn''t GalaxySMP.', 1, 10), ('ot-media', 'OT | Advertising', 'Share your own videos, streams, channels and projects.', 2, 10)) AS v(slug, name, topic, pos, power) ON CONFLICT (slug) DO NOTHING",
    "INSERT INTO schema_migrations (version) VALUES ('0055_off_topic') ON CONFLICT DO NOTHING",
  ]],  ["0056_threads_voice_slowmode", [
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS thread_root bigint REFERENCES messages(id) ON DELETE CASCADE",
    "CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_root, id) WHERE thread_root IS NOT NULL",
    "CREATE TABLE IF NOT EXISTS message_audio (id bigserial PRIMARY KEY, user_id bigint NOT NULL, mime text NOT NULL, duration_ms integer NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_id bigint REFERENCES message_audio(id) ON DELETE SET NULL",
    "ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS audio_id bigint REFERENCES message_audio(id) ON DELETE SET NULL",
    "ALTER TABLE channels ADD COLUMN IF NOT EXISTS slow_seconds integer NOT NULL DEFAULT 0",
    "ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS official boolean NOT NULL DEFAULT false",
    "INSERT INTO schema_migrations (version) VALUES ('0056_threads_voice_slowmode') ON CONFLICT DO NOTHING",
  ]],
  ["0057_potm", [
    "CREATE TABLE IF NOT EXISTS potm_votes (round integer NOT NULL, voter_xuid text NOT NULL, voter_name text NOT NULL, target_xuid text NOT NULL, target_name text NOT NULL, voted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (round, voter_xuid))",
    "CREATE INDEX IF NOT EXISTS potm_votes_target_idx ON potm_votes (round, target_xuid)",
    "INSERT INTO schema_migrations (version) VALUES ('0057_potm') ON CONFLICT DO NOTHING",
  ]],
  ["0058_bedwars_matches", [
    "CREATE TABLE IF NOT EXISTS bw_matches (id bigserial PRIMARY KEY, started_at timestamptz NOT NULL, seconds integer NOT NULL DEFAULT 0, mode text, winner text, feed jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE INDEX IF NOT EXISTS bw_matches_time_idx ON bw_matches (started_at DESC)",
    "CREATE TABLE IF NOT EXISTS bw_match_players (match_id bigint NOT NULL REFERENCES bw_matches(id) ON DELETE CASCADE, xuid text NOT NULL, name text NOT NULL, team text NOT NULL, kills integer NOT NULL DEFAULT 0, finals integer NOT NULL DEFAULT 0, beds integer NOT NULL DEFAULT 0, won boolean NOT NULL DEFAULT false, PRIMARY KEY (match_id, xuid))",
    "CREATE INDEX IF NOT EXISTS bw_match_players_xuid_idx ON bw_match_players (xuid, match_id DESC)",
    "INSERT INTO schema_migrations (version) VALUES ('0058_bedwars_matches') ON CONFLICT DO NOTHING",
  ]],
  ["0059_screenshots", [
    "ALTER TABLE builds ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'build'",
    "CREATE INDEX IF NOT EXISTS builds_kind_idx ON builds (kind, id DESC) WHERE deleted_at IS NULL",
    "INSERT INTO schema_migrations (version) VALUES ('0059_screenshots') ON CONFLICT DO NOTHING",
  ]],
  ["0060_private_polls", [
    "ALTER TABLE polls ADD COLUMN IF NOT EXISTS private boolean NOT NULL DEFAULT false",
    "INSERT INTO schema_migrations (version) VALUES ('0060_private_polls') ON CONFLICT DO NOTHING",
  ]],
  ["0061_friend_streaks", [
    `CREATE TABLE IF NOT EXISTS friend_streaks (
  a            bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b            bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  length       int NOT NULL DEFAULT 0,
  best         int NOT NULL DEFAULT 0,
  last_day     date,
  started_on   date,
  nudged_at    timestamptz,
  nudged_by    bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  PRIMARY KEY (a, b)
)`,
    "CREATE INDEX IF NOT EXISTS friend_streaks_b ON friend_streaks (b)",
    "INSERT INTO schema_migrations (version) VALUES ('0061_friend_streaks') ON CONFLICT DO NOTHING",
  ]],
  ["0062_merch", [
    `CREATE TABLE IF NOT EXISTS merch_orders (
  id               bigserial PRIMARY KEY,
  user_id          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'awaiting_payment',
  method           text NOT NULL DEFAULT 'card',
  items            jsonb NOT NULL,
  address          jsonb NOT NULL,
  subtotal_cents   integer NOT NULL,
  shipping_cents   integer NOT NULL,
  ship_cost_cents  integer NOT NULL DEFAULT 0,
  total_cents      integer NOT NULL,
  credits_cents    integer NOT NULL DEFAULT 0,
  payment_id       bigint,
  printify_id      text UNIQUE,
  tracking         jsonb,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  paid_at          timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
)`,
    "CREATE INDEX IF NOT EXISTS merch_orders_user ON merch_orders (user_id, id DESC)",
    "ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_check",
    "ALTER TABLE payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('topup', 'item', 'giftcard', 'merch'))",
    "INSERT INTO schema_migrations (version) VALUES ('0062_merch') ON CONFLICT DO NOTHING",
  ]],
  ["0063_links_ratings_packs", [
    `ALTER TABLE channels ADD COLUMN IF NOT EXISTS allow_links boolean NOT NULL DEFAULT false`,
    `UPDATE channels SET allow_links = true, slow_seconds = 1200, topic = 'Share your own videos, streams, channels and projects. Links are allowed; one post every 20 minutes.' WHERE slug = 'ot-media'`,
    `CREATE TABLE IF NOT EXISTS ticket_ratings (
  ticket_id   bigint PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
)`,
    `CREATE INDEX IF NOT EXISTS ticket_ratings_staff ON ticket_ratings (staff_id, created_at DESC)`,
    `ALTER TABLE game_rewards ADD COLUMN IF NOT EXISTS packs jsonb NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS cart jsonb`,
    `ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_check`,
    `ALTER TABLE payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('topup', 'item', 'giftcard', 'merch', 'cart'))`,
    `INSERT INTO schema_migrations (version) VALUES ('0063_links_ratings_packs') ON CONFLICT DO NOTHING`,
  ]],
  ["0064_community_engage", [
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind text",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS meta jsonb",
    "CREATE TABLE IF NOT EXISTS message_thanks (message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, author_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (message_id, user_id))",
    "CREATE INDEX IF NOT EXISTS message_thanks_author ON message_thanks (author_id)",
    "CREATE TABLE IF NOT EXISTS message_waves (message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (message_id, user_id))",
    "CREATE TABLE IF NOT EXISTS chat_xp (user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, xp integer NOT NULL DEFAULT 0, level integer NOT NULL DEFAULT 0, last_at timestamptz, day date, day_xp integer NOT NULL DEFAULT 0)",
    "CREATE INDEX IF NOT EXISTS chat_xp_rank ON chat_xp (xp DESC)",
    "CREATE TABLE IF NOT EXISTS web_activity (user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, day date NOT NULL, minutes integer NOT NULL DEFAULT 0, messages integer NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))",
    "CREATE TABLE IF NOT EXISTS qotd_questions (id bigserial PRIMARY KEY, text text NOT NULL, created_by bigint REFERENCES users(id) ON DELETE SET NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())",
    "INSERT INTO qotd_questions (text) SELECT q FROM unnest(ARRAY['What''s the best block for a starter house, and why?', 'If you could add one new mob to Minecraft, what would it do?', 'What''s the most useful farm you''ve ever built?', 'Nether or the End: where would you rather live?', 'What''s your favorite biome to build in?', 'Diamonds or emeralds: which do you care about more?', 'What was the first thing you ever built on GalaxySMP?', 'If you had a whole day to play, what would you work on first?', 'What''s your go-to food in Minecraft?', 'Which Bedwars team color is the luckiest?', 'What''s one build you''ve always wanted to make but haven''t yet?', 'Creeper, Enderman or Warden: which scares you the most?', 'What''s the best enchantment in the game?', 'Do you like building alone or with friends?', 'What''s your favorite music disc or in-game song?', 'If GalaxySMP had a theme park, what ride would you build?', 'What''s the funniest thing that''s happened to you on the server?', 'Wood or stone houses: which side are you on?', 'What''s your favorite pet or tamed mob?', 'What''s one tip you''d give a brand-new player?', 'If you could only use one tool forever, which would it be?', 'What''s the best way to spend your first night in a new world?', 'Which Minecraft update was your favorite?', 'What''s your dream base: underground, in the sky, or underwater?', 'What''s the rarest item you own right now?', 'What''s a block you think is underrated?', 'Would you rather explore caves or the ocean?', 'What''s your best Bedwars strategy?', 'What color scheme do you use most when building?', 'If you could rename one mob, which one and what would you call it?', 'What''s the longest you''ve ever spent on a single build?', 'Redstone: love it, hate it, or still learning?', 'What''s your favorite thing about the GalaxySMP community?', 'What should the next server event be?', 'Which villager trade is the best?', 'What''s your favorite way to travel: horse, elytra, boat or minecart?', 'What''s one rule you''d add to Minecraft if you could?', 'Build Contest theme idea: what should we build next?', 'What''s the most dangerous thing you''ve survived in game?', 'If you opened a shop in the Shop District, what would you sell?']) q WHERE NOT EXISTS (SELECT 1 FROM qotd_questions)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS community_seen_at timestamptz",
    "INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind) SELECT (SELECT id FROM categories WHERE name = 'Community'), 'bot-commands', 'Bot Commands', 'Chat levels: type !level, !rank or !top. Level-ups show here too.', 6, 10, 'text' ON CONFLICT (slug) DO NOTHING",
    "INSERT INTO schema_migrations (version) VALUES ('0064_community_engage') ON CONFLICT DO NOTHING",
  ]],
];

let ready = null;
export function ensureSchema(env) {
  if (!env.DATABASE_URL) return Promise.resolve();
  ready ||= (async () => {
    const sql = getDb(env);
    const done = new Set((await sql`SELECT version FROM schema_migrations WHERE version = ANY(${PENDING.map((p) => p[0])})`).map((r) => r.version));
    for (const [version, statements] of PENDING) {
      if (done.has(version)) continue;
      for (const s of statements) await sql.query(s);
      console.log("database updated:", version);
    }
  })().catch((e) => { ready = null; console.error("database update failed", e); });
  return ready;
}
