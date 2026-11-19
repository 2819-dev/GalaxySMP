// Chat commands and giveaways.
//   - "+" › Commands: pick a command and fill in a small form (no typing needed).
//   - Typing "/" in the message box: a list of commands; "/roll 20" + Enter runs it.
//   - Answers only you should see (your balance, staff confirmations) appear in a small "Only you can see this"
//     card above the message box; answers for everyone are posted by GalaxySMP ("Bob used /coinflip").
//   - Giveaway cards in #Giveaways: prize, time left, Enter button, winners, and staff controls.
import { toast, iconEl } from "/js/site.js";
import { h, getJson, postJson, openDialog, field } from "/js/dialog.js";
import { renderMarkdown } from "/js/markdown.js";
import { chatState as state, currentChannel, messageBodyHooks, submitHooks, eventHooks, composerHooks } from "/js/chat.js";

let commands = null;   // the commands this member can use
async function loadCommands() {
  if (commands) return commands;
  try { commands = (await getJson("/api/chat/commands")).commands || []; } catch { commands = []; }
  return commands;
}
composerHooks.push(() => { loadCommands(); });

// ---------- answers only you can see ----------
function tray() {
  let t = document.getElementById("cmd-private");
  if (!t) {
    t = h("div", { id: "cmd-private", class: "cmd-private", "aria-live": "polite" });
    const form = document.getElementById("composer") || document.getElementById("composer-input")?.closest("form");
    form?.parentNode?.insertBefore(t, form);
  }
  return t;
}
function showPrivate(text, title = "") {
  const card = h("div", { class: "cmd-card" },
    h("div", { class: "cmd-card-head" }, h("span", { class: "cmd-only", text: "Only you can see this" }),
      title ? h("code", { text: title }) : null,
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Dismiss", onclick: () => card.remove() })),
    h("div", { class: "cmd-card-body md" }, renderMarkdown(text)));
  const t = tray();
  t.append(card);
  while (t.children.length > 3) t.firstChild.remove();
}

async function runCommand(payload, label) {
  const ch = currentChannel();
  if (!ch) throw new Error("Open a chat first.");
  const r = await postJson("/api/chat/command", { channelId: ch.id, ...payload });
  if (r.show === "private" && r.text) showPrivate(r.text, label);
}

// ---------- typing "/" ----------
submitHooks.push((text) => {
  const name = text.slice(1).split(/\s+/)[0].toLowerCase();
  const c = (commands || []).find((x) => x.name === name);
  if (c?.form === "giveaway") { giveawayForm(); return true; }
  // a known command, or anything else starting with "/" (the server answers "there's no /xyz command")
  runCommand({ line: text }, `/${name}`).catch((e) => showPrivate(e.message || "That didn't work.", `/${name}`));
  hideSuggest();
  return true;
});

let suggest = null;
function hideSuggest() { suggest?.remove(); suggest = null; }
function showSuggest(input) {
  const v = input.value;
  if (!v.startsWith("/") || /\s/.test(v)) return hideSuggest();
  const q = v.slice(1).toLowerCase();
  const list = (commands || []).filter((c) => c.name.startsWith(q)).slice(0, 8);
  if (!list.length) return hideSuggest();
  if (!suggest) {
    suggest = h("div", { class: "cmd-suggest", role: "listbox" });
    tray().after(suggest);
  }
  suggest.replaceChildren(...list.map((c) => h("button", { class: "cmd-suggest-item", type: "button", role: "option",
    onclick: () => {
      hideSuggest();
      if (c.form || c.options.some((o) => o.type === "choice" || o.type === "member")) { input.value = ""; openCommand(c); return; }
      input.value = `/${c.name}${c.options.length ? " " : ""}`;
      input.focus();
    } }, h("b", { text: `/${c.name}` }), c.options.map((o) => h("span", { class: "text-3", text: o.required ? ` <${o.name}>` : ` [${o.name}]` })),
    h("span", { class: "cmd-desc text-2", text: c.description }))));
}
function hookInput() {
  const input = document.getElementById("composer-input");
  if (!input || input.dataset.cmd) return;
  input.dataset.cmd = "1";
  input.addEventListener("input", async () => { if (input.value.startsWith("/")) { await loadCommands(); showSuggest(input); } else hideSuggest(); });
  input.addEventListener("blur", () => setTimeout(hideSuggest, 200));
}
hookInput();
composerHooks.push(hookInput);

// ---------- the Commands window ----------
export async function openCommands() {
  const list = await loadCommands();
  const groups = [...new Set(list.map((c) => c.group))];
  const dlg = openDialog({
    title: "Commands",
    body: h("div", { class: "cmd-list" },
      h("p", { class: "text-3 small", style: "margin:0 0 6px", text: "Pick a command. You can also type them in the message box, like /level." }),
      ...groups.map((g) => h("div", { class: "cmd-group" }, h("h3", { class: "cmd-group-title", text: g === "Staff" ? "Staff" : g }),
        ...list.filter((c) => c.group === g).map((c) => h("button", { class: "cmd-item", type: "button",
          onclick: () => { dlg.close(); openCommand(c); } },
          h("b", { text: `/${c.name}` }), h("span", { class: "text-2", text: c.description }),
          h("span", { class: "cmd-who text-3 small", text: c.show === "public" ? "Everyone sees the answer" : "Only you see the answer" })))))),
    actions: [{ label: "Close" }],
  });
}

function memberInput(id, label, value = "") {
  const input = h("input", { class: "input", id, autocomplete: "off", maxlength: 32, autocapitalize: "off", spellcheck: "false", placeholder: "Start typing a name", value });
  const box = h("div", { class: "gift-list", role: "listbox" });
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim().replace(/^@/, "");
    if (q.length < 2) { box.replaceChildren(); return; }
    timer = setTimeout(async () => {
      let d;
      try { d = await getJson(`/api/store/members?q=${encodeURIComponent(q)}`); } catch { return; }
      box.replaceChildren(...(d.members || []).slice(0, 6).map((m) => h("button", { class: "gift-option", type: "button", text: m.username,
        onclick: () => { input.value = m.username; box.replaceChildren(); } })));
    }, 200);
  });
  return { input, el: h("div", { class: "field" }, h("label", { class: "field-label", for: id, text: label }), input, box) };
}

