-- Voice chat: staff voice mutes and Global Mic permission.
ALTER TABLE users ADD COLUMN voice_muted_until timestamptz;
ALTER TABLE users ADD COLUMN voice_mute_reason text;
ALTER TABLE users ADD COLUMN global_mic boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version) VALUES ('0004_voice');
