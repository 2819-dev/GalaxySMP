-- Gifts from the website Store (credits, items and plans; never in-game gifting), for the Gifter badges.
-- paid = the giver paid with their own credits or a card. Free gifts only count when they come from the owner.
CREATE TABLE IF NOT EXISTS store_gifts (
  id           bigserial PRIMARY KEY,
  giver_id     bigint NOT NULL,
  receiver_id  bigint NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('credits', 'item', 'plan')),
  item         text,
  cents        bigint NOT NULL DEFAULT 0,
  paid         boolean NOT NULL DEFAULT true,
  source_ref   text UNIQUE,                 -- e.g. ledger:123, payment:45 (so nothing is counted twice)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_gifts_giver_idx ON store_gifts (giver_id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gift_to bigint;

-- gifts made before this: members' credit gifts (paid), and the owner's free credit gifts
INSERT INTO store_gifts (giver_id, receiver_id, kind, cents, paid, source_ref, created_at)
SELECT l.user_id, l.ref::bigint, 'credits', -l.delta_cents, true, 'ledger:' || l.id, l.created_at
  FROM credit_ledger l WHERE l.reason = 'gift_out' AND l.ref ~ '^[0-9]+$'
ON CONFLICT (source_ref) DO NOTHING;
INSERT INTO store_gifts (giver_id, receiver_id, kind, cents, paid, source_ref, created_at)
SELECT l.ref::bigint, l.user_id, 'credits', l.delta_cents, false, 'ledger:' || l.id, l.created_at
  FROM credit_ledger l WHERE l.reason = 'staff' AND l.delta_cents > 0 AND l.detail LIKE 'Gift from %' AND l.ref ~ '^[0-9]+$'
ON CONFLICT (source_ref) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('0040_store_gifts') ON CONFLICT DO NOTHING;
