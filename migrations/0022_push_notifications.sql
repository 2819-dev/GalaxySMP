-- Phone/computer notifications (Web Push) and each member's notification preferences.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  device      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id     bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs       jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- the day each player last claimed /daily (sent by the plugin), for the reward reminder
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_daily date;

INSERT INTO schema_migrations (version) VALUES ('0022_push_notifications') ON CONFLICT DO NOTHING;
