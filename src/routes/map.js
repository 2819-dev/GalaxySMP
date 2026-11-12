// Live server map (galaxymc.us/map). The plugin sends the colour of the top block of each column,
// 16 x 16 per chunk; we keep them and serve 256 x 256 block regions as raw RGBA for the page to draw.
// Who is online (and where) and the markers (spawn, plots, shops) come live from the plugin.
import { Buffer } from "node:buffer";
import { getDb } from "../lib/db.js";
import { json } from "../lib/http.js";
import { voiceStub } from "./voice.js";

const REGION = 16; // chunks per region side (256 blocks)

// From the plugin (through the voice hub): store drawn chunks.
export async function recordChunks(env, msg) {
  const chunks = (Array.isArray(msg.chunks) ? msg.chunks : []).slice(0, 64).filter((c) =>
    Number.isInteger(c.cx) && Number.isInteger(c.cz) && Math.abs(c.cx) < 2e6 && Math.abs(c.cz) < 2e6 && typeof c.rgb === "string" && c.rgb.length === 1024);
  if (!chunks.length) return;
  const sql = getDb(env);
  await sql.transaction(chunks.map((c) => sql`
    INSERT INTO map_chunks (dim, cx, cz, rgb, updated_at) VALUES ('overworld', ${c.cx}, ${c.cz}, decode(${c.rgb}, 'base64'), now())
    ON CONFLICT (dim, cx, cz) DO UPDATE SET rgb = EXCLUDED.rgb, updated_at = now()`));
}

// GET /api/map/info: which regions have land, and the live players + markers.
export async function mapInfo(request, env) {
  const sql = getDb(env);
  const [regions, live] = await Promise.all([
    sql`SELECT floor(cx::numeric / ${REGION})::int AS rx, floor(cz::numeric / ${REGION})::int AS rz, count(*)::int AS n, extract(epoch FROM max(updated_at))::bigint AS at
          FROM map_chunks WHERE dim = 'overworld' GROUP BY 1, 2`,
    voiceStub(env).fetch("https://voice/internal/map").then((r) => r.json()).catch(() => ({})),
  ]);
  return json({
    ok: true, regionSize: REGION * 16,
    regions: regions.map((r) => ({ rx: r.rx, rz: r.rz, chunks: r.n, v: Number(r.at) })),
    players: live.players || [], playersAt: live.playersAt || null,
    markers: live.markers || [], plots: live.plots || [],
  }, 200, { "Cache-Control": "no-store" });
}

// GET /api/map/region/:rx/:rz  → 256 x 256 RGBA (transparent where nothing is drawn yet)
export async function mapRegion(request, env, ctx, url, params) {
  const rx = Number(params.rx), rz = Number(params.rz);
  if (!Number.isInteger(rx) || !Number.isInteger(rz) || Math.abs(rx) > 1e5 || Math.abs(rz) > 1e5) return new Response("Bad region", { status: 400 });
  const sql = getDb(env);
  const rows = await sql`
    SELECT cx, cz, encode(rgb, 'base64') AS b64 FROM map_chunks
     WHERE dim = 'overworld' AND cx BETWEEN ${rx * REGION} AND ${rx * REGION + REGION - 1} AND cz BETWEEN ${rz * REGION} AND ${rz * REGION + REGION - 1}`;
  const size = REGION * 16;
  const out = new Uint8Array(size * size * 4);
  for (const r of rows) {
    const rgb = Buffer.from(r.b64, "base64");
    if (rgb.length !== 768) continue;
    const ox = (r.cx - rx * REGION) * 16, oz = (r.cz - rz * REGION) * 16;
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 16; i++) {
        const s = (j * 16 + i) * 3, d = ((oz + j) * size + ox + i) * 4;
        if (rgb[s] === 0 && rgb[s + 1] === 0 && rgb[s + 2] === 0) continue;
        out[d] = rgb[s]; out[d + 1] = rgb[s + 1]; out[d + 2] = rgb[s + 2]; out[d + 3] = 255;
      }
    }
  }
  // The page adds ?v=<last update>, so a region can be cached until it changes.
  return new Response(out, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": url.searchParams.get("v") ? "public, max-age=86400" : "no-store" } });
}
