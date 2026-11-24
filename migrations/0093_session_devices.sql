-- Account settings > Signed-in devices: which browser each sign-in is, and when it was last used. Also in src/lib/autoschema.js
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
