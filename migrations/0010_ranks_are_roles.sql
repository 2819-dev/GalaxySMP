-- Ranks are now the only roles. The VIP website role is retired: a rank's staff powers are None, Moderator or Admin.
UPDATE ranks SET website_role = NULL WHERE website_role = 2;
UPDATE users SET role_id = 1, role_from_rank = false WHERE role_id = 2;
