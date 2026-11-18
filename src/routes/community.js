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
// Organized by status tabs (Open, Planned, In progress, Done, Declined), categories and search. Staff can merge a
// duplicate into the original: its votes and comments move over and it disappears from the lists.
const STATUSES = ["open", "planned", "progress", "done", "declined"];
export const SUGGESTION_CATEGORIES = { gameplay: "Gameplay", minigames: "Minigames", website: "Website", events: "Events", store: "Store", other: "Other" };

async function words(sql) {
  return compileWordList(await sql`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`);
}

export async function suggestionsList(request, env, ctx, url) {
  const user = await requireUser(request, env);
  const owner = isOwner(env, user.username, user.platform === "bedrock");
  const sort = url.searchParams.get("sort") === "new" ? "new" : "top";
  const one = Number(url.searchParams.get("id")) || null;      // open one suggestion (e.g. from "similar ideas")
  const status = STATUSES.includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "open";
  const category = SUGGESTION_CATEGORIES[url.searchParams.get("category")] ? url.searchParams.get("category") : null;
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, "")}%` : null;
  const sql = getDb(env);
  const rows = await sql`
    SELECT s.id, s.title, s.body, s.anonymous, s.official, s.status, s.category, s.created_at, s.user_id, s.staff_reply, s.staff_reply_at,
           u.username, ru.username AS reply_by,
           (SELECT count(*)::int FROM suggestions m WHERE m.merged_into = s.id AND m.deleted_at IS NULL) AS merged,
           (SELECT count(*)::int FROM suggestion_comments c WHERE c.suggestion_id = s.id AND c.deleted_at IS NULL) AS comments,
           coalesce(sum(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0)::int AS likes,
           coalesce(sum(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0)::int AS dislikes,
           max(CASE WHEN v.user_id = ${user.id} THEN v.value END) AS mine
      FROM suggestions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN users ru ON ru.id = s.staff_reply_by
      LEFT JOIN suggestion_votes v ON v.suggestion_id = s.id
     WHERE s.deleted_at IS NULL AND s.status <> 'duplicate'
       AND (${one}::bigint IS NOT NULL AND s.id = ${one}::bigint
            OR ${one}::bigint IS NULL AND (s.status = ${status} OR ${status} = 'done' AND s.status = 'implemented') AND (${category}::text IS NULL OR s.category = ${category})
               AND (${like}::text IS NULL OR s.title ILIKE ${like} OR s.body ILIKE ${like}))
     GROUP BY s.id, u.username, ru.username
     ORDER BY CASE WHEN ${sort} = 'top' THEN coalesce(sum(v.value), 0) END DESC NULLS LAST, s.created_at DESC
     LIMIT 100`;
  // how many are in each tab (with the same category and search)
  const countRows = await sql`
    SELECT status, count(*)::int AS n FROM suggestions
     WHERE deleted_at IS NULL AND status <> 'duplicate' AND (${category}::text IS NULL OR category = ${category})
       AND (${like}::text IS NULL OR title ILIKE ${like} OR body ILIKE ${like})
     GROUP BY status`;
  const counts = Object.fromEntries(STATUSES.map((k) => [k, 0]));
  for (const r of countRows) {
    const tab = r.status === "implemented" ? "done" : r.status;   // "Already implemented" ideas show in the Done tab
    if (STATUSES.includes(tab)) counts[tab] += r.n;
  }
  return json({
    ok: true,
    canModerate: Number(user.role_power) >= STAFF,
    counts, categories: SUGGESTION_CATEGORIES,
    suggestions: rows.map((r) => {
      const mine = Number(r.user_id) === Number(user.id);
      return {
        id: Number(r.id),
        title: r.title,
        body: r.body,
        status: r.status,
        category: r.category,
        merged: r.merged,
        createdAt: r.created_at,
        anonymous: r.anonymous,
        // Anonymous posts: only the owners (and the writer) see who wrote it.
        author: r.official ? "GalaxySMP" : !r.anonymous || owner || mine ? r.username : null,
        official: Boolean(r.official),  // posted by the server team for everyone to vote on
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
  const category = SUGGESTION_CATEGORIES[body.category] ? body.category : "other";
  const [row] = await sql`
    INSERT INTO suggestions (user_id, title, body, anonymous, category) VALUES (${user.id}, ${title}, ${text}, ${Boolean(body.anonymous)}, ${category})
    RETURNING id`;
  return json({ ok: true, id: Number(row.id) });
}

// Tell the person who posted a suggestion that its status changed (the bell on the website + phone notification).
const STATUS_WORDS = { open: "Open", planned: "Planned", progress: "In progress", done: "Done", implemented: "Already implemented", declined: "Declined" };
export async function suggestionStatusNotice(env, s, status, reply, actorId) {
  const sql = getDb(env);
  const [row] = await sql`SELECT s.user_id, s.title, s.official, p.xuid FROM suggestions s JOIN users u ON u.id = s.user_id
                           LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE s.id = ${s.id}`;
  if (!row || row.official) return;
  const title = status === "implemented" ? "Your idea is already on GalaxySMP"
    : status === "done" ? "Your suggestion was added!" : `Your suggestion is now ${STATUS_WORDS[status] || status}`;
  const body = reply ? `"${row.title}": ${String(reply).slice(0, 120)}` : `"${row.title}"`;
  const { notify } = await import("./notify.js");
  await notify(env, [row.user_id], "community", { title, body, url: `/community#suggestions/${s.id}`, tag: `sg-${s.id}` }, { exclude: actorId ? [actorId] : [] }).catch(() => {});
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
    if (!STATUSES.includes(status) && status !== "implemented") throw new HttpError(400, "Unknown status.");
    const [before] = await sql`SELECT status FROM suggestions WHERE id = ${id}`;
    await sql`UPDATE suggestions SET status = ${status} WHERE id = ${id}`;
    await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'suggestion.status', ${JSON.stringify({ title: s.title, status })}::jsonb)`;
    if (before?.status !== status) await suggestionStatusNotice(env, s, status, "", user.id);
    return json({ ok: true });
  }
  if (params.action === "category") {   // staff, or the person who posted it
    if (!staff && Number(s.user_id) !== Number(user.id)) throw new HttpError(403, "Only staff can change that.");
    const category = String((await readJson(request)).category || "");
    if (!SUGGESTION_CATEGORIES[category]) throw new HttpError(400, "Unknown category.");
    await sql`UPDATE suggestions SET category = ${category} WHERE id = ${id}`;
    return json({ ok: true });
  }
  if (params.action === "merge") {      // staff: this is a duplicate of { into }
    if (!staff) throw new HttpError(403, "Only staff can merge suggestions.");
    const into = Number((await readJson(request)).into) || 0;
    if (into === id) throw new HttpError(400, "Pick a different suggestion.");
    const [t] = await sql`SELECT id, title FROM suggestions WHERE id = ${into} AND deleted_at IS NULL AND status <> 'duplicate'`;
    if (!t) throw new HttpError(404, "That suggestion couldn't be found.");
    // votes move over (someone who voted on both keeps their vote on the original); comments move over
    await sql`INSERT INTO suggestion_votes (suggestion_id, user_id, value) SELECT ${into}, user_id, value FROM suggestion_votes WHERE suggestion_id = ${id}
              ON CONFLICT (suggestion_id, user_id) DO NOTHING`;
    await sql`DELETE FROM suggestion_votes WHERE suggestion_id = ${id}`;
    await sql`UPDATE suggestion_comments SET suggestion_id = ${into} WHERE suggestion_id = ${id}`;
    await sql`UPDATE suggestions SET status = 'duplicate', merged_into = ${into} WHERE id = ${id}`;
    await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'suggestion.merge', ${JSON.stringify({ title: s.title, into: t.title })}::jsonb)`;
    const { notify } = await import("./notify.js");
    await notify(env, [s.user_id], "community", { title: "Your suggestion was merged", body: `"${s.title}" was already suggested as "${t.title}". Your idea's votes and comments moved there.`,
      url: `/community#suggestions/${into}`, tag: `sg-${id}` }, { exclude: [user.id] }).catch(() => {});
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

// ---------- Auction House price alerts ----------
// A player picks an item and the most they'd pay (each). When the server sends listings, any new listing at or below
// that price notifies them once: on the website (bell + phone) and in game. Alerts belong to the Minecraft player
// (xuid), so they can be made in game (/ah > Price alerts) or on the website.
const MAX_ALERTS = 10;
const usd = (c) => `$${(Number(c) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const eachOf = (l) => Number(l.price) / Math.max(1, Number(l.amount) || 1);
const alertOut = (a) => ({ id: Number(a.id), item: a.item_id, label: a.label, maxEach: Number(a.max_each) });

export async function listAhAlerts(sql, xuid) {
  return (await sql`SELECT * FROM ah_alerts WHERE xuid = ${xuid} ORDER BY created_at`).map(alertOut);
}

// Add or change an alert. Listings already for sale at that price are counted (and won't notify later).
export async function saveAhAlert(env, sql, xuid, b) {
  const item = String(b.item || "").trim().toLowerCase().slice(0, 80);
  const label = String(b.label || "").replace(/§./g, "").trim().slice(0, 80) || item.replace(/^minecraft:/, "").replace(/_/g, " ");
  const maxEach = Math.round(Number(b.maxEach));
  if (!/^[a-z0-9_.:-]+$/.test(item)) throw new HttpError(400, "Choose an item.");
  if (!Number.isFinite(maxEach) || maxEach < 1 || maxEach > 1e13) throw new HttpError(400, "Enter the most you'd pay for each one.");
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM ah_alerts WHERE xuid = ${xuid} AND item_id <> ${item}`;
  if (n >= MAX_ALERTS) throw new HttpError(400, `You can have up to ${MAX_ALERTS} price alerts. Remove one first.`);
  const [a] = await sql`INSERT INTO ah_alerts (xuid, item_id, label, max_each) VALUES (${xuid}, ${item}, ${label}, ${maxEach})
                        ON CONFLICT (xuid, item_id) DO UPDATE SET max_each = EXCLUDED.max_each, label = EXCLUDED.label RETURNING *`;
  const data = await voiceStub(env).fetch("https://voice/internal/ah").then((r) => r.json()).catch(() => ({}));
  const now = Date.now() / 1000;
  const already = (data.listings || []).filter((l) => String(l.item) === item && eachOf(l) <= maxEach && (!l.expires || l.expires > now)
    && String(l.sellerXuid || "") !== xuid);
  if (already.length) {
    await sql`INSERT INTO ah_alert_hits (alert_id, listing_id) SELECT ${a.id}, unnest(${already.map((l) => Number(l.id))}::bigint[]) ON CONFLICT DO NOTHING`;
  }
  return { alert: alertOut(a), forSale: already.length };
}

