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
import * as shifts from "./routes/shifts.js";
import * as jobs from "./routes/jobs.js";
import * as plotshow from "./routes/plotshow.js";
import * as checklist from "./routes/checklist.js";
import * as giftcards from "./routes/giftcards.js";
import * as looks from "./routes/looks.js";
import * as wrapped from "./routes/wrapped.js";
import * as wishlist from "./routes/wishlist.js";
import * as seasonRoutes from "./routes/season.js";
import * as goals from "./routes/goals.js";
import * as referrals from "./routes/referrals.js";
import * as showcase from "./routes/showcase.js";
import { voiceConnect, voiceServer, cubeVoiceConnect } from "./routes/voice.js";
import * as cube from "./routes/cube.js";
import * as ranks from "./routes/ranks.js";
import * as economy from "./routes/economy.js";
import * as help from "./routes/help.js";
import * as backups from "./routes/backups.js";
import * as gamelink from "./routes/gamelink.js";
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
import * as friends from "./routes/friends.js";
import * as friendStreaks from "./routes/friendstreaks.js";
import * as merch from "./routes/merch.js";
import * as cart from "./routes/cart.js";
import * as engage from "./routes/engage.js";
import { isActingRequest } from "./lib/auth.js";
import { ensureSchema } from "./lib/autoschema.js";
import { lockdownGate, lockdownState } from "./lib/lockdown.js";

