// GalaxySMP website: main entry point.
// Plain pages are served straight from /public. Only /api/* requests reach this code.
import { json, error, HttpError } from "./lib/http.js";
import { getDb } from "./lib/db.js";
import { handleStatus } from "./routes/status.js";
import { listRanks, checkout } from "./routes/store.js";

// Each entry: [method, path, handler]. Later stages add accounts, chat and moderation here.
const routes = [
  ["GET", "/api/status", (req, env, ctx) => handleStatus(req, ctx)],
  ["GET", "/api/health", (req, env) => health(env)],
  ["GET", "/api/store/ranks", () => listRanks()],
  ["POST", "/api/store/checkout", (req, env) => checkout(req, env)],
];

// Lets you check, from a browser, that the settings reached the app.
// It never shows the values themselves.
async function health(env) {
  const result = {
    ok: true,
    settings: {
      DATABASE_URL: env.DATABASE_URL ? "set" : "MISSING",
      PLUGIN_SECRET: env.PLUGIN_SECRET ? "set" : "MISSING",
    },
    database: "not checked",
  };
  if (env.DATABASE_URL) {
    try {
      const sql = getDb(env);
      const rows = await sql`SELECT count(*)::int AS channels FROM channels`;
      result.database = `connected (${rows[0].channels} channels)`;
    } catch (e) {
      result.ok = false;
      result.database = "ERROR: could not connect. Check DATABASE_URL.";
    }
  } else {
    result.ok = false;
  }
  return json(result);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      for (const [method, path, handler] of routes) {
        if (url.pathname === path) {
          if (request.method !== method) return error("Method not allowed.", 405);
          return await handler(request, env, ctx, url);
        }
      }
      return error("Not found.", 404);
    } catch (e) {
      if (e instanceof HttpError) return error(e.message, e.status, e.extra);
      console.error("Unhandled error", e);
      return error("Something went wrong. Please try again.", 500);
    }
  },
};
