-- Mutes and bans: a reason shown to the member (the old reason columns stay a staff-only note). Also in src/lib/autoschema.js
ALTER TABLE users ADD COLUMN IF NOT EXISTS mute_shown text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_shown text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_mute_shown text;
