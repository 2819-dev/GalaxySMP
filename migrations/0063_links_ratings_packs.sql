-- Ad channel links + 20 min slow mode, ticket ratings, item packs in the rewards queue.
-- Also applied automatically by src/lib/autoschema.js
ALTER TABLE channels ADD COLUMN IF NOT EXISTS allow_links boolean NOT NULL DEFAULT false;
UPDATE channels SET allow_links = true, slow_seconds = 1200, topic = 'Share your own videos, streams, channels and projects. Links are allowed; one post every 20 minutes.' WHERE slug = 'ot-media';
CREATE TABLE IF NOT EXISTS ticket_ratings (
  ticket_id   bigint PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_ratings_staff ON ticket_ratings (staff_id, created_at DESC);
ALTER TABLE game_rewards ADD COLUMN IF NOT EXISTS packs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cart jsonb;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('topup', 'item', 'giftcard', 'merch', 'cart'));
INSERT INTO schema_migrations (version) VALUES ('0063_links_ratings_packs') ON CONFLICT DO NOTHING;
