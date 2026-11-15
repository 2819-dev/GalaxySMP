-- Notification inbox: every personal notification is also kept here (the bell at the top of the site).
-- One row per tag (a newer one with the same tag replaces it and is unread again).
CREATE TABLE IF NOT EXISTS notifications (id bigserial PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind text, title text NOT NULL, body text NOT NULL DEFAULT '', url text NOT NULL DEFAULT '/', tag text, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_tag_idx ON notifications (user_id, tag);

-- Optional two-step sign-in (authenticator app codes, RFC 6238), with one-time backup codes (hashed).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint;
CREATE TABLE IF NOT EXISTS login_challenges (token text PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, tries integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());

-- Join anniversaries: each year is celebrated once per player. Badges made automatically have an auto_key.
-- Badge finishes: none, holo, glow, sparkle.
CREATE TABLE IF NOT EXISTS anniversaries (xuid text NOT NULL, years integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (xuid, years));
ALTER TABLE badges ADD COLUMN IF NOT EXISTS auto_key text;
CREATE UNIQUE INDEX IF NOT EXISTS badges_auto_key_idx ON badges (auto_key) WHERE auto_key IS NOT NULL;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS finish text;
INSERT INTO schema_migrations (version) VALUES ('0053_inbox_2fa_anniversaries') ON CONFLICT DO NOTHING;
