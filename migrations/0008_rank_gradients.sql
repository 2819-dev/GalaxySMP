-- Optional gradient for a rank (one color per letter), e.g. 'galaxy'.
ALTER TABLE ranks ADD COLUMN IF NOT EXISTS gradient text;
