// GalaxySMP website: main entry point.
// Pages come from /public (packed in at deploy time); /api/* is the back end.
import { json, error, HttpError } from "./lib/http.js";
import { getDb } from "./lib/db.js";
import { handleStatus } from "./routes/status.js";
import { checkout, mine as storeMine, topup, gift, stripeWebhook, paymentsOverview, ownerCredits, findMembers } from "./routes/store.js";
import * as promos from "./store/promos.js";
import { serveStatic } from "./lib/static.js";
import { linkStart, linkPoll, login, logout, me } from "./routes/auth.js";
import { pluginPing, pluginLink } from "./routes/plugin.js";
import * as gamemod from "./routes/gamemod.js";
import * as progress from "./routes/progress.js";
import { headImage } from "./routes/heads.js";
import { bootstrap, history, connect, search as chatSearch, pins as chatPins, pin as chatPin } from "./routes/chat.js";
import * as mod from "./routes/mod.js";
import * as staffroom from "./routes/staffroom.js";
import { voiceConnect, voiceServer } from "./routes/voice.js";
import * as ranks from "./routes/ranks.js";
import * as economy from "./routes/economy.js";
import * as help from "./routes/help.js";
import * as plans from "./routes/plans.js";
import * as community from "./routes/community.js";
import * as support from "./routes/support.js";
import * as panel from "./routes/panel.js";
import * as onboarding from "./routes/onboarding.js";
import * as presence from "./routes/presence.js";
import * as badges from "./routes/badges.js";
import * as dms from "./routes/dms.js";
import * as notifyRoutes from "./routes/notify.js";
import * as account from "./routes/account.js";
import * as features from "./routes/features.js";
import * as appeals from "./routes/appeals.js";
import * as livemap from "./routes/map.js";
import * as emoji from "./routes/emoji.js";
import * as trades from "./routes/trades.js";
import * as shops from "./routes/shops.js";
import * as joinreq from "./routes/joinrequests.js";
import * as serverctl from "./routes/servercontrol.js";
import * as feed from "./routes/feed.js";
import * as team from "./routes/team.js";
import * as helpcenter from "./routes/helpcenter.js";
import * as uploads from "./routes/uploads.js";
import * as actas from "./routes/actas.js";
import { isActingRequest } from "./lib/auth.js";

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
  ["GET", "/api/store/members", findMembers],
  ["POST", "/api/store/stripe-webhook", (req, env) => stripeWebhook(req, env)],
  ["GET", "/api/panel/payments", (req, env) => paymentsOverview(req, env)],
  ["POST", "/api/panel/credits", (req, env) => ownerCredits(req, env)],
  ["POST", "/api/auth/link/start", (req, env) => linkStart(req, env)],
  ["POST", "/api/auth/link/poll", (req, env) => linkPoll(req, env)],
  ["POST", "/api/auth/login", (req, env) => login(req, env)],
  ["POST", "/api/auth/logout", (req, env) => logout(req, env)],
  ["POST", "/api/act-as/stop", (req, env) => actas.stopActingRoute(req, env)],
  ["POST", "/api/mod/act-as/:id", actas.startActing],
  ["GET", "/api/me", (req, env) => me(req, env)],
  ["GET", "/api/plugin/ping", (req, env) => pluginPing(req, env)],
  ["POST", "/api/plugin/link", (req, env) => pluginLink(req, env)],
  ["GET", "/api/chat/bootstrap", (req, env) => bootstrap(req, env)],
  ["GET", "/api/chat/channels/:id/messages", history],
  ["GET", "/api/chat/channels/:id/pins", chatPins],
  ["GET", "/api/chat/search", chatSearch],
  ["GET", "/api/emoji", (req, env) => emoji.listEmoji(req, env)],
  ["GET", "/api/trades", (req, env) => trades.listTrades(req, env)],
  ["GET", "/api/trades/inventory", (req, env) => trades.inventory(req, env)],
  ["POST", "/api/trades", (req, env) => trades.createTrade(req, env)],
  ["POST", "/api/trades/:id/:action", trades.tradeAction],
  ["GET", "/api/shops", (req, env) => shops.listShops(req, env)],
  ["POST", "/api/join-requests", (req, env) => joinreq.createJoinRequest(req, env)],
  ["GET", "/api/site-notice", (req, env) => serverctl.siteNotice(req, env)],
  ["GET", "/api/feed", feed.listFeed],
  ["GET", "/api/team", (req, env) => team.listTeam(req, env)],
  ["GET", "/api/help-center", (req, env) => helpcenter.helpCenter(req, env)],
  ["GET", "/api/uploads/rights", (req, env) => uploads.rights(req, env)],
  ["POST", "/api/chat/images", (req, env) => uploads.uploadChatImage(req, env)],
  ["GET", "/api/chat/images/:id", uploads.chatImage],
  ["POST", "/api/account/banner", (req, env) => uploads.saveBanner(req, env)],
  ["GET", "/api/banner/:id", uploads.banner],
  ["POST", "/api/account/picture", (req, env) => uploads.savePicture(req, env)],
  ["POST", "/api/mod/users/:id/uploads", uploads.modUploads],
  ["POST", "/api/help-center", (req, env) => helpcenter.saveArticle(req, env)],
  ["POST", "/api/help-center/:id/delete", helpcenter.deleteArticle],
  ["POST", "/api/team/bio", (req, env) => team.saveBio(req, env)],
  ["GET", "/api/applications", team.listApplications],
  ["POST", "/api/applications", (req, env) => team.createApplication(req, env)],
  ["POST", "/api/applications/withdraw", (req, env) => team.withdrawApplication(req, env)],
  ["GET", "/api/applications/:id", team.getApplication],
  ["POST", "/api/applications/:id/messages", team.appMessage],
  ["POST", "/api/applications/:id/decide", team.decideApplication],
  ["POST", "/api/feed/comments/:id/delete", feed.deleteComment],
  ["POST", "/api/feed/:id/like", feed.likePost],
  ["GET", "/api/feed/:id/comments", feed.listComments],
  ["POST", "/api/feed/:id/comments", feed.addComment],
  ["POST", "/api/feed/:id/delete", feed.deletePost],
  ["GET", "/api/panel/server-control", (req, env) => serverctl.getServerControl(req, env)],
  ["POST", "/api/panel/server-control", (req, env) => serverctl.saveServerControl(req, env)],
  ["GET", "/api/panel/allowlist", (req, env) => serverctl.getAllowlist(req, env)],
  ["POST", "/api/panel/allowlist", (req, env) => serverctl.changeAllowlist(req, env)],
  ["GET", "/api/join-requests/:token", joinreq.getJoinRequest],
  ["POST", "/api/join-requests/:token/messages", joinreq.postJoinMessage],
  ["GET", "/api/panel/join-requests", joinreq.listJoinRequests],
  ["GET", "/api/panel/join-requests/:id", joinreq.getJoinRequestOwner],
  ["POST", "/api/panel/join-requests/:id/messages", joinreq.ownerJoinMessage],
  ["POST", "/api/panel/join-requests/:id/decide", joinreq.decideJoinRequest],
  ["POST", "/api/shops/:id/buy", shops.buyFromShop],
  ["GET", "/api/emoji/:name", emoji.emojiImage],
  ["POST", "/api/panel/emoji", (req, env) => emoji.addEmoji(req, env)],
  ["POST", "/api/panel/emoji/:name/delete", emoji.deleteEmoji],
  ["POST", "/api/chat/messages/:id/pin", chatPin],
  ["GET", "/api/chat/connect", (req, env) => connect(req, env)],
  ["POST", "/api/reports", (req, env) => mod.createReport(req, env)],
  ["POST", "/api/reports/player", (req, env) => gamemod.webReportPlayer(req, env)],
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
  ["GET", "/api/staff-room/logs", staffroom.staffLogs],
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
  ["GET", "/api/players/:name/social", progress.socialProfile],
  ["GET", "/api/players/:name/history", progress.playerHistory],
  ["GET", "/api/timeline", progress.timeline],
  ["GET", "/api/map/info", (req, env) => livemap.mapInfo(req, env)],
  ["POST", "/api/panel/map", (req, env) => panel.setMap(req, env)],
  ["GET", "/api/panel/voice-rooms", (req, env) => panel.voiceRooms(req, env)],
  ["GET", "/api/voice/rooms", (req, env) => panel.publicVoiceRooms(req, env)],
  ["POST", "/api/panel/voice-rooms", (req, env) => panel.voiceRooms(req, env)],
  ["GET", "/api/map/region/:rx/:rz", livemap.mapRegion],
  ["POST", "/api/appeals", (req, env) => appeals.createAppeal(req, env)],
  ["GET", "/api/appeals/:token", appeals.getAppeal],
  ["GET", "/api/mod/appeals", appeals.listAppeals],
  ["POST", "/api/mod/appeals/:id", appeals.decideAppeal],
  ["GET", "/api/mod/economy", economy.adminEconomy],
  ["POST", "/api/mod/economy/plan", (req, env) => plans.adminSetPlan(req, env)],
  ["POST", "/api/mod/economy/:action", economy.adminEconomyAction],
  ["GET", "/api/help", help.getHelp],
  ["GET", "/api/community/auction", (req, env) => community.auctionList(req, env)],
  ["GET", "/api/community/events", (req, env) => features.eventsList(req, env)],
  ["POST", "/api/community/events", (req, env) => features.eventSave(req, env)],
  ["POST", "/api/community/events/:id/:action", features.eventAction],
  ["GET", "/api/community/news", features.newsList],
  ["POST", "/api/community/news", (req, env) => features.newsSave(req, env)],
  ["POST", "/api/community/news/:id/delete", features.newsDelete],
  ["GET", "/api/community/polls", (req, env) => features.pollsList(req, env)],
  ["POST", "/api/community/polls", (req, env) => features.pollCreate(req, env)],
  ["POST", "/api/community/polls/:id/:action", features.pollAction],
  ["POST", "/api/chat/polls", (req, env) => features.chatPollCreate(req, env)],
  ["GET", "/api/chat/polls/:id", features.chatPollGet],
  ["GET", "/api/community/builds", features.buildsList],
  ["POST", "/api/community/builds", (req, env) => features.buildCreate(req, env)],
  ["GET", "/api/community/builds/image/:id", features.buildImage],
  ["POST", "/api/community/builds/:id/:action", features.buildAction],
  ["GET", "/api/community/suggestions/similar", features.suggestionSimilar],
  ["GET", "/api/community/suggestions/:id/comments", features.suggestionComments],
  ["POST", "/api/community/suggestions/:id/comments", features.suggestionComment],
  ["POST", "/api/community/suggestions/:id/respond", features.suggestionRespond],
  ["POST", "/api/community/suggestion-comments/:id/delete", features.suggestionCommentDelete],
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
  ["POST", "/api/account/real-name", (req, env) => account.setRealNameVisibility(req, env)],
  ["GET", "/api/onboarding", (req, env) => onboarding.getOnboarding(req, env)],
  ["GET", "/api/presence/:id", presence.getPresence],
  ["GET", "/api/panel/badges", (req, env) => badges.listBadges(req, env)],
  ["POST", "/api/panel/badges", (req, env) => badges.createBadge(req, env)],
  ["POST", "/api/panel/badges/:id", badges.changeBadge],
  ["GET", "/api/panel/presence", (req, env) => presence.getMyPresence(req, env)],
  ["POST", "/api/panel/presence", (req, env) => presence.setMyPresence(req, env)],
  ["POST", "/api/account/activity", (req, env) => presence.setShowActivity(req, env)],
  ["POST", "/api/account/profile", (req, env) => onboarding.editProfile(req, env)],
  ["POST", "/api/onboarding", (req, env) => onboarding.finishOnboarding(req, env)],
  ["POST", "/api/panel/members/:id/real-name", panel.setRealName],
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
    // Local testing only (DEBUG_PUSH is set in .dev.vars, never on the live site): post the recap now.
    if (env.DEBUG_PUSH && event.cron === "recap-test") return ctx.waitUntil(import("./routes/recap.js").then((m) => m.weeklyRecap(env, true)));
    if (event.cron === "*/5 * * * *") ctx.waitUntil(features.tick(env).catch((e) => console.error("5-minute jobs failed", e)));
    else ctx.waitUntil(notifyRoutes.daily(env, event.cron).catch((e) => console.error("daily notifications failed", e)));
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
      // "Act as Member" sessions are look-only: no changes of any kind (except going back / signing out)
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !["/api/auth/logout", "/api/act-as/stop"].includes(url.pathname)
          && !url.pathname.startsWith("/api/plugin/") && request.headers.get("Cookie")?.includes("gsmp_session=") && await isActingRequest(request, env)) {
        return error("You're looking at the site as another member, so changes are turned off. Use \"Back to my account\" to go back.", 403);
      }
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
