-- Pinned messages, custom emoji and player trades.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_by bigint REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS messages_pinned_idx ON messages (channel_id, pinned_at DESC) WHERE pinned_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS emoji (
  name        text PRIMARY KEY CHECK (name ~ '^[a-z0-9_]{2,24}$'),
  mime        text NOT NULL,
  data        text NOT NULL,     -- base64
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trades (
  id           bigserial PRIMARY KEY,
  seller_xuid  text NOT NULL REFERENCES players(xuid) ON DELETE CASCADE,
  buyer_xuid   text NOT NULL REFERENCES players(xuid) ON DELETE CASCADE,
  label        text NOT NULL DEFAULT '',
  item_id      text NOT NULL DEFAULT '',
  amount       integer NOT NULL DEFAULT 1,
  enchants     text[] NOT NULL DEFAULT '{}',
  price_cents  bigint NOT NULL,
  note         text NOT NULL DEFAULT '',
  status       text NOT NULL CHECK (status IN ('creating', 'pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);
CREATE INDEX IF NOT EXISTS trades_seller_idx ON trades (seller_xuid, id DESC);
CREATE INDEX IF NOT EXISTS trades_buyer_idx ON trades (buyer_xuid, id DESC);
CREATE INDEX IF NOT EXISTS trades_pending_idx ON trades (created_at) WHERE status = 'pending';

INSERT INTO schema_migrations (version) VALUES ('0035_pins_emoji_trades') ON CONFLICT DO NOTHING;