export async function removeAhAlert(sql, xuid, id) {
  await sql`DELETE FROM ah_alerts WHERE xuid = ${xuid} AND id = ${Number(id) || 0}`;
}

// Called by the voice hub whenever the server sends its listings. Returns [{ xuid, text }] for players online in game.
export async function checkAhAlerts(env, listings) {
  return matchAlerts(env, listings.map((l) => ({ key: Number(l.id), item: String(l.item), label: l.label, amount: l.amount, price: l.price,
    sellerXuid: String(l.sellerXuid || ""), by: `by ${l.seller}`, where: "Auction House", url: "/community#marketplace/auction" })));
}

// Same for player shop chests (Galaxy+ / Pro+ shops listed in the Marketplace). Keys are negative so they never clash
// with Auction House listing ids; an empty shop never alerts.
export async function checkShopAlerts(env, shops) {
  const sql = getDb(env);
  const owners = [...new Set(shops.map((s) => String(s.owner)))];
  if (!owners.length) return [];
  const paid = new Set((await sql`SELECT xuid FROM subscriptions WHERE xuid = ANY(${owners}::text[]) AND plan IN ('plus', 'pro')
                                   AND (expires_at IS NULL OR expires_at > now())`).map((r) => r.xuid));
  return matchAlerts(env, shops.filter((s) => paid.has(String(s.owner)) && Number(s.stock) >= Number(s.amount) && Number(s.id) > 0)
    .map((s) => ({ key: -Number(s.id), item: String(s.item), label: s.name, amount: Number(s.amount), price: Number(s.price),
      sellerXuid: String(s.owner), by: `in ${s.shop} (${s.ownerName}'s shop)`, where: "Shops", url: "/community#marketplace/shops" })));
}

