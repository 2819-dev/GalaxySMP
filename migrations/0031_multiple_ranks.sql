-- Players can have several ranks (like Discord roles). Their commands combine; only the top
-- rank (in the Rank order) shows as their tag, and website staff powers come from the strongest.
ALTER TABLE player_ranks DROP CONSTRAINT player_ranks_pkey;
ALTER TABLE player_ranks ADD PRIMARY KEY (xuid, rank_id);
CREATE INDEX IF NOT EXISTS player_ranks_rank_idx ON player_ranks (rank_id);

-- Each player's one shown rank: the highest in the Rank order.
CREATE OR REPLACE VIEW player_top_rank AS
  SELECT DISTINCT ON (pr.xuid) pr.xuid, pr.rank_id, pr.assigned_by
    FROM player_ranks pr JOIN ranks r ON r.id = pr.rank_id
   ORDER BY pr.xuid, r.priority, r.position, r.id;

INSERT INTO schema_migrations (version) VALUES ('0031_multiple_ranks') ON CONFLICT DO NOTHING;
