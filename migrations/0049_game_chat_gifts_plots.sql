-- #Chat <-> game chat, Auction House price history, gift cards, new player checklist, public plots on the map.
-- (The website also applies this by itself: src/lib/autoschema.js.)
ALTER TABLE messages ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS game_xuid text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS game_name text;
CREATE TABLE IF NOT EXISTS ah_sales (id bigserial PRIMARY KEY, item_id text NOT NULL, label text NOT NULL DEFAULT '',
       amount integer NOT NULL, price_cents bigint NOT NULL, unit_cents bigint NOT NULL, sold_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ah_sales_item_idx ON ah_sales (item_id, sold_at DESC);
CREATE TABLE IF NOT EXISTS gift_cards (id bigserial PRIMARY KEY, code text NOT NULL UNIQUE, design text NOT NULL, amount_cents bigint NOT NULL,
       message text NOT NULL DEFAULT '', from_name text NOT NULL, to_name text NOT NULL DEFAULT '', buyer_id bigint REFERENCES users(id) ON DELETE SET NULL,
       status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'redeemed', 'refunded')),
       redeemed_by bigint REFERENCES users(id) ON DELETE SET NULL, redeemed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('topup', 'item', 'giftcard'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS checklist_claimed_at timestamptz;
CREATE TABLE IF NOT EXISTS plot_showcase (plot_id text PRIMARY KEY, owner_xuid text NOT NULL, caption text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS plot_photos (id bigserial PRIMARY KEY, plot_id text NOT NULL, position integer NOT NULL DEFAULT 0, mime text NOT NULL,
       width integer NOT NULL, height integer NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS plot_photos_idx ON plot_photos (plot_id, position);
CREATE TABLE IF NOT EXISTS plot_likes (plot_id text NOT NULL, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (plot_id, user_id));
INSERT INTO schema_migrations (version) VALUES ('0049_game_chat_gifts_plots') ON CONFLICT DO NOTHING;
