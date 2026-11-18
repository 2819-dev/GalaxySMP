-- Marketplace seller ratings (one rating per purchase, by the buyer), the staff to-do list in #Ideas & To-Do,
-- and each player's item collection book.
CREATE TABLE IF NOT EXISTS market_purchases (id bigserial PRIMARY KEY, kind text NOT NULL, ref text NOT NULL, seller_xuid text NOT NULL, seller_name text,
  buyer_xuid text NOT NULL, label text, amount integer, price bigint, rating smallint, rated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (kind, ref));
CREATE INDEX IF NOT EXISTS market_purchases_buyer ON market_purchases (buyer_xuid, created_at DESC);
CREATE INDEX IF NOT EXISTS market_purchases_seller ON market_purchases (seller_xuid) WHERE rating IS NOT NULL;
CREATE TABLE IF NOT EXISTS staff_todos (id bigserial PRIMARY KEY, title text NOT NULL, notes text, assignee_id bigint REFERENCES users(id) ON DELETE SET NULL,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL, done boolean NOT NULL DEFAULT false, done_by bigint REFERENCES users(id) ON DELETE SET NULL,
  done_at timestamptz, source_message bigint, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS player_items (xuid text NOT NULL, item_id text NOT NULL, first_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (xuid, item_id));
INSERT INTO schema_migrations (version) VALUES ('0083_ratings_todo_collection') ON CONFLICT DO NOTHING;
