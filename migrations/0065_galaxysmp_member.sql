-- GalaxySMP as a real (bot) member: posts the Question of the Day, welcomes, level-ups and official posts.
-- Nobody can sign in to it. Also applied automatically by src/lib/autoschema.js
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;
INSERT INTO users (mc_uuid, username, username_lower, platform, password_hash, is_bot, bio, onboarded_at, show_activity) SELECT '00000000-0000-4000-8000-00000000b075'::uuid, 'GalaxySMP', 'galaxysmp', 'bedrock', crypt(gen_random_uuid()::text, gen_salt('bf')), true, 'The official GalaxySMP account. I post the Question of the Day, welcome new players and answer !commands in #Bot Commands. Add GalaxyPRO#9842 as a friend on Xbox to join GalaxySMP from the Friends tab.', now(), false WHERE NOT EXISTS (SELECT 1 FROM users WHERE username_lower = 'galaxysmp');
UPDATE users SET is_bot = true WHERE username_lower = 'galaxysmp' AND mc_uuid = '00000000-0000-4000-8000-00000000b075'::uuid;
UPDATE messages SET user_id = (SELECT id FROM users WHERE is_bot ORDER BY id LIMIT 1), game_name = NULL WHERE kind IS NOT NULL AND user_id IS NULL AND game_xuid IS NULL;
INSERT INTO schema_migrations (version) VALUES ('0065_galaxysmp_member') ON CONFLICT DO NOTHING;
