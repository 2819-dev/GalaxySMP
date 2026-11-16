-- Merch orders (Printify). Also applied automatically by src/lib/autoschema.js
CREATE TABLE IF NOT EXISTS merch_orders (
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
);
CREATE INDEX IF NOT EXISTS merch_orders_user ON merch_orders (user_id, id DESC);
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('topup', 'item', 'giftcard', 'merch'));
INSERT INTO schema_migrations (version) VALUES ('0062_merch') ON CONFLICT DO NOTHING;
