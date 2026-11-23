// Linking from the game: Main Menu > Link Account shows a code and a QR code. The player opens
// galaxymc.us/community?game=CODE on their phone, picks a password, and their website account is made and linked to
// that Minecraft player (no typing in game). The opposite of the usual flow (code from the website, /link in game).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { linkCode, formatCode, normalizeCode } from "../lib/crypto.js";
import { isOwner } from "../lib/names.js";
import { createSession, sessionCookie } from "../lib/auth.js";
import { limit, clientIp } from "../lib/ratelimit.js";
import { checkSecret } from "./plugin.js";
import { checkPassword } from "./auth.js";
import { recordPlayers, syncRoleForUuid } from "./ranks.js";
import { encode } from "uqr";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLE = 4;
const MEMBER_ROLE = 1;
const SITE = "https://galaxymc.us";
const linkUrl = (code) => `${SITE}/community?game=${code}`;

// POST /api/plugin/link-code { uuid, xuid, name, bedrock } -> { linked } or { code, url, qr }
export async function pluginCode(request, env) {
  await checkSecret(request, env);
  const b = await readJson(request);
  const uuid = String(b.uuid || ""), name = String(b.name || "").trim();
  if (!UUID_RE.test(uuid) || !name || name.length > 32) throw new HttpError(400, "Bad player data.");
  const sql = getDb(env);
  const [user] = await sql`SELECT id FROM users WHERE mc_uuid = ${uuid}::uuid`;
  if (user) return json({ ok: true, linked: true });
  let [row] = await sql`SELECT code FROM game_link_codes WHERE mc_uuid = ${uuid}::uuid AND used_at IS NULL AND expires_at > now() + interval '5 minutes'`;
  for (let i = 0; !row && i < 3; i++) {
    try {
      [row] = await sql`INSERT INTO game_link_codes (code, mc_uuid, xuid, name, bedrock, expires_at)
                        VALUES (${linkCode()}, ${uuid}::uuid, ${String(b.xuid || "") || null}, ${name}, ${Boolean(b.bedrock)}, now() + interval '30 minutes')
                        RETURNING code`;
    } catch (e) {
      if (!String(e.message).includes("game_link_codes_code_key")) throw e;
    }
  }
  if (!row) throw new HttpError(500, "No code could be made.");
  if (Math.random() < 0.1) await sql`DELETE FROM game_link_codes WHERE expires_at < now() - interval '1 day'`.catch(() => {});
  return json({ ok: true, linked: false, code: formatCode(row.code), url: linkUrl(row.code), qr: `${SITE}/api/qr/game/${row.code}.png` });
}

async function activeCode(sql, code) {
  const c = normalizeCode(code);
  if (c.length !== 6) return null;
  const [row] = await sql`SELECT * FROM game_link_codes WHERE code = ${c} AND used_at IS NULL AND expires_at > now()`;
  return row || null;
}

// GET /api/link/game?code= -> { name }
export async function info(request, env, ctx, url) {
  await limit(env, "POLL_LIMITER", "glink:" + clientIp(request));
  const row = await activeCode(getDb(env), url.searchParams.get("code"));
  if (!row) throw new HttpError(404, "This code has expired. Open the Main Menu in game for a new one.");
  return json({ ok: true, name: row.name });
}

// POST /api/link/game { code, password } -> account made, linked and signed in
export async function claim(request, env) {
  await limit(env, "AUTH_LIMITER", "glink:" + clientIp(request));
  const b = await readJson(request);
  const sql = getDb(env);
  const row = await activeCode(sql, b.code);
  if (!row) throw new HttpError(404, "This code has expired. Open the Main Menu in game for a new one.");
  const password = checkPassword(b.password, row.name);
  const uuid = row.mc_uuid, name = row.name, platform = row.bedrock ? "bedrock" : "java";
  const owner = isOwner(env, name, row.bedrock);
  const res = await sql.transaction([
    sql`UPDATE game_link_codes SET used_at = now() WHERE id = ${row.id} AND used_at IS NULL RETURNING id`,
    sql`UPDATE users SET username_lower = username_lower || '#' || id WHERE username_lower = lower(${name}) AND mc_uuid <> ${uuid}::uuid`,
    sql`INSERT INTO users (mc_uuid, username, username_lower, platform, password_hash, role_id)
        VALUES (${uuid}::uuid, ${name}, lower(${name}), ${platform}, crypt(${password}, gen_salt('bf', 10)), ${owner ? ADMIN_ROLE : MEMBER_ROLE})
        ON CONFLICT (mc_uuid) DO UPDATE SET username = EXCLUDED.username, username_lower = EXCLUDED.username_lower,
          password_hash = EXCLUDED.password_hash, failed_logins = 0, locked_until = NULL
        RETURNING id, banned`,
  ]);
  if (!res[0].length) throw new HttpError(409, "This code was just used. Open the Main Menu in game for a new one.");
  const user = res[2][0];
  if (row.xuid) {
    try { await recordPlayers(env, [{ xuid: row.xuid, uuid, name }]); await syncRoleForUuid(env, uuid); } catch (e) { console.error("rank sync failed", e); }
  }
  if (user.banned) throw new HttpError(403, "This account has been banned from the community.");
  await sql`DELETE FROM sessions WHERE user_id = ${user.id}`;
  const token = await createSession(sql, user.id);
  return json({ ok: true, name }, 200, { "Set-Cookie": sessionCookie(token) });
}

// GET /api/qr/game/:code.png -> the QR code for that link (only for a code that's still valid)
export async function qr(request, env, ctx, url, params) {
  const c = normalizeCode(String(params.code || "").replace(/\.png$/i, ""));
  const row = await activeCode(getDb(env), c);
  const png = await qrPng(row ? linkUrl(c) : `${SITE}/community`);
  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" } });
}

// ---------- a small PNG writer for the QR code (black on white, 8 px per module, 4-module border) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function qrPng(text) {
  const { data, size } = encode(text, { ecc: "M" });
  const scale = 8, border = 4, px = (size + border * 2) * scale;
  const raw = new Uint8Array(px * (px + 1));
  for (let y = 0; y < px; y++) {
    raw[y * (px + 1)] = 0;   // filter: none
    const my = Math.floor(y / scale) - border;
    for (let x = 0; x < px; x++) {
      const mx = Math.floor(x / scale) - border;
      const dark = my >= 0 && mx >= 0 && my < size && mx < size && data[my][mx];
      raw[y * (px + 1) + 1 + x] = dark ? 0 : 255;
    }
  }
  const chunk = (type, body) => {
    const t = new TextEncoder().encode(type);
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length); out.set(t, 4); out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, px); dv.setUint32(4, px); ihdr[8] = 8; ihdr[9] = 0;   // 8-bit grayscale
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array())];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total); let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}
