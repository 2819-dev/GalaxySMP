// Galaxy Cube: a small box (Raspberry Pi) that lets Xbox / Switch / PlayStation players join GalaxySMP
// (it shows the server as a LAN game and passes the traffic through) and talk in voice chat.
//
// Pairing (like signing in on a TV):
//   1. The Cube calls POST /api/cube/pair/start and shows the code on its screen ("K7Q-29M").
//   2. The member opens galaxymc.us/cube (cube.galaxymc.us), signs in and types the code.
//   3. The Cube polls POST /api/cube/pair/poll and gets its own long-lived device token.
// The Cube then sends "Authorization: Bearer <device token>" to /api/cube/* and /api/cube/voice.
import config from "../../public/config.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { randomToken, sha256, linkCode, formatCode } from "../lib/crypto.js";
import { limit, clientIp } from "../lib/ratelimit.js";

const PAIR_MINUTES = 10;
const MAX_CUBES = 5;
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const DEVICE_RE = /^CUBE-[A-Z0-9]{4,8}$/;

// The device behind a request's Bearer token (or 401).
export async function requireCube(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length > 200) throw new HttpError(401, "This Cube isn't linked. Pair it again.");
  const sql = getDb(env);
  const [d] = await sql`SELECT d.*, u.username, u.banned FROM cube_devices d JOIN users u ON u.id = d.user_id
                         WHERE d.token_hash = ${await sha256(token)} AND d.revoked_at IS NULL`;
  if (!d || d.banned) throw new HttpError(401, "This Cube isn't linked. Pair it again.");
  if (!d.last_seen_at || Date.now() - new Date(d.last_seen_at) > 60_000) {
    await sql`UPDATE cube_devices SET last_seen_at = now(), firmware = coalesce(${request.headers.get("X-Cube-Firmware")}, firmware) WHERE id = ${d.id}`;
  }
  return d;
}

// POST /api/cube/pair/start { deviceId, model }  (the Cube)
export async function pairStart(request, env) {
  await limit(env, "AUTH_LIMITER", "cube:" + clientIp(request));
  const b = await readJson(request);
  const deviceId = String(b.deviceId || "").toUpperCase();
  if (!DEVICE_RE.test(deviceId)) throw new HttpError(400, "Bad device id (expected CUBE-XXXX).");
  const model = b.model === "lite" ? "lite" : "cube";
  const sql = getDb(env);
  const pollToken = randomToken(24);
  for (let i = 0; i < 3; i++) {
    const code = linkCode();
    try {
      const [r] = await sql`INSERT INTO cube_pairings (code, device_id, model, poll_hash, expires_at)
                             VALUES (${code}, ${deviceId}, ${model}, ${await sha256(pollToken)}, now() + make_interval(mins => ${PAIR_MINUTES})) RETURNING expires_at`;
      if (Math.random() < 0.1) await sql`DELETE FROM cube_pairings WHERE expires_at < now() - interval '1 day'`;
      return json({ ok: true, code: formatCode(code), pollToken, expiresAt: r.expires_at, url: "galaxymc.us/cube" });
    } catch (e) {
      if (!String(e.message).includes("cube_pairings_code_key")) throw e;
    }
  }
  throw new HttpError(500, "Couldn't make a code. Try again.");
}

// POST /api/cube/pair/poll { pollToken }  (the Cube, every 3 seconds) -> waiting | linked (with its token, once) | expired
export async function pairPoll(request, env) {
  await limit(env, "POLL_LIMITER", "cubepoll:" + clientIp(request));
  const token = String((await readJson(request)).pollToken || "");
  if (!token || token.length > 100) throw new HttpError(400, "Missing pollToken.");
  const sql = getDb(env);
  const [p] = await sql`SELECT p.*, u.username FROM cube_pairings p LEFT JOIN users u ON u.id = p.user_id WHERE p.poll_hash = ${await sha256(token)}`;
  if (!p) throw new HttpError(404, "Unknown pairing.");
  if (!p.claimed_at) return json({ ok: true, status: new Date(p.expires_at) > new Date() ? "waiting" : "expired" });
  const [took] = await sql`UPDATE cube_pairings SET picked_up = true WHERE id = ${p.id} AND NOT picked_up RETURNING id`;
  if (!took) return json({ ok: true, status: "claimed" });
  const deviceToken = randomToken(32);
  // one live link per Cube: pairing again replaces the old one
  await sql`UPDATE cube_devices SET revoked_at = now() WHERE device_id = ${p.device_id} AND revoked_at IS NULL`;
  await sql`INSERT INTO cube_devices (user_id, device_id, model, name, token_hash, last_seen_at)
            VALUES (${p.user_id}, ${p.device_id}, ${p.model}, ${p.model === "lite" ? "Galaxy Cube Lite" : "Galaxy Cube"}, ${await sha256(deviceToken)}, now())`;
  return json({ ok: true, status: "linked", deviceToken, username: p.username });
}

