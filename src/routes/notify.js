// Notifications on phones and computers (Web Push) for members who allow them, and their preferences.
// Kinds: updates (#announcements posts), announcements (staff announcements in game), server (online/offline),
// summary (daily), reward (daily reward reminder), mentions (chat mentions and replies), dms (direct messages).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { sendPush } from "../lib/webpush.js";

export const KINDS = {
  dms: { name: "Direct messages", hint: "When someone sends you a DM", default: true },
  mentions: { name: "Chat mentions & replies", hint: "When someone @mentions you or replies to you in the community", default: true },
  updates: { name: "Announcements", hint: "New posts in #Announcements", default: true },
  announcements: { name: "Server announcements", hint: "Announcements staff send in game", default: true },
  server: { name: "Server online / offline", hint: "When GalaxySMP goes down or comes back online", default: true },
  reward: { name: "Streak reminder", hint: "At most one in the evening, only if your daily streak would end tonight and you have no Streak Freeze", default: true },
  events: { name: "Events", hint: "New events, and a reminder 15 minutes before events you asked to be reminded about", default: true },
  news: { name: "Updates & polls", hint: "New posts in #Updates (when staff choose to notify) and new polls", default: true },
  jobs: { name: "Jobs", hint: "When someone offers to do your job, takes it or finishes it, and when you're hired or paid", default: true },
  friends: { name: "Friends", hint: "Friend requests, and when a friend joins the server", default: true },
  streams: { name: "Stages", hint: "When people and teams you follow go live on stage, and stages you asked to be reminded about", default: true },
  bedwars: { name: "Bedwars games", hint: "When players are waiting for a Bedwars game, so you can join", default: false },
  wishlist: { name: "Wishlist sales", hint: "When something on your Store wishlist is on sale", default: true },
  auction: { name: "Auction House price alerts", hint: "When an item you're watching is listed at or below your price", default: true },
  trades: { name: "Trades", hint: "Trade offers to you, and answers to your offers", default: true },
  community: { name: "Suggestions & builds", hint: "Replies to your suggestions, and Build of the Week", default: true },
  giveaways: { name: "Giveaways", hint: "New giveaways, and when you win one", default: true },
  summary: { name: "Daily summary", hint: "Each evening: who played today, your money and streak", default: true },
};
// How long the bell keeps notifications
export const KEEP = { day: { name: "Past day", sql: "1 day" }, week: { name: "Past week", sql: "7 days" }, month: { name: "Past month", sql: "30 days" },
  all: { name: "Everything (up to a year)", sql: "365 days" }, read: { name: "Only unread (delete once read)", sql: "365 days" } };
const keepOf = (k) => (KEEP[k] ? k : "month");
async function keepFor(sql, userId) {
  const [r] = await sql`SELECT keep FROM notification_prefs WHERE user_id = ${userId}`;
  return keepOf(r?.keep);
}
const prefsOf = (stored) => Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, stored && typeof stored[k] === "boolean" ? stored[k] : v.default]));

