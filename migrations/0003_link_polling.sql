-- Lets the browser that asked for a link code log in automatically once the
-- player types /link in game. Only a SHA-256 hash of the poll token is stored.
ALTER TABLE link_codes ADD COLUMN poll_token_hash text;
ALTER TABLE link_codes ADD COLUMN login_claimed_at timestamptz;
CREATE INDEX link_codes_requested_idx ON link_codes (lower(requested_name), created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('0003_link_polling');
