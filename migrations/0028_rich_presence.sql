-- Rich presence ("Playing ..." on profile cards, like Discord).
ALTER TABLE players ADD COLUMN IF NOT EXISTS session_start timestamptz;           -- when they joined the server this time
ALTER TABLE users   ADD COLUMN IF NOT EXISTS show_activity boolean NOT NULL DEFAULT true; -- Account > Privacy
ALTER TABLE users   ADD COLUMN IF NOT EXISTS custom_presence jsonb;              -- the owner's own status (Control Panel)

-- Xbox Live presence from OpenXBL, saved for a few minutes so we stay inside its rate limit.
CREATE TABLE IF NOT EXISTS xbl_presence (
  xuid       text PRIMARY KEY,
  data       jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('0028_rich_presence') ON CONFLICT DO NOTHING;
