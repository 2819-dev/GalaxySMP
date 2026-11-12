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

// The picture URL for a player row (needs xuid, head_at and gamerpic_at). Players whose Minecraft
// head hasn't arrived yet get their Xbox profile picture instead ("g=1"), fetched once by us.
export function headUrlFor(p) {
  if (!p?.xuid) return null;
  if (p.head_at) return `/api/head/${p.xuid}?v=${new Date(p.head_at).getTime()}`;
  return `/api/head/${p.xuid}?g=1&v=${p.gamerpic_at ? new Date(p.gamerpic_at).getTime() : 0}`;
}

// Xbox profile picture through OpenXBL (key in the Cloudflare secret XBL_API_KEY).
// Fetched at most once a day per player; the picture itself is saved and served from galaxymc.us.
async function fetchGamerpic(env, sql, xuid) {
  const [row] = await sql`
    UPDATE players SET gamerpic_tried = now()
     WHERE xuid = ${xuid} AND (gamerpic_tried IS NULL OR gamerpic_tried < now() - interval '1 day')
     RETURNING xuid`;
  if (!row) return null; // tried recently
  const why = async (reason) => {  // kept so a failing lookup can be fixed without guessing
    try {
      await sql`INSERT INTO economy_config (key, value, updated_by) VALUES ('gamerpic_debug', ${JSON.stringify({ [xuid]: { reason: String(reason).slice(0, 300), at: new Date().toISOString() } })}::jsonb, 'website')
                ON CONFLICT (key) DO UPDATE SET value = economy_config.value || EXCLUDED.value, updated_at = now()`;
    } catch { /* ignore */ }
    return null;
  };
  try {
    const res = await fetch(`https://xbl.io/api/v2/account/${xuid}`, {
      headers: { "X-Authorization": env.XBL_API_KEY, Accept: "application/json", "Accept-Language": "en-US" },
    });
    if (!res.ok) return why(`xbl.io answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    if (data?.code === 429 || data?.content?.limitType) { // the free key's limit (60 per 5 minutes): try again in an hour
      await sql`UPDATE players SET gamerpic_tried = now() - interval '23 hours' WHERE xuid = ${xuid}`;
      return null;
    }
    const settings = (data?.content || data)?.profileUsers?.[0]?.settings || [];
    let pic = settings.find((x) => x.id === "GameDisplayPicRaw")?.value;
    if (!pic) return why(`no picture in the answer: ${JSON.stringify(data).slice(0, 200)}`);
    const u = new URL(pic.replace(/^http:/, "https:"));
    if (!/(^|\.)xboxlive\.com$/.test(u.hostname)) return why(`unexpected picture host ${u.hostname}`);
    // add the size as plain text: rebuilding the link would re-encode its inner url and the server refuses it
    const raw = pic.replace(/^http:/, "https:").replace(/&(w|h|width|height)=\d+/g, "");
    let img = await fetch(`${raw}${raw.includes("?") ? "&" : "?"}w=208&h=208`); // Xbox only makes 64, 208, 424 and 1080
    if (!img.ok) {
      await why(`resize refused ${img.status} ${(await img.text()).slice(0, 120)} | ${raw.slice(0, 220)}`);
      img = await fetch(u.toString()); // some pictures can't be resized: take the original
    }
    const type = img.headers.get("content-type") || "";
    if (!img.ok || !/^image\/(png|jpeg|webp)/.test(type)) return why(`picture download failed: ${img.status} ${type}`);
    const bytes = new Uint8Array(await img.arrayBuffer());
    if (bytes.length > 400_000) return why(`picture too big (${bytes.length} bytes)`);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    await sql`UPDATE players SET gamerpic = ${b64}, gamerpic_type = ${type.split(";")[0]}, gamerpic_at = now() WHERE xuid = ${xuid}`;
    return { b64, type: type.split(";")[0] };
  } catch (e) {
    return why(`error: ${e.message}`);
  }
}

// GET /api/head/:xuid  (public: heads show on public profiles too)
export async function headImage(request, env, ctx, url, params) {
  const xuid = String(params.xuid || "").replace(/\.png$/, "");
  if (!/^\d{1,20}$/.test(xuid)) throw new HttpError(404, "No head.");
  const sql = getDb(env);
  const rows = await sql`SELECT head, gamerpic, gamerpic_type, pic_source, custom_pic, custom_pic_type FROM players WHERE xuid = ${xuid}`;
  const p = rows[0];
  if (!p) throw new HttpError(404, "No head yet.");
  const versioned = url.searchParams.has("v") && url.searchParams.get("v") !== "0";
  const headers = {
    "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  // ?as=head|xbox|custom: a preview of one choice (Control Panel), never cached
  const as = url.searchParams.get("as");
  if (["head", "xbox", "custom"].includes(as)) { p.pic_source = as; headers["Cache-Control"] = "no-store"; }
  const photo = (b64, type) => new Response(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), { headers: { ...headers, "Content-Type": type } });
  // The player's chosen picture: custom (set by an Admin), Xbox, or their Minecraft head.
  if (p.pic_source === "custom" && p.custom_pic) return photo(p.custom_pic, p.custom_pic_type || "image/png");
  if (p.head && p.pic_source !== "xbox") return new Response(await pngFromRgba(p.head), { headers: { ...headers, "Content-Type": "image/png" } });
  let pic = p.gamerpic ? { b64: p.gamerpic, type: p.gamerpic_type || "image/png" } : null;
  if (!pic && env.XBL_API_KEY) pic = await fetchGamerpic(env, sql, xuid);
  if (!pic && p.head) return new Response(await pngFromRgba(p.head), { headers: { ...headers, "Cache-Control": "public, max-age=600", "Content-Type": "image/png" } });
  if (!pic) return new Response("No picture yet.", { status: 404, headers: { "Cache-Control": "public, max-age=600" } });
  const bytes = Uint8Array.from(atob(pic.b64), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { ...headers, "Content-Type": pic.type } });
}

// Changing a player's picture (Control Panel): the source, a custom image, or the newest Xbox picture.
// The picture's address changes too (head_at / gamerpic_at are its version), so browsers show it at once.
export async function setPicture(env, sql, xuid, { source, image, refreshXbox }) {
  if (!["auto", "head", "xbox", "custom"].includes(source)) throw new HttpError(400, "Choose a picture.");
  if (source === "custom") {
    if (image) {
      const type = String(image.mime || "");
      const b64 = String(image.data || "").replace(/\s+/g, "");
      if (!/^image\/(png|jpeg|webp)$/.test(type)) throw new HttpError(400, "The picture must be PNG, JPEG or WebP.");
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length > 400_000) throw new HttpError(400, "That picture is too large. Try a smaller one.");
      await sql`UPDATE players SET custom_pic = ${b64}, custom_pic_type = ${type} WHERE xuid = ${xuid}`;
    } else {
      const [has] = await sql`SELECT custom_pic IS NOT NULL AS ok FROM players WHERE xuid = ${xuid}`;
      if (!has?.ok) throw new HttpError(400, "Upload a picture first.");
    }
  }
  if (refreshXbox || source === "xbox") {
    if (refreshXbox) await sql`UPDATE players SET gamerpic_tried = NULL WHERE xuid = ${xuid}`;
    if (refreshXbox && env.XBL_API_KEY) {
      const got = await fetchGamerpic(env, sql, xuid);
      if (!got) throw new HttpError(502, "The Xbox picture couldn't be loaded right now. Try again in a few minutes.");
    }
  }
  await sql`UPDATE players SET pic_source = ${source},
                 head_at = CASE WHEN head IS NOT NULL THEN now() ELSE head_at END,
                 gamerpic_at = now() WHERE xuid = ${xuid}`;
}
