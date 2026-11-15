// Home page "Online now": who's in game and what they're doing. Names and heads are for signed-in
// members only (like the rest of the site); visitors just see how many are playing.
import { json } from "../lib/http.js";
import { getUser } from "../lib/auth.js";
import { voiceStub } from "./voice.js";

export async function online(request, env) {
  const info = await voiceStub(env).fetch("https://voice/internal/server").then((r) => r.json()).catch(() => null);
  const list = Array.isArray(info?.players) ? info.players : [];
  const count = list.length || Number(info?.online) || 0;
  const user = await getUser(request, env).catch(() => null);
  return json({
    ok: true, up: Boolean(info), count, signedIn: Boolean(user),
    players: user ? list.map((p) => ({ name: p.name, head: `/api/head/${p.xuid}`, doing: p.doing })) : [],
  }, 200, { "Cache-Control": "private, max-age=20" });
}
