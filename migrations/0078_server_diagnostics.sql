-- Server diagnostics from the plugin (for troubleshooting): the console (3 days), grouped errors (30 days),
-- health readings every minute (3 days) and start/stop events (30 days).
CREATE TABLE IF NOT EXISTS server_console (id bigserial PRIMARY KEY, at timestamptz NOT NULL, level text NOT NULL DEFAULT 'INFO', text text NOT NULL);
CREATE INDEX IF NOT EXISTS server_console_at_idx ON server_console (at);
CREATE TABLE IF NOT EXISTS server_errors (sig text PRIMARY KEY, level text NOT NULL, message text NOT NULL, detail text NOT NULL, count int NOT NULL DEFAULT 0,
  first_at timestamptz NOT NULL, last_at timestamptz NOT NULL, fixed_at timestamptz);
CREATE TABLE IF NOT EXISTS server_health (at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS server_health_at_idx ON server_health (at);
CREATE TABLE IF NOT EXISTS server_events (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, data jsonb NOT NULL DEFAULT '{}');
INSERT INTO schema_migrations (version) VALUES ('0078_server_diagnostics') ON CONFLICT DO NOTHING;
