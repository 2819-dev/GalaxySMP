-- Rank icons, and the economy: balances (sent by the server for the leaderboard) and shop prices.
ALTER TABLE ranks ADD COLUMN IF NOT EXISTS icon text;

ALTER TABLE players ADD COLUMN IF NOT EXISTS balance_cents bigint;
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_op boolean NOT NULL DEFAULT false;
ALTER TABLE players ADD COLUMN IF NOT EXISTS balance_at timestamptz;
CREATE INDEX IF NOT EXISTS players_balance_idx ON players (balance_cents DESC) WHERE balance_cents IS NOT NULL;

CREATE TABLE IF NOT EXISTS economy_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
