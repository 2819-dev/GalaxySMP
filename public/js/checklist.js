// The new player checklist card (home page and Account settings). Only shows for new members.
import { h, getJson, postJson } from "/js/dialog.js";
import { toast, iconEl } from "/js/site.js";
import { moneyDollars } from "/js/money.js";

export async function checklistCard() {
  let d;
  try { d = await getJson("/api/checklist"); } catch { return null; }
  if (!d.show) return null;
  const doneN = d.steps.filter((s) => s.done).length;
  const card = h("section", { class: "panel ck-card" });
  const claim = h("button", { class: "btn btn-primary", type: "button", disabled: !d.done, text: d.done ? `Claim ${moneyDollars(d.reward / 100)}` : `${doneN} of ${d.steps.length} done` });
  claim.addEventListener("click", async () => {
    claim.disabled = true;
    try { const r = await postJson("/api/checklist/claim", {}); toast(r.message); card.remove(); } catch (e) { toast(e.message); claim.disabled = false; }
  });
  card.append(
    h("div", { class: "ck-head" },
      h("div", {}, h("h2", { text: "Getting started" }), h("p", { class: "text-3", text: `Finish these first steps to earn ${moneyDollars(d.reward / 100)} in game.` })),
      claim),
    h("div", { class: "ck-bar" }, h("span", { style: `width:${Math.round((doneN / d.steps.length) * 100)}%` })),
    h("ol", { class: "ck-list" }, ...d.steps.map((s) => h("li", { class: s.done ? "done" : "" },
      h("span", { class: "ck-dot" }, s.done ? iconEl("check") : null),
      h("div", {}, s.href && !s.done ? h("a", { href: s.href, text: s.title }) : h("b", { text: s.title }), h("span", { class: "text-3 small", text: s.hint }))))));
  return card;
}
