// Profile showcase: members pin up to 3 of their achievements or builds to the top of their profile.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { achievementDefs } from "./progress.js";

const MAX = 3;

async function mine(sql, userId) {
  const [p] = await sql`SELECT p.achievements FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${userId}`;
  const defs = await achievementDefs(sql);
  const have = new Set(p?.achievements || []);
  const builds = await sql`SELECT b.id, b.title, (SELECT i.id FROM build_images i WHERE i.build_id = b.id ORDER BY i.position LIMIT 1) AS image_id
                            FROM builds b WHERE b.user_id = ${userId} AND b.deleted_at IS NULL ORDER BY b.created_at DESC LIMIT 50`;
  return {
    achievements: defs.filter((a) => have.has(a.id)).map((a) => ({ type: "achievement", id: String(a.id), name: a.name, description: a.desc || a.description || "", icon: a.icon || null })),
    builds: builds.map((b) => ({ type: "build", id: String(b.id), name: b.title, image: b.image_id ? `/api/community/builds/image/${b.image_id}` : null })),
  };
}

// The showcase as shown on a profile (only things the member still has).
export async function showcaseFor(sql, userId, saved) {
  const list = Array.isArray(saved) ? saved.slice(0, MAX) : [];
  if (!list.length) return [];
  const m = await mine(sql, userId);
  const all = [...m.achievements, ...m.builds];
  return list.map((s) => all.find((x) => x.type === s.type && x.id === String(s.id))).filter(Boolean);
}

// GET /api/showcase/options
export async function options(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [u] = await sql`SELECT showcase FROM users WHERE id = ${user.id}`;
  return json({ ok: true, max: MAX, chosen: u.showcase || [], ...(await mine(sql, user.id)) });
}

// POST /api/showcase { items: [{ type, id }] }
export async function save(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const items = (await readJson(request)).items;
  if (!Array.isArray(items) || items.length > MAX) throw new HttpError(400, `Pick up to ${MAX}.`);
  const m = await mine(sql, user.id);
  const all = [...m.achievements, ...m.builds];
  const clean = [];
  for (const it of items) {
    const found = all.find((x) => x.type === it?.type && x.id === String(it?.id));
    if (!found) throw new HttpError(400, "You can only show your own achievements and builds.");
    if (!clean.some((c) => c.type === found.type && c.id === found.id)) clean.push({ type: found.type, id: found.id });
  }
  await sql`UPDATE users SET showcase = ${JSON.stringify(clean)}::jsonb WHERE id = ${user.id}`;
  return json({ ok: true });
}
