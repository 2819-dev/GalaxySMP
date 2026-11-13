// Galaxy Wrapped: a story-style recap like Spotify's.
//   - The big one, for the year: out on December 1 (covers January to November).
//   - A smaller recap every 2 months: Jan+Feb (out March 1), Mar+Apr (May 1), ... Nov+Dec (January 1).
// Everything comes from what the website already keeps: daily stat totals (player_stats_daily), play sessions,
// chat messages, reactions, #Jobs, trades, builds and achievements on the #Timeline. A recap is worked out the
// first time it's opened after it comes out, then saved, so it never changes. The owner can preview the
// period that's still going.
import { getDb } from "../lib/db.js";
import { json, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";
import { achievementDefs } from "./progress.js";
import { postTimeline } from "./feed.js";
import { notify } from "./notify.js";

const TZ = "America/New_York";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NEW_DAYS = 31;          // a recap counts as "new" (banner, notification) this long after it comes out
const MIN_PLAY = 10 * 60;     // less than this in the period: a short "quiet" recap

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m) => `${y}-${pad(m)}-01`;  // m: 1-12
const owner = (env, u) => Boolean(u.owner) || isOwner(env, u.username, u.platform === "bedrock");

// Today in New York, as { y, m, d }.
function today(now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now).split("-").map(Number);
  return { y, m, d };
}
const dayNum = ({ y, m, d }) => y * 10000 + m * 100 + d;

// '2026' = the year, '2026-09' = Sep + Oct. Dates are New York dates; end is exclusive.
export function periodInfo(key) {
  let m = /^(\d{4})$/.exec(String(key));
  if (m) {
    const y = Number(m[1]);
    return { key: String(y), kind: "year", year: y, start: ymd(y, 1), end: ymd(y, 12), release: ymd(y, 12),
      title: `${y} Wrapped`, short: String(y), range: `January to November ${y}` };
  }
  m = /^(\d{4})-(\d{2})$/.exec(String(key));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 11 || mo % 2 === 0) return null;
  const endY = mo === 11 ? y + 1 : y, endM = mo === 11 ? 1 : mo + 2;
  return { key: `${y}-${pad(mo)}`, kind: "recap", year: y, start: ymd(y, mo), end: ymd(endY, endM), release: ymd(endY, endM),
    title: `${MONTHS[mo - 1]}–${MONTHS[mo]} ${y} Recap`, short: `${MONTHS[mo - 1]}–${MONTHS[mo]}`, range: `${LONG[mo - 1]} and ${LONG[mo]} ${y}` };
}

const released = (p, t = today()) => dayNum(t) >= Number(p.release.replaceAll("-", ""));
const ageDays = (p, now = new Date()) => (now - new Date(`${p.release}T12:00:00Z`)) / 864e5;

// Every period that has come out since the server's history starts, newest first.
export function releasedPeriods(firstDay, t = today()) {
  const out = [];
  for (let y = t.y; y >= 2026; y--) {
    for (const key of [String(y), ...[11, 9, 7, 5, 3, 1].map((mo) => `${y}-${pad(mo)}`)]) {
      const p = periodInfo(key);
      if (released(p, t) && (!firstDay || p.end > firstDay)) out.push(p);
    }
  }
  return out.sort((a, b) => (a.release === b.release ? (a.kind === "year" ? -1 : 1) : a.release < b.release ? 1 : -1));
}

// The period going on now (for the owner's preview), cut off at today.
function previewPeriod(kind, t = today()) {
  const mo = t.m % 2 ? t.m : t.m - 1;
  const p = kind === "year" ? periodInfo(String(t.y)) : periodInfo(`${t.y}-${pad(mo)}`);
  const tomorrow = new Date(Date.UTC(t.y, t.m - 1, t.d + 1)).toISOString().slice(0, 10);
  return { ...p, key: kind === "year" ? "preview-year" : "preview", end: p.end < tomorrow ? p.end : tomorrow, preview: true,
    title: `${p.title} (preview)` };
}

