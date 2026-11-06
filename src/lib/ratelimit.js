// Stops people from hammering sign-in and code requests.
// Uses Cloudflare's built-in rate limiter (free); skipped if it isn't configured.
import { HttpError } from "./http.js";

export async function limit(env, binding, key) {
  const limiter = env[binding];
  if (!limiter || typeof limiter.limit !== "function") return;
  const { success } = await limiter.limit({ key });
  if (!success) throw new HttpError(429, "Too many tries. Please wait a minute and try again.");
}

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}
