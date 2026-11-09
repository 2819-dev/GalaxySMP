-- Allow Bedrock-only color codes for ranks (g, h, i, j, m, n, p, q, s, t, u, v).
ALTER TABLE ranks DROP CONSTRAINT IF EXISTS ranks_color_check;
ALTER TABLE ranks ADD CONSTRAINT ranks_color_check CHECK (color ~ '^[0-9a-fghijmnpqstuv]$');
