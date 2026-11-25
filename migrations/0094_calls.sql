-- Calls (2.90): a call's line in the DM conversation ("Call · 12 min", "Missed call", "Declined").
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS call jsonb;
INSERT INTO schema_migrations (version) VALUES ('0094_calls') ON CONFLICT DO NOTHING;
