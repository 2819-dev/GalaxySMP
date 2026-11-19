// #Giveaways: staff start a giveaway (with /giveaway in any chat, or the Commands button). GalaxySMP posts a card in
// #Giveaways with the prize, the end time and an Enter button. When it ends, winners are picked at random and the
// prize is given automatically:
//   money      in-game money (through the rewards queue, so it waits for the server if it's offline)
//   keys       crate keys (same queue)
//   credits    Galaxy Credits (right away)
//   item       a Store item or a Galaxy+ / Pro+ month (given like a Store purchase; retried if the server is offline)
//   text       anything else ("A custom build"): staff hand it over themselves
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { can } from "../lib/perms.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { hubBroadcast } from "./chat.js";
import { notify } from "./notify.js";
import { botPost } from "../chat/engage.js";
import { queueReward } from "./rewards.js";

export const PRIZE_KINDS = ["money", "keys", "credits", "item", "text"];
const KEY_NAMES = { common: "Common", rare: "Rare", galaxy: "Galaxy" };
const usd = (c) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const money = (c) => `$${Math.floor(c / 100).toLocaleString("en-US")}`;

// Things a Store-item giveaway can give: plans and Shop items (not real-world items like the Galaxy Cube).
export async function giveawayItems() {
  const { SHOP } = await import("../store/shop.js");
  const { PAID_PLANS, product } = await import("../store/promos.js");
  const out = PAID_PLANS.map((p) => ({ id: p, option: null, name: `${product(p)?.name || p} (30 days)` }));
  for (const cat of SHOP) {
    if (cat.physical) continue;
    for (const it of cat.items) {
      if (it.physical || (!it.price && !it.options)) continue;
      if (it.options) for (const o of it.options) out.push({ id: it.id, option: o.id, name: `${it.name} (${o.name})` });
      else out.push({ id: it.id, option: null, name: it.name });
    }
  }
  return out;
}

export function prizeLabel(g) {
  const p = g.prize || {};
  if (g.prize_kind === "money") return money(Number(p.cents) || 0);
  if (g.prize_kind === "keys") return `${p.count} ${KEY_NAMES[p.key] || "Common"} crate key${p.count === 1 ? "" : "s"}`;
  if (g.prize_kind === "credits") return `${usd(Number(p.cents) || 0)} of Galaxy Credits`;
  if (g.prize_kind === "item") return p.name || "A Store item";
  return p.text || "A prize";
}

function publicGiveaway(g, me, entries, mine, winners = []) {
  return {
    id: Number(g.id), title: g.title, description: g.description || "", prize: prizeLabel(g), prizeKind: g.prize_kind,
    winners: Number(g.winners), endsAt: g.ends_at, status: g.status, entries: Number(entries), entered: Boolean(mine),
    needsLink: g.needs_link, winnerNames: winners, messageId: g.message_id ? Number(g.message_id) : null,
    canManage: can(me, "run_giveaways"),
  };
}

