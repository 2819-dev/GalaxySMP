// Looks unlocked in the Season Pass: website themes, profile titles and profile frames.
// The owner has them all (to try them out). Everyone can go back to the default at any time.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";
import { THEMES, TITLES, FRAMES, SEASON_UNLOCKS, lookInfo, unlockId } from "../../public/js/looks-catalog.js";

const COLUMN = { theme: "look_theme", title: "look_title", frame: "look_frame" };
const owner = (env, u) => Boolean(u.owner) || isOwner(env, u.username, u.platform === "bedrock");

// Everything the owner can pick (per-season titles for every season so far).
async function everything(sql) {
  const [{ n }] = await sql`SELECT coalesce(max(id), 1)::int AS n FROM seasons`;
  const out = { theme: THEMES.map((t) => t.id), frame: FRAMES.map((f) => f.id), title: [] };
  for (const t of TITLES) {
    if (!t.perSeason) out.title.push(t.id);
    else for (let s = 1; s <= n; s++) out.title.push(`s${s}_${t.id}`);
  }
  return out;
}

export async function unlockedFor(env, sql, user) {
  if (owner(env, user)) return everything(sql);
  const rows = await sql`SELECT kind, item FROM user_unlocks WHERE user_id = ${user.id} ORDER BY created_at`;
  const out = { theme: [], title: [], frame: [] };
  for (const r of rows) out[r.kind]?.push(r.item);
  return out;
}

export async function giveUnlock(sql, userId, kind, item, source) {
  await sql`INSERT INTO user_unlocks (user_id, kind, item, source) VALUES (${userId}, ${kind}, ${item}, ${source}) ON CONFLICT DO NOTHING`;
}

// GET /api/looks: what you've unlocked and what you're using
export async function mine(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [u] = await sql`SELECT look_theme, look_title, look_frame FROM users WHERE id = ${user.id}`;
  const have = await unlockedFor(env, sql, user);
  const list = (kind) => have[kind].map((id) => lookInfo(kind, id)).filter(Boolean);
  // what's still to unlock in the Season Pass, so the picker can show it greyed out
  const locked = [];
  for (const track of ["free", "pro"]) {
    for (const [tier, [kind, id]] of Object.entries(SEASON_UNLOCKS[track])) {
      const def = lookInfo(kind, unlockId(kind, id, 1));
      if (def && !have[kind].some((x) => x === id || x.endsWith(`_${id}`))) locked.push({ kind, name: def.name.replace(/Season \d+ /, "Season "), tier: Number(tier), track });
    }
  }
  return json({
    ok: true,
    chosen: { theme: u.look_theme || null, title: u.look_title || null, frame: u.look_frame || null },
    themes: list("theme"), titles: list("title"), frames: list("frame"), locked,
  }, 200, { "Cache-Control": "no-store" });
}

// POST /api/looks { kind, item } (item null = default)
export async function choose(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const kind = String(body.kind || "");
  if (!COLUMN[kind]) throw new HttpError(400, "Unknown kind of look.");
  const sql = getDb(env);
  const item = body.item ? String(body.item) : null;
  if (item) {
    if (!lookInfo(kind, item)) throw new HttpError(400, "Unknown look.");
    const have = await unlockedFor(env, sql, user);
    if (!have[kind].includes(item)) throw new HttpError(403, "Unlock it in the Season Pass first.");
  }
  if (kind === "theme") await sql`UPDATE users SET look_theme = ${item} WHERE id = ${user.id}`;
  else if (kind === "title") await sql`UPDATE users SET look_title = ${item} WHERE id = ${user.id}`;
  else await sql`UPDATE users SET look_frame = ${item} WHERE id = ${user.id}`;
  return json({ ok: true, item });
}

// For profiles: { title: "Galaxy Legend", frame: "nebula" } (only things they still have)
export function looksOut(u) {
  return { title: lookInfo("title", u.look_title)?.name || null, frame: lookInfo("frame", u.look_frame)?.id || null };
}