async function matchAlerts(env, offers) {
  const items = [...new Set(offers.map((o) => o.item))];
  if (!items.length) return [];
  const sql = getDb(env);
  if (Math.random() < 0.02) await sql`DELETE FROM ah_alert_hits WHERE at < now() - interval '4 days'`.catch(() => {});
  const alerts = await sql`SELECT * FROM ah_alerts WHERE item_id = ANY(${items})`;
  if (!alerts.length) return [];
  const pairs = [];
  for (const a of alerts) {
    for (const o of offers) {
      if (o.item === a.item_id && eachOf(o) <= Number(a.max_each) && o.sellerXuid !== a.xuid) pairs.push([a, o]);
    }
  }
  if (!pairs.length) return [];
  const fresh = await sql`INSERT INTO ah_alert_hits (alert_id, listing_id)
                          SELECT * FROM unnest(${pairs.map(([a]) => Number(a.id))}::bigint[], ${pairs.map(([, o]) => o.key)}::bigint[])
                          ON CONFLICT DO NOTHING RETURNING alert_id, listing_id`;
  const isNew = new Set(fresh.map((r) => `${r.alert_id}:${r.listing_id}`));
  const hits = pairs.filter(([a, o]) => isNew.has(`${a.id}:${o.key}`));
  if (!hits.length) return [];
  const xuids = [...new Set(hits.map(([a]) => a.xuid))];
  const users = await sql`SELECT u.id, p.xuid FROM players p JOIN users u ON u.mc_uuid = p.uuid WHERE p.xuid = ANY(${xuids}) AND NOT u.banned`;
  const userOf = new Map(users.map((u) => [u.xuid, Number(u.id)]));
  const { notify } = await import("./notify.js");
  const out = [];
  for (const [a, o] of hits) {
    const text = `${o.amount}x ${o.label} is for sale for ${usd(o.price)}${o.amount > 1 ? ` (${usd(eachOf(o))} each)` : ""} ${o.by}`;
    out.push({ xuid: a.xuid, text, where: o.where });
    const uid = userOf.get(a.xuid);
    if (uid) await notify(env, [uid], "auction", { title: `Price alert: ${a.label}`, body: text, url: o.url, tag: `alert-${o.key}` }).catch(() => {});
  }
  return out;
}

