// GalaxySMP website: main entry point.
// Pages come from /public (packed in at deploy time); /api/* is the back end.
import { json, error, HttpError } from "./lib/http.js";
import { getDb } from "./lib/db.js";
import { handleStatus } from "./routes/status.js";
import { checkout, mine as storeMine, topup, gift, stripeWebhook, paymentsOverview } from "./routes/store.js";
import * as promos from "./store/promos.js";
import { serveStatic } from "./lib/static.js";
import { linkStart, linkPoll, login, logout, me } from "./routes/auth.js";
import { pluginPing, pluginLink } from "./routes/plugin.js";
import * as gamemod from "./routes/gamemod.js";
import * as progress from "./routes/progress.js";
import { headImage } from "./routes/heads.js";
import { bootstrap, history, connect } from "./routes/chat.js";
import * as mod from "./routes/mod.js";
import { voiceConnect, voiceServer } from "./routes/voice.js";
import * as ranks from "./routes/ranks.js";
import * as economy from "./routes/economy.js";
import * as help from "./routes/help.js";
import * as plans from "./routes/plans.js";
import * as community from "./routes/community.js";
import * as support from "./routes/support.js";
import * as panel from "./routes/panel.js";
import * as dms from "./routes/dms.js";
import * as notifyRoutes from "./routes/notify.js";
import * as account from "./routes/account.js";

export { CommunityHub } from "./chat/hub.js";
export { VoiceHub } from "./voice/hub.js";

