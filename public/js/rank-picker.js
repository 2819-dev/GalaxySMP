// Give a player several ranks at once (like Discord roles). Their commands combine; only the top
// rank in the Rank order shows as their tag, and website staff powers come from the strongest one.
import { h, openDialog, postJson, getJson } from "/js/dialog.js";
import { toast } from "/js/site.js";
import { rankTag } from "/js/rank-paint.js";

let cache = null;

export async function loadRanks(fresh) {
  if (!cache || fresh) cache = (await getJson("/api/mod/ranks?q=%20%20none%20%20")).ranks;  // ranks only, no player list
  return cache;
}

// Short text for a player's ranks: "[ADMIN]" or "[ADMIN] +2 more".
export function ranksSummary(ranks, ids) {
  const mine = ranks.filter((r) => ids.includes(r.id));
  if (!mine.length) return "No rank";
  return `[${mine[0].prefix}]${mine.length > 1 ? ` +${mine.length - 1} more` : ""}`;
}

export async function ranksDialog({ name, xuid, rankIds, onSaved }) {
  let ranks;
  try { ranks = await loadRanks(true); } catch (e) { toast(e.message); return; }
  const chosen = new Set((rankIds || []).map(Number));
  const list = h("div", { class: "rank-pick", role: "group", "aria-label": `Ranks for ${name}` });
  const note = h("p", { class: "hint" });
  const draw = () => {
    const top = ranks.find((r) => chosen.has(r.id));
    list.replaceChildren(...ranks.map((r) => {
      const on = chosen.has(r.id);
      const b = h("button", { type: "button", class: `rank-pick-row${on ? " on" : ""}`, "aria-pressed": String(on) },
        h("span", { class: "rank-pick-box", "aria-hidden": "true", text: on ? "✓" : "" }),
        rankTag(r), h("span", { class: "rank-pick-name", text: r.name }),
        on && r === top && chosen.size > 1 ? h("span", { class: "rank-pick-shown", text: "Shown" }) : null);
      b.addEventListener("click", () => { on ? chosen.delete(r.id) : chosen.add(r.id); draw(); });
      return b;
    }));
    note.textContent = !chosen.size ? "No ranks: tap ranks to give them."
      : chosen.size === 1 ? "Only this rank's tag shows."
      : `${name} gets the commands of ${chosen.size === 2 ? "both" : `all ${chosen.size}`} ranks. Only [${top.prefix}] shows, because it's highest in the Rank order (Ranks tab). A Galaxy+ or Pro+ plan placed higher there still shows instead.`;
  };
  draw();
  openDialog({
    title: `Ranks for ${name}`,
    body: h("div", { class: "form" },
      ranks.length ? list : h("p", { class: "text-3", text: "No ranks yet. Create them in the Ranks tab." }), note),
    actions: [{ label: "Cancel" }, {
      label: "Save", kind: "primary",
      onClick: async () => {
        await postJson("/api/mod/ranks/assign", { xuid, rankIds: [...chosen] });
        onSaved?.(chosen.size ? `Ranks updated for ${name}.` : `Ranks removed from ${name}.`, [...chosen]);
      },
    }],
  });
}