export { CommunityHub } from "./chat/hub.js";
export { VoiceHub } from "./voice/hub.js";
export { StreamRoom } from "./streams/room.js";

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
  ["POST", "/api/auth/login/2fa", (req, env) => import("./routes/twostep.js").then((m) => m.finishLogin(req, env))],
  ["GET", "/api/account/2fa", (req, env) => import("./routes/twostep.js").then((m) => m.status(req, env))],
  ["POST", "/api/account/2fa", (req, env) => import("./routes/twostep.js").then((m) => m.action(req, env))],
  ["POST", "/api/auth/logout", (req, env) => logout(req, env)],
  ["POST", "/api/act-as/stop", (req, env) => actas.stopActingRoute(req, env)],
  ["POST", "/api/mod/act-as/:id", actas.startActing],
  ["POST", "/api/mod/use-galaxysmp", (req, env) => actas.useGalaxySMP(req, env)],
  ["GET", "/api/me", (req, env) => me(req, env)],
  ["GET", "/api/plugin/ping", (req, env) => pluginPing(req, env)],
  ["POST", "/api/plugin/link", (req, env) => pluginLink(req, env)],
  ["POST", "/api/plugin/link-code", gamelink.pluginCode],
  ["GET", "/api/link/game", gamelink.info],
  ["POST", "/api/link/game", gamelink.claim],
  ["GET", "/api/qr/game/:code", gamelink.qr],
  ["POST", "/api/plugin/social", friends.pluginState],
  ["POST", "/api/plugin/social/act", friends.pluginAct],
  ["POST", "/api/plugin/backup/start", backups.start],
  ["PUT", "/api/plugin/backup/part", backups.part],
  ["POST", "/api/plugin/backup/complete", backups.complete],
  ["GET", "/api/plugin/backup/download", backups.download],
  ["GET", "/api/panel/backups", backups.list],
  ["POST", "/api/panel/backups", backups.act],
  ["GET", "/api/chat/bootstrap", (req, env) => bootstrap(req, env)],
  ["GET", "/api/chat/channels/:id/messages", history],
  ["GET", "/api/chat/channels/:id/pins", chatPins],
  ["POST", "/api/chat/channels/:id/read", (req, env, ctx, url, params) => import("./routes/chat.js").then((m) => m.markRead(req, env, ctx, url, params))],
  ["POST", "/api/chat/read-all", (req, env) => import("./routes/chat.js").then((m) => m.markAllRead(req, env))],
  ["GET", "/api/chat/threads/:id", (req, env, ctx, url, params) => import("./routes/chat.js").then((m) => m.thread(req, env, ctx, url, params))],
  ["POST", "/api/chat/channels/:id/slowmode", (req, env, ctx, url, params) => import("./routes/chat.js").then((m) => m.slowmode(req, env, ctx, url, params))],
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
  ["GET", "/api/feed/now", feed.happeningNow],
  ["GET", "/api/team", (req, env) => team.listTeam(req, env)],
  ["GET", "/api/help-center", (req, env) => helpcenter.helpCenter(req, env)],
  ["GET", "/api/uploads/rights", (req, env) => uploads.rights(req, env)],
  ["POST", "/api/chat/images", (req, env) => uploads.uploadChatImage(req, env)],
  ["POST", "/api/chat/voice", (req, env) => uploads.uploadVoice(req, env)],
  ["GET", "/api/chat/voice/:id", uploads.voiceFile],
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
  ["POST", "/api/applications/state", (req, env) => team.setAppState(req, env)],
  ["GET", "/api/applications/:id", team.getApplication],
  ["POST", "/api/applications/:id/messages", team.appMessage],
  ["POST", "/api/applications/:id/decide", team.decideApplication],
  ["POST", "/api/feed/comments/:id/delete", feed.deleteComment],
  ["POST", "/api/feed/:id/like", feed.likePost],
  ["GET", "/api/feed/:id/comments", feed.listComments],
  ["POST", "/api/feed/:id/comments", feed.addComment],
  ["POST", "/api/feed/:id/delete", feed.deletePost],
  ["GET", "/api/panel/server-control", (req, env) => serverctl.getServerControl(req, env)],
  ["GET", "/api/panel/potm", (req, env, ctx, url) => import("./routes/potm.js").then((m) => m.getPotm(req, env, ctx, url))],
  ["POST", "/api/panel/potm", (req, env) => import("./routes/potm.js").then((m) => m.savePotmPanel(req, env))],
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
  ["GET", "/api/mod/members/:id/record", mod.memberRecord],
  ["POST", "/api/mod/members/:id/notes", mod.addStaffNote],
  ["POST", "/api/mod/notes/:id/delete", mod.deleteStaffNote],
  ["POST", "/api/mod/members/:id/unmute", mod.unmute],
  ["POST", "/api/mod/members/:id/ban", mod.ban],
  ["POST", "/api/mod/members/:id/unban", mod.unban],
  ["POST", "/api/mod/members/:id/role", mod.setRole],
  ["GET", "/api/mod/words", (req, env) => mod.listWords(req, env)],
  ["POST", "/api/mod/words", (req, env) => mod.addWord(req, env)],
  ["POST", "/api/mod/words/:id/delete", mod.removeWord],
  ["GET", "/api/mod/chatfilter", (req, env) => mod.chatFilterState(req, env)],
  ["POST", "/api/mod/chatfilter", (req, env) => mod.chatFilterSet(req, env)],
  ["POST", "/api/mod/filter-test", (req, env) => mod.filterTest(req, env)],
  ["GET", "/api/mod/filter-blocks", (req, env) => mod.filterBlocks(req, env)],
  ["GET", "/api/mod/audit", mod.listAudit],
  ["GET", "/api/staff-room/logs", staffroom.staffLogs],
  ["POST", "/api/wishlist", (req, env) => wishlist.toggle(req, env)],
  ["POST", "/api/account/wishlist", (req, env) => wishlist.privacy(req, env)],
  ["GET", "/api/wrapped", (req, env) => wrapped.list(req, env)],
  ["GET", "/api/wrapped/:key", wrapped.get],
  ["POST", "/api/wrapped/:key/share", wrapped.share],
  ["POST", "/api/giftcards", (req, env) => giftcards.buy(req, env)],
  ["GET", "/api/lockdown", async (req, env) => { const l = await lockdownState(env); return json({ ok: true, on: Boolean(l.on) }, 200, { "Cache-Control": "no-store" }); }],
  ["GET", "/api/friends", (req, env) => friends.list(req, env)],
  ["GET", "/api/inbox", notifyRoutes.inbox],
  ["GET", "/api/teams/mine", (req, env) => import("./routes/teams.js").then((m) => m.mine(req, env))],
  ["GET", "/api/teams/leaderboard", (req, env) => import("./routes/teams.js").then((m) => m.leaderboard(req, env))],
  ["GET", "/api/teams/chat", (req, env, ctx, url) => import("./routes/teams.js").then((m) => m.chat(req, env, ctx, url))],
  ["POST", "/api/teams/chat", (req, env) => import("./routes/teams.js").then((m) => m.send(req, env))],
  ["POST", "/api/teams", (req, env) => import("./routes/teams.js").then((m) => m.act(req, env))],
  ["GET", "/api/crates", async (req, env) => {
    const [row] = await getDb(env)`SELECT value FROM economy_config WHERE key = 'crate_odds'`;
    return json({ ok: true, ...(row?.value || { crates: [] }) }, 200, { "Cache-Control": "public, max-age=60" });
  }],
  ["POST", "/api/inbox", (req, env) => notifyRoutes.inboxAction(req, env)],
  ["POST", "/api/friends", (req, env) => friends.act(req, env)],
  ["POST", "/api/friends/streak", (req, env) => friendStreaks.act(req, env)],
  ["POST", "/api/friends/tpa", (req, env) => friends.tpa(req, env)],
  ["GET", "/api/staff/todos", (req, env) => staffroom.todos(req, env)],
  ["POST", "/api/staff/todos", (req, env) => staffroom.todoAction(req, env)],
  ["POST", "/api/map/visit", (req, env) => livemap.mapVisit(req, env)],
  ["GET", "/api/store/merch", (req, env) => merch.list(req, env)],
  ["POST", "/api/store/cart/quote", (req, env) => cart.quote(req, env)],
  ["POST", "/api/chat/messages/:id/thank", engage.thank],
  ["POST", "/api/chat/messages/:id/wave", engage.wave],
  ["GET", "/api/community/away", (req, env) => engage.away(req, env)],
  ["GET", "/api/community/level", engage.level],
  ["GET", "/api/panel/qotd", (req, env) => engage.qotdList(req, env)],
  ["GET", "/api/panel/bot-post", (req, env) => engage.botChannels(req, env)],
  ["POST", "/api/panel/bot-post", (req, env) => engage.botSay(req, env)],
  ["POST", "/api/panel/qotd", (req, env) => engage.qotdSave(req, env)],
  ["POST", "/api/store/cart/checkout", (req, env) => cart.checkout(req, env)],
  ["POST", "/api/store/merch/quote", (req, env) => merch.quote(req, env)],
  ["POST", "/api/store/merch/checkout", (req, env) => merch.checkout(req, env)],
  ["POST", "/api/store/merch/connect", (req, env) => merch.connect(req, env)],
  ["POST", "/api/store/printify-webhook", (req, env) => merch.webhook(req, env)],
  ["GET", "/api/giftcards/mine", (req, env) => giftcards.mine(req, env)],
  ["GET", "/api/giftcards/open", giftcards.peek],
  ["POST", "/api/giftcards/redeem", (req, env) => giftcards.redeem(req, env)],
  ["GET", "/api/checklist", (req, env) => checklist.get(req, env)],
  ["POST", "/api/checklist/claim", (req, env) => checklist.claim(req, env)],
  ["GET", "/api/map/showcase", (req, env) => plotshow.showcase(req, env)],
  ["GET", "/api/map/plots/:id", plotshow.plotCard],
  ["POST", "/api/map/plots/:id", plotshow.plotAction],
  ["GET", "/api/map/plot-photo/:id", plotshow.plotPhoto],
  ["GET", "/api/looks", (req, env) => looks.mine(req, env)],
  ["POST", "/api/looks", (req, env) => looks.choose(req, env)],
  ["GET", "/api/jobs", (req, env) => jobs.list(req, env)],
  ["POST", "/api/jobs", (req, env) => jobs.create(req, env)],
  ["POST", "/api/jobs/:id", jobs.action],
  ["GET", "/api/shifts", (req, env) => shifts.overview(req, env)],
  ["POST", "/api/shifts/action", (req, env) => shifts.action(req, env)],
  ["POST", "/api/shifts/loa", (req, env) => shifts.requestLoa(req, env)],
  ["POST", "/api/shifts/loa/:id", shifts.decideLoa],
  ["POST", "/api/plugin/shift", (req, env) => shifts.pluginShift(req, env)],
  ["GET", "/api/season", (req, env) => seasonRoutes.season(req, env)],
  ["POST", "/api/season/claim", (req, env) => seasonRoutes.claim(req, env)],
  ["GET", "/api/goals/current", (req, env) => goals.current(req, env)],
  ["GET", "/api/mod/goals", (req, env) => goals.manage(req, env)],
  ["POST", "/api/mod/goals", (req, env) => goals.manage(req, env)],
  ["GET", "/api/referrals", (req, env) => referrals.mine(req, env)],
  ["GET", "/api/referrals/who", referrals.who],
  ["POST", "/api/referrals/inviter", (req, env) => referrals.setInviter(req, env)],
  ["GET", "/api/showcase/options", (req, env) => showcase.options(req, env)],
  ["POST", "/api/showcase", (req, env) => showcase.save(req, env)],
  ["GET", "/api/voice/connect", (req, env) => voiceConnect(req, env)],
  ["GET", "/api/streams", (req, env) => import("./routes/streams.js").then((m) => m.list(req, env))],
  ["GET", "/api/sessions", (req, env) => import("./routes/sessions.js").then((m) => m.list(req, env))],
  ["POST", "/api/recordings/start", (req, env) => import("./routes/recordings.js").then((m) => m.start(req, env))],
  ["POST", "/api/episodes/start", (req, env) => import("./routes/recordings.js").then((m) => m.episodeStart(req, env))],
  ["PUT", "/api/episodes/:id/part", (req, env, ctx, url, params) => import("./routes/recordings.js").then((m) => m.episodePart(req, env, ctx, url, params))],
  ["POST", "/api/episodes/:id/finish", (req, env, ctx, url, params) => import("./routes/recordings.js").then((m) => m.episodeFinish(req, env, ctx, url, params))],
  ["POST", "/api/episodes/:id/cancel", (req, env, ctx, url, params) => import("./routes/recordings.js").then((m) => m.episodeCancel(req, env, ctx, url, params))],
  ["GET", "/api/episodes/:id/audio", (req, env, ctx, url, params) => import("./routes/recordings.js").then((m) => m.episodeAudio(req, env, ctx, url, params))],
  ["GET", "/api/episodes/:id/comments", (req, env, ctx, url, params) => import("./routes/streams.js").then((m) => m.comments(req, env, ctx, url, params))],
  ["POST", "/api/recordings/episodes/:id/purge", (req, env, ctx, url, params) => import("./routes/recordings.js").then((m) => m.purgeEpisode(req, env, ctx, url, params))],
  ["GET", "/api/recordings", (req, env) => import("./routes/recordings.js").then((m) => m.list(req, env))],
  ["PUT", "/api/recordings/:id/part", (req, env, ctx, url, params) => import("./routes/recordings.js").then((m) => m.part(req, env, ctx, url, params))],
  ["POST", "/api/recordings/:id/finish", (req, env, ctx, url, params) => import("./routes/recordings.js").then((m) => m.finish(req, env, ctx, url, params))],
  ["GET", "/api/recordings/:id/file", (req, env, ctx, url, params) => import("./routes/recordings.js").then((m) => m.file(req, env, ctx, url, params))],
  ["POST", "/api/recordings/:id/delete", (req, env, ctx, url, params) => import("./routes/recordings.js").then((m) => m.remove(req, env, ctx, url, params))],
  ["POST", "/api/recordings/episodes/:id/restore", (req, env, ctx, url, params) => import("./routes/recordings.js").then((m) => m.restoreEpisode(req, env, ctx, url, params))],
  ["POST", "/api/sessions", (req, env) => import("./routes/sessions.js").then((m) => m.act(req, env))],
  ["GET", "/api/sessions/:id/chat", (req, env, ctx, url, params) => import("./routes/sessions.js").then((m) => m.chat(req, env, ctx, url, params))],
  ["POST", "/api/streams", (req, env) => import("./routes/streams.js").then((m) => m.act(req, env))],
  ["GET", "/api/streams/staff", (req, env) => import("./routes/streams.js").then((m) => m.staffList(req, env))],
  ["GET", "/api/streams/:id", (req, env, ctx, url, params) => import("./routes/streams.js").then((m) => m.one(req, env, ctx, url, params))],
  ["GET", "/api/streams/:id/ws", (req, env, ctx, url, params) => import("./routes/streams.js").then((m) => m.connect(req, env, ctx, url, params))],
  ["GET", "/api/voice/server", (req, env) => voiceServer(req, env)],
  ["POST", "/api/cube/pair/start", (req, env) => cube.pairStart(req, env)],
  ["POST", "/api/cube/pair/poll", (req, env) => cube.pairPoll(req, env)],
  ["POST", "/api/cube/pair/claim", (req, env) => cube.pairClaim(req, env)],
  ["GET", "/api/cube/devices", (req, env) => cube.myDevices(req, env)],
  ["POST", "/api/cube/devices/:id", cube.deviceAction],
  ["GET", "/api/cube/me", (req, env) => cube.cubeMe(req, env)],
  ["GET", "/api/cube/voice", (req, env) => cubeVoiceConnect(req, env)],
  ["POST", "/api/mod/members/:id/voice-mute", mod.voiceMute],
  ["POST", "/api/mod/members/:id/voice-unmute", mod.voiceUnmute],
  ["POST", "/api/mod/members/:id/voice-kick", mod.voiceKick],
  ["POST", "/api/mod/members/:id/global-mic", mod.setGlobalMic],
  ["GET", "/api/mod/ranks", ranks.listRanks],
  ["POST", "/api/mod/ranks/:action", ranks.websiteAction],
  ["POST", "/api/plugin/ranks", (req, env) => ranks.pluginAction(req, env)],
  ["POST", "/api/plugin/report", (req, env) => gamemod.pluginReport(req, env)],
  ["POST", "/api/plugin/support", (req, env) => gamemod.pluginSupport(req, env)],
  ["POST", "/api/plugin/map-image", (req, env) => livemap.pluginMapImage(req, env)],
  ["POST", "/api/plugin/ah-alerts", (req, env) => community.pluginAhAlerts(req, env)],
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
  ["GET", "/api/players/:name/collection", progress.playerCollection],
  ["GET", "/api/players/:name/pets", progress.playerPets],
  ["GET", "/api/players/:name/loading-screens", progress.playerLoadingScreens],
  ["POST", "/api/me/loading-screens", (req, env) => progress.sawLoadingScreen(req, env)],
  ["GET", "/api/timeline", progress.timeline],
  ["GET", "/api/uptime", (req, env) => import("./routes/uptime.js").then((m) => m.uptime(req, env))],
  ["GET", "/api/online", (req, env) => import("./routes/online.js").then((m) => m.online(req, env))],
  ["GET", "/api/bedwars/history", (req, env, ctx, url) => import("./routes/bedwars.js").then((m) => m.history(req, env, ctx, url))],
  ["GET", "/api/bedwars/match/:id", (req, env, ctx, url, params) => import("./routes/bedwars.js").then((m) => m.match(req, env, ctx, url, params))],
  ["GET", "/api/bedwars/live", (req, env) => import("./routes/bedwars.js").then((m) => m.live(req, env))],
  ["GET", "/api/bedwars/top", (req, env, ctx, url) => import("./routes/bedwars.js").then((m) => m.top(req, env, ctx, url))],
  ["GET", "/api/map/info", (req, env) => livemap.mapInfo(req, env)],
  ["POST", "/api/panel/map", (req, env) => panel.setMap(req, env)],
  ["GET", "/api/panel/voice-rooms", (req, env) => panel.voiceRooms(req, env)],
  ["GET", "/api/voice/rooms", (req, env) => panel.publicVoiceRooms(req, env)],
  ["POST", "/api/panel/voice-rooms", (req, env) => panel.voiceRooms(req, env)],
  ["GET", "/api/map/region/:rx/:rz", livemap.mapRegion],
  ["GET", "/api/map/heights/:rx/:rz", livemap.mapHeights],
  ["POST", "/api/appeals", (req, env) => appeals.createAppeal(req, env)],
  ["GET", "/api/appeals/:token", appeals.getAppeal],
  ["GET", "/api/mod/appeals", appeals.listAppeals],
  ["POST", "/api/mod/appeals/:id", appeals.decideAppeal],
  ["GET", "/api/mod/economy", economy.adminEconomy],
  ["POST", "/api/mod/economy/plan", (req, env) => plans.adminSetPlan(req, env)],
  ["POST", "/api/mod/economy/:action", economy.adminEconomyAction],
  ["GET", "/api/help", help.getHelp],
  ["GET", "/api/community/auction", (req, env) => community.auctionList(req, env)],
  ["GET", "/api/community/auction/history", community.auctionHistory],
  ["GET", "/api/community/auction/alerts", (req, env) => community.auctionAlerts(req, env)],
  ["POST", "/api/community/auction/alerts", (req, env) => community.auctionAlertSave(req, env)],
  ["POST", "/api/chat/messages/:id/support", gamemod.supportAction],
  ["GET", "/api/market/inventory", (req, env) => community.marketInventory(req, env)],
  ["GET", "/api/market/ratings", (req, env) => community.marketRatings(req, env)],
  ["GET", "/api/market/plots", (req, env) => community.marketPlots(req, env)],
  ["POST", "/api/market/plots", (req, env) => community.marketPlotAction(req, env)],
  ["POST", "/api/market/rate", (req, env) => community.marketRate(req, env)],
  ["GET", "/api/leaderboards/parkour", (req, env) => progress.parkourBoards(req, env)],
  ["POST", "/api/market/sell", (req, env) => community.marketSell(req, env)],
  ["GET", "/api/market/orders", (req, env) => community.marketOrders(req, env)],
  ["POST", "/api/market/orders", (req, env) => community.marketOrderAction(req, env)],
  ["GET", "/api/community/events", (req, env) => features.eventsList(req, env)],
  ["POST", "/api/community/events", (req, env) => features.eventSave(req, env)],
  ["POST", "/api/community/events/:id/:action", features.eventAction],
  ["GET", "/api/community/events/:id/calendar", features.eventCalendar],
  ["GET", "/api/community/news", features.newsList],
  ["POST", "/api/community/news", (req, env) => features.newsSave(req, env)],
  ["POST", "/api/community/news/:id/delete", features.newsDelete],
  ["GET", "/api/community/polls", (req, env) => features.pollsList(req, env)],
  ["POST", "/api/community/polls", (req, env) => features.pollCreate(req, env)],
  ["POST", "/api/community/polls/:id/:action", features.pollAction],
  ["POST", "/api/chat/polls", (req, env) => features.chatPollCreate(req, env)],
  ["POST", "/api/dm/forms", (req, env) => import("./routes/dms.js").then((m) => m.createForm(req, env))],
  ["GET", "/api/dm/forms/:id", (req, env, ctx, url, params) => import("./routes/dms.js").then((m) => m.getForm(req, env, ctx, url, params))],
  ["POST", "/api/dm/forms/:id/:action", (req, env, ctx, url, params) => import("./routes/dms.js").then((m) => m.formAction(req, env, ctx, url, params))],
  ["GET", "/api/chat/quiet", (req, env) => import("./routes/quiet.js").then((m) => m.getQuiet(req, env))],
  ["POST", "/api/chat/quiet", (req, env) => import("./routes/quiet.js").then((m) => m.setQuiet(req, env))],
  ["GET", "/api/chat/commands", (req, env) => import("./routes/commands.js").then((m) => m.listCommands(req, env))],
  ["POST", "/api/chat/command", (req, env, ctx) => import("./routes/commands.js").then((m) => m.runCommand(req, env, ctx))],
  ["GET", "/api/giveaways/items", (req, env) => import("./routes/giveaways.js").then((m) => m.itemsList(req, env))],
  ["POST", "/api/giveaways", (req, env) => import("./routes/giveaways.js").then((m) => m.create(req, env))],
  ["GET", "/api/giveaways/:id", (req, env, ctx, url, params) => import("./routes/giveaways.js").then((m) => m.getGiveaway(req, env, ctx, url, params))],
  ["POST", "/api/giveaways/:id/:action", (req, env, ctx, url, params) => import("./routes/giveaways.js").then((m) => m.giveawayAction(req, env, ctx, url, params))],
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
  ["POST", "/api/support/tickets/:id/rate", support.rateTicket],
  ["GET", "/api/mod/ticket-ratings", support.ratings],
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
  ["GET", "/api/account/presence", (req, env) => presence.getMyPresence(req, env)],
  ["POST", "/api/account/presence", (req, env) => presence.setMyPresence(req, env)],
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
  ["POST", "/api/plugin/mail", (req, env) => dms.pluginMail(req, env)],
  ["POST", "/api/plugin/mail/thread", (req, env) => dms.pluginMailThread(req, env)],
  ["GET", "/api/mod/overview", (req, env) => panel.overview(req, env)],
  ["POST", "/api/mod/announce", (req, env) => panel.announce(req, env)],
  ["GET", "/api/mod/players", panel.searchPlayers],
  ["GET", "/api/mod/players/:xuid", panel.playerCard],
  ["POST", "/api/mod/players/:xuid/:action", panel.playerAction],
  ["POST", "/api/mod/tickets/:id/update", support.updateTicket],
  ["GET", "/api/mod/help", help.adminGetHelp],
  ["POST", "/api/mod/help/:action", help.adminHelpAction],
  ["GET", "/api/mod/welcome", help.adminGetWelcome],
  ["POST", "/api/mod/welcome/:action", help.adminWelcomeAction],
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
    if (event.cron === "*/5 * * * *") ctx.waitUntil(ensureSchema(env).then(() => features.tick(env)).catch((e) => console.error("5-minute jobs failed", e)));
    else ctx.waitUntil(notifyRoutes.daily(env, event.cron).catch((e) => console.error("daily notifications failed", e)));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) await ensureSchema(env);
    // One public address: send www.galaxymc.us and the old workers.dev pages to galaxymc.us.
    // (The Minecraft plugin's /api/ calls keep working on any address.)
    if (url.hostname === "www.galaxymc.us" || (url.hostname.endsWith(".workers.dev") && !url.pathname.startsWith("/api/"))) {
      return Response.redirect(`https://galaxymc.us${url.pathname}${url.search}`, 301);
    }
    // cube.galaxymc.us (the address in the Galaxy Cube's manual) opens the Cube page on the main site, where you're signed in
    if (url.hostname.startsWith("cube.") && !url.pathname.startsWith("/api/")) {
      return Response.redirect(`https://galaxymc.us/cube${url.search}`, 302);
    }
    // Player Shops and Trades moved into #Marketplace in Community: old links (and the in-game text) still work
    if (url.pathname === "/shops" || url.pathname === "/shops.html") return Response.redirect(`${url.origin}/community#marketplace/shops`, 302);
    if (url.pathname === "/trades" || url.pathname === "/trades.html") return Response.redirect(`${url.origin}/community${url.search}#marketplace/trades`, 302);
    // Website lockdown (Control Panel): everyone but the owners sees the lock screen
    const locked = await lockdownGate(request, env, url);
    if (locked) return locked;
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
