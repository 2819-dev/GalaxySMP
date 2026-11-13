-- Gift cards are built from parts (background, artwork, foil, greeting). (Also applied by src/lib/autoschema.js.)
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS style jsonb;