// ---------- the member's own settings ----------
export async function getSettings(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [row] = await sql`SELECT prefs, keep FROM notification_prefs WHERE user_id = ${user.id}`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = ${user.id}`;
  return json({ ok: true, publicKey: env.VAPID_PUBLIC_KEY || null, prefs: prefsOf(row?.prefs), kinds: KINDS, devices: n,
    keep: keepOf(row?.keep), keepOptions: Object.entries(KEEP).map(([k, v]) => ({ key: k, name: v.name })) });
}

export async function subscribe(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const sub = body.subscription || {};
  const endpoint = String(sub.endpoint || "");
  const p256dh = String(sub.keys?.p256dh || "");
  const auth = String(sub.keys?.auth || "");
  let host = "";
  try { host = new URL(endpoint).hostname; } catch { /* checked below */ }
  // only real browser push services
  if (!/^https:\/\//.test(endpoint) || !/(googleapis\.com|mozilla\.com|push\.apple\.com|notify\.windows\.com|push\.services\.mozilla\.com)$/.test(host)) {
    throw new HttpError(400, "This browser's notification service isn't supported.");
  }
  if (!/^[A-Za-z0-9_-]{60,120}$/.test(p256dh) || !/^[A-Za-z0-9_-]{10,40}$/.test(auth)) throw new HttpError(400, "That subscription isn't valid.");
  const sql = getDb(env);
  await sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device)
    VALUES (${user.id}, ${endpoint}, ${p256dh}, ${auth}, ${String(body.device || "").slice(0, 60)})
    ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, device = EXCLUDED.device`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = ${user.id}`;
  if (n > 10) { // keep the newest 10 devices
    await sql`DELETE FROM push_subscriptions WHERE id IN (SELECT id FROM push_subscriptions WHERE user_id = ${user.id} ORDER BY id DESC OFFSET 10)`;
  }
  return json({ ok: true });
}

export async function unsubscribe(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  await sql`DELETE FROM push_subscriptions WHERE user_id = ${user.id} AND endpoint = ${String(body.endpoint || "")}`;
  return json({ ok: true });
}

export async function savePrefs(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const [cur] = await sql`SELECT prefs, keep FROM notification_prefs WHERE user_id = ${user.id}`;
  const prefs = body.prefs ? prefsOf(body.prefs) : prefsOf(cur?.prefs);
  const keep = body.keep ? keepOf(body.keep) : keepOf(cur?.keep);
  await sql`INSERT INTO notification_prefs (user_id, prefs, keep) VALUES (${user.id}, ${JSON.stringify(prefs)}::jsonb, ${keep})
            ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, keep = EXCLUDED.keep, updated_at = now()`;
  if (keep === "read") await sql`DELETE FROM notifications WHERE user_id = ${user.id} AND read_at IS NOT NULL`;
  else await sql`DELETE FROM notifications WHERE user_id = ${user.id} AND created_at < now() - ${KEEP[keep].sql}::interval`;
  return json({ ok: true, prefs, keep });
}

export async function testPush(request, env) {
  const user = await requireUser(request, env);
  const sent = await notify(env, [user.id], null, { title: "Notifications are on", body: "You'll get GalaxySMP notifications on this device.", url: "/community", tag: "test" });
  if (!sent) throw new HttpError(409, "No device got it. Turn notifications on again on this device.");
  return json({ ok: true, sent });
}

// ---------- the inbox (the bell at the top of every page) ----------
// Personal notifications are also kept for 60 days so nothing is missed without a phone notification.
// Reminders and summaries aren't kept. A newer notification with the same tag replaces the older one.
const NOT_IN_INBOX = new Set(["summary", "reward", "server"]);
async function toInbox(sql, ids, kind, m) {
  const title = String(m.title || "GalaxySMP").slice(0, 80), body = String(m.body || "").slice(0, 200);
  const raw = String(m.url || "/");
  const url = /^\/(?!\/)/.test(raw) && !raw.includes("\\") ? raw.slice(0, 200) : "/";   // a page on this site only (never //other-site)
  const tag = m.tag ? String(m.tag).slice(0, 80) : null;
  await sql`INSERT INTO notifications (user_id, kind, title, body, url, tag)
            SELECT x, ${kind}, ${title}, ${body}, ${url}, ${tag} FROM unnest(${ids}::bigint[]) AS x
            ON CONFLICT (user_id, tag) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, body = EXCLUDED.body, url = EXCLUDED.url,
                                                    created_at = now(), read_at = NULL`;
}

// GET /api/inbox
export async function inbox(request, env, ctx, url) {
  const user = await requireUser(request, env);
  if (url?.searchParams.has("count")) return json({ ok: true, unread: await unreadCount(getDb(env), user.id) }, 200, { "Cache-Control": "no-store" });
  const sql = getDb(env);
  const keep = await keepFor(sql, user.id);
  const rows = await sql`SELECT id, kind, title, body, url, created_at, read_at FROM notifications
                          WHERE user_id = ${user.id} AND created_at > now() - ${KEEP[keep].sql}::interval
                            AND (${keep} <> 'read' OR read_at IS NULL)
                          ORDER BY created_at DESC LIMIT 100`;
  return json({ ok: true, unread: rows.filter((r) => !r.read_at).length,
    items: rows.map((r) => ({ id: Number(r.id), kind: r.kind, title: r.title, body: r.body, url: r.url, at: r.created_at, read: Boolean(r.read_at) })) },
    200, { "Cache-Control": "no-store" });
}

// POST /api/inbox { action: "read", id? } (no id = everything) | { action: "clear" }
export async function inboxAction(request, env) {
  const user = await requireUser(request, env);
  const b = await readJson(request);
  const sql = getDb(env);
  if (b.action === "clear") await sql`DELETE FROM notifications WHERE user_id = ${user.id}`;
  else if (b.id) await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${user.id} AND id = ${Number(b.id)} AND read_at IS NULL`;
  else await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${user.id} AND read_at IS NULL`;
  if (b.action !== "clear" && (await keepFor(sql, user.id)) === "read") await sql`DELETE FROM notifications WHERE user_id = ${user.id} AND read_at IS NOT NULL`;
  return json({ ok: true });
}

export async function unreadCount(sql, userId) {
  const keep = await keepFor(sql, userId);
  const [r] = await sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId} AND read_at IS NULL AND created_at > now() - ${KEEP[keep].sql}::interval`;
  return r.n;
}

// "/community#suggestions/5" -> "suggestions"; "/community#dm-12" -> "dm:12". Pages outside Community: none.
function viewFromUrl(url) {
  const m = /^\/community#([a-z0-9-]+)/.exec(String(url || ""));
  if (!m) return null;
  const dm = /^dm-(\d+)$/.exec(m[1]);
  return dm ? `dm:${dm[1]}` : m[1];
}

