-- #Auction House becomes #Marketplace (Auction House, Player Shops, Trades and Jobs as tabs); #Jobs moves inside it.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check CHECK (kind IN ('text', 'info', 'events', 'auction', 'suggestions', 'voice', 'support', 'news', 'polls', 'builds', 'team', 'timeline', 'applications', 'stafflogs', 'reports', 'shifts', 'jobs', 'streams', 'marketplace'));
UPDATE channels SET slug = 'marketplace', name = 'Marketplace', kind = 'marketplace', topic = 'Buy, sell, trade and find work.' WHERE slug = 'auction-house';
UPDATE channels SET hidden = true WHERE slug = 'jobs' AND kind = 'jobs';
INSERT INTO schema_migrations (version) VALUES ('0081_marketplace') ON CONFLICT DO NOTHING;