// ---------- the numbers ----------
const FIELDS = ["playtime_s", "mined", "placed", "balance_cents", "kills", "quests", "achievements", "bw_wins", "bw_kills"];

// What changed in the period for each player (stats are running totals, one row per day).
async function periodDeltas(sql, p) {
  const rows = await sql`
    WITH inside AS (
      SELECT DISTINCT ON (xuid) * FROM player_stats_daily WHERE day >= ${p.start}::date AND day < ${p.end}::date ORDER BY xuid, day DESC
    ), first_in AS (
      SELECT DISTINCT ON (xuid) * FROM player_stats_daily WHERE day >= ${p.start}::date AND day < ${p.end}::date ORDER BY xuid, day
    ), before AS (
      SELECT DISTINCT ON (xuid) * FROM player_stats_daily WHERE day < ${p.start}::date ORDER BY xuid, day DESC
    )
    SELECT i.xuid, pl.gamertag, (pl.first_seen >= ${p.start}::date) AS joined_now,
           row_to_json(i) AS l, row_to_json(b) AS b, row_to_json(f) AS f
      FROM inside i JOIN first_in f ON f.xuid = i.xuid JOIN players pl ON pl.xuid = i.xuid LEFT JOIN before b ON b.xuid = i.xuid`;
  return rows.map((r) => {
    const d = { xuid: r.xuid, name: r.gamertag, joined: r.joined_now };
    for (const f of FIELDS) {
      const last = r.l?.[f];
      if (last == null) { d[f] = 0; continue; }
      // before the period; if we don't know (new stats, or history started inside the period): 0 for brand-new players, else the first day we have
      const base = r.b?.[f] ?? (r.joined_now ? 0 : r.f?.[f] ?? last);
      d[f] = Number(last) - Number(base);
    }
    return d;
  });
}

const pctBelow = (values, v) => (values.length > 1 ? Math.round((values.filter((x) => x < v).length / (values.length - 1)) * 100) : 100);

