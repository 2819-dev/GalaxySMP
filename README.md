# GalaxySMP website

Website and community chat for the GalaxySMP Minecraft Bedrock server.

- **Hosting:** Cloudflare Workers (free plan) at https://galaxymc.us (www and the old workers.dev address redirect there). Pages in `public/` (packed into the Worker by `scripts/build-assets.mjs`), back-end code in `src/`.
- **Database:** Neon Postgres. Schema in `migrations/`.
- **Deploy:** `CLOUDFLARE_API_TOKEN=... npx wrangler deploy` (Claude does this after each change).

## Files you might edit

| What | File |
|---|---|
| Server address and port, Realm/server mode, manual status message, game modes | `public/config.js` |
| Rules (short + full) | `public/rules.html` |
| Store ranks | `src/store/catalog.js` |
| Who becomes Admin automatically | `wrangler.jsonc` → `OWNER_USERNAMES` |

## Settings stored in Cloudflare (never in this code)

| Name | What it is |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `PLUGIN_SECRET` | Shared password between the Minecraft plugin and the website (stage b) |

Check that they reached the site: open `/api/health` on the website.

## GalaxyLink plugin (Endstone)

The `/link` command for the Bedrock server lives in `endstone-plugin/` (Python, for
[Endstone](https://github.com/EndstoneMC/endstone) on Bedrock Dedicated Server).

Build: `PLUGIN_SECRET=... endstone-plugin/build.sh out/` produces `endstone_galaxylink-*.whl`.
Install: upload the `.whl` file into the server's `plugins` folder and restart.

The plugin also powers website voice chat: it streams player positions to the
`VoiceHub` Durable Object (`src/voice/hub.js`) over a WebSocket while anyone is in
voice, and shows voice icons before players' names in game. Audio goes through
Cloudflare Realtime (secrets `REALTIME_APP_ID`, `REALTIME_APP_SECRET`).
