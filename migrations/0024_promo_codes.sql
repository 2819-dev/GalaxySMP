-- Promo codes for the Store (made in the Control Panel > Promo codes).
CREATE TABLE IF NOT EXISTS promo_codes (
  id           bigserial PRIMARY KEY,
  code         text NOT NULL UNIQUE,                  -- stored in CAPITALS
  kind         text NOT NULL CHECK (kind IN ('percent', 'amount', 'free', 'first_month')),
  value        integer NOT NULL DEFAULT 0,            -- percent (1-99) or cents off
  targets      text[] NOT NULL DEFAULT '{}',          -- 'subs', 'plan:plus', 'shop', 'cat:cosmetics', 'item:trail_hearts'
  members      bigint[],                              -- website user ids; NULL = anyone with the code
  max_uses     integer,                               -- total uses (NULL = unlimited)
  per_player   integer,                               -- uses per player (NULL = unlimited)
  expires_at   timestamptz,
  active       boolean NOT NULL DEFAULT true,
  note         text,
  created_by   bigint,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id           bigserial PRIMARY KEY,
  promo_id     bigint NOT NULL REFERENCES promo_codes (id) ON DELETE CASCADE,
  user_id      bigint NOT NULL,
  item         text NOT NULL,
  option       text,
  price_cents  integer NOT NULL,
  final_cents  integer NOT NULL,
  status       text NOT NULL DEFAULT 'used' CHECK (status IN ('pending', 'used', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promo_redemptions_promo_idx ON promo_redemptions (promo_id, user_id);

INSERT INTO schema_migrations (version) VALUES ('0024_promo_codes') ON CONFLICT DO NOTHING;