async function myXuid(sql, user) {
  const [p] = await sql`SELECT p.xuid FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  if (!p) throw new HttpError(400, "Join the server once first, so we know which Minecraft player you are.");
  return String(p.xuid);
}

// GET /api/community/auction/alerts : your alerts, plus items you can pick (sold or listed lately)
export async function auctionAlerts(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [p] = await sql`SELECT p.xuid FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  const items = await sql`SELECT item_id AS item, max(label) AS label FROM ah_sales WHERE sold_at > now() - interval '90 days' GROUP BY item_id ORDER BY count(*) DESC LIMIT 300`;
  return json({ ok: true, linked: Boolean(p), max: MAX_ALERTS, alerts: p ? await listAhAlerts(sql, String(p.xuid)) : [], items });
}

// POST /api/community/auction/alerts { item, label, maxEach } or { remove: id }
export async function auctionAlertSave(request, env) {
  const user = await requireUser(request, env);
  await rateLimit(env, "POLL_LIMITER", `ahalert:${user.id}`);
  const b = await readJson(request);
  const sql = getDb(env);
  const xuid = await myXuid(sql, user);
  if (b.remove != null) {
    await removeAhAlert(sql, xuid, b.remove);
    return json({ ok: true, alerts: await listAhAlerts(sql, xuid) });
  }
  const r = await saveAhAlert(env, sql, xuid, b);
  return json({ ok: true, ...r, alerts: await listAhAlerts(sql, xuid) });
}

