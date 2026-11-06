// Small helpers for building API responses.

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extraHeaders },
  });
}

export function error(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

// Thrown anywhere inside a route to send a friendly error to the browser.
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export async function readJson(request, maxBytes = 8192) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "Expected JSON.");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
