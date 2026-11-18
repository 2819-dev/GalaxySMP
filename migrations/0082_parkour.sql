-- Parkour courses and best times (sent by the Minecraft server), shown in Leaderboards > Parkour.
CREATE TABLE IF NOT EXISTS parkour_courses (name text PRIMARY KEY, checkpoints integer NOT NULL DEFAULT 0, reward bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS parkour_times (course text NOT NULL, xuid text NOT NULL, name text NOT NULL, best_ms integer NOT NULL, finishes integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (course, xuid));
INSERT INTO schema_migrations (version) VALUES ('0082_parkour') ON CONFLICT DO NOTHING;
