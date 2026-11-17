-- Streams became Stages (like Discord Stages: speakers + audience, raise hand, screen share). Also in src/lib/autoschema.js
UPDATE categories SET name = 'Voice & Stages' WHERE name = 'Voice & Streams';
UPDATE channels SET slug = 'stages', name = 'Stages', topic = 'Live talks, podcasts and screen shares. Raise your hand to speak.' WHERE slug = 'streams';
INSERT INTO schema_migrations (version) VALUES ('0068_stages') ON CONFLICT DO NOTHING;