// POST /api/plugin/ah-alerts { xuid, action: "list" | "add" | "remove", item, label, maxEach, id } (from /ah in game)
export async function pluginAhAlerts(request, env) {
  const { checkPlugin } = await import("./ranks.js");
  await checkPlugin(request, env);
  const b = await readJson(request);
  const xuid = String(b.xuid || "");
  if (!/^\d{1,20}$/.test(xuid)) throw new HttpError(400, "Unknown player.");
  const sql = getDb(env);
  try {
    if (b.action === "remove") await removeAhAlert(sql, xuid, b.id);
    let forSale = 0;
    if (b.action === "add") forSale = (await saveAhAlert(env, sql, xuid, b)).forSale;
    return json({ ok: true, forSale, max: MAX_ALERTS, alerts: await listAhAlerts(sql, xuid) });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message });
    throw e;
  }
}

// ---------- Marketplace: sell from the website, and buy orders (the plugin does the work; you must be online in game) ----------
const askMarket = (env, msg) => voiceStub(env).fetch("https://voice/internal/ask", { method: "POST", body: JSON.stringify({ type: "market", ...msg }) })
  .then((r) => r.json()).catch(() => ({ ok: false, message: "The server didn't answer. Try again in a minute." }));
async function marketPlayer(request, env) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  const sql = getDb(env);
  const [p] = await sql`SELECT p.xuid, p.gamertag FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  if (!p) throw new HttpError(400, "Link your Minecraft account first (Account > Link), so we know which player you are.");
  return { user, xuid: String(p.xuid), name: p.gamertag };
}
const answer = (a) => { if (!a.ok) throw new HttpError(409, a.message || "That didn't work."); return json({ ok: true, ...a }); };

// GET /api/market/inventory : your live inventory, with what the server Shop pays for each item
export async function marketInventory(request, env) {
  const who = await marketPlayer(request, env);
  await rateLimit(env, "POLL_LIMITER", `minv:${who.user.id}`);
  return answer(await askMarket(env, { op: "inventory", xuid: who.xuid }));
}

// POST /api/market/sell { mode: "ah" | "shop", slot, expectId, expectAmount, price }
export async function marketSell(request, env) {
  const who = await marketPlayer(request, env);
  await rateLimit(env, "AUTH_LIMITER", `msell:${who.user.id}`);
  const b = await readJson(request);
  const base = { xuid: who.xuid, slot: Number(b.slot), expectId: String(b.expectId || "").slice(0, 80), expectAmount: Number(b.expectAmount) };
  if (!Number.isInteger(base.slot) || !base.expectId || !Number.isInteger(base.expectAmount)) throw new HttpError(400, "Pick an item first.");
  if (b.mode === "shop") return answer(await askMarket(env, { op: "shop_sell", ...base }));
  const price = Math.round(Number(b.price));
  if (!Number.isFinite(price) || price < 100 || price > 1e13) throw new HttpError(400, "Enter a price of at least $1.");
  return answer(await askMarket(env, { op: "ah_list", ...base, price }));
}

// GET /api/market/orders : open buy orders
export async function marketOrders(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [p] = await sql`SELECT p.xuid FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  const data = await voiceStub(env).fetch("https://voice/internal/orders").then((r) => r.json()).catch(() => ({ orders: [] }));
  const mine = p ? String(p.xuid) : null;
  const now = Date.now() / 1000;
  return json({ ok: true, updated: data.at, orders: (data.orders || []).filter((o) => o.expires > now && o.filled < o.want)
    .map(({ buyerXuid, ...o }) => ({ ...o, mine: Boolean(mine && buyerXuid === mine) })) });
}

