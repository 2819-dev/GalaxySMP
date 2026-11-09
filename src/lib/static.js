// Serves the website's pages, styles and scripts (packed from /public at deploy time).
import assets from "../generated/assets.js";

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self' wss:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function findAsset(pathname) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (p.endsWith("/")) p += "index.html";
  if (assets[p]) return { path: p, asset: assets[p] };
  if (assets[p + ".html"]) return { path: p + ".html", asset: assets[p + ".html"] };
  if (/^\/player\/[^/]{1,40}$/.test(p) && assets["/player.html"]) return { path: "/player.html", asset: assets["/player.html"] };  // public profiles
  return null;
}

function body(asset) {
  if (asset.text !== undefined) return asset.text;
  return Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0));
}

export function serveStatic(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(request.url);
  const found = findAsset(url.pathname);
  const isHtml = (a) => a.type.startsWith("text/html");

  if (!found) {
    const notFound = assets["/404.html"];
    return new Response(notFound ? notFound.text : "Not found", {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, no-transform", ...SECURITY_HEADERS },
    });
  }

  const { asset } = found;
  const headers = {
    "Content-Type": asset.type,
    ETag: asset.etag,
    // Versioned files (?v=...) never change, so browsers may keep them for a year.
    // Pages and unversioned files must be re-checked every time (a quick "not modified" reply).
    "Cache-Control": !isHtml(asset) && url.searchParams.has("v")
      ? "public, max-age=31536000, immutable"
      : "no-cache, no-transform", // no-transform: Cloudflare must not inject scripts (no trackers)
    ...SECURITY_HEADERS,
  };
  if (request.headers.get("If-None-Match") === asset.etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : body(asset), { status: 200, headers });
}
