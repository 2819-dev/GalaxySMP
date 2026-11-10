-- Display priority for ranks (1 = highest, 255 = lowest). A player with a rank and a Galaxy+/Pro+ plan
-- shows only the tag with the best (lowest) priority, above their head and in chat.
ALTER TABLE ranks ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 255);
UPDATE ranks SET priority = 1 WHERE lower(name) = 'owner';
UPDATE ranks SET priority = 10 WHERE lower(name) = 'admin';
INSERT INTO economy_config (key, value, updated_by) VALUES ('plan_priority', '{"pro": 50, "plus": 60}'::jsonb, 'setup') ON CONFLICT (key) DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('0020_rank_priority') ON CONFLICT DO NOTHING;
