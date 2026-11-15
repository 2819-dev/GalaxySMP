-- Player of the Month: secret votes from the Voting Computers in game. Only the owner sees who voted for who.
CREATE TABLE IF NOT EXISTS potm_votes (
  round        integer NOT NULL,
  voter_xuid   text NOT NULL,
  voter_name   text NOT NULL,
  target_xuid  text NOT NULL,
  target_name  text NOT NULL,
  voted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round, voter_xuid)
);
CREATE INDEX IF NOT EXISTS potm_votes_target_idx ON potm_votes (round, target_xuid);
INSERT INTO schema_migrations (version) VALUES ('0057_potm') ON CONFLICT DO NOTHING;
