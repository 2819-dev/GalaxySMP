-- Linking from the game (Main Menu > Link Account): the plugin asks for a code, the player opens
-- galaxymc.us/join?game=CODE (or scans the QR code), picks a password and their account is made and linked.
CREATE TABLE IF NOT EXISTS game_link_codes (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  mc_uuid     uuid NOT NULL,
  xuid        text,
  name        text NOT NULL,
  bedrock     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX IF NOT EXISTS game_link_codes_uuid_idx ON game_link_codes (mc_uuid) WHERE used_at IS NULL;
INSERT INTO schema_migrations (version) VALUES ('0089_game_link_codes') ON CONFLICT DO NOTHING;
