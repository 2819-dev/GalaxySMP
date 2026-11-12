// The "+" button next to the message box: a small pop-up with Poll, Emojis and Gift, and
// "Choose a photo" at the bottom. Used by the chat channels and DMs.
import { h, getJson, postJson, openDialog, field } from "/js/dialog.js";
import { iconEl, toast } from "/js/site.js";
import { faceSvg } from "/js/face.js";

let open = null;
function close() { open?.remove(); open = null; document.removeEventListener("click", outside, true); }
function outside(e) { if (open && !open.contains(e.target)) close(); }

// items: [{ icon, label, onClick }]; photo: function or null
export function openPlusMenu(anchor, { items, photo }) {
  if (open) { close(); return; }
  const menu = h("div", { class: "plus-menu", role: "menu" },
    h("div", { class: "plus-row" }, ...items.map((it) => h("button", { class: "plus-item", type: "button", role: "menuitem", onclick: () => { close(); it.onClick(); } },
      h("span", { class: "plus-ic" }, iconEl(it.icon)), h("span", { text: it.label })))),
    photo ? h("button", { class: "plus-photo", type: "button", role: "menuitem", onclick: () => { close(); photo(); } },
      iconEl("image"), h("span", {}, h("b", { text: "Choose a photo" }), h("span", { text: "From your phone or computer" }))) : null);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, r.top - menu.offsetHeight - 8)}px`;
  open = menu;
  setTimeout(() => document.addEventListener("click", outside, true), 0);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

// Gift to someone: credits (sent now) or a Store item (opens the Store with them picked).
// to: { id, username } to skip picking (in a DM).
export function giftDialog(to = null) {
  let chosen = to;
  const search = h("input", { class: "input", id: "pg-to", placeholder: "Type the first letters of their name", autocomplete: "off", maxlength: 32, autocapitalize: "off", spellcheck: "false" });
  const list = h("div", { class: "gift-list", role: "listbox", "aria-label": "Members" });
  const picked = h("div", { class: "gift-picked" });
  const amount = h("input", { class: "input", id: "pg-amount", type: "number", min: 1, step: "0.01", value: "1.00", inputmode: "decimal" });
  const face = (m) => { const img = h("img", { class: "gift-face", alt: "", width: 28, height: 28, src: m.head || faceSvg(m.username) }); img.addEventListener("error", () => { img.src = faceSvg(m.username); }, { once: true }); return img; };
  const showPicked = () => {
    search.hidden = Boolean(chosen); picked.hidden = !chosen; list.replaceChildren();
    if (chosen) picked.replaceChildren(...[face(chosen), h("span", {}, "To ", h("b", { text: chosen.username })),
      to ? null : h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Change", onclick: () => { chosen = null; showPicked(); search.value = ""; search.focus(); } })].filter(Boolean));
  };
  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (q.length < 2) { list.replaceChildren(); return; }
    timer = setTimeout(async () => {
      let d;
      try { d = await getJson(`/api/store/members?q=${encodeURIComponent(q)}`); } catch { return; }
      if (chosen) return;
      list.replaceChildren(...(d.members?.length ? d.members.map((m) => h("button", { class: "gift-option", type: "button", role: "option", onclick: () => { chosen = m; showPicked(); } }, face(m), h("span", { text: m.username })))
        : [h("p", { class: "text-3 small gift-hint", text: "No members start with that." })]));
    }, 200);
  });
  showPicked();
  const need = () => { if (!chosen) throw new Error("Pick who the gift is for."); };
  openDialog({
    title: "Send a gift",
    body: h("div", { class: "form" },
      h("div", { class: "field" }, h("label", { class: "field-label", for: "pg-to", text: "Who is it for?" }), search, picked, list),
      field("Credits ($)", amount, "Credits are spent in the Store. Gifts can't be undone."),
      h("p", { class: "text-3 small", style: "margin:0", text: "Want to gift a Store item or Galaxy+ instead? Choose \"Pick a Store item\"." })),
    actions: [
      { label: "Pick a Store item", onClick: () => { need(); location.href = `/store?gift=${chosen.id}&giftName=${encodeURIComponent(chosen.username)}#shop`; } },
      { label: "Send credits", kind: "primary", onClick: async () => { need(); const r = await postJson("/api/store/gift", { toId: chosen.id, amount: amount.value }); toast(r.message); } },
    ],
  });
  if (!to) setTimeout(() => search.focus(), 50);
}