// ---------- sending ----------
// userIds: an array of user ids, or "all". kind: a KINDS key (null = always, e.g. a test).
// Returns how many devices got it.
// options.exclude: user ids that never get this one (e.g. whoever made the announcement)
export async function notify(env, userIds, kind, message, options = {}) {
  const sql = getDb(env);
  const skip = new Set((options.exclude || []).map(Number));
  // Nobody is notified about something they're looking at right now (e.g. #Suggestions open on screen).
  // The page a notification opens says what it's about: "/community#suggestions/5" -> "suggestions"; options.view overrides.
  const view = options.view || viewFromUrl(message?.url);
  if (view && userIds !== "all") {
    try {
      const { hubStub } = await import("./chat.js");
      const r = await hubStub(env).fetch(`https://hub/internal/viewers?view=${encodeURIComponent(view)}`).then((x) => x.json());
      for (const id of r.ids || []) skip.add(Number(id));
    } catch { /* best effort */ }
  }
  const ids = userIds === "all" ? null : [...new Set(userIds.map(Number).filter((id) => id && !skip.has(id)))];
  if (ids && !ids.length) return 0;
  if (ids && kind && !NOT_IN_INBOX.has(kind)) await toInbox(sql, ids, kind, message).catch((e) => console.error("inbox failed", e));
  if (!env.VAPID_PRIVATE_KEY) return 0;
  const exclude = [...skip];
  const def = kind ? KINDS[kind].default : true;
  const subs = await sql`
    SELECT s.id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN notification_prefs n ON n.user_id = s.user_id
     WHERE NOT u.banned
       AND (${ids === null} OR s.user_id = ANY(${ids || []}::bigint[]))
       AND NOT (s.user_id = ANY(${exclude}::bigint[]))
       AND (${kind === null} OR coalesce((n.prefs ->> ${kind || "x"})::boolean, ${def}))
     LIMIT 2000`;
  if (env.DEBUG_PUSH) console.log("PUSHDEBUG", kind, JSON.stringify(ids), "exclude", JSON.stringify(exclude), "devices", subs.length);
  if (!subs.length) return 0;
  const payload = {
    title: String(message.title || "GalaxySMP").slice(0, 80),
    body: String(message.body || "").slice(0, 200),
    url: /^\/(?!\/)/.test(String(message.url || "")) ? message.url : "/",
    tag: message.tag || kind || "galaxysmp",
    ttl: message.ttl,
    urgent: message.urgent,
  };
  let ok = 0;
  const gone = [];
  const good = [];
  for (let i = 0; i < subs.length; i += 25) { // 25 at a time
    const batch = subs.slice(i, i + 25);
    const results = await Promise.all(batch.map((s) => sendPush(env, s, payload)));
    results.forEach((r, j) => {
      if (r === "ok") { ok++; good.push(Number(batch[j].id)); }
      else if (r === "gone") gone.push(Number(batch[j].id));
    });
  }
  if (gone.length) await sql`DELETE FROM push_subscriptions WHERE id = ANY(${gone}::bigint[])`;
  if (good.length) await sql`UPDATE push_subscriptions SET last_ok_at = now() WHERE id = ANY(${good}::bigint[])`;
  return ok;
}

// ---------- daily notifications (Cloudflare cron) ----------
export async function daily(env, cron) {
  if (!cron.startsWith("5 16") && !cron.startsWith("35 0")) return 0;
  const sql = getDb(env);
  const etToday = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10); // US Eastern date (close enough)
  if (cron.startsWith("5 16")) return 0;  // (the old midday reminder; streak reminders are now in the evening, only when needed)
  // One gentle streak reminder in the evening (US Eastern), only when a streak of 3+ days would end tonight:
  // not claimed today, claimed yesterday, and no Streak Freeze to save it.
  const atRisk = await sql`
    SELECT u.id, p.streak FROM users u JOIN players p ON p.uuid = u.mc_uuid
     WHERE NOT u.banned AND p.streak >= 3 AND coalesce(p.freezes, 0) = 0 AND p.last_daily = ${etToday}::date - 1`;
  for (const r of atRisk) {
    await notify(env, [r.id], "reward", {
      title: `Keep your ${r.streak}-day streak`, body: "Hop on GalaxySMP and type /daily before midnight to keep it going.", url: "/", tag: "streak", ttl: 4 * 3600,
    }).catch(() => {});
  }
  const [{ played }] = await sql`SELECT count(*)::int AS played FROM players WHERE last_seen > now() - interval '24 hours'`;
  const rows = await sql`
    SELECT DISTINCT u.id, p.balance_cents, p.streak FROM push_subscriptions s JOIN users u ON u.id = s.user_id
      LEFT JOIN players p ON p.uuid = u.mc_uuid`;
  let sent = 0;
  // one personal message each (money and streak differ)
  for (const r of rows) {
    const money = r.balance_cents == null ? null : `$${(Number(r.balance_cents) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    const you = [money ? `You have ${money}` : null, r.streak ? `${r.streak}-day streak` : null].filter(Boolean).join(", ");
    sent += await notify(env, [r.id], "summary", {
      title: "Today on GalaxySMP",
      body: `${played} player${played === 1 ? "" : "s"} played today.${you ? ` ${you}.` : ""}`,
      url: "/leaderboard", tag: "summary", ttl: 8 * 3600,
    });
  }
  return sent;
}
