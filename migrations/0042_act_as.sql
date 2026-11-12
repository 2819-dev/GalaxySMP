-- "Act as Member" (Control Panel, owner only): a look-only session for another member's account.
-- acting_by = the owner who started it. These sessions can't change anything.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS acting_by bigint;
INSERT INTO schema_migrations (version) VALUES ('0042_act_as') ON CONFLICT DO NOTHING;
