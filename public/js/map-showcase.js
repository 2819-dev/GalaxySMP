// Plot Showcase (a view on the map page, not its own page): every claimed plot as a card, most liked first.
// Public plots have a "Show on map" button; "Location Hidden" plots show without where they are;
// hidden plots are locked "Plot Hidden" cards.
import { h, getJson } from "/js/dialog.js";
import { iconEl, toast } from "/js/site.js";

export function openShowcase(stage, { goTo, onClose }) {
  const grid = h("div", { class: "sc-grid" }, h("p", { class: "text-3", text: "Loading…" }));
  const close = h("button", { class: "btn btn-secondary btn-sm", type: "button" }, iconEl("close"), "Back to map");
  const panel = h("section", { class: "showcase", "aria-label": "Plot Showcase" },
    h("div", { class: "sc-top" }, h("div", {}, h("h2", { text: "Plot Showcase" }),
      h("p", { class: "text-3 small", style: "margin:0", text: "Builds on GalaxySMP, most liked first. Owners choose what's shown: tap your own plot to change it." })), close),
    grid);
  const done = () => { panel.remove(); onClose?.(); };
  close.addEventListener("click", done);
  stage.append(panel);

  async function load() {
    let d;
    try { d = await getJson("/api/map/showcase"); } catch (e) { grid.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    if (!d.plots.length) { grid.replaceChildren(h("p", { class: "text-3", text: "No plots have been claimed yet." })); return; }
    grid.replaceChildren(...d.plots.map((p) => {
      if (p.visibility === "hidden" && !p.mine) {
        return h("div", { class: "sc-card sc-locked" }, h("div", { class: "sc-pic" }, iconEl("lock")), h("div", { class: "sc-body" }, h("b", { text: "Plot Hidden" }),
          h("span", { class: "text-3 small", text: "The owner keeps this one private." })));
      }
      const pic = p.photo ? h("img", { src: `/api/map/plot-photo/${p.photo.id}`, alt: `Photo of ${p.name}`, loading: "lazy" }) : iconEl("castle");
      const chips = [];
      if (p.visibility === "location") chips.push(h("span", { class: "sc-chip", title: "The owner hides where this plot is" }, iconEl("eye"), "Location Hidden"));
      if (p.visibility === "hidden") chips.push(h("span", { class: "sc-chip" }, iconEl("lock"), "Plot Hidden (only you see this)"));
      if (p.photos > 1) chips.push(h("span", { class: "sc-chip", text: `${p.photos} photos` }));
      const card = h("button", { class: "sc-card", type: "button" },
        h("div", { class: "sc-pic" }, pic),
        h("div", { class: "sc-body" },
          h("b", { text: p.name }),
          h("span", { class: "text-3 small", text: `By ${p.owner}${p.mine ? " (you)" : ""}` }),
          p.caption ? h("span", { class: "sc-cap", text: p.caption }) : null,
          h("div", { class: "sc-foot" }, h("span", { class: "sc-likes" }, iconEl("heart"), String(p.likes)), ...chips)));
      card.addEventListener("click", () => import("/js/map-plot.js").then((m) => m.openPlot(p.id, load)));
      if (p.x != null) {
        const go = h("button", { class: "btn btn-ghost btn-sm sc-go", type: "button" }, iconEl("map"), "Show on map");
        go.addEventListener("click", (e) => { e.stopPropagation(); done(); goTo(p.x, p.z, 3); });
        return h("div", { class: "sc-wrap" }, card, go);
      }
      return h("div", { class: "sc-wrap" }, card);
    }));
  }
  load().catch((e) => toast(e.message));
  return done;
}
