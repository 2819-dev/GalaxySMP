// Badges: special hexagon awards for events and roles (achievements are the in-game milestones).
// The Owner badge is built in and belongs to the owner automatically; the rest are made and given
// by Admins in the Control Panel > Badges.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";

export const STYLES = ["gold", "silver", "bronze", "ruby", "emerald", "sapphire", "amethyst", "galaxy", "sunset", "ice"];
export const ICONS = ["star", "crown", "trophy", "medal", "gem", "heart", "flame", "comet", "orbit", "sparkles", "castle", "sword",
  "pickaxe", "shield", "gift", "calendar", "music", "megaphone", "tools", "handshake", "firework", "moon", "flag", "key"];
export const OWNER_BADGE = { id: "owner", name: "Owner", description: "Founder and owner of GalaxySMP.", icon: "crown", style: "owner", builtIn: true };

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const out = (b, awardedAt) => ({ id: String(b.id), name: b.name, description: b.description || "", icon: b.icon, style: b.style, ...(awardedAt ? { awardedAt } : {}) });

// Badges of many members at once: Map(userId -> [badge]) ; owners get the Owner badge first.
export async function badgesFor(env, sql, users) {
  const ids = users.map((u) => Number(u.id));
  const map = new Map(ids.map((id) => [id, []]));
  for (const u of users) if (isOwner(env, u.username, (u.platform || u.plat) === "bedrock")) map.get(Number(u.id)).push(OWNER_BADGE);
  if (!ids.length) return map;
  const rows = await sql`SELECT ub.user_id, ub.awarded_at, b.* FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
                          WHERE ub.user_id = ANY(${ids}::bigint[]) ORDER BY ub.awarded_at`;
  for (const r of rows) map.get(Number(r.user_id))?.push(out(r, r.awarded_at));
  return map;
}

// ---------- Control Panel (Admins) ----------
async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (Number(user.role_power) < 100) throw new HttpError(403, "Only Admins can manage badges.");
  return user;
}
async function audit(sql, actorId, action, details) {
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${actorId}, ${action}, ${JSON.stringify(details)}::jsonb)`;
}

export async function listBadges(request, env) {
  await requireAdmin(request, env);
  const sql = getDb(env);
  const rows = await sql`
    SELECT b.*, (SELECT json_agg(json_build_object('id', u.id, 'username', u.username) ORDER BY ub.awarded_at)
                   FROM user_badges ub JOIN users u ON u.id = ub.user_id WHERE ub.badge_id = b.id) AS holders
      FROM badges b ORDER BY b.id DESC`;
  return json({ ok: true, styles: STYLES, icons: ICONS, owner: OWNER_BADGE,
    badges: rows.map((b) => ({ ...out(b), holders: b.holders || [] })) });
}

export async function createBadge(request, env) {
  const user = await requireAdmin(request, env);
  const body = await readJson(request);
  const name = clean(body.name, 40);
  if (!name) throw new HttpError(400, "Give the badge a name.");
  if (name.toLowerCase() === "owner") throw new HttpError(400, "The Owner badge is built in.");
  const sql = getDb(env);
  const [b] = await sql`INSERT INTO badges (name, description, icon, style, created_by)
                        VALUES (${name}, ${clean(body.description, 120) || null}, ${ICONS.includes(body.icon) ? body.icon : "star"},
                                ${STYLES.includes(body.style) ? body.style : "gold"}, ${user.id}) RETURNING id`;
  await audit(sql, user.id, "badge.create", { badge: name });
  return json({ ok: true, id: String(b.id) });
}

// POST /api/panel/badges/:id { action: "award" | "revoke" | "delete", userIds }
export async function changeBadge(request, env, ctx, url, params) {
  const user = await requireAdmin(request, env);
  const body = await readJson(request, 16384);
  const sql = getDb(env);
  const [b] = await sql`SELECT id, name FROM badges WHERE id = ${Number(params.id) || 0}`;
  if (!b) throw new HttpError(404, "That badge doesn't exist.");
  const ids = [...new Set((Array.isArray(body.userIds) ? body.userIds : []).map(Number).filter((n) => n > 0))].slice(0, 500);
  if (body.action === "delete") {
    await sql`DELETE FROM badges WHERE id = ${b.id}`;
    await audit(sql, user.id, "badge.delete", { badge: b.name });
    return json({ ok: true });
  }
  if (!ids.length) throw new HttpError(400, "Pick at least one member.");
  if (body.action === "award") {
    await sql`INSERT INTO user_badges (user_id, badge_id, awarded_by)
              SELECT id, ${b.id}, ${user.id} FROM users WHERE id = ANY(${ids}::bigint[]) ON CONFLICT DO NOTHING`;
    await audit(sql, user.id, "badge.award", { badge: b.name, members: ids.length });
  } else if (body.action === "revoke") {
    await sql`DELETE FROM user_badges WHERE badge_id = ${b.id} AND user_id = ANY(${ids}::bigint[])`;
    await audit(sql, user.id, "badge.revoke", { badge: b.name, members: ids.length });
  } else throw new HttpError(400, "Unknown action.");
  return json({ ok: true });
}
