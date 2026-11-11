// Control Panel > Badges (Admins): make badges, give them to members, take them back.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { iconEl } from "/js/site.js";
import { hexBadge, BADGE_THEMES } from "/js/badges.js";
import { faceSvg } from "/js/face.js";

const STYLE_NAMES = { gold: "Gold", silver: "Silver", bronze: "Bronze", ruby: "Ruby", emerald: "Emerald", sapphire: "Sapphire", amethyst: "Amethyst", galaxy: "Galaxy", sunset: "Sunset", ice: "Ice" };

function memberPicker(chosen, onChange) {
  const input = h("input", { class: "input", id: "bd-member", type: "search", placeholder: "Type the first letters of a name", autocomplete: "off" });
  const results = h("div", { class: "gift-list" });
  const chips = h("div", { class: "promo-chips" });
  const draw = () => {
    chips.replaceChildren(...[...chosen.values()].map((m) => {
      const x = h("button", { class: "promo-chip", type: "button", "aria-label": `Remove ${m.username}` }, m.username, " ×");
      x.addEventListener("click", () => { chosen.delete(m.id); draw(); onChange?.(); });
      return x;
    }));
  };
  let t = null;
  input.addEventListener("input", () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 2) { results.replaceChildren(); return; }
    t = setTimeout(async () => {
      const d = await getJson(`/api/store/members?q=${encodeURIComponent(q)}`).catch(() => ({ members: [] }));
      results.replaceChildren(...d.members.map((m) => {
        const img = h("img", { class: "gift-face", alt: "", width: 28, height: 28 });
        img.src = m.head || faceSvg(m.username);
        const b = h("button", { class: "gift-option", type: "button" }, img, h("span", { text: m.username }));
        b.addEventListener("click", () => { chosen.set(m.id, m); input.value = ""; results.replaceChildren(); draw(); onChange?.(); input.focus(); });
        return b;
      }));
    }, 200);
  });
  return h("div", {}, input, results, chips);
}

export function setupBadges({ loaders, toast }) {
  let data = null;

  async function load() {
    const box = document.getElementById("badge-list");
    try { data = await getJson("/api/panel/badges"); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    const row = (b, builtIn) => {
      const holders = builtIn ? "The owner (automatic)" : b.holders.length ? b.holders.map((x) => x.username).join(", ") : "Nobody yet";
      const actions = builtIn ? h("span", { class: "promo-status on", text: "Built in" }) : h("div", { class: "promo-actions" },
        h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Give", onclick: () => giveDialog(b, "award") }),
        b.holders.length ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Take back", onclick: () => giveDialog(b, "revoke") }) : null,
        h("button", { class: "btn btn-ghost btn-sm danger-text", type: "button", text: "Delete", onclick: () => openDialog({
          title: `Delete ${b.name}?`,
          body: h("p", { class: "text-2", text: "It disappears from everyone's profile. This can't be undone." }),
          actions: [{ label: "Cancel" }, { label: "Delete", kind: "danger", onClick: async () => { await postJson(`/api/panel/badges/${b.id}`, { action: "delete" }); toast("Badge deleted."); load(); } }],
        }) }));
      return h("div", { class: "promo-row bd-row" }, hexBadge(b, 52),
        h("div", { class: "promo-main" }, h("b", { text: b.name }), b.description ? h("p", { class: "text-2 small", style: "margin:2px 0 0", text: b.description }) : null,
          h("p", { class: "text-3 small promo-bits", text: holders })),
        actions);
    };
    box.replaceChildren(h("div", { class: "promo-list" }, row(data.owner, true), ...data.badges.map((b) => row(b, false))));
  }

  function giveDialog(b, action) {
    const chosen = new Map();
    if (action === "revoke") b.holders.forEach((x) => chosen.set(x.id, x));
    const picker = action === "award" ? memberPicker(chosen) : null;
    const list = action === "revoke" ? h("div", { class: "promo-chips" }) : null;
    if (list) {
      const draw = () => list.replaceChildren(...b.holders.map((x) => {
        const on = chosen.has(x.id);
        const c = h("button", { class: `promo-chip${on ? "" : " off"}`, type: "button", text: `${on ? "✓ " : ""}${x.username}` });
        c.addEventListener("click", () => { on ? chosen.delete(x.id) : chosen.set(x.id, x); draw(); });
        return c;
      }));
      draw();
    }
    openDialog({
      title: action === "award" ? `Give "${b.name}"` : `Take back "${b.name}"`,
      body: h("div", {}, h("div", { class: "bd-hero" }, hexBadge(b, 72)),
        action === "award" ? field("Give it to", picker.querySelector("input")) : h("p", { class: "text-2", text: "Tap names to choose who loses it (ticked = taken back)." }),
        picker ? h("div", {}, ...[...picker.children].slice(1)) : list),
      actions: [{ label: "Cancel" }, { label: action === "award" ? "Give badge" : "Take back", kind: action === "award" ? "primary" : "danger", onClick: async () => {
        if (!chosen.size) throw new Error("Pick at least one member.");
        await postJson(`/api/panel/badges/${b.id}`, { action, userIds: [...chosen.keys()] });
        toast(action === "award" ? `Gave "${b.name}" to ${chosen.size} member${chosen.size === 1 ? "" : "s"}.` : "Badge taken back.");
        load();
      } }],
    });
  }

  function newBadge() {
    const name = h("input", { class: "input", id: "bd-name", maxlength: 40, placeholder: "e.g. GalaxySMP 25th Anniversary" });
    const desc = h("input", { class: "input", id: "bd-desc", maxlength: 120, placeholder: "e.g. Played during the 25th anniversary event" });
    let style = "gold", icon = "star";
    const preview = h("div", { class: "bd-hero" });
    const drawPreview = () => preview.replaceChildren(hexBadge({ style, icon }, 96), h("b", { text: name.value.trim() || "Badge name" }));
    const styles = h("div", { class: "bd-styles" });
    const drawStyles = () => styles.replaceChildren(...BADGE_THEMES.map((s) => {
      const b = h("button", { class: "bd-pick", type: "button", "aria-pressed": String(style === s), title: STYLE_NAMES[s] || s }, hexBadge({ style: s, icon }, 38));
      b.addEventListener("click", () => { style = s; drawStyles(); drawPreview(); });
      return b;
    }));
    const icons = h("div", { class: "pr-icons" });
    const drawIcons = () => icons.replaceChildren(...data.icons.map((n) => {
      const b = h("button", { class: "pr-icon", type: "button", role: "radio", "aria-checked": String(icon === n), "aria-label": n }, iconEl(n));
      b.addEventListener("click", () => { icon = n; drawIcons(); drawStyles(); drawPreview(); });
      return b;
    }));
    name.addEventListener("input", drawPreview);
    drawStyles(); drawIcons(); drawPreview();
    openDialog({
      title: "New badge",
      body: h("div", {}, preview, field("Name", name), field("What it's for (optional)", desc),
        h("div", { class: "field" }, h("span", { class: "field-label", text: "Style" }), styles),
        h("div", { class: "field" }, h("span", { class: "field-label", text: "Icon" }), icons)),
      actions: [{ label: "Cancel" }, { label: "Create badge", kind: "primary", onClick: async () => {
        await postJson("/api/panel/badges", { name: name.value, description: desc.value, style, icon });
        toast("Badge created. Tap Give to hand it out.");
        load();
      } }],
    });
  }

  document.getElementById("badge-new")?.addEventListener("click", async () => { if (!data) await load(); if (data) newBadge(); });
  loaders.badges = load;
}
