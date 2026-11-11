-- Real names, added by staff in the Control Panel. Shown on profile cards next to the username,
-- unless the member hides it in Account > Privacy (then only they and staff see it).
ALTER TABLE users ADD COLUMN IF NOT EXISTS real_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS real_name_hidden boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version) VALUES ('0026_real_names') ON CONFLICT DO NOTHING;
