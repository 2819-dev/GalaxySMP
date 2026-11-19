-- Which loading screens each member has seen (Loading screens collection on profiles).
CREATE TABLE IF NOT EXISTS user_loading_screens (user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, screen text NOT NULL,
  first_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, screen));
INSERT INTO schema_migrations (version) VALUES ('0084_loading_screens') ON CONFLICT DO NOTHING;
