// Players' Minecraft heads as profile pictures on the community website.
// The game server cuts the 8x8 face (+ hat layer) out of each player's skin and sends it here;
// we serve it as a tiny PNG from our own site (no outside skin services, so no trackers).
import { getDb } from "../lib/db.js";
import { HttpError } from "../lib/http.js";

export async function recordHead(env, msg) {
  const xuid = String(msg.xuid || "");
  const rgba = String(msg.rgba || "").toLowerCase();
  if (!/^\d{1,20}$/.test(xuid) || !/^[0-9a-f]{512}$/.test(rgba)) return;
  const sql = getDb(env);
  await sql`UPDATE players SET head = ${rgba}, head_at = now() WHERE xuid = ${xuid} AND head IS DISTINCT FROM ${rgba}`;
}

// Why a player's head couldn't be made (kept so it can be fixed without the server console).
export async function recordHeadError(env, msg) {
  const xuid = String(msg.xuid || "");
  if (!/^\d{1,20}$/.test(xuid)) return;
  const entry = { name: String(msg.name || "").slice(0, 32), reason: String(msg.reason || "").slice(0, 300), info: msg.info || {}, at: new Date().toISOString() };
  if (JSON.stringify(entry).length > 8000) entry.info = { note: "too big" };
  const sql = getDb(env);
  await sql`INSERT INTO economy_config (key, value, updated_by) VALUES ('head_debug', ${JSON.stringify({ [xuid]: entry })}::jsonb, 'server')
            ON CONFLICT (key) DO UPDATE SET value = economy_config.value || EXCLUDED.value, updated_at = now()`;
}

// ---- a tiny PNG encoder (8x8 RGBA) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function deflate(bytes) {
  const cs = new CompressionStream("deflate");
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}
export async function pngFromRgba(hex, size = 8) {
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let i = 0; i < size * 4; i++) raw[y * (size * 4 + 1) + 1 + i] = parseInt(hex.substr((y * size * 4 + i) * 2, 2), 16);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size); dv.setUint32(4, size);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// GET /api/head/:xuid  (public: heads show on public profiles too)
export async function headImage(request, env, ctx, url, params) {
  const xuid = String(params.xuid || "").replace(/\.png$/, "");
  if (!/^\d{1,20}$/.test(xuid)) throw new HttpError(404, "No head.");
  const sql = getDb(env);
  const rows = await sql`SELECT head FROM players WHERE xuid = ${xuid} AND head IS NOT NULL`;
  if (!rows.length) throw new HttpError(404, "No head yet.");
  const png = await pngFromRgba(rows[0].head);
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      // URLs carry ?v=<when it changed>, so a versioned head can be cached for a long time
      "Cache-Control": url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
