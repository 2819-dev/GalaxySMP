// Status page: day-by-day uptime for the last 30 days and recent outages (from server_uptime, which the
// plugin keeps up to date about once a minute while the server is online) plus unexpected restarts
// (crash reports). No player names: this is public.
import { getDb } from "../lib/db.js";
import { json } from "../lib/http.js";

const DAYS = 30;
const MIN_GAP = 3 * 60e3; // shorter gaps are normal restarts, not outages

export async function uptime(request, env) {
  const sql = getDb(env);
  const now = Date.now();
  const from = now - DAYS * 864e5;
  const [rows, crashes, first] = await Promise.all([
    sql`SELECT started_at, ended_at FROM server_uptime WHERE ended_at > to_timestamp(${from / 1000}) ORDER BY started_at`,
    sql`SELECT created_at, details->>'lastSeenAt' AS at FROM audit_log WHERE action = 'server.crash' AND created_at > to_timestamp(${from / 1000})`,
    sql`SELECT min(started_at) AS t FROM server_uptime`,
  ]);
  const since = Math.max(from, first[0]?.t ? new Date(first[0].t).getTime() : now);
  const spans = rows.map((r) => [Math.max(since, new Date(r.started_at).getTime()), Math.min(now, new Date(r.ended_at).getTime() + 90e3)]);
  // merge overlaps
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([...s]);
  }
  const covered = (a, b) => merged.reduce((n, [x, y]) => n + Math.max(0, Math.min(y, b) - Math.max(x, a)), 0);
  const crashAt = crashes.map((c) => Number(c.at) || new Date(c.created_at).getTime());
  const days = [];
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  for (let i = DAYS - 1; i >= 0; i--) {
    const a = start.getTime() - i * 864e5, b = Math.min(now, a + 864e5);
    if (b <= since) { days.push({ day: new Date(a).toISOString().slice(0, 10), pct: null, restarts: 0 }); continue; }
    const lo = Math.max(a, since);
    days.push({ day: new Date(a).toISOString().slice(0, 10), pct: Math.round((covered(lo, b) / (b - lo)) * 1000) / 10,
      restarts: crashAt.filter((t) => t >= a && t < b).length });
  }
  const outages = [];
  for (let i = 1; i < merged.length; i++) {
    const a = merged[i - 1][1], b = merged[i][0];
    if (b - a >= MIN_GAP) outages.push({ from: a, to: b, minutes: Math.round((b - a) / 60e3) });
  }
  const week = now - 7 * 864e5;
  const lo = Math.max(week, since);
  return json({
    ok: true,
    week: now > lo ? Math.round((covered(lo, now) / (now - lo)) * 1000) / 10 : null,
    month: now > since ? Math.round((covered(since, now) / (now - since)) * 1000) / 10 : null,
    restartsWeek: crashAt.filter((t) => t >= week).length,
    days,
    outages: outages.reverse().slice(0, 8),
    restarts: crashAt.sort((x, y) => y - x).slice(0, 8),
  }, 200, { "Cache-Control": "public, max-age=120" });
}
