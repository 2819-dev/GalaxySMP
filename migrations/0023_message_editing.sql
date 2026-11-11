-- Editing messages before anyone has read them: when another member first saw a message, and when it was edited.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS seen_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
-- everything already sent counts as read
UPDATE messages SET seen_at = created_at WHERE seen_at IS NULL;
UPDATE dm_messages SET read_at = created_at WHERE read_at IS NULL;
INSERT INTO schema_migrations (version) VALUES ('0023_message_editing') ON CONFLICT DO NOTHING;
