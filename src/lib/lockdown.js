// Website lockdown (Control Panel > Server control, owner only): every page shows one screen with a lock icon,
// the owner's title and message, and the API is closed. Only the owners can still use the site (and sign in
// at /community?owner). The Minecraft server is closed to players at the same time (maintenance mode).
import { getDb } from "./db.js";
import { getUser } from "./auth.js";
import { isOwner } from "./names.js";

let cache = { at: 0, value: null };

export async function lockdownState(env) {
  if (Date.now() - cache.at < 15_000 && cache.value) return cache.value;
  let value = { on: false };
  try {
    const [row] = await getDb(env)`SELECT value FROM economy_config WHERE key = 'lockdown'`;
    if (row?.value?.on) value = row.value;
  } catch { /* database trouble: keep the site open */ }
  cache = { at: Date.now(), value };
  return value;
}
export function forgetLockdown() { cache = { at: 0, value: null }; }

// Always reachable: the Minecraft plugin, payments, signing in, and the files pages need.
const OPEN_API = [/^\/api\/plugin\//, /^\/api\/voice\/server$/, /^\/api\/store\/stripe-webhook$/, /^\/api\/auth\//, /^\/api\/lockdown$/];
const isFile = (p) => /\.(js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|json|webmanifest|mp3|ogg|txt)$/i.test(p);

// Returns a Response when the request is blocked, or null to carry on.
export async function lockdownGate(request, env, url) {
  const lock = await lockdownState(env);
  if (!lock.on) return null;
  const p = url.pathname;
  if (OPEN_API.some((r) => r.test(p)) || isFile(p)) return null;
  if (p === "/community" && url.searchParams.has("owner")) return null;  // the owner's way to sign in
  const user = await getUser(request, env).catch(() => null);
  if (user && isOwner(env, user.username, user.platform === "bedrock")) return null;
  if (p.startsWith("/api/")) {
    return new Response(JSON.stringify({ ok: false, error: lock.title || "GalaxySMP is closed right now.", locked: true }),
      { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "300" } });
  }
  return new Response(lockPage(lock), { status: 503, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "300",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  } });
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function lockPage(lock) {
  const title = esc(lock.title || "GalaxySMP is closed right now");
  const message = esc(lock.message || "We'll be back soon.").replace(/\n/g, "<br>");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} · GalaxySMP</title>
<link rel="icon" href="/favicon.png">
<style>
  :root { --bg: #f4f6fb; --card: #ffffff; --text: #141a2e; --sub: #586079; --ring: rgba(80, 100, 255, .14); --line: #e3e7f2; }
  @media (prefers-color-scheme: dark) { :root { --bg: #070a17; --card: #11162a; --text: #eef1ff; --sub: #a3abc8; --ring: rgba(120, 140, 255, .18); --line: #232a45; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg);
    background-image: radial-gradient(60rem 40rem at 50% -10%, var(--ring), transparent 70%);
    color: var(--text); font: 16px/1.6 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: 100%; max-width: 480px; text-align: center; background: var(--card); border: 1px solid var(--line);
    border-radius: 24px; padding: 40px 28px 28px; box-shadow: 0 20px 60px rgba(10, 20, 60, .12); }
  .lock { width: 72px; height: 72px; margin: 0 auto 20px; border-radius: 22px; display: grid; place-items: center; color: #fff;
    background: linear-gradient(135deg, #4f7cff, #8a5cff); box-shadow: 0 10px 30px rgba(90, 100, 255, .35); }
  .lock svg { width: 34px; height: 34px; }
  h1 { margin: 0 0 10px; font-size: clamp(1.4rem, 5vw, 1.8rem); line-height: 1.25; letter-spacing: -.01em; overflow-wrap: anywhere; }
  p { margin: 0; color: var(--sub); overflow-wrap: anywhere; }
  .brand { margin-top: 28px; padding-top: 18px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: .85rem; color: var(--sub); }
  .brand b { color: var(--text); letter-spacing: .02em; }
  a { color: var(--sub); }
</style></head>
<body><main>
  <div class="lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor"/></svg></div>
  <h1>${title}</h1>
  <p>${message}</p>
  <div class="brand"><b>GalaxySMP</b><a href="/community?owner">Owner sign-in</a></div>
</main></body></html>`;
}