// POST /api/market/orders { action: "create", item, label, want, each } | { action: "fill" | "cancel", id }
export async function marketOrderAction(request, env) {
  const who = await marketPlayer(request, env);
  await rateLimit(env, "AUTH_LIMITER", `morder:${who.user.id}`);
  const b = await readJson(request);
  if (b.action === "create") {
    const item = String(b.item || "").trim().toLowerCase().slice(0, 80);
    if (!/^[a-z0-9_.:-]+$/.test(item)) throw new HttpError(400, "Choose an item.");
    return answer(await askMarket(env, { op: "order_create", xuid: who.xuid, name: who.name, item,
      label: String(b.label || "").replace(/§./g, "").slice(0, 80), want: Math.round(Number(b.want)), each: Math.round(Number(b.each)) }));
  }
  if (b.action === "fill") return answer(await askMarket(env, { op: "order_fill", xuid: who.xuid, id: Number(b.id) }));
  if (b.action === "cancel") return answer(await askMarket(env, { op: "order_cancel", xuid: who.xuid, id: Number(b.id) }));
  throw new HttpError(400, "Unknown action.");
}

// ---------- Seller ratings: buyers rate the seller once per purchase (👍 / 👎) ----------
export async function recordPurchase(env, msg) {
  const x = (v) => (/^\d{1,20}$/.test(String(v ?? "")) ? String(v) : null);
  const seller = x(msg.sellerXuid), buyer = x(msg.buyerXuid);
  const kind = ["ah", "shop", "order"].includes(msg.kind) ? msg.kind : null;
  if (!seller || !buyer || !kind || seller === buyer) return;
  await getDb(env)`INSERT INTO market_purchases (kind, ref, seller_xuid, seller_name, buyer_xuid, label, amount, price)
    VALUES (${kind}, ${String(msg.ref || "").slice(0, 60)}, ${seller}, ${String(msg.sellerName || "").slice(0, 32) || null}, ${buyer},
            ${String(msg.label || "").slice(0, 80)}, ${Math.round(Number(msg.amount) || 0)}, ${Math.round(Number(msg.price) || 0)})
    ON CONFLICT (kind, ref) DO NOTHING`;
}

// GET /api/market/ratings : every seller's 👍/👎 (by name), plus your purchases you haven't rated yet (last 30 days)
export async function marketRatings(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [p] = await sql`SELECT p.xuid FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  const sellers = await sql`
    SELECT coalesce(pl.gamertag, max(m.seller_name)) AS name, count(*) FILTER (WHERE m.rating > 0)::int AS up, count(*) FILTER (WHERE m.rating < 0)::int AS down
      FROM market_purchases m LEFT JOIN players pl ON pl.xuid = m.seller_xuid
     WHERE m.rating IS NOT NULL GROUP BY m.seller_xuid, pl.gamertag`;
  const toRate = p ? await sql`
    SELECT id, kind, label, amount, price, seller_name, created_at FROM market_purchases
     WHERE buyer_xuid = ${String(p.xuid)} AND rating IS NULL AND created_at > now() - interval '30 days' ORDER BY created_at DESC LIMIT 20` : [];
  return json({ ok: true,
    sellers: Object.fromEntries(sellers.filter((s) => s.name).map((s) => [s.name.toLowerCase(), { up: s.up, down: s.down }])),
    toRate: toRate.map((r) => ({ id: Number(r.id), kind: r.kind, label: r.label, amount: r.amount, price: Number(r.price), seller: r.seller_name, at: r.created_at })) });
}

// POST /api/market/rate { id, good }
export async function marketRate(request, env) {
  const user = await requireUser(request, env);
  await rateLimit(env, "POLL_LIMITER", `mrate:${user.id}`);
  const b = await readJson(request);
  const sql = getDb(env);
  const [p] = await sql`SELECT p.xuid FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  if (!p) throw new HttpError(400, "Link your Minecraft account first.");
  const [row] = await sql`UPDATE market_purchases SET rating = ${b.good ? 1 : -1}, rated_at = now()
                           WHERE id = ${Number(b.id) || 0} AND buyer_xuid = ${String(p.xuid)} AND rating IS NULL RETURNING seller_name`;
  if (!row) throw new HttpError(409, "You can only rate your own purchases, once each.");
  return json({ ok: true, message: `Thanks! Your rating for ${row.seller_name || "the seller"} is saved.` });
}
