// Community channels that aren't plain chat: Auction House and Suggestions.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { isOwner } from "../lib/names.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { voiceStub } from "./voice.js";

const STAFF = 50;

// ---------- Auction House (listings come live from the server) ----------
export async function auctionList(request, env) {
  await requireUser(request, env);
  const data = await voiceStub(env).fetch("https://voice/internal/ah").then((r) => r.json());
  const now = Date.now() / 1000;
  const listings = (data.listings || []).filter((l) => !l.expires || l.expires > now);
  // average price per item (each) over the last 30 days, so buyers can tell a good deal
  const items = [...new Set(listings.map((l) => String(l.item)))];
  const avg = items.length ? await getDb(env)`SELECT item_id, round(avg(unit_cents))::bigint AS unit, count(*)::int AS n FROM ah_sales
                                               WHERE item_id = ANY(${items}) AND sold_at > now() - interval '30 days' GROUP BY item_id`.catch(() => []) : [];
  const byItem = new Map(avg.map((r) => [r.item_id, { unit: Number(r.unit), sales: r.n }]));
  return json({ ok: true, updated: data.at, listings: listings.map((l) => ({ ...l, market: byItem.get(String(l.item)) || null })) });
}

// GET /api/community/auction/history?item=minecraft:diamond : daily average price (each) for the last 30 days
export async function auctionHistory(request, env, ctx, url) {
  await requireUser(request, env);
  const item = String(url.searchParams.get("item") || "").slice(0, 80);
  const sql = getDb(env);
  const days = await sql`SELECT (sold_at AT TIME ZONE 'America/New_York')::date::text AS day, round(avg(unit_cents))::bigint AS unit, count(*)::int AS n, sum(amount)::int AS qty
                           FROM ah_sales WHERE item_id = ${item} AND sold_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`;
  const [all] = await sql`SELECT round(avg(unit_cents))::bigint AS unit, min(unit_cents)::bigint AS lo, max(unit_cents)::bigint AS hi, count(*)::int AS n
                            FROM ah_sales WHERE item_id = ${item} AND sold_at > now() - interval '30 days'`;
  return json({ ok: true, item, days: days.map((d) => ({ day: d.day, unit: Number(d.unit), sales: d.n, qty: d.qty })),
    summary: all?.n ? { avg: Number(all.unit), low: Number(all.lo), high: Number(all.hi), sales: all.n } : null });
}

// From the plugin: an Auction House item was sold (in game or on the website)
export async function recordAhSale(env, msg) {
  const amount = Math.max(1, Math.round(Number(msg.amount) || 1));
  const price = Math.max(0, Math.round(Number(msg.price) || 0));
  const item = String(msg.item || "").slice(0, 80);
  if (!item || !price) return;
  await getDb(env)`INSERT INTO ah_sales (item_id, label, amount, price_cents, unit_cents) VALUES (${item}, ${String(msg.label || "").slice(0, 80)}, ${amount}, ${price}, ${Math.round(price / amount)})`;
}

