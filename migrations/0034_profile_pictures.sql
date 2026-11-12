-- Profile picture choice: Minecraft head, Xbox picture, or a custom picture (uploaded by an Admin).
-- 'auto' = the head once the server has sent it, otherwise the Xbox picture (how it worked before).
ALTER TABLE players ADD COLUMN IF NOT EXISTS pic_source text NOT NULL DEFAULT 'auto'
  CHECK (pic_source IN ('auto', 'head', 'xbox', 'custom'));
ALTER TABLE players ADD COLUMN IF NOT EXISTS custom_pic text;        -- base64
ALTER TABLE players ADD COLUMN IF NOT EXISTS custom_pic_type text;
INSERT INTO schema_migrations (version) VALUES ('0034_profile_pictures') ON CONFLICT DO NOTHING;