// Each entry: [method, path, handler]. A path segment like ":id" matches any value.
const routes = [
  ["GET", "/api/status", (req, env, ctx) => handleStatus(req, ctx, env)],
  ["GET", "/api/health", (req, env) => health(env)],
  ["GET", "/api/store/mine", (req, env) => storeMine(req, env)],
  ["POST", "/api/store/promo", (req, env) => promos.checkRoute(req, env)],
  ["GET", "/api/panel/promos", (req, env) => promos.listRoute(req, env)],
  ["POST", "/api/panel/promos", (req, env) => promos.createRoute(req, env)],
  ["POST", "/api/panel/promos/:id", promos.updateRoute],
  ["POST", "/api/store/checkout", (req, env) => checkout(req, env)],
  ["POST", "/api/store/topup", (req, env) => topup(req, env)],
  ["POST", "/api/store/gift", (req, env) => gift(req, env)],
  ["POST", "/api/store/stripe-webhook", (req, env) => stripeWebhook(req, env)],
  ["GET", "/api/panel/payments", (req, env) => paymentsOverview(req, env)],
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
  ["GET", "/api/mod/chatfilter", (req, env) => mod.chatFilterState(req, env)],
  ["POST", "/api/mod/chatfilter", (req, env) => mod.chatFilterSet(req, env)],
  ["GET", "/api/mod/audit", mod.listAudit],
  ["GET", "/api/voice/connect", (req, env) => voiceConnect(req, env)],
  ["GET", "/api/voice/server", (req, env) => voiceServer(req, env)],
  ["POST", "/api/mod/members/:id/voice-mute", mod.voiceMute],
  ["POST", "/api/mod/members/:id/voice-unmute", mod.voiceUnmute],
  ["POST", "/api/mod/members/:id/voice-kick", mod.voiceKick],
  ["POST", "/api/mod/members/:id/global-mic", mod.setGlobalMic],
  ["GET", "/api/mod/ranks", ranks.listRanks],
  ["POST", "/api/mod/ranks/:action", ranks.websiteAction],
  ["POST", "/api/plugin/ranks", (req, env) => ranks.pluginAction(req, env)],
  ["POST", "/api/plugin/report", (req, env) => gamemod.pluginReport(req, env)],
  ["GET", "/api/plugin/reports", (req, env) => gamemod.pluginReports(req, env)],
  ["POST", "/api/plugin/reports/resolve", (req, env) => gamemod.pluginResolveReport(req, env)],
  ["POST", "/api/plugin/punish", (req, env) => gamemod.pluginPunish(req, env)],
  ["GET", "/api/mod/game-reports", (req, env) => gamemod.staffGameReports(req, env)],
  ["POST", "/api/mod/game-reports/:id/resolve", gamemod.staffResolveGameReport],
  ["GET", "/api/economy/top", economy.leaderboard],
  ["GET", "/api/leaderboards", progress.leaderboards],
  ["GET", "/api/players/search", progress.searchPlayers],
  ["GET", "/api/head/:xuid", headImage],
  ["GET", "/api/players/:name", progress.profile],
  ["GET", "/api/mod/economy", economy.adminEconomy],
  ["POST", "/api/mod/economy/plan", (req, env) => plans.adminSetPlan(req, env)],
  ["POST", "/api/mod/economy/:action", economy.adminEconomyAction],
  ["GET", "/api/help", help.getHelp],
  ["GET", "/api/community/auction", (req, env) => community.auctionList(req, env)],
  ["GET", "/api/community/events", (req, env) => community.eventsList(req, env)],
  ["POST", "/api/community/auction/:id/buy", community.auctionBuy],
  ["GET", "/api/community/suggestions", community.suggestionsList],
  ["POST", "/api/community/suggestions", (req, env) => community.suggestionCreate(req, env)],
  ["POST", "/api/community/suggestions/:id/vote", community.suggestionVote],
  ["POST", "/api/community/suggestions/:id/:action", community.suggestionAction],
  ["GET", "/api/store/plans", (req, env) => plans.storePlans(env)],
  ["GET", "/api/support/tickets", (req, env) => support.myTickets(req, env)],
  ["POST", "/api/support/tickets", (req, env) => support.createTicket(req, env)],
  ["GET", "/api/support/tickets/:id", support.getTicket],
  ["POST", "/api/support/tickets/:id/messages", support.postMessage],
  ["POST", "/api/support/tickets/:id/close", support.closeTicket],
  ["GET", "/api/mod/tickets", support.staffTickets],
  ["GET", "/api/me/header", (req, env) => account.headerMe(req, env)],
  ["GET", "/api/account", (req, env) => account.getAccount(req, env)],
  ["POST", "/api/account/password", (req, env) => account.changePassword(req, env)],
  ["POST", "/api/account/signout-others", (req, env) => account.signOutOthers(req, env)],
  ["GET", "/api/notify", (req, env) => notifyRoutes.getSettings(req, env)],
  ["POST", "/api/notify/subscribe", (req, env) => notifyRoutes.subscribe(req, env)],
  ["POST", "/api/notify/unsubscribe", (req, env) => notifyRoutes.unsubscribe(req, env)],
  ["POST", "/api/notify/prefs", (req, env) => notifyRoutes.savePrefs(req, env)],
  ["POST", "/api/notify/test", (req, env) => notifyRoutes.testPush(req, env)],
  ["GET", "/api/dm/threads", (req, env) => dms.listThreads(req, env)],
  ["GET", "/api/dm/with/:userId", dms.getConversation],
  ["POST", "/api/dm/with/:userId", dms.postMessage],
  ["POST", "/api/dm/block/:userId", dms.setBlock],
  ["POST", "/api/dm/messages/:id/edit", dms.editMessage],
  ["GET", "/api/mod/dms", dms.ownerThreads],
  ["GET", "/api/mod/dms/:id", dms.ownerThread],
  ["POST", "/api/plugin/dm", (req, env) => dms.pluginDm(req, env)],
  ["GET", "/api/mod/overview", (req, env) => panel.overview(req, env)],
  ["POST", "/api/mod/announce", (req, env) => panel.announce(req, env)],
  ["GET", "/api/mod/players", panel.searchPlayers],
  ["GET", "/api/mod/players/:xuid", panel.playerCard],
  ["POST", "/api/mod/players/:xuid/:action", panel.playerAction],
  ["POST", "/api/mod/tickets/:id/update", support.updateTicket],
  ["GET", "/api/mod/help", help.adminGetHelp],
  ["POST", "/api/mod/help/:action", help.adminHelpAction],
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
  // Daily notifications (reward reminder, daily summary): see "triggers" in wrangler.jsonc.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(notifyRoutes.daily(env, event.cron).catch((e) => console.error("daily notifications failed", e)));
  },

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
