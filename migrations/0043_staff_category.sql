-- Staff category in Community: channels only members with the "See the Staff category" permission can see.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS staff_only boolean NOT NULL DEFAULT false;
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check
  CHECK (kind IN ('text', 'info', 'events', 'auction', 'suggestions', 'voice', 'support', 'news', 'polls', 'builds',
                  'team', 'timeline', 'applications', 'stafflogs', 'reports'));

INSERT INTO categories (name, position)
SELECT 'Staff', (SELECT coalesce(max(position), 0) + 1 FROM categories)
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Staff');

INSERT INTO channels (category_id, slug, name, topic, position, min_post_power, kind, staff_only)
SELECT (SELECT id FROM categories WHERE name = 'Staff'), v.slug, v.name, v.topic, v.pos, v.power, v.kind, true
  FROM (VALUES
    ('staff-announcements', 'Staff Announcements', 'Important news for the staff team.', 0, 50, 'text'),
    ('staff-chat', 'Staff Chat', 'Talk with the rest of the staff team.', 1, 10, 'text'),
    ('staff-logs', 'Staff Logs', 'Bans, mutes, kicks, warnings and rollbacks, from the website and the game.', 2, 100, 'stafflogs'),
    ('reports', 'Reports', 'Open player and chat reports.', 3, 100, 'reports'),
    ('ideas-todo', 'Ideas & To-Do', 'Plan updates and events together.', 4, 10, 'text')
  ) AS v(slug, name, topic, pos, power, kind)
ON CONFLICT (slug) DO NOTHING;

-- Ranks that open the Mod Panel can see the Staff category to start with (change it per rank in Control Panel > Ranks).
UPDATE ranks SET web_perms = array_append(web_perms, 'staff_chat')
 WHERE 'mod_panel' = ANY(web_perms) AND NOT ('staff_chat' = ANY(web_perms));

INSERT INTO schema_migrations (version) VALUES ('0043_staff_category') ON CONFLICT DO NOTHING;
