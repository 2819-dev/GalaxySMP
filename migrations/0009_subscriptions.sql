-- Subscriptions (Galaxy+ and Galaxy Pro+). Given by Admins for now; paid checkout comes later.
CREATE TABLE IF NOT EXISTS subscriptions (
  xuid        text PRIMARY KEY REFERENCES players (xuid) ON DELETE CASCADE,
  plan        text NOT NULL CHECK (plan IN ('plus', 'pro')),
  expires_at  timestamptz,
  granted_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
