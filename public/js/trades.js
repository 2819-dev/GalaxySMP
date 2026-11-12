// Trades page: offers to you, your offers, and making a new offer from your (live) inventory.
import { toast } from "/js/site.js";
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { money, moneyExact } from "/js/money.js";

const $ = (id) => document.getElementById(id);
const STATUS = { pending: ["Waiting", "planned"], accepted: ["Accepted", "done"], declined: ["Declined", "declined"], cancelled: ["Cancelled", "open"], expired: ["Expired", "open"] };

// "5k", "1.5m", "2,500" -> cents
function parsePrice(text) {
  const m = String(text).trim().toLowerCase().replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1;
  return Math.round(Number(m[1]) * mult * 100);
}

function left(iso) {
  const s = Math.max(0, (new Date(iso) - Date.now()) / 1000);
  const hrs = Math.floor(s / 3600);
  return hrs ? `${hrs}h ${Math.floor((s % 3600) / 60)}m left` : `${Math.max(1, Math.floor(s / 60))}m left`;
}

let data = null;

function tradeCard(t) {
  const [label, cls] = STATUS[t.status] || ["", "open"];
  const who = t.incoming ? `From ${t.seller}` : `To ${t.buyer}`;
  const actions = h("div", { class: "tr-actions" });
  if (t.status === "pending" && t.incoming) {
    actions.append(
      h("button", { class: "btn btn-primary btn-sm", type: "button", text: `Accept and pay ${money(t.price)}`, onclick: () => openDialog({
        title: `Buy ${t.amount}x ${t.label}?`,
        body: h("p", { class: "text-2", style: "margin:0" }, `You pay `, h("b", { text: moneyExact(t.price) }), ` to ${t.seller}. The item goes into your inventory (if you're offline, the next time you join).`),
        actions: [{ label: "Cancel" }, { label: "Accept and pay", kind: "primary", onClick: async () => { const r = await postJson(`/api/trades/${t.id}/accept`, {}); toast(r.message || "Trade done."); load(); } }],
      }) }),
      h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Decline", onclick: async () => {
        try { await postJson(`/api/trades/${t.id}/decline`, {}); toast("Declined. The item goes back to the seller."); load(); } catch (e) { toast(e.message); }
      } }));
  }
  if (t.status === "pending" && !t.incoming) {
    actions.append(h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Cancel offer", onclick: async () => {
      try { await postJson(`/api/trades/${t.id}/cancel`, {}); toast("Cancelled. The item is back in your inventory."); load(); } catch (e) { toast(e.message); }
    } }));
  }
  return h("article", { class: "panel tr-card" },
    h("div", { class: "tr-item" }, h("span", { class: "tr-amount", text: `${t.amount}x` }), h("div", {},
      h("b", { text: t.label }), t.enchants.length ? h("div", { class: "text-3 small", text: t.enchants.join(", ") }) : null)),
    h("div", { class: "tr-price", text: money(t.price), title: moneyExact(t.price) }),
    h("div", { class: "tr-meta" }, h("span", { class: `sg-status ${cls}`, text: label }),
      h("span", { text: `${who} · ${t.status === "pending" ? left(t.expiresAt) : new Date(t.decidedAt || t.createdAt).toLocaleDateString()}` })),
    t.note ? h("p", { class: "tr-note", text: `“${t.note}”` }) : null,
    actions);
}

function renderLists() {
  const inc = data.trades.filter((t) => t.incoming), outg = data.trades.filter((t) => !t.incoming);
  const waiting = inc.filter((t) => t.status === "pending").length;
  $("tr-in-count").textContent = waiting ? String(waiting) : "";
  $("tr-in-count").dataset.n = String(waiting);
  $("tr-incoming").replaceChildren(...(inc.length ? inc.map(tradeCard) : [h("div", { class: "panel empty", text: "No offers to you yet." })]));
  $("tr-outgoing").replaceChildren(...(outg.length ? outg.map(tradeCard) : [h("div", { class: "panel empty", text: "You haven't offered anything yet. Use New offer." })]));
}

async function load() {
  try { data = await getJson("/api/trades"); renderLists(); } catch (e) { $("tr-incoming").replaceChildren(h("p", { class: "text-3", text: e.message })); }
}

