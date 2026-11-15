// Crate Odds (galaxymc.us/crates): every prize in each crate with its chance, sent by the server's plugin.
import "/js/site.js";
import { iconEl } from "/js/site.js";
import { h } from "/js/dialog.js";

const THEME = { common: "co-common", rare: "co-rare", galaxy: "co-galaxy" };
const ICON = { money: "coins", key: "key", item: "gem" };
const pct = (n) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2)).replace(/\.0+$/, "") + "%";

async function load() {
  const grid = document.getElementById("co-grid");
  let d;
  try { d = await (await fetch("/api/crates")).json(); } catch { d = { crates: [] }; }
  if (d.keyPrice) document.getElementById("co-price").textContent = ` for $${(d.keyPrice / 100).toLocaleString("en-US")}`;
  if (!d.crates?.length) {
    grid.replaceChildren(h("p", { class: "text-3", text: "The crate list shows here once the server has connected. Check back soon." }));
    return;
  }
  grid.replaceChildren(...d.crates.map((c) => {
    const best = Math.max(...c.prizes.map((p) => p.chance), 1);
    return h("section", { class: `panel co-crate ${THEME[c.key] || ""}` },
      h("div", { class: "co-head" }, h("span", { class: "co-badge" }, iconEl("gift")), h("div", {},
        h("h2", { text: c.name }), h("span", { class: "text-3 small", text: `${c.prizes.length} possible prize${c.prizes.length === 1 ? "" : "s"}` }))),
      h("ol", { class: "co-list" }, ...c.prizes.map((p) => h("li", { class: "co-row" },
        h("span", { class: `co-ic co-ic-${p.kind}` }, iconEl(ICON[p.kind] || "gem")),
        h("span", { class: "co-name" }, h("b", { text: p.label }),
          h("span", { class: "co-bar", "aria-hidden": "true" }, h("span", { style: `width:${Math.max(2, (p.chance / best) * 100)}%` }))),
        h("span", { class: "co-pct", text: pct(p.chance) })))));
  }));
}
load();
