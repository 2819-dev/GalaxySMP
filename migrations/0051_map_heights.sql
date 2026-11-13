-- 3D map: the height of the top block of every column, 16x16 per chunk (uint16 little-endian, y + 65; 0 = unknown).
ALTER TABLE map_chunks ADD COLUMN IF NOT EXISTS heights bytea;

INSERT INTO schema_migrations (version) VALUES ('0051_map_heights') ON CONFLICT DO NOTHING;
