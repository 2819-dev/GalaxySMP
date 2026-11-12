// Player Shops page: shop chests from Galaxy+ and Galaxy Pro+ members, bought right here.
import { toast, iconEl } from "/js/site.js";
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { money, moneyExact } from "/js/money.js";

const $ = (id) => document.getElementById(id);
let data = null;

const hue = (s) => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7);
const dimName = (d) => ({ overworld: "Overworld", nether: "Nether", theend: "The End", the_end: "The End" })[String(d).toLowerCase()] || d || "Overworld";

function itemTile(s) {
  const t = h("span", { class: "sh-tile", "aria-hidden": "true", text: s.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?" });
  t.style.setProperty("--h", hue(s.item));
  return t;
}

function card(s) {
  const trades = Math.floor(s.stock / s.amount);
  const out = trades < 1;
  const buy = h("button", { class: "btn btn-primary btn-sm", type: "button", disabled: out || s.mine, text: s.mine ? "Your shop" : out ? "Out of stock" : "Buy" });
  buy.addEventListener("click", () => buyDialog(s));
  const owner = h("a", { href: `/player/${encodeURIComponent(s.owner)}`, text: s.owner });
  return h("article", { class: `panel sh-card${out ? " out" : ""}` },
    h("div", { class: "sh-top" }, itemTile(s),
      h("div", { class: "sh-what" }, h("h3", { class: "sh-name", text: s.name }),
        h("div", { class: "sh-deal" }, h("b", { text: moneyExact(s.price) }), ` for ${s.amount}`))),
    h("div", { class: "sh-meta" },
      h("span", { class: "with-ic" }, iconEl("store"), h("span", {}, `${s.shop} by `, owner)),
      h("span", { class: "with-ic" }, iconEl("pin"), `${dimName(s.where.dim)} ${s.where.x}, ${s.where.y}, ${s.where.z}`),
      h("span", { class: `sh-stock${out ? " none" : ""}`, text: out ? "Out of stock" : `${s.stock.toLocaleString()} in stock` })),
    h("div", { class: "sh-foot" }, h("span", { class: `plan-pill ${s.plan === "Galaxy Pro+" ? "pro" : "plus"}`, text: s.plan }), buy));
}

function buyDialog(s) {
  if (!data.me) { location.href = "/community"; return; }
  if (!data.me.linked) { toast("Link your Minecraft account first (Account > Link)."); return; }
  const max = Math.min(1000, Math.floor(s.stock / s.amount));
  const times = h("input", { class: "input", id: "sh-times", type: "number", min: 1, max, value: 1, inputmode: "numeric" });
  const total = h("p", { class: "sh-total" });
  const update = () => {
    const n = Math.max(1, Math.min(max, Math.floor(Number(times.value) || 1)));
    const cost = n * s.price;
    total.replaceChildren("You get ", h("b", { text: `${(n * s.amount).toLocaleString()}x ${s.name}` }), " for ", h("b", { text: moneyExact(cost) }),
      data.me.balance != null && cost > data.me.balance ? h("span", { class: "sh-warn", text: ` You have ${money(data.me.balance)}.` }) : "");
  };
  times.addEventListener("input", update);
  update();
  openDialog({
    title: `Buy ${s.name}`,
    body: h("div", { class: "form" },
      h("p", { class: "text-2", style: "margin:0" }, `From ${s.owner}'s shop. ${s.amount} for ${moneyExact(s.price)} each time.`),
      field(`How many times? (up to ${max})`, times), total,
      h("p", { class: "text-3 small", style: "margin:0", text: "Paid from your in-game balance. The items go into your inventory (if you're offline, the next time you join)." })),
    actions: [{ label: "Cancel" }, {
      label: "Buy", kind: "primary",
      onClick: async () => {
        const n = Math.max(1, Math.min(max, Math.floor(Number(times.value) || 1)));
        const r = await postJson(`/api/shops/${s.id}/buy`, { times: n, price: s.price, amount: s.amount });
        toast(r.message || "Bought.");
        load();
      },
    }],
  });
}

function render() {
  const box = $("sh-list");
  const q = $("sh-q").value.trim().toLowerCase();
  const sort = $("sh-sort").value;
  let list = data.shops.filter((s) => !q || `${s.name} ${s.item} ${s.owner} ${s.shop}`.toLowerCase().includes(q));
  if (sort === "cheap") list = [...list].sort((a, b) => a.price / a.amount - b.price / b.amount);
  if (sort === "stock") list = [...list].sort((a, b) => b.stock - a.stock);
  box.replaceChildren(...(list.length ? list.map(card)
    : [h("div", { class: "panel empty", text: data.shops.length ? "No shops match that." : "No shops are listed right now. Check back soon, or visit the Shop District in game." })]));
  $("sh-bal").textContent = data.me?.balance != null ? `Your balance: ${money(data.me.balance)}` : "";
}

async function load() {
  try { data = await getJson("/api/shops"); } catch (e) { $("sh-list").replaceChildren(h("div", { class: "panel empty", text: e.message || "Shops couldn't be loaded." })); return; }
  render();
}

$("sh-q").addEventListener("input", () => data && render());
$("sh-sort").addEventListener("change", () => data && render());
load();
setInterval(() => { if (!document.hidden && !document.querySelector("dialog[open]")) load(); }, 30000);
