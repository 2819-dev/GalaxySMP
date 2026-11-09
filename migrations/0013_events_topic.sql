-- #Events now shows minigames running on the server.
UPDATE channels SET topic = 'Minigames happening on the server right now.' WHERE slug = 'events';
