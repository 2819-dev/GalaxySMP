// Database connection to Neon Postgres (over HTTPS, works on Cloudflare's free plan).
import { neon } from "@neondatabase/serverless";
import { HttpError } from "./http.js";

export function getDb(env) {
  if (!env.DATABASE_URL) {
    throw new HttpError(503, "The website is not connected to its database yet (DATABASE_URL is missing).");
  }
  return neon(env.DATABASE_URL);
}
