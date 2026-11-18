-- Auction House price alerts: tell a player when an item is listed at or below the price (each) they chose.
CREATE TABLE IF NOT EXISTS ah_alerts (id bigserial PRIMARY KEY, xuid text NOT NULL, item_id text NOT NULL, label text NOT NULL,
  max_each bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (xuid, item_id));
CREATE TABLE IF NOT EXISTS ah_alert_hits (alert_id bigint NOT NULL REFERENCES ah_alerts(id) ON DELETE CASCADE, listing_id bigint NOT NULL,
  at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (alert_id, listing_id));
INSERT INTO schema_migrations (version) VALUES ('0080_ah_alerts') ON CONFLICT DO NOTHING;
