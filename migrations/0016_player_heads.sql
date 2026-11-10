-- Players' Minecraft heads (8x8 face + hat layer from their skin, sent by the server) for community profile pictures.
ALTER TABLE players ADD COLUMN IF NOT EXISTS head text;          -- 8x8 RGBA as hex (512 characters)
ALTER TABLE players ADD COLUMN IF NOT EXISTS head_at timestamptz;
INSERT INTO schema_migrations (version) VALUES ('0016_player_heads') ON CONFLICT DO NOTHING;