function openCommand(c) {
  if (c.form === "giveaway") return giveawayForm();
  if (!c.options.length) {   // nothing to fill in: run it straight away
    runCommand({ name: c.name, args: {} }, `/${c.name}`).catch((e) => toast(e.message));
    return;
  }
  const inputs = {};
  const fields = c.options.map((o) => {
    const id = `cmd-${c.name}-${o.name}`;
    if (o.type === "member") { const m = memberInput(id, o.label + (o.required ? "" : "")); inputs[o.name] = m.input; return m.el; }
    let el;
    if (o.type === "choice") el = h("select", { class: "input", id }, ...o.choices.map(([v, t]) => h("option", { value: v, text: t })));
    else if (o.type === "number") el = h("input", { class: "input", id, type: "number", min: o.min ?? "", max: o.max ?? "", inputmode: "numeric", placeholder: o.hint || "" });
    else el = h(o.max > 200 ? "textarea" : "input", { class: "input", id, maxlength: o.max || 100, rows: o.max > 200 ? 4 : undefined, placeholder: o.hint || "" });
    inputs[o.name] = el;
    return field(o.label, el);
  });
  openDialog({
    title: `/${c.name}`,
    body: h("div", { class: "form" }, h("p", { class: "text-2", style: "margin:0", text: c.description }), ...fields,
      h("p", { class: "text-3 small", style: "margin:0", text: c.show === "public" ? `Everyone in #${currentChannel()?.name || "this chat"} sees the answer.` : "Only you see the answer." })),
    actions: [{ label: "Cancel" }, { label: "Run", kind: "primary", onClick: async () => {
      const args = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]).filter(([, v]) => v !== ""));
      await runCommand({ name: c.name, args }, `/${c.name}`);
    } }],
  });
  setTimeout(() => Object.values(inputs)[0]?.focus(), 50);
}