async function serverFacts(sql, p, deltas) {
  const sum = (f) => deltas.reduce((n, d) => n + Math.max(0, d[f]), 0);
  const [[newbies], [busy], [msgs], [jobs], top] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM players WHERE first_seen >= ${p.start}::date AND first_seen < ${p.end}::date`,
    sql`SELECT (started_at AT TIME ZONE ${TZ})::date::text AS day, max(peak)::int AS peak FROM server_uptime
         WHERE started_at >= ${p.start}::date AND started_at < ${p.end}::date GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1`,
    sql`SELECT count(*)::int AS n FROM messages WHERE deleted_at IS NULL AND created_at >= ${p.start}::date AND created_at < ${p.end}::date`,
    sql`SELECT count(*)::int AS n, coalesce(sum(reward_cents), 0)::bigint AS paid FROM jobs WHERE status = 'done' AND finished_at >= ${p.start}::date AND finished_at < ${p.end}::date`.catch(() => [{ n: 0, paid: 0 }]),
    Promise.resolve([...deltas].sort((a, b) => b.playtime_s - a.playtime_s).filter((d) => d.playtime_s > 0).slice(0, 5)),
  ]);
  return {
    players: deltas.filter((d) => d.playtime_s > 0).length,
    hours: Math.round(sum("playtime_s") / 3600), mined: sum("mined"), placed: sum("placed"), bwWins: sum("bw_wins"),
    newPlayers: newbies.n, busiestDay: busy ? { day: busy.day, peak: busy.peak } : null,
    messages: msgs.n, jobsDone: jobs.n, jobsPaid: Number(jobs.paid),
    top: top.map((d) => ({ name: d.name, hours: Math.round((d.playtime_s / 3600) * 10) / 10 })),
  };
}

const ARCHETYPES = {
  miner: { name: "The Deep Miner", line: "Always digging deeper. The caves know your name.", icon: "pickaxe" },
  builder: { name: "The Architect", line: "Block by block, you shaped the server.", icon: "castle" },
  warrior: { name: "The Warrior", line: "Mobs and Bedwars beds fear you.", icon: "sword" },
  tycoon: { name: "The Tycoon", line: "Money comes to you. Business is booming.", icon: "coins" },
  social: { name: "The Social Butterfly", line: "The community wouldn't be the same without you.", icon: "chat" },
  nightowl: { name: "The Night Owl", line: "When everyone sleeps, you play.", icon: "moon" },
  explorer: { name: "The Adventurer", line: "A bit of everything, always on the move.", icon: "map" },
};

async function playerFacts(sql, p, me, deltas, server) {
  const xuid = me.xuid;
  const others = (f) => deltas.map((d) => d[f]);
  const [[u], sessions, hours, friends, achPosts, players] = await Promise.all([
    sql`SELECT u.id FROM users u JOIN players pl ON pl.uuid = u.mc_uuid WHERE pl.xuid = ${xuid} LIMIT 1`,
    sql`SELECT count(DISTINCT (started_at AT TIME ZONE ${TZ})::date)::int AS days,
               coalesce(max(extract(epoch FROM ended_at - started_at)), 0)::int AS longest, count(*)::int AS n
          FROM player_sessions WHERE xuid = ${xuid} AND started_at >= ${p.start}::date AND started_at < ${p.end}::date AND ended_at - started_at > interval '1 minute'`,
    sql`SELECT extract(hour FROM started_at AT TIME ZONE ${TZ})::int AS h, extract(dow FROM started_at AT TIME ZONE ${TZ})::int AS dow,
               sum(extract(epoch FROM ended_at - started_at))::int AS secs
          FROM player_sessions WHERE xuid = ${xuid} AND started_at >= ${p.start}::date AND started_at < ${p.end}::date GROUP BY 1, 2`,
    sql`SELECT b.xuid, pl.gamertag AS name, sum(extract(epoch FROM least(a.ended_at, b.ended_at) - greatest(a.started_at, b.started_at)))::int AS secs
          FROM player_sessions a JOIN player_sessions b ON b.xuid <> a.xuid AND a.started_at < b.ended_at AND b.started_at < a.ended_at
          JOIN players pl ON pl.xuid = b.xuid
         WHERE a.xuid = ${xuid} AND a.started_at >= ${p.start}::date AND a.started_at < ${p.end}::date
         GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 3`,
    sql`SELECT dedupe FROM timeline_posts WHERE kind = 'achievement' AND xuid = ${xuid} AND deleted_at IS NULL
           AND created_at >= ${p.start}::date AND created_at < ${p.end}::date`,
    sql`SELECT achievements FROM players`,
  ]);
  const s = sessions[0];
  // when they play
  const byPart = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  const byDay = Array(7).fill(0);
  for (const r of hours) {
    const part = r.h >= 6 && r.h < 12 ? "morning" : r.h >= 12 && r.h < 17 ? "afternoon" : r.h >= 17 && r.h < 22 ? "evening" : "night";
    byPart[part] += r.secs;
    byDay[r.dow] += r.secs;
  }
  const part = Object.entries(byPart).sort((a, b) => b[1] - a[1])[0];
  const dayIdx = byDay.indexOf(Math.max(...byDay));
  // achievements unlocked in the period, and the rarest one
  const defs = new Map((await achievementDefs(sql)).map((a) => [a.id, a]));
  const got = [...new Set(achPosts.flatMap((r) => String(r.dedupe || "").split(":").slice(2).join(":").split(",")).filter((id) => defs.has(id)))];
  const owners = (id) => players.filter((r) => (r.achievements || []).includes(id)).length;
  const rarest = got.map((id) => ({ id, n: owners(id) })).sort((a, b) => a.n - b.n)[0];
  // website
  let web = { messages: 0, channel: null, reactions: 0, emoji: null, dms: 0, builds: 0, jobsDone: 0, jobsEarned: 0, jobsPosted: 0, trades: 0 };
  if (u) {
    const uid = u.id;
    const [[m], [ch], [rx], [em], [dm], [bd], [jb], [jp], [tr]] = await Promise.all([
      sql`SELECT count(*)::int AS n FROM messages WHERE user_id = ${uid} AND deleted_at IS NULL AND created_at >= ${p.start}::date AND created_at < ${p.end}::date`,
      sql`SELECT c.name, count(*)::int AS n FROM messages m JOIN channels c ON c.id = m.channel_id
           WHERE m.user_id = ${uid} AND m.deleted_at IS NULL AND NOT c.staff_only AND m.created_at >= ${p.start}::date AND m.created_at < ${p.end}::date
           GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
      sql`SELECT count(*)::int AS n FROM reactions r JOIN messages m ON m.id = r.message_id
           WHERE m.user_id = ${uid} AND r.user_id <> ${uid} AND r.created_at >= ${p.start}::date AND r.created_at < ${p.end}::date`,
      sql`SELECT emoji, count(*)::int AS n FROM reactions WHERE user_id = ${uid} AND created_at >= ${p.start}::date AND created_at < ${p.end}::date
           GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
      sql`SELECT count(*)::int AS n FROM dm_messages WHERE sender_id = ${uid} AND created_at >= ${p.start}::date AND created_at < ${p.end}::date`,
      sql`SELECT count(*)::int AS n FROM builds WHERE user_id = ${uid} AND deleted_at IS NULL AND created_at >= ${p.start}::date AND created_at < ${p.end}::date`,
      sql`SELECT count(*)::int AS n, coalesce(sum(reward_cents), 0)::bigint AS c FROM jobs WHERE worker_id = ${uid} AND status = 'done' AND finished_at >= ${p.start}::date AND finished_at < ${p.end}::date`.catch(() => [{ n: 0, c: 0 }]),
      sql`SELECT count(*)::int AS n FROM jobs WHERE poster_id = ${uid} AND status <> 'creating' AND created_at >= ${p.start}::date AND created_at < ${p.end}::date`.catch(() => [{ n: 0 }]),
      sql`SELECT count(*)::int AS n FROM trades WHERE (seller_xuid = ${xuid} OR buyer_xuid = ${xuid}) AND status = 'accepted' AND decided_at >= ${p.start}::date AND decided_at < ${p.end}::date`.catch(() => [{ n: 0 }]),
    ]);
    web = { messages: m.n, channel: ch?.name || null, reactions: rx.n, emoji: em?.emoji || null, dms: dm.n, builds: bd.n,
      jobsDone: jb.n, jobsEarned: Number(jb.c), jobsPosted: jp.n, trades: tr.n };
  }
  const play = me.playtime_s;
  // what kind of player: the thing they did most, compared with everyone else
  const score = {
    miner: pctBelow(others("mined"), me.mined) * (me.mined > 200 ? 1 : 0),
    builder: pctBelow(others("placed"), me.placed) * (me.placed > 200 ? 1 : 0),
    warrior: Math.max(pctBelow(others("kills"), me.kills) * (me.kills > 20 ? 1 : 0), pctBelow(others("bw_wins"), me.bw_wins) * (me.bw_wins > 2 ? 1 : 0)),
    tycoon: pctBelow(others("balance_cents"), me.balance_cents) * (me.balance_cents > 50000 ? 1 : 0),
    social: web.messages + web.dms > 40 ? 90 + Math.min(10, web.messages / 50) : 0,
    nightowl: play > 3600 && byPart.night / Math.max(1, play) > 0.45 ? 95 : 0,
  };
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  const type = best && best[1] >= 50 ? best[0] : "explorer";
  return {
    name: me.name,
    quiet: play < MIN_PLAY,
    hours: Math.round((play / 3600) * 10) / 10,
    playPct: pctBelow(others("playtime_s"), play),
    days: s.days, sessions: s.n, longestMin: Math.round(s.longest / 60),
    partOfDay: part && part[1] > 0 ? part[0] : null, favoriteDay: Math.max(...byDay) > 0 ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIdx] : null,
    mined: Math.max(0, me.mined), placed: Math.max(0, me.placed), minedPct: pctBelow(others("mined"), me.mined), placedPct: pctBelow(others("placed"), me.placed),
    money: me.balance_cents, kills: Math.max(0, me.kills), quests: Math.max(0, me.quests), bwWins: Math.max(0, me.bw_wins), bwKills: Math.max(0, me.bw_kills),
    achievements: got.length,
    rarest: rarest ? { name: defs.get(rarest.id).name, pct: Math.max(1, Math.round((rarest.n / Math.max(1, players.length)) * 100)) } : null,
    friends: friends.filter((f) => f.secs > 300).map((f) => ({ name: f.name, hours: Math.round((f.secs / 3600) * 10) / 10 })),
    web,
    type: { key: type, ...ARCHETYPES[type] },
    joined: me.joined,
  };
}

async function build(sql, p, xuid) {
  const deltas = await periodDeltas(sql, p);
  const server = await serverFacts(sql, p, deltas);
  const me = deltas.find((d) => d.xuid === xuid);
  const mine = me ? await playerFacts(sql, p, me, deltas, server) : null;
  return { server, me: mine };
}

async function firstDay(sql) {
  const [r] = await sql`SELECT min(day)::text AS d FROM player_stats_daily`;
  return r?.d || null;
}

const periodOut = (p) => ({ key: p.key, kind: p.kind, title: p.title, short: p.short, range: p.range, release: p.release, isNew: !p.preview && ageDays(p) < NEW_DAYS, preview: Boolean(p.preview) });

// GET /api/wrapped: the recaps you can watch
export async function list(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const periods = releasedPeriods(await firstDay(sql));
  const out = periods.map(periodOut);
  return json({ ok: true, periods: out, featured: out.find((p) => p.isNew)?.key || null, canPreview: owner(env, user),
    next: nextRelease() });
}

function nextRelease(t = today()) {
  // the next 1st of an odd month, or Dec 1
  for (let i = 0; i < 14; i++) {
    const y = t.y + Math.floor((t.m - 1 + i) / 12), m = ((t.m - 1 + i) % 12) + 1;
    if (i === 0 && t.d > 1) continue;
    if (m % 2 === 1 || m === 12) {
      const key = m === 12 ? String(y) : m === 1 ? `${y - 1}-11` : `${y}-${pad(m - 2)}`;
      const p = periodInfo(key);
      if (p && !released(p, t)) return { key: p.key, title: p.title, release: p.release };
    }
  }
  return null;
}

async function playerOf(sql, userId) {
  const [p] = await sql`SELECT p.xuid, p.gamertag FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${userId}`;
  return p || null;
}

// GET /api/wrapped/:key
export async function get(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const key = String(params.key || "");
  let p;
  if (key === "preview" || key === "preview-year") {
    if (!owner(env, user)) throw new HttpError(403, "Only the owner can preview a recap before it comes out.");
    p = previewPeriod(key === "preview" ? "recap" : "year");
  } else {
    p = periodInfo(key);
    if (!p || !released(p)) throw new HttpError(404, "That recap isn't out yet.");
  }
  const me = await playerOf(sql, user.id);
  const asXuid = me?.xuid || "";
  let data;
  if (p.preview) {
    data = await build(sql, p, asXuid);
  } else {
    const [server] = await sql`SELECT data FROM wrapped WHERE xuid = 'server' AND period = ${p.key}`;
    const [mine] = asXuid ? await sql`SELECT data FROM wrapped WHERE xuid = ${asXuid} AND period = ${p.key}` : [];
    if (server && (mine || !asXuid)) {
      data = { server: server.data, me: mine?.data?.me ?? null };
    } else {
      data = await build(sql, p, asXuid);
      await sql`INSERT INTO wrapped (xuid, period, data) VALUES ('server', ${p.key}, ${JSON.stringify(data.server)}::jsonb) ON CONFLICT DO NOTHING`;
      if (asXuid) await sql`INSERT INTO wrapped (xuid, period, data) VALUES (${asXuid}, ${p.key}, ${JSON.stringify({ me: data.me })}::jsonb) ON CONFLICT DO NOTHING`;
      // whoever was first decides the saved version (so two tabs can't disagree)
      const [s2] = await sql`SELECT data FROM wrapped WHERE xuid = 'server' AND period = ${p.key}`;
      data.server = s2?.data || data.server;
    }
  }
  return json({ ok: true, period: periodOut(p), linked: Boolean(me), ...data }, 200, { "Cache-Control": "no-store" });
}

// POST /api/wrapped/:key/share: posts your recap's highlights on #Timeline
export async function share(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  const sql = getDb(env);
  const p = periodInfo(String(params.key || ""));
  if (!p || !released(p)) throw new HttpError(404, "That recap isn't out yet.");
  const me = await playerOf(sql, user.id);
  if (!me) throw new HttpError(400, "Link your Minecraft account first.");
  const [row] = await sql`SELECT data FROM wrapped WHERE xuid = ${me.xuid} AND period = ${p.key}`;
  const d = row?.data?.me;
  if (!d) throw new HttpError(409, "Open your recap first.");
  const bits = [`${d.hours}h played`, d.mined ? `${d.mined.toLocaleString("en-US")} blocks mined` : null, d.placed ? `${d.placed.toLocaleString("en-US")} placed` : null, d.type?.name].filter(Boolean);
  await postTimeline(sql, { kind: "wrapped", xuid: me.xuid, name: me.gamertag, title: `shared their ${p.title}`, detail: bits.join(" · "), icon: "sparkles", dedupe: `wrapped:${me.xuid}:${p.key}` });
  return json({ ok: true, message: "Shared to #Timeline." });
}

// Every 5 minutes: when a recap comes out, tell everyone once (notification + a post in #Updates).
export async function wrappedTick(env, sql = getDb(env)) {
  const fresh = releasedPeriods(await firstDay(sql)).filter((p) => ageDays(p) < 2);
  for (const p of fresh) {
    const [done] = await sql`SELECT 1 FROM economy_config WHERE key = ${`wrapped_out:${p.key}`}`;
    if (done) continue;
    await sql`INSERT INTO economy_config (key, value) VALUES (${`wrapped_out:${p.key}`}, ${JSON.stringify(new Date().toISOString())}::jsonb) ON CONFLICT DO NOTHING`;
    const big = p.kind === "year";
    const body = big
      ? `Your ${p.year} on GalaxySMP is ready: how long you played, what you mined and built, who you played with most, what kind of player you are, and the whole server's year. Watch it at galaxymc.us/wrapped and share your card!`
      : `Your recap for ${p.range} is ready: your playtime, blocks, best friend on the server, and how the whole server did. Watch it at galaxymc.us/wrapped.`;
    await sql`INSERT INTO news_posts (title, body, tag) VALUES (${big ? `${p.year} Wrapped is here!` : `${p.title} is here`}, ${body}, 'recap')`.catch((e) => console.error("wrapped news post failed", e));
    await notify(env, "all", "news", { title: big ? `Your ${p.year} Wrapped is here!` : `Your ${p.short} recap is ready`, body: big ? "See your year on GalaxySMP." : "See your last 2 months on GalaxySMP.", url: "/wrapped", tag: `wrapped-${p.key}` }).catch(() => {});
  }
}