// Checks and fills in a new giveaway from the form. Throws HttpError with a friendly message.
export async function cleanGiveaway(body) {
  const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (title.length < 3) throw new HttpError(400, "Give the giveaway a title (at least 3 characters).");
  const description = String(body.description || "").replace(/\r/g, "").trim().slice(0, 500);
  const kind = String(body.prizeKind || "");
  if (!PRIZE_KINDS.includes(kind)) throw new HttpError(400, "Choose what the prize is.");
  const winners = Math.round(Number(body.winners) || 1);
  if (winners < 1 || winners > 20) throw new HttpError(400, "Pick 1 to 20 winners.");
  const minutes = Math.round(Number(body.minutes) || 0);
  if (minutes < 5 || minutes > 60 * 24 * 30) throw new HttpError(400, "A giveaway lasts 5 minutes to 30 days.");
  let prize;
  if (kind === "money") {
    const cents = Math.round(Number(body.amount) * 100);
    if (!(cents >= 100) || cents > 100_000_000_00) throw new HttpError(400, "Choose an amount of money from $1 to $100,000,000 (per winner).");
    prize = { cents };
  } else if (kind === "credits") {
    const cents = Math.round(Number(body.amount) * 100);
    if (!(cents >= 100) || cents > 100_00) throw new HttpError(400, "Choose $1 to $100 of credits (per winner).");
    prize = { cents };
  } else if (kind === "keys") {
    const key = String(body.keyKind || "common");
    const count = Math.round(Number(body.amount) || 1);
    if (!KEY_NAMES[key]) throw new HttpError(400, "Choose a kind of crate key.");
    if (count < 1 || count > 64) throw new HttpError(400, "Give 1 to 64 keys (per winner).");
    prize = { key, count };
  } else if (kind === "item") {
    const items = await giveawayItems();
    const it = items.find((x) => x.id === String(body.item || "") && (x.option || null) === (body.option || null));
    if (!it) throw new HttpError(400, "Choose a Store item.");
    prize = { item: it.id, option: it.option, name: it.name };
  } else {
    const text = String(body.prizeText || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (text.length < 2) throw new HttpError(400, "Say what the prize is.");
    prize = { text };
  }
  // in-game prizes need a linked Minecraft account to receive them
  const needsLink = kind === "money" || kind === "keys" || kind === "item";
  return { title, description, kind, prize, winners, minutes, needsLink };
}

// Starts a giveaway: saves it and posts the card in #Giveaways. Returns { giveaway, message }.
export async function startGiveaway(env, sql, user, body) {
  if (!can(user, "run_giveaways")) throw new HttpError(403, "Only staff who run giveaways can start one.");
  const g = await cleanGiveaway(body);
  const [row] = await sql`INSERT INTO giveaways (title, description, prize_kind, prize, winners, needs_link, ends_at, created_by)
                          VALUES (${g.title}, ${g.description || null}, ${g.kind}, ${JSON.stringify(g.prize)}::jsonb, ${g.winners}, ${g.needsLink},
                                  now() + make_interval(mins => ${g.minutes}), ${user.id}) RETURNING *`;
  const m = await botPost(sql, { slug: "giveaways", kind: "giveaway", meta: { giveawayId: Number(row.id) },
    content: `🎉 **Giveaway: ${row.title}**\nPrize: ${prizeLabel(row)}${row.winners > 1 ? ` (${row.winners} winners)` : ""}` });
  if (!m) throw new HttpError(409, "The #Giveaways channel is missing. Reload and try again in a minute.");
  await sql`UPDATE giveaways SET message_id = ${m.id} WHERE id = ${row.id}`;
  await hubBroadcast(env, { type: "message", message: m });
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'giveaway.start', ${JSON.stringify({ id: Number(row.id), title: row.title, prize: prizeLabel(row) })}::jsonb)`;
  await notify(env, "all", "giveaways", { title: `New giveaway: ${row.title}`, body: `Prize: ${prizeLabel(row)}. Tap to enter.`, url: "/community#giveaways", tag: `giveaway-${row.id}` },
    { exclude: [Number(user.id)] }).catch(() => {});
  return { giveaway: row, message: m };
}

async function load(sql, id, user) {
  const [g] = await sql`SELECT * FROM giveaways WHERE id = ${Number(id) || 0}`;
  if (!g) throw new HttpError(404, "That giveaway doesn't exist.");
  const [{ n, mine }] = await sql`SELECT count(*)::int AS n, bool_or(user_id = ${user.id}) AS mine FROM giveaway_entries WHERE giveaway_id = ${g.id}`;
  const winners = g.status === "ended"
    ? (await sql`SELECT u.username FROM giveaway_entries e JOIN users u ON u.id = e.user_id WHERE e.giveaway_id = ${g.id} AND e.won ORDER BY u.username`).map((r) => r.username)
    : [];
  return publicGiveaway(g, user, n, mine, winners);
}

// GET /api/giveaways/:id
export async function getGiveaway(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  return json({ ok: true, giveaway: await load(getDb(env), params.id, user) });
}

// POST /api/giveaways/:id/:action   enter | leave | end (staff) | reroll (staff) | cancel (staff)
export async function giveawayAction(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  await rateLimit(env, "POLL_LIMITER", `give:${user.id}`);
  const sql = getDb(env);
  const id = Number(params.id) || 0;
  const [g] = await sql`SELECT * FROM giveaways WHERE id = ${id}`;
  if (!g) throw new HttpError(404, "That giveaway doesn't exist.");
  const action = params.action;
  if (action === "enter") {
    if (g.status !== "open" || new Date(g.ends_at) <= new Date()) throw new HttpError(409, "This giveaway has ended.");
    if (user.banned) throw new HttpError(403, "Your account has been banned.");
    if (user.is_bot) throw new HttpError(403, "GalaxySMP can't enter giveaways.");
    if (g.needs_link) {
      const [p] = await sql`SELECT 1 FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
      if (!p) throw new HttpError(409, "This prize is given in Minecraft, so link your account first: type /link in game.");
    }
    await sql`INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (${id}, ${user.id}) ON CONFLICT DO NOTHING`;
  } else if (action === "leave") {
    if (g.status !== "open") throw new HttpError(409, "This giveaway has ended.");
    await sql`DELETE FROM giveaway_entries WHERE giveaway_id = ${id} AND user_id = ${user.id}`;
  } else if (["end", "reroll", "cancel"].includes(action)) {
    if (!can(user, "run_giveaways")) throw new HttpError(403, "Only staff who run giveaways can do that.");
    if (action === "cancel") {
      if (g.status !== "open") throw new HttpError(409, "This giveaway already ended.");
      await sql`UPDATE giveaways SET status = 'cancelled', ended_at = now() WHERE id = ${id} AND status = 'open'`;
      await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'giveaway.cancel', ${JSON.stringify({ id, title: g.title })}::jsonb)`;
    } else if (action === "end") {
      if (g.status !== "open") throw new HttpError(409, "This giveaway already ended.");
      await finish(env, sql, g);
    } else {
      if (g.status !== "ended") throw new HttpError(409, "You can only pick a new winner after the giveaway ends.");
      await reroll(env, sql, g, user);
    }
  } else throw new HttpError(400, "Unknown action.");
  await hubBroadcast(env, { type: "giveaway", id });
  return json({ ok: true, giveaway: await load(sql, id, user),
    message: action === "enter" ? "You're in! Good luck." : action === "leave" ? "You left the giveaway." : action === "cancel" ? "Giveaway cancelled." : action === "end" ? "Giveaway ended and winners picked." : "A new winner was picked." });
}

// Picks `n` random winners from people who entered and haven't won it yet (and aren't banned).
async function pick(sql, g, n) {
  return sql`UPDATE giveaway_entries SET won = true WHERE giveaway_id = ${g.id} AND user_id IN (
               SELECT e.user_id FROM giveaway_entries e JOIN users u ON u.id = e.user_id
                WHERE e.giveaway_id = ${g.id} AND NOT e.won AND NOT u.banned
                ORDER BY random() LIMIT ${n})
             RETURNING user_id`;
}

async function finish(env, sql, g) {
  const [claimed] = await sql`UPDATE giveaways SET status = 'ended', ended_at = now() WHERE id = ${g.id} AND status = 'open' RETURNING id`;
  if (!claimed) return;   // someone else ended it at the same moment
  const won = await pick(sql, g, Number(g.winners));
  const ids = won.map((r) => Number(r.user_id));
  const names = ids.length ? (await sql`SELECT username FROM users WHERE id = ANY(${ids}) ORDER BY username`).map((r) => r.username) : [];
  const text = names.length
    ? `🏆 **${g.title}** has ended! Congratulations ${names.map((n) => `@${n}`).join(", ")}: you won **${prizeLabel(g)}**!${g.prize_kind === "text" ? " Staff will be in touch to give you your prize." : " It's on its way to you."}`
    : `**${g.title}** has ended, but nobody entered, so there's no winner this time.`;
  const m = await botPost(sql, { slug: "giveaways", kind: "bot", content: text, replyTo: g.message_id ? Number(g.message_id) : null });
  if (m) await hubBroadcast(env, { type: "message", message: m });
  if (ids.length) {
    await notify(env, ids, "giveaways", { title: "You won a giveaway! 🎉", body: `${g.title}: ${prizeLabel(g)}`, url: "/community#giveaways", tag: `giveaway-won-${g.id}`, urgent: true }).catch(() => {});
    await deliverAll(env, sql, g);
  }
}

