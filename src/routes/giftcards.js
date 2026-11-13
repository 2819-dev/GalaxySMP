// Gift cards: Galaxy Credits in a designed card with a personal message, bought in the Store (with credits or a
// card) and shared as a private link (galaxymc.us/gift?c=CODE). Whoever opens it watches the gift box open, then
// redeems it to their account. Each card works once.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { change } from "../store/credits.js";
import { AMOUNTS, TEMPLATE, GREETINGS, GREETING_MAX, MESSAGE_MAX, styleOf } from "../../public/js/giftcard-designs.js";
import { notify } from "./notify.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const usd = (c) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `GALX-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
const cleanCode = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^GALX/, "").slice(0, 12);
const fmtCode = (raw) => `GALX-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;

const out = (c, withCode) => ({
  id: Number(c.id), design: c.design, style: c.style || styleOf(c.design), amount: Number(c.amount_cents), message: c.message || "", from: c.from_name, to: c.to_name || "",
  status: c.status, createdAt: c.created_at, redeemedAt: c.redeemed_at, redeemedBy: c.redeemed_by_name || null,
  ...(withCode ? { code: c.code, link: `/gift?c=${encodeURIComponent(c.code)}` } : {}),
});

async function cleanText(sql, v, max) {
  const t = String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
  if (!t) return "";
  const check = checkMessage(t, compileWordList(await sql`SELECT word, match FROM filter_words`), { allowLinks: false, maxLength: max });
  if (!check.ok) throw new HttpError(400, check.message || "That isn't allowed.");
  return check.text;
}

// POST /api/giftcards { design, amount (cents), toName, message, method: "credits" | "card" }
export async function buy(request, env) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  await rateLimit(env, "AUTH_LIMITER", `gc:${user.id}`);
  const body = await readJson(request);
  const sql = getDb(env);
  // the card the buyer built: background, artwork, foil, pattern and greeting (a template fills these in)
  const design = TEMPLATE[body.template] ? body.template : "custom";
  const style = styleOf({ template: body.template, ...(body.style || {}) });
  if (String(body.style?.greeting || "").trim().length > GREETING_MAX) throw new HttpError(400, `Greetings can be up to ${GREETING_MAX} characters.`);
  if (!GREETINGS.includes(style.greeting)) style.greeting = await cleanText(sql, style.greeting, GREETING_MAX) || "A gift for you";
  const amount = Math.round(Number(body.amount));
  if (!AMOUNTS.includes(amount)) throw new HttpError(400, "Choose an amount.");
  if (String(body.message || "").trim().length > MESSAGE_MAX) throw new HttpError(400, `Messages can be up to ${MESSAGE_MAX} characters.`);
  const message = await cleanText(sql, body.message, MESSAGE_MAX);
  const toName = await cleanText(sql, body.toName, 32);
  const code = newCode();
  const method = body.method === "card" ? "card" : "credits";
  const [card] = await sql`INSERT INTO gift_cards (code, design, style, amount_cents, message, from_name, to_name, buyer_id, status)
                           VALUES (${code}, ${design}, ${JSON.stringify(style)}::jsonb, ${amount}, ${message}, ${user.username}, ${toName}, ${user.id}, 'pending') RETURNING *`;
  if (method === "credits") {
    const left = user.owner ? 1 : await change(sql, user.id, -amount, "purchase", `Gift card (${usd(amount)})`, `giftcard:${card.id}`);
    if (left === null) {
      await sql`DELETE FROM gift_cards WHERE id = ${card.id}`;
      throw new HttpError(409, `You need ${usd(amount)} of Galaxy Credits for this gift card. Top up in the Store, or pay by card.`);
    }
    const [done] = await sql`UPDATE gift_cards SET status = 'active' WHERE id = ${card.id} RETURNING *`;
    return json({ ok: true, card: out(done, true) });
  }
  // by card: Stripe checkout, activated by the webhook
  const { stripeReady, createGiftCheckout } = await import("./store.js");
  if (!stripeReady(env)) {
    await sql`DELETE FROM gift_cards WHERE id = ${card.id}`;
    return json({ ok: false, comingSoon: true, message: "Card payments aren't available yet. Use Galaxy Credits, or check back soon." });
  }
  const url = await createGiftCheckout(env, sql, user, card, new URL(request.url).origin);
  return json({ ok: true, url });
}

// The card payment went through (called by the Stripe webhook)
export async function activatePaid(sql, cardId) {
  await sql`UPDATE gift_cards SET status = 'active' WHERE id = ${cardId} AND status = 'pending'`;
}

// GET /api/giftcards/mine: cards you bought (with their codes)
export async function mine(request, env) {
  const user = await requireUser(request, env);
  const rows = await getDb(env)`SELECT g.*, u.username AS redeemed_by_name FROM gift_cards g LEFT JOIN users u ON u.id = g.redeemed_by
                                 WHERE g.buyer_id = ${user.id} AND g.status <> 'pending' ORDER BY g.id DESC LIMIT 50`;
  return json({ ok: true, cards: rows.map((c) => out(c, true)) });
}

// GET /api/giftcards/open?c=CODE: what's inside (no sign-in needed, so anyone with the link can see it)
export async function peek(request, env, ctx, url) {
  const raw = cleanCode(url.searchParams.get("c"));
  if (raw.length !== 12) throw new HttpError(404, "That gift card link isn't complete. Check the code and try again.");
  await rateLimit(env, "POLL_LIMITER", `gcpeek:${request.headers.get("CF-Connecting-IP") || "?"}`);
  const [c] = await getDb(env)`SELECT g.*, u.username AS redeemed_by_name FROM gift_cards g LEFT JOIN users u ON u.id = g.redeemed_by
                                WHERE g.code = ${fmtCode(raw)} AND g.status IN ('active', 'redeemed')`;
  if (!c) throw new HttpError(404, "We couldn't find that gift card. Check the code and try again.");
  return json({ ok: true, card: out(c, false) }, 200, { "Cache-Control": "no-store" });
}

// POST /api/giftcards/redeem { code }
export async function redeem(request, env) {
  const user = await requireUser(request, env);
  await rateLimit(env, "AUTH_LIMITER", `gcred:${user.id}`);
  const body = await readJson(request);
  const raw = cleanCode(body.code);
  if (raw.length !== 12) throw new HttpError(400, "Enter the full gift card code.");
  const sql = getDb(env);
  const [c] = await sql`UPDATE gift_cards SET status = 'redeemed', redeemed_by = ${user.id}, redeemed_at = now()
                         WHERE code = ${fmtCode(raw)} AND status = 'active' RETURNING *`;
  if (!c) {
    const [was] = await sql`SELECT status FROM gift_cards WHERE code = ${fmtCode(raw)}`;
    throw new HttpError(409, was?.status === "redeemed" ? "This gift card has already been redeemed." : "We couldn't find that gift card. Check the code and try again.");
  }
  const left = await change(sql, user.id, Number(c.amount_cents), "gift", `Gift card from ${c.from_name}`, `giftcard:${c.id}`);
  if (Number(c.buyer_id) !== Number(user.id)) {
    await notify(env, [Number(c.buyer_id)], "dms", { title: "Your gift card was opened", body: `${user.username} redeemed the ${usd(Number(c.amount_cents))} gift card you sent.`, url: "/store#giftcards", tag: `gc-${c.id}` }).catch(() => {});
  }
  return json({ ok: true, credits: left / 100, message: `${usd(Number(c.amount_cents))} of Galaxy Credits has been added to your account.` });
}
