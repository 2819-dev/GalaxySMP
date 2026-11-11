// Control Panel > Payments (owner only): money made, recent payments, credits, and whether Stripe is connected.
import { h, getJson } from "/js/dialog.js";
import { iconEl } from "/js/site.js";

const usd = (n) => `$${Number(n).toFixed(2)}`;
const fmt = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STATUS = { paid: ["Paid", "on"], pending: ["Waiting", "off"], failed: ["Not paid", "off"], refunded: ["Refunded", "bad"] };

export function setupPayments({ loaders }) {
  loaders.payments = async () => {
    const box = document.getElementById("pay-box");
    let d;
    try { d = await getJson("/api/panel/payments"); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    const s = d.stripe;
    const status = s.connected
      ? h("div", { class: "pay-status ok" }, iconEl("check"), h("span", {}, h("b", { text: s.live ? "Stripe is connected (live)" : "Stripe is connected (TEST mode)" }),
        h("span", { class: "text-3 small", text: s.live ? ` · ${s.name || "real payments are on"}` : " · test cards only, no real money yet" })))
      : h("div", { class: "pay-status" }, iconEl("alert"), h("span", {}, h("b", { text: "Stripe isn't connected yet" }),
        h("span", { class: "text-3 small", text: s.error ? ` · ${s.error}` : " · players can still spend credits and use promo codes. See the staff guide to connect it." })));
    const tile = (label, v) => h("div", { class: "pay-tile" }, h("span", { class: "text-3 small", text: label }), h("b", { text: usd(v) }));
    const tiles = h("div", { class: "pay-tiles" }, tile("Today", d.totals.day), tile("Last 7 days", d.totals.week), tile("Last 30 days", d.totals.month), tile("All time", d.totals.total));
    const credits = h("p", { class: "text-3 small", style: "margin:8px 0 0", text: `${d.totals.count} card payment${d.totals.count === 1 ? "" : "s"} · ${usd(d.credits.held)} of credits waiting to be spent · ${usd(d.credits.spent)} spent in the Store · ${usd(d.credits.given)} given free by you (not real money). Card amounts are before Stripe's fees.` });
    const list = d.recent.length
      ? h("div", { class: "promo-list" }, d.recent.map((r) => h("div", { class: "promo-row" },
        h("div", { class: "promo-main" },
          h("div", { class: "promo-top" }, h("b", { text: r.what }), h("span", { class: `promo-status ${STATUS[r.status]?.[1] || "off"}`, text: STATUS[r.status]?.[0] || r.status })),
          h("p", { class: "text-3 small promo-bits", text: `${r.who} · ${fmt(r.at)}` })),
        h("b", { class: "pay-amount", text: usd(r.amount) }))))
      : h("p", { class: "text-3", text: "No payments yet." });
    box.replaceChildren(status, tiles, credits, h("h3", { class: "pay-h3", text: "Recent payments" }), list,
      h("p", { class: "text-3 small", style: "margin:12px 0 0", text: "Refunds: refund the payment in your Stripe dashboard. The website then takes the item or credits back automatically." }));
  };
}