export async function auctionBuy(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  await rateLimit(env, "POLL_LIMITER", `ahbuy:${user.id}`);
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Unknown listing.");
  const sql = getDb(env);
  const [p] = await sql`SELECT p.xuid FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  if (!p) throw new HttpError(400, "Join the server once first, so we know which Minecraft player you are.");
  const answer = await voiceStub(env).fetch("https://voice/internal/ask", {
    method: "POST",
    body: JSON.stringify({ type: "ah_buy", listing: id, xuid: p.xuid }),
  }).then((r) => r.json());
  if (!answer.ok) throw new HttpError(409, answer.message || "That couldn't be bought.");
  return json({ ok: true, message: answer.message });
}

// ---------- Events (minigames running on the server) ----------
export async function eventsList(request, env) {
  await requireUser(request, env);
  const data = await voiceStub(env).fetch("https://voice/internal/events").then((r) => r.json());
  return json({ ok: true, updated: data.at, events: data.events || [] });
}

// ---------- Suggestions ----------
const STATUSES = ["open", "planned", "done", "declined"];

async function words(sql) {
  return compileWordList(await sql`SELECT word, match FROM filter_words`);
}

export async function suggestionsList(request, env, ctx, url) {
  const user = await requireUser(request, env);
  const owner = isOwner(env, user.username, user.platform === "bedrock");
  const sort = url.searchParams.get("sort") === "new" ? "new" : "top";
  const sql = getDb(env);
  const rows = await sql`
    SELECT s.id, s.title, s.body, s.anonymous, s.status, s.created_at, s.user_id, s.staff_reply, s.staff_reply_at,
           u.username, ru.username AS reply_by,
           (SELECT count(*)::int FROM suggestion_comments c WHERE c.suggestion_id = s.id AND c.deleted_at IS NULL) AS comments,
           coalesce(sum(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0)::int AS likes,
           coalesce(sum(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0)::int AS dislikes,
           max(CASE WHEN v.user_id = ${user.id} THEN v.value END) AS mine
      FROM suggestions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN users ru ON ru.id = s.staff_reply_by
      LEFT JOIN suggestion_votes v ON v.suggestion_id = s.id
     WHERE s.deleted_at IS NULL
     GROUP BY s.id, u.username, ru.username
     ORDER BY CASE WHEN ${sort} = 'top' THEN coalesce(sum(v.value), 0) END DESC NULLS LAST, s.created_at DESC
     LIMIT 100`;
  return json({
    ok: true,
    canModerate: Number(user.role_power) >= STAFF,
    suggestions: rows.map((r) => {
      const mine = Number(r.user_id) === Number(user.id);
      return {
        id: Number(r.id),
        title: r.title,
        body: r.body,
        status: r.status,
        createdAt: r.created_at,
        anonymous: r.anonymous,
        // Anonymous posts: only the owners (and the writer) see who wrote it.
        author: !r.anonymous || owner || mine ? r.username : null,
        mine,
        likes: r.likes,
        dislikes: r.dislikes,
        myVote: r.mine == null ? 0 : Number(r.mine),
        comments: r.comments,
        staffReply: r.staff_reply ? { text: r.staff_reply, by: r.reply_by || "Staff", at: r.staff_reply_at } : null,
      };
    }),
  });
}

export async function suggestionCreate(request, env) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  if (user.muted_until && new Date(user.muted_until) > new Date()) throw new HttpError(403, "You're muted, so you can't post suggestions right now.");
  await rateLimit(env, "AUTH_LIMITER", `suggest:${user.id}`);
  const body = await readJson(request);
  const title = String(body.title || "").replace(/\s+/g, " ").trim();
  const text = String(body.body || "").replace(/\r/g, "").trim();
  if (title.length < 4 || title.length > 80) throw new HttpError(400, "Give your suggestion a title of 4 to 80 characters.");
  if (text.length > 500) throw new HttpError(400, "Keep the details under 500 characters.");
  const sql = getDb(env);
  const list = await words(sql);
  // Same word, link and personal-info filter as chat (lowercased so capitals are fine in titles).
  for (const part of [title, text.replace(/\n+/g, " ")].filter(Boolean)) {
    const check = checkMessage(part.toLowerCase(), list);
    if (!check.ok) throw new HttpError(400, check.message || "That isn't allowed.");
  }
  const [recent] = await sql`SELECT count(*)::int AS n FROM suggestions WHERE user_id = ${user.id} AND created_at > now() - interval '1 hour'`;
  if (recent.n >= 3) throw new HttpError(429, "You can post 3 suggestions an hour. Please wait a bit.");
  const [row] = await sql`
    INSERT INTO suggestions (user_id, title, body, anonymous) VALUES (${user.id}, ${title}, ${text}, ${Boolean(body.anonymous)})
    RETURNING id`;
  return json({ ok: true, id: Number(row.id) });
}

export async function suggestionVote(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  const id = Number(params.id);
  const value = Number((await readJson(request)).value);
  if (![1, -1, 0].includes(value)) throw new HttpError(400, "Vote like or dislike.");
  const sql = getDb(env);
  const [s] = await sql`SELECT id FROM suggestions WHERE id = ${id} AND deleted_at IS NULL`;
  if (!s) throw new HttpError(404, "That suggestion no longer exists.");
  if (value === 0) {
    await sql`DELETE FROM suggestion_votes WHERE suggestion_id = ${id} AND user_id = ${user.id}`;
  } else {
    await sql`
      INSERT INTO suggestion_votes (suggestion_id, user_id, value) VALUES (${id}, ${user.id}, ${value})
      ON CONFLICT (suggestion_id, user_id) DO UPDATE SET value = EXCLUDED.value`;
  }
  return json({ ok: true });
}

export async function suggestionAction(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const id = Number(params.id);
  const sql = getDb(env);
  const [s] = await sql`SELECT id, user_id, title FROM suggestions WHERE id = ${id} AND deleted_at IS NULL`;
  if (!s) throw new HttpError(404, "That suggestion no longer exists.");
  const staff = Number(user.role_power) >= STAFF;
  if (params.action === "status") {
    if (!staff) throw new HttpError(403, "Only staff can change a suggestion's status.");
    const status = String((await readJson(request)).status || "");
    if (!STATUSES.includes(status)) throw new HttpError(400, "Unknown status.");
    await sql`UPDATE suggestions SET status = ${status} WHERE id = ${id}`;
    await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'suggestion.status', ${JSON.stringify({ title: s.title, status })}::jsonb)`;
    return json({ ok: true });
  }
  if (params.action === "delete") {
    if (!staff && Number(s.user_id) !== Number(user.id)) throw new HttpError(403, "You can only delete your own suggestions.");
    await sql`UPDATE suggestions SET deleted_at = now() WHERE id = ${id}`;
    if (staff && Number(s.user_id) !== Number(user.id)) {
      await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'suggestion.delete', ${JSON.stringify({ title: s.title })}::jsonb)`;
    }
    return json({ ok: true });
  }
  throw new HttpError(400, "Unknown action.");
}
