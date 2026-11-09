-- Extra plots a player has (bought for $1.00 when payments open, or given by Admins).
ALTER TABLE players ADD COLUMN IF NOT EXISTS extra_plots integer NOT NULL DEFAULT 0;
