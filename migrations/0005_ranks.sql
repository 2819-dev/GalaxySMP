-- In-game ranks: prefix, color, command permissions and an optional website role.
CREATE TABLE ranks (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  prefix        text NOT NULL,
  color         char(1) NOT NULL DEFAULT 'f' CHECK (color ~ '^[0-9a-f]$'),  -- Minecraft color code
  permissions   text[] NOT NULL DEFAULT '{}',
  website_role  smallint REFERENCES roles(id),
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ranks_name_idx ON ranks (lower(name));

-- Every player the server has seen (Xbox ID is permanent; gamertags can change).
CREATE TABLE players (
  xuid        text PRIMARY KEY,
  uuid        uuid,
  gamertag    text NOT NULL,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX players_gamertag_idx ON players (lower(gamertag));
CREATE INDEX players_uuid_idx ON players (uuid);

-- One rank per player.
CREATE TABLE player_ranks (
  xuid         text PRIMARY KEY REFERENCES players(xuid) ON DELETE CASCADE,
  rank_id      integer NOT NULL REFERENCES ranks(id) ON DELETE CASCADE,
  assigned_by  text,
  assigned_at  timestamptz NOT NULL DEFAULT now()
);

-- Remembers when a website role came from a rank, so removing the rank can undo it.
ALTER TABLE users ADD COLUMN role_from_rank boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version) VALUES ('0005_ranks');