// ---------- starting a giveaway (staff) ----------
let items = null;
async function giveawayForm() {
  if (!items) { try { items = (await getJson("/api/giveaways/items")).items || []; } catch (e) { toast(e.message); return; } }
  const title = h("input", { class: "input", id: "gw-title", maxlength: 80, placeholder: "e.g. Weekend giveaway" });
  const desc = h("textarea", { class: "input", id: "gw-desc", maxlength: 500, rows: 3, placeholder: "Optional: what it's for, any rules" });
  const kind = h("select", { class: "input", id: "gw-kind" },
    h("option", { value: "money", text: "In-game money" }), h("option", { value: "keys", text: "Crate keys" }),
    h("option", { value: "credits", text: "Galaxy Credits" }), h("option", { value: "item", text: "Store item or Galaxy+ / Pro+" }),
    h("option", { value: "text", text: "Something else (staff give it)" }));
  const amount = h("input", { class: "input", id: "gw-amount", type: "number", min: 1, step: "any", inputmode: "decimal", value: "10000" });
  const keyKind = h("select", { class: "input", id: "gw-key" }, h("option", { value: "common", text: "Common" }), h("option", { value: "rare", text: "Rare" }), h("option", { value: "galaxy", text: "Galaxy" }));
  const item = h("select", { class: "input", id: "gw-item" }, ...items.map((x, i) => h("option", { value: String(i), text: x.name })));
  const text = h("input", { class: "input", id: "gw-text", maxlength: 80, placeholder: "e.g. A custom statue at spawn" });
  const winners = h("input", { class: "input", id: "gw-winners", type: "number", min: 1, max: 20, value: "1", inputmode: "numeric" });
  const length = h("select", { class: "input", id: "gw-len" }, ...[[30, "30 minutes"], [60, "1 hour"], [180, "3 hours"], [720, "12 hours"], [1440, "1 day"], [2880, "2 days"], [4320, "3 days"], [10080, "1 week"]]
    .map(([v, t]) => h("option", { value: String(v), text: t, selected: v === 1440 })));
  const amountField = field("Amount ($ per winner)", amount);
  const keyField = field("Kind of key", keyKind);
  const itemField = field("Store item", item);
  const textField = field("Prize", text);
  const sync = () => {
    const k = kind.value;
    amountField.hidden = !["money", "credits", "keys"].includes(k);
    amountField.querySelector("label").textContent = k === "keys" ? "How many keys (per winner)" : k === "credits" ? "Credits ($ per winner, up to $100)" : "Money ($ per winner)";
    if (k === "keys" && Number(amount.value) > 64) amount.value = "1";
    if (k === "credits" && Number(amount.value) > 100) amount.value = "5";
    if (k === "money" && Number(amount.value) < 100) amount.value = "10000";
    keyField.hidden = k !== "keys"; itemField.hidden = k !== "item"; textField.hidden = k !== "text";
  };
  kind.addEventListener("change", sync);
  sync();
  openDialog({
    title: "Start a giveaway",
    body: h("div", { class: "form" }, field("Title", title), field("Details", desc), field("Prize", kind), amountField, keyField, itemField, textField,
      h("div", { class: "row-2" }, field("Winners", winners), field("Ends in", length)),
      h("p", { class: "text-3 small", style: "margin:0", text: "It's posted in #Giveaways and everyone is notified. Winners are picked at random when it ends, and in-game prizes, credits and Store items are given automatically." })),
    actions: [{ label: "Cancel" }, { label: "Start giveaway", kind: "primary", onClick: async () => {
      const it = items[Number(item.value)] || {};
      const args = { title: title.value, description: desc.value, prizeKind: kind.value, amount: amount.value, keyKind: keyKind.value,
        item: it.id, option: it.option, prizeText: text.value, winners: winners.value, minutes: length.value };
      await runCommand({ name: "giveaway", args }, "/giveaway");
    } }],
  });
  setTimeout(() => title.focus(), 50);
}

// ---------- "Bob used /coinflip" above command answers ----------
messageBodyHooks.push((m, body, text) => {
  if (m.bot && m.meta?.command) {
    body.prepend(h("div", { class: "cmd-used text-3 small" }, iconEl("slash"), h("b", { text: m.meta.by || "Someone" }), " used ", h("code", { text: m.meta.command })));
  }
  if (m.kind === "giveaway" && m.meta?.giveawayId) giveawayCard(m, body, text);
});

