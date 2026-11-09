// Store API. Today this only shows ranks and answers "coming soon".
//
// Adding Stripe later (no rewrite needed):
//   1. Add STRIPE_SECRET_KEY in Cloudflare (Variables and Secrets).
//   2. Fill in stripePriceId for each rank in src/store/catalog.js.
//   3. Replace the body of createCheckout() below with a call to Stripe's
//      "Create Checkout Session" API and return { url } to redirect to.
//   4. Add a webhook route that gives the buyer their rank after payment.
// The website's Store page already calls /api/store/checkout and follows the
// returned url, so nothing else has to change.
import { RANKS } from "../store/catalog.js";
import { json, readJson, HttpError } from "../lib/http.js";

function publicRank(r) {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    price: (r.priceCents / 100).toFixed(2),
    currency: r.currency,
    perks: r.perks,
  };
}

export function listRanks() {
  return json({ ok: true, ranks: RANKS.map(publicRank), checkoutEnabled: false });
}

// eslint-disable-next-line no-unused-vars
async function createCheckout(env, rank) {
  // Stripe goes here later. Until then, every rank is "coming soon".
  return { comingSoon: true };
}

export async function checkout(request, env) {
  const body = await readJson(request);
  const rank = RANKS.find((r) => r.id === body.rankId);
  if (RANKS.length && !rank) throw new HttpError(404, "That rank doesn't exist.");
  const result = await createCheckout(env, rank);
  if (result.comingSoon) return json({ ok: false, comingSoon: true, message: "Paid plans are coming soon!" });
  return json({ ok: true, url: result.url });
}
