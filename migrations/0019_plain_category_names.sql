-- Plain category names (the website draws its own icons instead of emojis).
UPDATE categories SET name = 'Information' WHERE name LIKE '%Information%';
UPDATE categories SET name = 'General' WHERE name LIKE '%General%';
INSERT INTO schema_migrations (version) VALUES ('0019_plain_category_names') ON CONFLICT DO NOTHING;
