-- How long the bell keeps your notifications: 'day', 'week', 'month', 'all' or 'read' (deleted once read). Also in src/lib/autoschema.js
ALTER TABLE notification_prefs ADD COLUMN IF NOT EXISTS keep text NOT NULL DEFAULT 'month';
INSERT INTO schema_migrations (version) VALUES ('0076_notif_keep') ON CONFLICT DO NOTHING;
