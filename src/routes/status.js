// Live server status, fetched from the free mcsrvstat.us service.
// Visitors' browsers only talk to OUR site; our site asks mcsrvstat.us at most
// about once a minute and remembers the answer. Player names are never passed on.
import config from "../../public/config.js";
import { json } from "../lib/http.js";

const CACHE_SECONDS = 60;
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

export async function buildStatus() {
  const configured = config.javaAddress && config.javaAddress !== PLACEHOLDER;
  const base = {
    configured,
    javaAddress: config.javaAddress,
    javaPort: config.javaPort,
    bedrockAddress: config.bedrockAddress,
    bedrockPort: config.bedrockPort,
    checkedAt: new Date().toISOString(),
  };
  if (!configured) return { ...base, online: false, reason: "not_configured" };

  const javaTarget =
    Number(config.javaPort) === 25565 ? config.javaAddress : `${config.javaAddress}:${config.javaPort}`;
  const bedrockTarget = `${config.bedrockAddress}:${config.bedrockPort}`;

  const [java, bedrock] = await Promise.allSettled([
    lookup(`https://api.mcsrvstat.us/3/${encodeURIComponent(javaTarget)}`),
    lookup(`https://api.mcsrvstat.us/bedrock/3/${encodeURIComponent(bedrockTarget)}`),
  ]);

  const j = java.status === "fulfilled" ? java.value : null;
  const b = bedrock.status === "fulfilled" ? bedrock.value : null;
  if (!j && !b) return { ...base, online: false, reason: "lookup_failed" };

  const online = Boolean(j?.online || b?.online);
  const players = j?.online ? j.players : b?.online ? b.players : null;
  return {
    ...base,
    online,
    java: { online: Boolean(j?.online) },
    bedrock: { online: Boolean(b?.online) },
    players: { online: Number(players?.online ?? 0), max: Number(players?.max ?? 0) },
    version: String(j?.version ?? b?.version ?? "").slice(0, 60),
    motd: cleanMotd(j?.motd ?? b?.motd),
  };
}

export async function handleStatus(request, ctx) {
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

  const data = await buildStatus();
  memo = { at: now, data };
  const response = json(data, 200, { "Cache-Control": `public, max-age=${CACHE_SECONDS}` });
  if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
