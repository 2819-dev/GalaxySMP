import { can } from "../lib/perms.js";
// Voice chat connections: browsers (signed-in, linked members) and the Endstone plugin.
import { getDb } from "../lib/db.js";
import { HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { safeEqual } from "../lib/crypto.js";

export function voiceStub(env) {
  return env.VOICE.get(env.VOICE.idFromName("voice"));
}

export async function voiceEvent(env, event) {
  await voiceStub(env).fetch("https://voice/internal/event", { method: "POST", body: JSON.stringify(event) });
}

// A browser joins voice. The website account (made with /link) is the voice identity.
export async function voiceConnect(request, env) {
  if (request.headers.get("Upgrade") !== "websocket") throw new HttpError(426, "Expected a WebSocket.");
  const origin = request.headers.get("Origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) throw new HttpError(403, "Forbidden.");
  if (!env.REALTIME_APP_ID || !env.REALTIME_APP_SECRET) throw new HttpError(503, "Voice chat isn't set up yet.");
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const rows = await sql`
    SELECT u.mc_uuid, u.voice_muted_until, u.global_mic, r.key AS role, r.color
      FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ${user.id}`;
  const extra = rows[0];
  const power = Number(user.role_power);
  const headers = new Headers(request.headers);
  headers.set("X-GSMP-User", JSON.stringify({
    id: Number(user.id),
    username: user.username,
    role: extra.role,
    color: extra.color,
    power,
    mcUuid: String(extra.mc_uuid).toLowerCase(),
    canGlobal: power >= 50 || Boolean(extra.global_mic),
    staffChat: can(user, "staff_chat"),
    voiceMutedUntil: extra.voice_muted_until && new Date(extra.voice_muted_until) > new Date() ? extra.voice_muted_until : null,
  }));
  return voiceStub(env).fetch(new Request(request.url, { headers }));
}

// The Endstone plugin connects here to send positions and receive voice icons.
export async function voiceServer(request, env) {
  if (request.headers.get("Upgrade") !== "websocket") throw new HttpError(426, "Expected a WebSocket.");
  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!env.PLUGIN_SECRET || !given || !(await safeEqual(given, env.PLUGIN_SECRET))) throw new HttpError(401, "Wrong plugin secret.");
  const headers = new Headers(request.headers);
  headers.delete("Authorization");
  headers.set("X-GSMP-Plugin", "1");
  return voiceStub(env).fetch(new Request(request.url, { headers }));
}
