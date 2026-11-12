// Live server status, fetched from the free mcsrvstat.us service.
import { getDb } from "../lib/db.js";
// Visitors' browsers only talk to OUR site; our site asks mcsrvstat.us at most
// about once a minute and remembers the answer. Player names are never passed on.
import { loadServerControl } from "./servercontrol.js";
import config from "../../public/config.js";
import { json } from "../lib/http.js";

const CACHE_SECONDS = 30;
const PLACEHOLDER = "your.server.ip";
let memo = null; // { at: ms, data }

async function lookup(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "GalaxySMP-Website/1.0" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`status service returned ${res.status}`);
  return res.json();
}

function cleanMotd(motd) {
  const lines = motd && Array.isArray(motd.clean) ? motd.clean : [];
  return lines.join(" ").replace(/\s+/g, " ").trim().slice(0, 140);
}

export async function buildStatus(env) {
  const manual = config.manualStatus;
  if (manual && manual.enabled) {
    return {
      configured: true,
      manual: true,
      hosting: config.hosting,
      online: Boolean(manual.open),
      color: ["green", "amber", "red"].includes(manual.color) ? manual.color : manual.open ? "green" : "red",
      title: String(manual.title || (manual.open ? "Open" : "Closed")),
      message: String(manual.message || ""),
      checkedAt: new Date().toISOString(),
    };
  }
  // Maintenance mode (Control Panel > Server control): amber, with the owner's message.
  if (env && env.DATABASE_URL) {
    try {
      const { maintenance } = await loadServerControl(getDb(env));
      if (maintenance.on) {
        return { configured: true, maintenance: true, online: false, color: "amber", title: "Maintenance", message: maintenance.message,
          bedrockAddress: config.bedrockAddress, bedrockPort: config.bedrockPort, checkedAt: new Date().toISOString() };
      }
    } catch (e) { console.error("maintenance check failed", e); }
  }
  const configured = config.hosting !== "realm" && config.bedrockAddress && config.bedrockAddress !== PLACEHOLDER;
  const base = {
    configured,
    bedrockAddress: config.bedrockAddress,
    bedrockPort: config.bedrockPort,
    checkedAt: new Date().toISOString(),
  };
  if (!configured) return { ...base, online: false, reason: "not_configured" };

  // 1) GalaxyLink reports the player count every 15 seconds (works with any Bedrock network setting).
  if (env && env.VOICE) {
    try {
      const res = await env.VOICE.get(env.VOICE.idFromName("voice")).fetch("https://voice/internal/server");
      const info = await res.json();
      if (info && Date.now() - info.at < 45_000) {
        return {
          ...base,
          online: true,
          source: "plugin",
          players: { online: info.online, max: info.max }, // null when the plugin hasn't reported a count
          version: info.version,
          motd: "",
        };
      }
    } catch { /* fall back to the public status service */ }
  }

  // 2) Fallback: public status service.
  let b;
  try {
    b = await lookup(`https://api.mcsrvstat.us/bedrock/3/${encodeURIComponent(`${config.bedrockAddress}:${config.bedrockPort}`)}`);
  } catch {
    return { ...base, online: false, reason: "lookup_failed" };
  }
  return {
    ...base,
    online: Boolean(b.online),
    players: { online: Number(b.players?.online ?? 0), max: Number(b.players?.max ?? 0) },
    version: String(b.version ?? "").slice(0, 60),
    motd: cleanMotd(b.motd),
  };
}

export async function handleStatus(request, ctx, env) {
  const now = Date.now();
  if (memo && now - memo.at < CACHE_SECONDS * 1000) {
    return json(memo.data, 200, { "Cache-Control": `public, max-age=${CACHE_SECONDS}` });
  }

  // Shared cache (works once a custom domain is connected; harmless before that).
  const cacheKey = new Request(new URL("/api/status", request.url).toString());
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const data = await buildStatus(env);
  memo = { at: now, data };
  const response = json(data, 200, { "Cache-Control": `public, max-age=${CACHE_SECONDS}` });
  if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
