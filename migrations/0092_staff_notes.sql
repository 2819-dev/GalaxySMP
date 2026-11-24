-- Private staff notes on members (member card > Moderate). Also in src/lib/autoschema.js
CREATE TABLE IF NOT EXISTS staff_notes (id bigserial PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, author_id bigint REFERENCES users(id) ON DELETE SET NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS staff_notes_user_idx ON staff_notes (user_id, created_at DESC);