// POST /api/cube/pair/claim { code }  (the member, on galaxymc.us/cube)
export async function pairClaim(request, env) {
  const user = await requireUser(request, env);
  if (user.acting_by) throw new HttpError(403, "You're looking at the site as another member.");
  await limit(env, "AUTH_LIMITER", "cubeclaim:" + user.id);
  const code = String((await readJson(request)).code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) throw new HttpError(400, "Codes look like K7Q-29M (6 letters and numbers).");
  const sql = getDb(env);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM cube_devices WHERE user_id = ${user.id} AND revoked_at IS NULL`;
  if (n >= MAX_CUBES) throw new HttpError(409, `You can link up to ${MAX_CUBES} Cubes. Unlink one first.`);
  const [p] = await sql`UPDATE cube_pairings SET user_id = ${user.id}, claimed_at = now()
                         WHERE code = ${code} AND claimed_at IS NULL AND expires_at > now() RETURNING device_id, model`;
  if (!p) throw new HttpError(404, "That code didn't work. Check the Cube's screen, or turn the wheel to get a new code.");
  return json({ ok: true, message: `${p.model === "lite" ? "Galaxy Cube Lite" : "Galaxy Cube"} ${p.device_id} is linked to ${user.username}. It finishes setting up in a few seconds.` });
}

// GET /api/cube/devices  (the member)
export async function myDevices(request, env) {
  const user = await requireUser(request, env);
  const rows = await getDb(env)`SELECT id, device_id, name, model, firmware, created_at, last_seen_at FROM cube_devices
                                 WHERE user_id = ${user.id} AND revoked_at IS NULL ORDER BY id`;
  return json({ ok: true, devices: rows.map((d) => ({ id: Number(d.id), deviceId: d.device_id, name: d.name, model: d.model, firmware: d.firmware,
    linkedAt: d.created_at, lastSeen: d.last_seen_at, online: d.last_seen_at && Date.now() - new Date(d.last_seen_at) < 3 * 60_000 })) });
}

// POST /api/cube/devices/:id { action: "rename", name } | { action: "unlink" }  (the member)
export async function deviceAction(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const b = await readJson(request);
  const sql = getDb(env);
  const id = Number(params.id) || 0;
  if (b.action === "rename") {
    const name = clean(b.name, 24);
    if (name.length < 2) throw new HttpError(400, "Give it a name (2 to 24 characters).");
    const [d] = await sql`UPDATE cube_devices SET name = ${name} WHERE id = ${id} AND user_id = ${user.id} AND revoked_at IS NULL RETURNING id`;
    if (!d) throw new HttpError(404, "That Cube isn't linked to you.");
    return json({ ok: true });
  }
  if (b.action === "unlink") {
    const [d] = await sql`UPDATE cube_devices SET revoked_at = now() WHERE id = ${id} AND user_id = ${user.id} AND revoked_at IS NULL RETURNING id`;
    if (!d) throw new HttpError(404, "That Cube isn't linked to you.");
    return json({ ok: true, message: "Unlinked. The Cube asks to be paired again." });
  }
  throw new HttpError(400, "Unknown action.");
}

// GET /api/cube/me  (the Cube): who it belongs to and where the server is. Also its heartbeat.
export async function cubeMe(request, env) {
  const d = await requireCube(request, env);
  const sql = getDb(env);
  const [p] = await sql`SELECT p.gamertag, p.xuid FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${d.user_id}`;
  return json({
    ok: true,
    device: { id: Number(d.id), deviceId: d.device_id, name: d.name, model: d.model },
    user: { id: Number(d.user_id), username: d.username, gamertag: p?.gamertag || null },
    server: { name: "GalaxySMP", motd: "GalaxySMP", host: config.bedrockAddress, port: Number(config.bedrockPort) },
    voice: { url: `${new URL(request.url).origin.replace(/^http/, "ws")}/api/cube/voice` },
  }, 200, { "Cache-Control": "no-store" });
}
