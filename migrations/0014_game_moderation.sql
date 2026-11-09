-- In-game moderation: player reports made with /report, and warnings/mutes/kicks/bans given with /mod.
CREATE TABLE IF NOT EXISTS game_reports (
  id             bigserial PRIMARY KEY,
  reporter_xuid  text,
  reporter_name  text NOT NULL,
  target_xuid    text,
  target_name    text NOT NULL,
  reason         text NOT NULL,
  details        text NOT NULL DEFAULT '',
  world          text,
  x              integer,
  y              integer,
  z              integer,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_by    text,
  resolved_at    timestamptz,
  resolution     text
);
CREATE INDEX IF NOT EXISTS game_reports_status_idx ON game_reports (status, created_at);

CREATE TABLE IF NOT EXISTS game_punishments (
  id           bigserial PRIMARY KEY,
  xuid         text,
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('warn', 'mute', 'unmute', 'kick', 'ban', 'unban')),
  reason       text NOT NULL DEFAULT '',
  minutes      integer,                 -- mutes and bans; NULL = permanent ban
  by_name      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_punishments_xuid_idx ON game_punishments (xuid, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('0014_game_moderation') ON CONFLICT DO NOTHING;
