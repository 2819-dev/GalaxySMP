-- Galaxy Cube: a small box that lets console players join (LAN broadcast) and use voice chat.
-- A Cube shows a pairing code; the member types it at galaxymc.us/cube; the Cube gets its own token.
CREATE TABLE IF NOT EXISTS cube_devices (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    text NOT NULL,                 -- the Cube's serial, e.g. CUBE-7F3A
  name         text NOT NULL DEFAULT 'Galaxy Cube',
  model        text NOT NULL DEFAULT 'cube',  -- cube or lite
  token_hash   text NOT NULL UNIQUE,
  firmware     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS cube_devices_user_idx ON cube_devices (user_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS cube_pairings (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,            -- what the Cube shows, e.g. K7Q-29M
  device_id   text NOT NULL,
  model       text NOT NULL DEFAULT 'cube',
  poll_hash   text NOT NULL UNIQUE,
  user_id     bigint REFERENCES users(id) ON DELETE CASCADE,
  claimed_at  timestamptz,                     -- the member typed the code
  picked_up   boolean NOT NULL DEFAULT false,  -- the Cube collected its token
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (version) VALUES ('0046_galaxy_cube') ON CONFLICT DO NOTHING;
