-- Onboarding: the step-by-step welcome every member goes through once on the website.
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded_at    timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rules_agreed_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests       text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio             text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_color   text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS found_via       text;     -- only staff see this
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by      bigint;   -- only staff see this

INSERT INTO schema_migrations (version) VALUES ('0027_onboarding') ON CONFLICT DO NOTHING;
