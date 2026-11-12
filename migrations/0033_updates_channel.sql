-- #Updates: minor announcements (staff post, members read and react). Quieter than #Announcements:
-- its notifications are their own setting ("Minor updates"), off unless a member turns it on.
UPDATE channels SET position = 3 WHERE slug = 'news';
UPDATE channels SET position = 4 WHERE slug = 'events';
INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind)
SELECT category_id, 'updates', 'Updates', 'Small updates: fixes, tweaks and quick news.', 2, 50, 'text' FROM channels WHERE slug = 'announcements'
ON CONFLICT (slug) DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('0033_updates_channel') ON CONFLICT DO NOTHING;
