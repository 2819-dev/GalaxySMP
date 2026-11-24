-- My Pets on profiles: the Dumplings, Blubs and Penguins players tamed (sent by the plugin). Also in src/lib/autoschema.js
CREATE TABLE IF NOT EXISTS game_pets (xuid text NOT NULL, pet_id text NOT NULL, kind text NOT NULL, name text, color text, tamed_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (xuid, pet_id));
