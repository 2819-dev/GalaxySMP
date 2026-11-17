-- #Suggestions: "Already implemented" (the idea already exists; shown in the Done tab). Also in src/lib/autoschema.js
ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS suggestions_status_check;
ALTER TABLE suggestions ADD CONSTRAINT suggestions_status_check CHECK (status IN ('open', 'planned', 'progress', 'done', 'implemented', 'declined', 'duplicate'));
INSERT INTO schema_migrations (version) VALUES ('0071_suggestion_implemented') ON CONFLICT DO NOTHING;
