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
  minor: { name: "Minor updates", hint: "Small updates posted in #Updates", default: false },
  announcements: { name: "Server announcements", hint: "Announcements staff send in game", default: true },
  server: { name: "Server online / offline", hint: "When GalaxySMP goes down or comes back online", default: true },
  reward: { name: "Daily reward reminder", hint: "Around noon (US Eastern) if you haven't claimed /daily yet", default: true },
  events: { name: "Events", hint: "New events, and a reminder 15 minutes before events you asked to be reminded about", default: true },
  news: { name: "News & polls", hint: "New posts in #News and new polls", default: true },
  trades: { name: "Trades", hint: "Trade offers to you, and answers to your offers", default: true },
  community: { name: "Suggestions & builds", hint: "Replies to your suggestions, and Build of the Week", default: true },
  summary: { name: "Daily summary", hint: "Each evening: who played today, your money and streak", default: true },
};
const prefsOf = (stored) => Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, stored && typeof stored[k] === "boolean" ? stored[k] : v.default]));

// ---------- the member's own settings ----------
export async function getSettings(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [row] = await sql`SELECT prefs FROM notification_prefs WHERE user_id = ${user.id}`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = ${user.id}`;
  return json({ ok: true, publicKey: env.VAPID_PUBLIC_KEY || null, prefs: prefsOf(row?.prefs), kinds: KINDS, devices: n });
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
  const prefs = prefsOf(body.prefs);
  const sql = getDb(env);
  await sql`INSERT INTO notification_prefs (user_id, prefs) VALUES (${user.id}, ${JSON.stringify(prefs)}::jsonb)
            ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()`;
  return json({ ok: true, prefs });
}

export async function testPush(request, env) {
  const user = await requireUser(request, env);
  const sent = await notify(env, [user.id], null, { title: "Notifications are on", body: "You'll get GalaxySMP notifications on this device.", url: "/community", tag: "test" });
  if (!sent) throw new HttpError(409, "No device got it. Turn notifications on again on this device.");
  return json({ ok: true, sent });
}

// ---------- sending ----------
// userIds: an array of user ids, or "all". kind: a KINDS key (null = always, e.g. a test).
// Returns how many devices got it.
// options.exclude: user ids that never get this one (e.g. whoever made the announcement)
export async function notify(env, userIds, kind, message, options = {}) {
  if (!env.VAPID_PRIVATE_KEY) return 0;
  const sql = getDb(env);
  const skip = new Set((options.exclude || []).map(Number));
  const ids = userIds === "all" ? null : [...new Set(userIds.map(Number).filter((id) => id && !skip.has(id)))];
  if (ids && !ids.length) return 0;
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
    url: message.url || "/",
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
  if (cron.startsWith("5 16")) {
    // reward reminder: linked players who haven't claimed today
    const rows = await sql`
      SELECT u.id FROM users u JOIN players p ON p.uuid = u.mc_uuid
       WHERE p.last_daily IS NULL OR p.last_daily < ${etToday}::date`;
    return notify(env, rows.map((r) => r.id), "reward", {
      title: "Your daily reward is ready", body: "Join GalaxySMP and type /daily to claim it (and keep your streak going).", url: "/", tag: "reward", ttl: 6 * 3600,
    });
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
