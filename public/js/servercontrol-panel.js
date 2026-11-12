// Control Panel > Server > Server control (owner only): maintenance mode, a one-time scheduled restart,
// and the welcome kit for brand-new players.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";

const pad = (n) => String(n).padStart(2, "0");
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const nice = (iso) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function setupServerControl({ loaders, toast }) {
  const box = document.getElementById("serverctl-box");
  const save = async (body) => { const r = await postJson("/api/panel/server-control", body); toast(r.message); loaders.serverctl(); };

  loaders.serverctl = async () => {
    let d;
    try { d = await getJson("/api/panel/server-control"); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    box.replaceChildren(allowlistPanel(), goalPanel(), maintenancePanel(d), restartPanel(d), kitPanel(d));
  };

  // ---------- allowlist (who can join the Minecraft server) ----------
  function allowlistPanel() {
    const list = h("div", { class: "al-list" }, h("p", { class: "text-3", text: "Asking the server…" }));
    const name = h("input", { class: "input", id: "al-name", maxlength: 16, placeholder: "Gamertag, e.g. Steve1234" });
    const add = h("button", { class: "btn btn-primary btn-sm", type: "submit", text: "Add" });
    const form = h("form", { class: "al-add" }, name, add);
    const extra = h("div", { class: "cx-row" });
    const call = async (body) => { try { const r = await postJson("/api/panel/allowlist", body); toast(r.message); draw(); } catch (e) { toast(e.message); } };
    form.addEventListener("submit", (e) => { e.preventDefault(); if (name.value.trim()) { call({ action: "add", name: name.value }); name.value = ""; } });
    async function draw() {
      let d;
      try { d = await getJson("/api/panel/allowlist"); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
      if (!d.connected) { list.replaceChildren(h("p", { class: "note warn small", text: `${d.message} The list shows when the server is online.` })); extra.replaceChildren(); return; }
      list.replaceChildren(...(d.names.length ? d.names.map((n) => h("span", { class: "al-chip" }, h("span", { text: n }),
        h("button", { type: "button", "aria-label": `Remove ${n}`, title: `Remove ${n}`, onclick: () => openDialog({
          title: `Remove ${n} from the allowlist?`, body: h("p", { class: "text-2", text: "They won't be able to join until you add them again." }),
          actions: [{ label: "Cancel" }, { label: "Remove", kind: "danger", onClick: () => call({ action: "remove", name: n }) }],
        }) }, "×")))
        : [h("p", { class: "text-3", text: "Nobody is on the allowlist yet." })]));
      extra.replaceChildren(d.missing.length
        ? h("button", { class: "btn btn-secondary btn-sm", type: "button", text: `Add everyone who has played (${d.missing.length})`, onclick: () => call({ action: "add_played" }) })
        : h("span", { class: "text-3 small", text: "Everyone who has played is on the allowlist." }));
    }
    draw();
    return h("section", { class: "panel sc-card" },
      h("div", { class: "sc-head" }, h("h2", { text: "Allowlist" })),
      h("p", { class: "text-2", text: "Who can join the Minecraft server (when allow-list is on in server.properties). Approving a join request adds them here too." }),
      form, list, extra);
  }

  // ---------- maintenance ----------
  function maintenancePanel(d) {
    const m = d.maintenance;
    const msg = h("textarea", { class: "input", id: "sc-maint-msg", rows: 3, maxlength: 300, value: m.message });
    msg.value = m.message;
    const btn = h("button", { class: `btn ${m.on ? "btn-secondary" : "btn-primary"}`, type: "button", text: m.on ? "Turn maintenance off" : "Turn maintenance on" });
    btn.addEventListener("click", () => {
      if (m.on) return save({ action: "maintenance", on: false, message: msg.value }).catch((e) => toast(e.message));
      openDialog({
        title: "Turn on maintenance mode?",
        body: h("p", { class: "text-2", style: "margin:0", text: "Everyone except you is moved out of the server and can't join until you turn it off. The website shows your message at the top of every page." }),
        actions: [{ label: "Cancel" }, { label: "Turn on", kind: "danger", onClick: () => save({ action: "maintenance", on: true, message: msg.value }) }],
      });
    });
    const update = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Save message", hidden: !m.on,
      onclick: () => save({ action: "maintenance", on: true, message: msg.value }).catch((e) => toast(e.message)) });
    return h("section", { class: "panel sc-card" },
      h("div", { class: "sc-head" }, h("h2", { text: "Maintenance mode" }),
        h("span", { class: `sg-status ${m.on ? "declined" : "done"}`, text: m.on ? `On since ${nice(m.since || Date.now())}` : "Off" })),
      h("p", { class: "text-2", text: "Only you can join the Minecraft server while it's on. Everyone else sees your message when they try to join, and the website shows it in a banner on every page." }),
      !d.ownerLinked ? h("p", { class: "note warn small", text: "Link your Minecraft account (Account > Link) before turning this on, so the server knows it's you." }) : null,
      field("Banner message (website and in game)", msg),
      h("div", { class: "cx-row" }, btn, update));
  }

  // ---------- restart ----------
  function restartPanel(d) {
    const soon = new Date(Date.now() + 30 * 60e3);
    soon.setMinutes(Math.ceil(soon.getMinutes() / 5) * 5, 0, 0);
    const at = h("input", { class: "input", type: "datetime-local", id: "sc-restart-at", value: localInput(soon) });
    const reason = h("input", { class: "input", id: "sc-restart-reason", maxlength: 120, placeholder: "Optional, e.g. Installing an update" });
    const body = d.restart
      ? [h("p", { class: "sc-big" }, "Scheduled for ", h("b", { text: nice(d.restart.at) }), d.restart.reason ? ` · ${d.restart.reason}` : ""),
        h("button", { class: "btn btn-secondary", type: "button", text: "Cancel restart", onclick: () => save({ action: "cancel-restart" }).catch((e) => toast(e.message)) })]
      : [h("div", { class: "grid grid-2", style: "gap:12px" }, field("When (your time)", at), field("Reason", reason)),
        h("div", {}, h("button", { class: "btn btn-primary", type: "button", text: "Schedule restart", onclick: () => save({ action: "restart", at: new Date(at.value).toISOString(), reason: reason.value }).catch((e) => toast(e.message)) }))];
    return h("section", { class: "panel sc-card" },
      h("div", { class: "sc-head" }, h("h2", { text: "Scheduled restart" }), d.restart ? h("span", { class: "sg-status planned", text: "Scheduled" }) : null),
      h("p", { class: "text-2", text: "Players get warnings in chat and on screen 10, 5, 2 and 1 minute before, then a 10-second countdown. Then everyone is moved out and the server stops. The website shows a banner during the last 24 hours." }),
      h("p", { class: "note warn small", text: "Your host doesn't start the server again by itself, so start it from your host after it stops." }),
      ...body);
  }

  // ---------- welcome kit ----------
  function kitPanel(d) {
    const kit = d.kit;
    const enabled = h("input", { type: "checkbox", id: "sc-kit-on", checked: kit.enabled });
    const money = h("input", { class: "input", type: "number", id: "sc-kit-money", min: 0, step: 1, value: String((kit.money || 0) / 100) });
    const msg = h("input", { class: "input", id: "sc-kit-msg", maxlength: 200, value: kit.message });
    const rows = h("div", { class: "stack", style: "gap:8px" });
    const addRow = (it = { id: "", count: 1 }) => {
      if (rows.children.length >= 12) return;
      const id = h("input", { class: "input", maxlength: 70, value: it.id.replace(/^minecraft:/, ""), placeholder: "e.g. iron_pickaxe", "aria-label": "Item" });
      const count = h("input", { class: "input sc-count", type: "number", min: 1, max: 640, value: String(it.count), "aria-label": "How many" });
      const del = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove", onclick: () => row.remove() });
      const row = h("div", { class: "sc-item" }, id, count, del);
      rows.append(row);
    };
    (kit.items || []).forEach(addRow);
    return h("section", { class: "panel sc-card" },
      h("div", { class: "sc-head" }, h("h2", { text: "Welcome kit" })),
      h("p", { class: "text-2", text: "Given once, on a player's very first join. Everyone online also sees \"Welcome to GalaxySMP, name!\"." }),
      h("label", { class: "check" }, enabled, "Give new players a welcome kit"),
      h("div", { class: "grid grid-2", style: "gap:12px" }, field("Money ($)", money), field("Message to them", msg)),
      h("div", { class: "field" }, h("span", { class: "field-label", text: "Items (Minecraft item names, up to 12)" }), rows,
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ Add item", onclick: () => addRow() })),
      h("div", {}, h("button", { class: "btn btn-primary", type: "button", text: "Save welcome kit", onclick: () => save({
        action: "kit", enabled: enabled.checked, money: Number(money.value) || 0, message: msg.value,
        items: [...rows.children].map((r) => ({ id: r.children[0].value, count: Number(r.children[1].value) })).filter((x) => x.id.trim()),
      }).catch((e) => toast(e.message)) })));
  }

  // ---------- server-wide goal ----------
  function goalPanel() {
    const wrap = h("section", { class: "panel sc-card" }, h("div", { class: "sc-head" }, h("h2", { text: "Server goal" })), h("p", { class: "text-3", text: "Loading…" }));
    getJson("/api/mod/goals").then((d) => {
      const cur = d.goals.find((g) => !g.closed);
      const parts = [h("div", { class: "sc-head" }, h("h2", { text: "Server goal" }))];
      if (cur) {
        const pct = Math.min(100, Math.floor((cur.progress / cur.target) * 100));
        parts.push(h("p", { class: "text-2" }, h("b", { text: cur.title }), ` · ${cur.progress.toLocaleString()} of ${cur.target.toLocaleString()} ${cur.unit} (${pct}%) · ${cur.endsIn || "ending"} left`),
          h("div", { class: "sh-bar" }, h("span", { style: `width:${pct}%` })),
          cur.top?.length ? h("p", { class: "text-3 small", text: `Top helpers: ${cur.top.map((t) => `${t.name} (${t.value.toLocaleString()})`).join(", ")}` }) : null,
          h("div", {}, h("button", { class: "btn btn-danger btn-sm", type: "button", text: "End this goal now", onclick: () => openDialog({
            title: "End the goal now?", body: h("p", { class: "text-2", text: "It stops without rewards. Players can't finish it any more." }),
            actions: [{ label: "Cancel" }, { label: "End goal", kind: "danger", onClick: async () => { await postJson("/api/mod/goals", { action: "end" }); toast("Goal ended."); loaders.serverctl(); } }],
          }) })));
      } else {
        const title = h("input", { class: "input", id: "goal-title", maxlength: 80, placeholder: "e.g. Mine a million blocks together" });
        const stat = h("select", { class: "input", id: "goal-stat" }, ...d.stats.map((s) => h("option", { value: s.key, text: s.unit[0].toUpperCase() + s.unit.slice(1) })));
        const target = h("input", { class: "input", id: "goal-target", type: "number", min: 1, value: "100000" });
        const days = h("input", { class: "input", id: "goal-days", type: "number", min: 1, max: 60, value: "7" });
        const reward = h("input", { class: "input", id: "goal-reward", type: "number", min: 0, value: "1000" });
        parts.push(h("p", { class: "text-2", text: "Everyone works together on one big number. Players see it on the home page and with /goal; the server hears about it at 25%, 50%, 75% and when it's done. Everyone who helped gets the reward." }),
          field("Title", title),
          h("div", { class: "grid grid-2", style: "gap:12px" }, field("What counts", stat), field("Target", target, "For hours played, the target is in hours.")),
          h("div", { class: "grid grid-2", style: "gap:12px" }, field("Days to do it", days), field("Reward for each helper ($ in game)", reward)),
          h("div", {}, h("button", { class: "btn btn-primary", type: "button", text: "Start goal", onclick: async () => {
            try {
              await postJson("/api/mod/goals", { action: "create", title: title.value, stat: stat.value, target: Number(target.value), days: Number(days.value), rewardDollars: Number(reward.value) || 0 });
              toast("Goal started! The server announced it."); loaders.serverctl();
            } catch (e) { toast(e.message); }
          } })));
      }
      const past = d.goals.filter((g) => g.closed).slice(0, 5);
      if (past.length) parts.push(h("details", {}, h("summary", { class: "text-3 small", text: "Past goals" }),
        ...past.map((g) => h("p", { class: "text-3 small", text: `${g.finished ? "✓" : "✗"} ${g.title}: ${g.progress.toLocaleString()} of ${g.target.toLocaleString()} ${g.unit}` }))));
      wrap.replaceChildren(...parts.filter(Boolean));
    }).catch((e) => wrap.replaceChildren(h("p", { class: "text-3", text: e.message })));
    return wrap;
  }
}