// ---------- giveaway cards ----------
const cache = new Map();   // giveaway id -> data
async function refresh(id) {
  try { cache.set(id, (await getJson(`/api/giveaways/${id}`)).giveaway); } catch { cache.set(id, null); }
  for (const slot of document.querySelectorAll(`.gw-slot[data-gw="${id}"]`)) draw(slot, id);
}
function left(ends) {
  const s = Math.max(0, Math.round((new Date(ends) - Date.now()) / 1000));
  if (s < 60) return "less than a minute";
  const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), mi = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${mi}m` : `${mi}m`;
}
function draw(slot, id) {
  const g = cache.get(id);
  if (g === null) { slot.replaceChildren(h("p", { class: "text-3 small", text: "This giveaway isn't available." })); return; }
  if (!g) return;
  const open = g.status === "open" && new Date(g.endsAt) > new Date();
  const act = (action) => async (e) => {
    e.stopPropagation();
    if (action === "cancel" && !confirm("Cancel this giveaway? Nobody wins.")) return;
    try { const r = await postJson(`/api/giveaways/${id}/${action}`, {}); cache.set(id, r.giveaway); draw(slot, id); toast(r.message); } catch (err) { toast(err.message); }
  };
  const status = open ? `Ends in ${left(g.endsAt)}` : g.status === "cancelled" ? "Cancelled" : "Ended";
  slot.replaceChildren(...[
    h("div", { class: "gw-top" }, h("span", { class: "gw-badge", text: "🎁 Giveaway" }), h("span", { class: `gw-status${open ? " live" : ""}`, text: status })),
    h("div", { class: "gw-title", text: g.title }),
    h("div", { class: "gw-prize" }, h("span", { class: "text-3", text: "Prize" }), h("b", { text: g.prize }), g.winners > 1 ? h("span", { class: "text-3", text: ` · ${g.winners} winners` }) : null),
    g.description ? h("div", { class: "gw-desc md" }, renderMarkdown(g.description)) : null,
    !open && g.status === "ended" ? h("div", { class: "gw-winners" }, g.winnerNames.length ? ["🏆 ", h("b", { text: g.winnerNames.join(", ") })] : "Nobody entered.") : null,
    h("div", { class: "gw-foot" },
      open ? h("button", { class: `btn btn-sm ${g.entered ? "btn-secondary" : "btn-primary"}`, type: "button", onclick: act(g.entered ? "leave" : "enter") }, g.entered ? "✓ Entered (tap to leave)" : "🎉 Enter") : null,
      h("span", { class: "text-3 small", text: `${g.entries} ${g.entries === 1 ? "entry" : "entries"}${open && g.needsLink ? " · needs a linked Minecraft account" : ""}` }),
      g.canManage && open ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "End now", onclick: act("end") }) : null,
      g.canManage && open ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Cancel", onclick: act("cancel") }) : null,
      g.canManage && g.status === "ended" && g.entries > g.winnerNames.length ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Pick a new winner", onclick: act("reroll") }) : null)].filter(Boolean));
}
function giveawayCard(m, body, text) {
  const id = Number(m.meta.giveawayId);
  body.classList.add("gw-card");
  if (text) text.hidden = true;
  const slot = h("div", { class: "gw-slot", "data-gw": String(id) });
  body.append(slot);
  if (cache.get(id)) draw(slot, id); else refresh(id);
}
eventHooks.push((data) => {
  if (data.type !== "giveaway") return;
  const id = Number(data.id);
  if (document.querySelector(`.gw-slot[data-gw="${id}"]`)) refresh(id); else cache.delete(id);
});
// the "Ends in" countdowns
setInterval(() => { for (const slot of document.querySelectorAll(".gw-slot")) { const id = Number(slot.dataset.gw); const g = cache.get(id); if (g?.status === "open") { if (new Date(g.endsAt) <= new Date()) refresh(id); else draw(slot, id); } } }, 30_000);
