-- Where each member stopped reading in each channel (unread counts and @mention badges in Community).
CREATE TABLE IF NOT EXISTS channel_reads (user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, channel_id integer NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_id bigint NOT NULL DEFAULT 0, PRIMARY KEY (user_id, channel_id));
INSERT INTO schema_migrations (version) VALUES ('0079_channel_reads') ON CONFLICT DO NOTHING;
