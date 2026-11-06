// Serves the website's pages, styles and scripts (packed from /public at deploy time).
import assets from "../generated/assets.js";

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self' wss:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
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
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
    });
  }

  const { asset } = found;
  const headers = {
    "Content-Type": asset.type,
    ETag: asset.etag,
    // Pages: re-check after 5 minutes. Styles/scripts/images: keep for a day.
    "Cache-Control": isHtml(asset) ? "public, max-age=300" : "public, max-age=86400",
    ...SECURITY_HEADERS,
  };
  if (request.headers.get("If-None-Match") === asset.etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : body(asset), { status: 200, headers });
}
