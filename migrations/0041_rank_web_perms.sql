-- Website permissions per rank (Control Panel > Ranks > edit a rank), replacing the fixed Moderator/Admin
-- staff powers. Every rank starts with none; the owner ticks what each rank can do.
ALTER TABLE ranks ADD COLUMN IF NOT EXISTS web_perms text[] NOT NULL DEFAULT '{}';
UPDATE ranks SET website_role = NULL;
INSERT INTO schema_migrations (version) VALUES ('0041_rank_web_perms') ON CONFLICT DO NOTHING;
