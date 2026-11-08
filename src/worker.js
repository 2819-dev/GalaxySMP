// GalaxySMP website: main entry point.
// Pages come from /public (packed in at deploy time); /api/* is the back end.
import { json, error, HttpError } from "./lib/http.js";
import { getDb } from "./lib/db.js";
import { handleStatus } from "./routes/status.js";
import { listRanks, checkout } from "./routes/store.js";
import { serveStatic } from "./lib/static.js";
import { linkStart, linkPoll, login, logout, me } from "./routes/auth.js";
import { pluginPing, pluginLink } from "./routes/plugin.js";
import { bootstrap, history, connect } from "./routes/chat.js";
import * as mod from "./routes/mod.js";
import { voiceConnect, voiceServer } from "./routes/voice.js";

export { CommunityHub } from "./chat/hub.js";
export { VoiceHub } from "./voice/hub.js";

// Each entry: [method, path, handler]. A path segment like ":id" matches any value.
const routes = [
  ["GET", "/api/status", (req, env, ctx) => handleStatus(req, ctx)],
  ["GET", "/api/health", (req, env) => health(env)],
  ["GET", "/api/store/ranks", () => listRanks()],
  ["POST", "/api/store/checkout", (req, env) => checkout(req, env)],
  ["POST", "/api/auth/link/start", (req, env) => linkStart(req, env)],
  ["POST", "/api/auth/link/poll", (req, env) => linkPoll(req, env)],
  ["POST", "/api/auth/login", (req, env) => login(req, env)],
  ["POST", "/api/auth/logout", (req, env) => logout(req, env)],
  ["GET", "/api/me", (req, env) => me(req, env)],
  ["GET", "/api/plugin/ping", (req, env) => pluginPing(req, env)],
  ["POST", "/api/plugin/link", (req, env) => pluginLink(req, env)],
  ["GET", "/api/chat/bootstrap", (req, env) => bootstrap(req, env)],
  ["GET", "/api/chat/channels/:id/messages", history],
  ["GET", "/api/chat/connect", (req, env) => connect(req, env)],
  ["POST", "/api/reports", (req, env) => mod.createReport(req, env)],
  ["POST", "/api/messages/:id/delete", mod.deleteMessage],
  ["GET", "/api/mod/summary", (req, env) => mod.staffSummary(req, env)],
  ["GET", "/api/mod/reports", mod.listReports],
  ["POST", "/api/mod/reports/:id/resolve", mod.resolveReport],
  ["GET", "/api/mod/members", mod.searchMembers],
  ["POST", "/api/mod/members/:id/mute", mod.mute],
  ["POST", "/api/mod/members/:id/unmute", mod.unmute],
  ["POST", "/api/mod/members/:id/ban", mod.ban],
  ["POST", "/api/mod/members/:id/unban", mod.unban],
  ["POST", "/api/mod/members/:id/role", mod.setRole],
  ["GET", "/api/mod/words", (req, env) => mod.listWords(req, env)],
  ["POST", "/api/mod/words", (req, env) => mod.addWord(req, env)],
  ["POST", "/api/mod/words/:id/delete", mod.removeWord],
  ["GET", "/api/mod/audit", mod.listAudit],
  ["GET", "/api/voice/connect", (req, env) => voiceConnect(req, env)],
  ["GET", "/api/voice/server", (req, env) => voiceServer(req, env)],
  ["POST", "/api/mod/members/:id/voice-mute", mod.voiceMute],
  ["POST", "/api/mod/members/:id/voice-unmute", mod.voiceUnmute],
  ["POST", "/api/mod/members/:id/voice-kick", mod.voiceKick],
  ["POST", "/api/mod/members/:id/global-mic", mod.setGlobalMic],
];

function matchPath(pattern, pathname) {
  const a = pattern.split("/");
  const b = pathname.split("/");
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

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
    // One public address: send www.galaxymc.us and the old workers.dev pages to galaxymc.us.
    // (The Minecraft plugin's /api/ calls keep working on any address.)
    if (url.hostname === "www.galaxymc.us" || (url.hostname.endsWith(".workers.dev") && !url.pathname.startsWith("/api/"))) {
      return Response.redirect(`https://galaxymc.us${url.pathname}${url.search}`, 301);
    }
    if (!url.pathname.startsWith("/api/")) return serveStatic(request);
    try {
      let pathFound = false;
      for (const [method, path, handler] of routes) {
        const params = matchPath(path, url.pathname);
        if (!params) continue;
        pathFound = true;
        if (request.method === method) return await handler(request, env, ctx, url, params);
      }
      return pathFound ? error("Method not allowed.", 405) : error("Not found.", 404);
    } catch (e) {
      if (e instanceof HttpError) return error(e.message, e.status, e.extra);
      console.error("Unhandled error", e);
      return error("Something went wrong. Please try again.", 500);
    }
  },
};
