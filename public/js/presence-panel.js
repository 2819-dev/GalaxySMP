// Control Panel > Overview (owner): your own custom status, shown on your profile card like Discord's rich presence.
import { h, getJson, postJson, field, select } from "/js/dialog.js";
import { iconEl } from "/js/site.js";
import { activityBlock } from "/js/activity.js";

export async function setupMyPresence({ toast }) {
  const box = document.getElementById("my-presence");
  if (!box) return;
  let d;
  try { d = await getJson("/api/panel/presence"); } catch { return; }
  const cur = d.presence || {};
  const label = select("pr-label", [["Status", "Status"], ["Playing", "Playing"], ["Building", "Building"], ["Working on", "Working on"], ["Watching", "Watching"], ["Listening to", "Listening to"]], cur.label || "Status");
  const title = h("input", { class: "input", id: "pr-title", maxlength: 40, placeholder: "e.g. Building the new spawn", value: cur.title || "" });
  const details = h("input", { class: "input", id: "pr-details", maxlength: 60, placeholder: "e.g. Come say hi at /spawn", value: cur.details || "" });
  const state = h("input", { class: "input", id: "pr-state", maxlength: 60, placeholder: "e.g. Opening on Saturday!", value: cur.state || "" });
  const hours = select("pr-hours", [["0", "Until I clear it"], ["1", "1 hour"], ["4", "4 hours"], ["12", "12 hours"], ["24", "1 day"], ["168", "1 week"]], "0");
  const timer = h("input", { type: "checkbox", id: "pr-timer" });
  timer.checked = cur.timer !== false;
  let icon = cur.icon || "star";
  const icons = h("div", { class: "pr-icons", role: "radiogroup", "aria-label": "Icon" });
  const preview = h("div", { class: "pr-preview" });
  const drawIcons = () => icons.replaceChildren(...d.icons.map((name) => {
    const b = h("button", { class: "pr-icon", type: "button", role: "radio", "aria-checked": String(icon === name), "aria-label": name }, iconEl(name));
    b.addEventListener("click", () => { icon = name; drawIcons(); drawPreview(); });
    return b;
  }));
  const drawPreview = () => {
    const a = { kind: "custom", label: label.value, title: title.value.trim() || "Your status", details: details.value.trim() || null, state: state.value.trim() || null, icon, since: timer.checked ? new Date().toISOString() : null };
    preview.replaceChildren(h("span", { class: "text-3 small", text: "Preview" }), activityBlock(a).node);
  };
  [label, title, details, state, timer].forEach((x) => x.addEventListener("input", drawPreview));
  timer.addEventListener("change", drawPreview);
  drawIcons();
  drawPreview();
  const save = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Save status" });
  const clear = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Clear", hidden: !d.live });
  const live = h("span", { class: `promo-status ${d.live ? "on" : "off"}`, text: d.live ? "Showing on your profile" : "Not set" });
  save.addEventListener("click", async () => {
    try {
      await postJson("/api/panel/presence", { label: label.value, title: title.value, details: details.value, state: state.value, icon, timer: timer.checked, hours: Number(hours.value) });
      toast("Your status is on your profile.");
      live.className = "promo-status on"; live.textContent = "Showing on your profile"; clear.hidden = false;
    } catch (e) { toast(e.message); }
  });
  clear.addEventListener("click", async () => {
    await postJson("/api/panel/presence", { clear: true }).catch(() => {});
    toast("Status cleared. Your profile shows your game or Xbox activity again.");
    live.className = "promo-status off"; live.textContent = "Not set"; clear.hidden = true;
  });
  box.replaceChildren(
    h("div", { class: "voice-head" }, h("h2", { text: "Your status" }), live),
    h("p", { class: "text-3 small", style: "margin:0 0 12px", text: "Like Discord's rich presence: it shows on your profile card instead of your game or Xbox activity." }),
    h("div", { class: "pr-grid" },
      h("div", {},
        h("div", { class: "promo-two" }, field("Type", label), field("Shows for", hours)),
        field("What you're doing", title), field("Line 2 (optional)", details), field("Line 3 (optional)", state),
        h("div", { class: "field" }, h("span", { class: "field-label", text: "Icon" }), icons),
        h("label", { class: "acc-rn-switch", for: "pr-timer", style: "margin-top:6px" }, timer, h("span", { text: "Show a timer (how long since you set it)" }))),
      preview),
    h("div", { class: "acc-card-foot", style: "margin-top:12px" }, save, clear));
  box.hidden = false;
}
