-- Partners (2.96): applications from the /partner page (a private chat, like join requests) and the Network
-- Servers that were set up from them (each has its own revocable token, so the plugin secret is never shared).
CREATE TABLE IF NOT EXISTS partner_requests (
  id            bigserial PRIMARY KEY,
  token         text NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('partner', 'network')),
  name          text NOT NULL,
  contact       text NOT NULL,
  about         text NOT NULL,
  link          text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined')),
  ip_hash       text,
  owner_unread  integer NOT NULL DEFAULT 0,
  req_unread    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);
CREATE INDEX IF NOT EXISTS partner_requests_status_idx ON partner_requests (status, last_at DESC);
CREATE TABLE IF NOT EXISTS partner_request_messages (
  id          bigserial PRIMARY KEY,
  request_id  bigint NOT NULL REFERENCES partner_requests(id) ON DELETE CASCADE,
  from_owner  boolean NOT NULL DEFAULT false,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_request_messages_req_idx ON partner_request_messages (request_id, id);
CREATE TABLE IF NOT EXISTS partner_servers (
  id              bigserial PRIMARY KEY,
  request_id      bigint REFERENCES partner_requests(id) ON DELETE SET NULL,
  name            text NOT NULL,
  token_hash      text NOT NULL UNIQUE,
  token_hint      text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  ops_enabled     boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  players_online  integer NOT NULL DEFAULT 0,
  plugin_version  text
);
INSERT INTO schema_migrations (version) VALUES ('0096_partners') ON CONFLICT DO NOTHING;
