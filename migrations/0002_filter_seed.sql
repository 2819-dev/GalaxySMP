-- Starter word list for the chat filter. Staff can add/remove words on the
-- Staff page later; this only seeds the first version.
-- 'contains' words are blocked even when hidden inside other letters.
-- 'word' words are only blocked on their own (avoids blocking "class", "Scunthorpe", etc.).

INSERT INTO filter_words (word, match) VALUES
  ('fuck', 'contains'), ('shit', 'contains'), ('bitch', 'contains'), ('cunt', 'contains'),
  ('whore', 'contains'), ('slut', 'contains'), ('dick', 'word'), ('dickhead', 'contains'),
  ('cock', 'word'), ('pussy', 'contains'), ('penis', 'contains'), ('vagina', 'contains'),
  ('ass', 'word'), ('asshole', 'contains'), ('arse', 'word'), ('bastard', 'contains'),
  ('damn', 'word'), ('crap', 'word'), ('piss', 'word'), ('wank', 'contains'),
  ('wanker', 'contains'), ('twat', 'contains'), ('bollocks', 'contains'), ('bullshit', 'contains'),
  ('motherfucker', 'contains'), ('fck', 'word'), ('fuk', 'word'), ('fuq', 'word'),
  ('stfu', 'word'), ('wtf', 'word'), ('omfg', 'word'), ('porn', 'contains'),
  ('sex', 'word'), ('sexy', 'word'), ('nude', 'word'), ('nudes', 'word'), ('boobs', 'contains'),
  ('tits', 'word'), ('horny', 'contains'), ('rape', 'word'), ('rapist', 'contains'),
  ('nigger', 'contains'), ('nigga', 'contains'), ('faggot', 'contains'), ('fag', 'word'),
  ('retard', 'contains'), ('retarded', 'contains'), ('tranny', 'contains'), ('spic', 'word'),
  ('chink', 'word'), ('kike', 'word'), ('dyke', 'word'),
  ('kys', 'word'), ('killyourself', 'contains'),
  ('snapchat', 'contains'), ('instagram', 'contains'), ('tiktok', 'contains'),
  ('whatsapp', 'contains'), ('telegram', 'word'), ('kik', 'word')
ON CONFLICT (word) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('0002_filter_seed');
