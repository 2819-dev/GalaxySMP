-- Xbox profile pictures (shown in the community until a player's Minecraft head arrives),
-- Store purchases, extra shop plots, Night Vision and cosmetics.
ALTER TABLE players ADD COLUMN IF NOT EXISTS gamerpic        text;          -- base64 picture
ALTER TABLE players ADD COLUMN IF NOT EXISTS gamerpic_type   text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS gamerpic_at     timestamptz;
ALTER TABLE players ADD COLUMN IF NOT EXISTS gamerpic_tried  timestamptz;
ALTER TABLE players ADD COLUMN IF NOT EXISTS extra_shop_plots integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS night_vision_until timestamptz;
ALTER TABLE players ADD COLUMN IF NOT EXISTS cosmetics       text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS shop_orders (
  id          bigserial PRIMARY KEY,
  xuid        text NOT NULL,
  item        text NOT NULL,
  option      text,
  price_cents integer NOT NULL DEFAULT 0,
  source      text NOT NULL DEFAULT 'staff',     -- 'staff' (given in the panel) or 'payment'
  given_by    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_orders_xuid_idx ON shop_orders (xuid, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('0018_store_and_gamerpics') ON CONFLICT DO NOTHING;