// ---------- new offer ----------
function renderNew() {
  const box = $("tr-new");
  const grid = h("div", { class: "tr-inv" });
  const status = h("p", { class: "text-3 small", style: "margin:0" }, "Your inventory loads live from the server, so you need to be online in Minecraft.");
  const loadBtn = h("button", { class: "btn btn-primary", type: "button", text: "Load my inventory" });
  let chosen = null;
  const form = h("div", { class: "form" });
  const formBox = h("section", { class: "panel", style: "padding:16px", hidden: true }, form);
  const buyer = h("input", { class: "input", id: "tr-buyer", maxlength: 32, placeholder: "Player name", autocomplete: "off", list: "tr-players" });
  const players = h("datalist", { id: "tr-players" });
  const price = h("input", { class: "input", id: "tr-price", placeholder: "e.g. 5000, 5k or 1.5m", inputmode: "decimal", autocomplete: "off" });
  const note = h("input", { class: "input", id: "tr-note", maxlength: 120, placeholder: "Optional message, e.g. \"for your castle\"" });
  const pick = h("p", { class: "tr-picked" });
  const pricePreview = h("p", { class: "hint", style: "margin:4px 0 0" });
  price.addEventListener("input", () => { const c = parsePrice(price.value); pricePreview.textContent = c ? `= ${moneyExact(c)}` : ""; });
  let t = null;
  buyer.addEventListener("input", () => {
    clearTimeout(t);
    const q = buyer.value.trim();
    if (q.length < 2) return;
    t = setTimeout(async () => {
      try { const d = await (await fetch(`/api/players/search?q=${encodeURIComponent(q)}`)).json(); players.replaceChildren(...(d.players || []).map((p) => h("option", { value: p.name }))); } catch { /* ignore */ }
    }, 250);
  });
  const to = new URLSearchParams(location.search).get("to");
  if (to) buyer.value = to;
  const send = h("button", { class: "btn btn-primary", type: "button", text: "Send offer" });
  send.addEventListener("click", async () => {
    const cents = parsePrice(price.value);
    if (!chosen) return toast("Pick an item first.");
    if (!buyer.value.trim()) return toast("Who is it for?");
    if (!cents) return toast("Enter a price, like 5000 or 5k.");
    send.disabled = true;
    try {
      await postJson("/api/trades", { buyer: buyer.value.trim(), slot: chosen.slot, expectId: chosen.id, expectAmount: chosen.amount, enchants: chosen.enchants, price: cents, note: note.value });
      toast(`Offer sent to ${buyer.value.trim()}. The item is held until they answer.`);
      chosen = null; formBox.hidden = true; grid.replaceChildren(); price.value = ""; note.value = ""; pricePreview.textContent = "";
      await load();
      selectTab("outgoing");
    } catch (e) { toast(e.message); }
    send.disabled = false;
  });
  form.append(pick, field("Offer to", buyer), players, h("div", { class: "field" }, h("label", { class: "field-label", for: "tr-price", text: "Price (in-game money)" }), price, pricePreview), field("Message", note), send);
  loadBtn.addEventListener("click", async () => {
    loadBtn.disabled = true;
    status.textContent = "Loading your inventory…";
    try {
      const d = await getJson("/api/trades/inventory");
      status.textContent = d.items.length ? "Tap the item you want to offer." : "Your inventory is empty.";
      grid.replaceChildren(...d.items.map((it) => {
        const b = h("button", { type: "button", class: "tr-slot", "aria-pressed": "false" },
          h("span", { class: "tr-slot-n", text: `${it.amount}x` }), h("b", { text: it.label }),
          it.enchants.length ? h("span", { class: "text-3 small", text: it.enchants.join(", ") }) : null);
        b.addEventListener("click", () => {
          chosen = it;
          grid.querySelectorAll(".tr-slot").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          pick.textContent = `Offering ${it.amount}x ${it.label}`;
          formBox.hidden = false;
          buyer.focus();
        });
        return b;
      }));
    } catch (e) { status.textContent = e.message; }
    loadBtn.disabled = false;
    loadBtn.textContent = "Reload inventory";
  });
  box.replaceChildren(h("section", { class: "panel", style: "padding:16px" },
    h("ol", { class: "tr-steps" }, h("li", { text: "Be online in Minecraft." }), h("li", { text: "Load your inventory and pick an item." }), h("li", { text: "Choose the player and the price, then send." })),
    h("div", { class: "cx-row" }, loadBtn), status), grid, formBox);
}

function selectTab(name) {
  document.querySelectorAll("#tr-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.t === name)));
  for (const k of ["incoming", "outgoing", "new"]) $(`tr-${k}`).hidden = k !== name;
}

(async () => {
  let user = null;
  try { user = (await getJson("/api/me")).user; } catch { /* signed out */ }
  if (!user) { $("tr-signin").hidden = false; return; }
  $("tr-app").hidden = false;
  document.querySelectorAll("#tr-tabs button").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.t)));
  renderNew();
  await load();
  if (new URLSearchParams(location.search).get("to")) selectTab("new");
  setInterval(load, 30000);
})();
