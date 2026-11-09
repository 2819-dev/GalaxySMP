// Called by the GalaxyLink plugin on the Minecraft server, never by browsers.
// Every request must carry the shared PLUGIN_SECRET.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { safeEqual, normalizeCode } from "../lib/crypto.js";
import { namesMatch, isOwner } from "../lib/names.js";
import { recordPlayers, syncRoleForUuid } from "./ranks.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLE = 4;
const MEMBER_ROLE = 1;

async function checkSecret(request, env) {
  if (!env.PLUGIN_SECRET) throw new HttpError(503, "PLUGIN_SECRET is not set on the website.");
  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!given || !(await safeEqual(given, env.PLUGIN_SECRET))) throw new HttpError(401, "Wrong plugin secret.");
}

// Lets the plugin check its settings when the server starts.
export async function pluginPing(request, env) {
  await checkSecret(request, env);
  return json({ ok: true, message: "Connected to the GalaxySMP website." });
}

export async function pluginLink(request, env) {
  await checkSecret(request, env);
  const body = await readJson(request);
  const code = normalizeCode(body.code);
  const uuid = String(body.uuid || "");
  const name = String(body.name || "").trim();
  const bedrock = Boolean(body.bedrock);
  if (!UUID_RE.test(uuid) || !name || name.length > 32) throw new HttpError(400, "Bad player data.");

  const reply = (ok, message) => json({ ok, message });
  if (code.length !== 6) return reply(false, "Invalid code format. Codes look like ABC-123.");

  const sql = getDb(env);
  const rows = await sql`
    SELECT id, requested_name, used_at, expires_at > now() AS active FROM link_codes WHERE code = ${code}`;
  const row = rows[0];
  if (!row || row.used_at || !row.active) {
    return reply(false, "This code is invalid or has expired. Generate a new one on the website.");
  }
  if (!namesMatch(row.requested_name, name, bedrock)) {
    return reply(false, `This code belongs to ${row.requested_name}. Generate a new code using your own username.`);
  }

  const platform = bedrock ? "bedrock" : "java";
  const owner = isOwner(env, name, bedrock);
  const results = await sql.transaction([
    sql`UPDATE link_codes SET used_at = now() WHERE id = ${row.id} AND used_at IS NULL`,
    // If someone else used to have this name (they renamed), free it up.
    sql`UPDATE users SET username_lower = username_lower || '#' || id
         WHERE username_lower = lower(${name}) AND mc_uuid <> ${uuid}::uuid`,
    sql`INSERT INTO users (mc_uuid, username, username_lower, platform, password_hash, role_id)
        SELECT ${uuid}::uuid, ${name}, lower(${name}), ${platform}, password_hash,
               ${owner ? ADMIN_ROLE : MEMBER_ROLE}
          FROM link_codes WHERE id = ${row.id}
        ON CONFLICT (mc_uuid) DO UPDATE SET
          username = EXCLUDED.username,
          username_lower = EXCLUDED.username_lower,
          password_hash = EXCLUDED.password_hash,
          failed_logins = 0,
          locked_until = NULL,
          role_id = CASE WHEN ${owner} THEN ${ADMIN_ROLE}::smallint ELSE users.role_id END
        RETURNING id, banned, (xmax = 0) AS created`,
    sql`UPDATE link_codes SET user_id = (SELECT id FROM users WHERE mc_uuid = ${uuid}::uuid) WHERE id = ${row.id}`,
    // A new link also works as "forgot password": sign out everywhere else.
    sql`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE mc_uuid = ${uuid}::uuid)`,
  ]);
  const user = results[2][0];
  if (body.xuid) {
    try {
      await recordPlayers(env, [{ xuid: body.xuid, uuid, name }]);
      await syncRoleForUuid(env, uuid);
    } catch (e) { console.error("rank role sync failed", e); }
  }
  if (user.banned) return reply(true, "Account linked, but this account is banned from the community.");
  if (user.created) {
    return reply(true, owner
      ? "Account linked with Admin access. Return to the website to continue."
      : "Account linked. Return to the website to continue.");
  }
  return reply(true, "Account linked and password updated. Return to the website to continue.");
}
