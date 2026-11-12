-- Join requests: on How to Join, a new player types their gamertag and chats with the owner (no account needed;
-- a private token in their browser opens the chat). Approving adds the gamertag to the server's allowlist.
CREATE TABLE IF NOT EXISTS join_requests (
  id            bigserial PRIMARY KEY,
  token         text NOT NULL UNIQUE,
  gamertag      text NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'declined')),
  ip_hash       text,
  owner_unread  integer NOT NULL DEFAULT 0,
  req_unread    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);
CREATE INDEX IF NOT EXISTS join_requests_status_idx ON join_requests (status, last_at DESC);
CREATE INDEX IF NOT EXISTS join_requests_gamertag_idx ON join_requests (lower(gamertag));

CREATE TABLE IF NOT EXISTS join_request_messages (
  id          bigserial PRIMARY KEY,
  request_id  bigint NOT NULL REFERENCES join_requests(id) ON DELETE CASCADE,
  from_owner  boolean NOT NULL DEFAULT false,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS join_request_messages_req_idx ON join_request_messages (request_id, id);

INSERT INTO schema_migrations (version) VALUES ('0038_join_requests') ON CONFLICT DO NOTHING;
