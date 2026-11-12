-- One "Updates" channel in the News format (cards with a title, label and formatting).
-- The old #updates chat channel's posts become Updates posts, then that channel is hidden.
ALTER TABLE news_posts DROP CONSTRAINT IF EXISTS news_posts_tag_check;
ALTER TABLE news_posts ADD CONSTRAINT news_posts_tag_check CHECK (tag IN ('news', 'update', 'event', 'store', 'fix', 'recap'));

INSERT INTO news_posts (title, body, tag, author_id, created_at)
SELECT left(coalesce(nullif(trim(regexp_replace(regexp_replace(split_part(m.content, E'\n', 1), '^#+\s*', ''), '^\[[A-Za-z]+\]\s*', '')), ''), 'Update'), 100),
       coalesce(nullif(trim(substr(m.content, length(split_part(m.content, E'\n', 1)) + 1)), ''), m.content),
       CASE WHEN m.content ~* '^#*\s*fix' THEN 'fix' ELSE 'update' END,
       m.user_id, m.created_at
  FROM messages m JOIN channels c ON c.id = m.channel_id
 WHERE c.slug = 'updates' AND c.kind = 'text' AND m.deleted_at IS NULL
 ORDER BY m.id;

UPDATE channels SET slug = 'updates-old', name = 'updates-old', hidden = true WHERE slug = 'updates' AND kind = 'text';
UPDATE channels SET slug = 'updates', name = 'Updates', topic = 'What''s new on GalaxySMP: new features, fixes and the weekly recap.', position = 2
 WHERE slug = 'news';

INSERT INTO schema_migrations (version) VALUES ('0036_merge_news_into_updates') ON CONFLICT DO NOTHING;
