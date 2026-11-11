-- Galaxy Credits (a Store balance players top up and spend) and card payments through Stripe.
ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_cents bigint NOT NULL DEFAULT 0;

-- Every change to a balance, so it always adds up.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL,
  delta_cents bigint NOT NULL,
  reason      text NOT NULL,            -- topup, purchase, gift_in, gift_out, refund, staff
  detail      text,
  ref         text,                     -- payment id, item id, other member...
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, id DESC);

-- Card payments (Stripe Checkout). One row per checkout started.
CREATE TABLE IF NOT EXISTS payments (
  id             bigserial PRIMARY KEY,
  user_id        bigint NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('topup', 'item')),
  item           text,                  -- pack id or Shop item id
  option         text,
  promo_id       bigint,
  amount_cents   integer NOT NULL,      -- what the card is charged
  credit_cents   integer NOT NULL DEFAULT 0,  -- top-ups: credit added (with bonus)
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  stripe_session text UNIQUE,
  payment_intent text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments (user_id, id DESC);
CREATE INDEX IF NOT EXISTS payments_intent_idx ON payments (payment_intent);


-- A promo used on a card payment counts once the payment goes through.
ALTER TABLE promo_redemptions ADD COLUMN IF NOT EXISTS payment_id bigint;

INSERT INTO schema_migrations (version) VALUES ('0025_credits_payments') ON CONFLICT DO NOTHING;