async function reroll(env, sql, g, by) {
  // winners who haven't got their prize yet (e.g. never linked their account) lose it, and their entry is removed so
  // they can't be picked again; a new winner is picked for each of them (at least one)
  const old = await sql`DELETE FROM giveaway_entries WHERE giveaway_id = ${g.id} AND won AND NOT delivered RETURNING user_id`;
  const won = await pick(sql, g, Math.max(1, old.length));
  const ids = won.map((r) => Number(r.user_id));
  if (!ids.length) throw new HttpError(409, "There's nobody left to pick.");
  const names = (await sql`SELECT username FROM users WHERE id = ANY(${ids})`).map((r) => r.username);
  const m = await botPost(sql, { slug: "giveaways", kind: "bot", content: `🎲 New winner for **${g.title}**: ${names.map((n) => `@${n}`).join(", ")}! You won **${prizeLabel(g)}**.`,
    replyTo: g.message_id ? Number(g.message_id) : null });
  if (m) await hubBroadcast(env, { type: "message", message: m });
  await notify(env, ids, "giveaways", { title: "You won a giveaway! 🎉", body: `${g.title}: ${prizeLabel(g)}`, url: "/community#giveaways", tag: `giveaway-won-${g.id}`, urgent: true }).catch(() => {});
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${by.id}, 'giveaway.reroll', ${JSON.stringify({ id: Number(g.id), title: g.title, winners: names })}::jsonb)`;
  await deliverAll(env, sql, g);
}

// Gives the prize to every winner who doesn't have it yet. Store items wait for the server if it's offline.
async function deliverAll(env, sql, g) {
  const rows = await sql`SELECT e.user_id, u.username FROM giveaway_entries e JOIN users u ON u.id = e.user_id
                          WHERE e.giveaway_id = ${g.id} AND e.won AND NOT e.delivered`;
  const p = g.prize || {};
  const reason = `Giveaway: ${g.title}`.slice(0, 120);
  for (const w of rows) {
    try {
      if (g.prize_kind === "text") {
        // staff hand it over; nothing to give automatically
      } else if (g.prize_kind === "credits") {
        const { change } = await import("../store/credits.js");
        await change(sql, w.user_id, Number(p.cents), "giveaway", reason, String(g.id));
      } else {
        const { linkedPlayer } = await import("./store.js");
        const player = await linkedPlayer(sql, w.user_id);
        if (!player) continue;   // unlinked since entering: tried again later
        if (g.prize_kind === "money") await queueReward(sql, { xuid: player.xuid, name: player.gamertag, cents: Number(p.cents), reason });
        else if (g.prize_kind === "keys") await queueReward(sql, { xuid: player.xuid, name: player.gamertag, keys: { [p.key]: Number(p.count) }, reason });
        else if (g.prize_kind === "item") {
          const { product } = await import("../store/promos.js");
          const { deliver } = await import("./store.js");
          const prod = product(p.item, p.option);
          if (!prod) continue;
          await deliver(env, sql, player, prod, { id: g.created_by, username: "Giveaway" }, "giveaway");
        }
      }
      await sql`UPDATE giveaway_entries SET delivered = true WHERE giveaway_id = ${g.id} AND user_id = ${w.user_id}`;
    } catch (e) {
      console.error("giveaway prize", g.id, w.user_id, e?.message);   // tried again on the next tick
    }
  }
  if (g.prize_kind === "money" || g.prize_kind === "keys") {
    const { sendRewards } = await import("./rewards.js");
    await sendRewards(env, sql).catch(() => {});
  }
}

// Every minute: end giveaways whose time is up, and retry prizes that couldn't be given yet.
export async function tick(env) {
  const sql = getDb(env);
  const due = await sql`SELECT * FROM giveaways WHERE status = 'open' AND ends_at <= now() ORDER BY ends_at LIMIT 10`;
  for (const g of due) {
    await finish(env, sql, g).catch((e) => console.error("giveaway end", g.id, e));
    await hubBroadcast(env, { type: "giveaway", id: Number(g.id) }).catch(() => {});
  }
  const waiting = await sql`SELECT DISTINCT g.* FROM giveaways g JOIN giveaway_entries e ON e.giveaway_id = g.id
                             WHERE g.status = 'ended' AND e.won AND NOT e.delivered AND g.prize_kind <> 'text' AND g.ended_at > now() - interval '30 days' LIMIT 10`;
  for (const g of waiting) await deliverAll(env, sql, g).catch(() => {});
}

// GET /api/giveaways/items (staff): Store items a giveaway can give
export async function itemsList(request, env) {
  const user = await requireUser(request, env);
  if (!can(user, "run_giveaways")) throw new HttpError(403, "Only staff who run giveaways can see this.");
  return json({ ok: true, items: await giveawayItems() });
}

// POST /api/giveaways (staff): start one from the giveaway form
export async function create(request, env) {
  const user = await requireUser(request, env);
  await rateLimit(env, "POLL_LIMITER", `give:${user.id}`);
  const { giveaway } = await startGiveaway(env, getDb(env), user, await readJson(request));
  return json({ ok: true, id: Number(giveaway.id), message: `Giveaway started in #Giveaways. It ends ${new Date(giveaway.ends_at).toUTCString().replace(" GMT", " UTC")}.` });
}
