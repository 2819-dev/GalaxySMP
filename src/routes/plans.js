// Subscriptions: Galaxy Free, Galaxy+ and Galaxy Pro+ (defined in the plugin's plans.json so the
// website and the server always agree). Paid checkout is "coming soon"; Admins can give plans in
// Staff Tools > Economy. The server applies the perks and takes the monthly in-game fee.
import { can } from "../lib/perms.js";
import { postTimeline } from "./feed.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { toPlugin } from "./economy.js";
import PLANS from "../../endstone-plugin/src/endstone_galaxylink/plans.json";
import { SHOP } from "../store/shop.js";

export { PLANS };

export async function loadSubscriptions(sql) {
  const rows = await sql`SELECT xuid, plan, expires_at FROM subscriptions WHERE expires_at IS NULL OR expires_at > now()`;
  return Object.fromEntries(rows.map((r) => [r.xuid, {
    plan: r.plan,
    expires: r.expires_at ? Math.floor(new Date(r.expires_at).getTime() / 1000) : null,
  }]));
}

// Public: the Store page.
export function storePlans(env) {
  const cardsReady = Boolean(env?.STRIPE_SECRET_KEY && env?.STRIPE_WEBHOOK_SECRET);
  const ON_SALE = ["plans", "money", "plots", "effects"]; // the same list as ON_SALE in routes/store.js
  return json({
    ok: true,
    checkoutEnabled: cardsReady,
    onSale: ON_SALE,
    plans: ["free", "plus", "pro"].map((id) => ({ id, ...PLANS[id] })),
    shop: SHOP.map((c) => ({
      id: c.id, name: c.name, blurb: c.blurb,
      items: c.items.map(({ cents, days, ...i }) => ({ ...i, price: i.price != null ? i.price / 100 : undefined,
        options: i.options?.map((o) => ({ id: o.id, name: o.name, price: o.price / 100 })) })),
    })),
  }, 200, { "Cache-Control": "public, max-age=300" });
}

// Everything the server needs about plans: who has which plan, and extra plots.
export async function planMessage(sql) {
  const extra = await sql`
    SELECT xuid, extra_plots, extra_shop_plots, cosmetics, night_vision_until FROM players
     WHERE extra_plots > 0 OR extra_shop_plots > 0 OR cardinality(cosmetics) > 0 OR night_vision_until > now()`;
  return {
    type: "plans",
    subscriptions: await loadSubscriptions(sql),
    extraPlots: Object.fromEntries(extra.filter((r) => r.extra_plots > 0).map((r) => [r.xuid, Number(r.extra_plots)])),
    extraShopPlots: Object.fromEntries(extra.filter((r) => r.extra_shop_plots > 0).map((r) => [r.xuid, Number(r.extra_shop_plots)])),
    cosmetics: Object.fromEntries(extra.filter((r) => r.cosmetics?.length).map((r) => [r.xuid, r.cosmetics])),
    nightVision: Object.fromEntries(extra.filter((r) => r.night_vision_until && new Date(r.night_vision_until) > new Date())
      .map((r) => [r.xuid, Math.floor(new Date(r.night_vision_until).getTime() / 1000)])),
  };
}

export async function sendPlans(env, sql) {
  return toPlugin(env, await planMessage(sql));
}

// Admins: give, change or remove a player's plan.
export async function adminSetPlan(request, env) {
  const user = await requireUser(request, env);
  if (!can(user, "give_plans")) throw new HttpError(403, "Your rank can't give plans.");
  const body = await readJson(request);
  const sql = getDb(env);
  const [player] = await sql`SELECT xuid, gamertag FROM players WHERE xuid = ${String(body.xuid || "")}`;
  if (!player) throw new HttpError(404, "That player hasn't joined the server yet.");
  if (body.extraPlots !== undefined) {
    const extra = Number(body.extraPlots);
    if (!Number.isInteger(extra) || extra < 0 || extra > 50) throw new HttpError(400, "Extra plots must be a number from 0 to 50.");
    await sql`UPDATE players SET extra_plots = ${extra} WHERE xuid = ${player.xuid}`;
  }
  const plan = body.plan ? String(body.plan) : null;
  if (plan && !["plus", "pro"].includes(plan)) throw new HttpError(400, "Choose Galaxy+ or Galaxy Pro+.");
  const days = Number(body.days || 0);
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new HttpError(400, "Choose how long the plan lasts.");
  if (plan) {
    const expires = days ? new Date(Date.now() + days * 86400_000).toISOString() : null;
    await sql`
      INSERT INTO subscriptions (xuid, plan, expires_at, granted_by) VALUES (${player.xuid}, ${plan}, ${expires}, ${user.username})
      ON CONFLICT (xuid) DO UPDATE SET plan = EXCLUDED.plan, expires_at = EXCLUDED.expires_at, granted_by = EXCLUDED.granted_by`;
    await postTimeline(sql, { kind: "plan", xuid: player.xuid, name: player.gamertag, title: `got ${PLANS[plan].name}`, detail: "Thanks for supporting GalaxySMP!", icon: "star",
      dedupe: `plan:${player.xuid}:${plan}:${new Date().toISOString().slice(0, 10)}` });
  } else {
    await sql`DELETE FROM subscriptions WHERE xuid = ${player.xuid}`;
  }
  await sql`INSERT INTO audit_log (actor_id, action, details)
            VALUES (${user.id}, ${plan ? "plan.give" : "plan.remove"}, ${JSON.stringify({ player: player.gamertag, plan: plan ? PLANS[plan].name : null, days })}::jsonb)`;
  const sent = await sendPlans(env, sql);
  return json({ ok: true, sent });
}
