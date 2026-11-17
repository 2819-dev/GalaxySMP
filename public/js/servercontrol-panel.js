// Control Panel > Server > Server control (owner only): maintenance mode, a one-time scheduled restart,
// and the welcome kit for brand-new players.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { iconEl } from "/js/site.js";

const pad = (n) => String(n).padStart(2, "0");
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor"/></svg>';
const nice = (iso) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function setupServerControl({ loaders, toast }) {
  const box = document.getElementById("serverctl-box");
  const save = async (body) => { const r = await postJson("/api/panel/server-control", body); toast(r.message); loaders.serverctl(); };

  loaders.serverctl = async () => {
    let d;
    try { d = await getJson("/api/panel/server-control"); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    box.replaceChildren(lockdownPanel(d), h("div", { class: "sc-potm-slot" }), friendBotPanel(d), allowlistPanel(), goalPanel(), botPanel(), qotdPanel(), maintenancePanel(d), restartPanel(d), kitPanel(d), holidayPanel(d));
    box.querySelector(".sc-potm-slot")?.replaceWith(potmPanel());
  };

  // ---------- Player of the Month (Voting Computers in game) ----------
  function potmPanel() {
    const wrap = h("section", { class: "panel sc-card" }, h("div", { class: "sc-head" }, h("h2", { text: "Player of the Month" })), h("p", { class: "text-3", text: "Loading…" }));
    const send = async (body) => { try { const r = await postJson("/api/panel/potm", body); toast(r.message); draw(); } catch (e) { toast(e.message); } };
    async function draw(round) {
      let d;
      try { d = await getJson(`/api/panel/potm${round ? `?round=${round}` : ""}`); } catch (e) { wrap.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
      const total = d.totals.reduce((n, t) => n + t.votes, 0);
      const top = d.totals[0]?.votes || 0;
      const current = d.viewing === d.round;
      const rounds = h("select", { class: "input", style: "width:auto", "aria-label": "Round" },
        ...Array.from({ length: d.round }, (_, i) => d.round - i).map((r) => h("option", { value: r, text: r === d.round ? `Round ${r} (current)` : `Round ${r}`, selected: r === d.viewing })));
      rounds.addEventListener("change", () => draw(Number(rounds.value)));
      const votes = h("details", { class: "potm-votes" }, h("summary", { text: `Who voted for who (${d.votes.length})` }),
        d.votes.length ? h("ul", { class: "potm-list" }, ...d.votes.map((v) => h("li", {}, h("b", { text: v.voter }), h("span", { class: "text-3", text: " voted for " }), h("b", { text: v.target }),
          h("span", { class: "text-3 small", text: ` · ${new Date(v.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` }))))
          : h("p", { class: "text-3 small", text: "No votes yet." }));
      wrap.replaceChildren(
        h("div", { class: "sc-head" }, h("h2", { text: "Player of the Month" }),
          h("span", { class: `sg-status ${d.open ? "done" : "declined"}`, text: d.open ? "Voting open" : "Voting closed" })),
        h("p", { class: "text-2", text: "Players vote at the Voting Computers in game. Staff make a computer with /votecomputer, and can open or close voting from any computer or here. Votes are secret: only you see this list. Badges are given by hand." }),
        h("div", { class: "cx-row", style: "flex-wrap:wrap;align-items:center" },
          h("button", { class: `btn ${d.open ? "btn-secondary" : "btn-primary"}`, type: "button", text: d.open ? "Close voting" : "Open voting", onclick: () => send({ action: d.open ? "close" : "open" }) }),
          h("button", { class: "btn btn-ghost", type: "button", text: "Start a new round", onclick: () => openDialog({
            title: "Start a new round?", body: h("p", { class: "text-2", style: "margin:0", text: `Round ${d.round} is kept, and the count starts again from zero for next month. Voting will be closed until you open it.` }),
            actions: [{ label: "Cancel" }, { label: "New round", kind: "primary", onClick: () => send({ action: "new-round" }) }] }) }),
          d.round > 1 ? rounds : null),
        h("h3", { class: "potm-h", text: `${current ? "This round" : `Round ${d.viewing}`}: ${total} vote${total === 1 ? "" : "s"}` }),
        d.totals.length ? h("ol", { class: "potm-totals" }, ...d.totals.map((t) => h("li", { class: t.votes === top ? "lead" : "" },
          h("span", { class: "potm-name", text: t.name }),
          h("span", { class: "potm-bar" }, h("i", { style: `width:${Math.round((t.votes / top) * 100)}%` })),
          h("b", { text: String(t.votes) }))))
          : h("p", { class: "text-3", text: "No votes yet." }),
        votes);
    }
    draw();
    return wrap;
  }

  // ---------- Post as GalaxySMP ----------
  function botPanel() {
    const sel = h("select", { class: "input", "aria-label": "Channel" }, h("option", { value: "", text: "Loading channels…" }));
    const text = h("textarea", { class: "input", rows: 3, maxlength: 2000, placeholder: "Write a message. **bold** and links work.", "aria-label": "Message" });
    const send = h("button", { class: "btn btn-primary", type: "button", text: "Post as GalaxySMP" });
    getJson("/api/panel/bot-post").then((d) => {
      sel.replaceChildren(...d.channels.map((c) => h("option", { value: c.id, text: `#${c.name}`, selected: c.name === "Chat" })));
    }).catch((e) => toast(e.message));
    send.addEventListener("click", async () => {
      send.disabled = true;
      try { const r = await postJson("/api/panel/bot-post", { channelId: Number(sel.value), text: text.value }); toast(r.message); text.value = ""; } catch (e) { toast(e.message); }
      send.disabled = false;
    });
    return h("section", { class: "panel sc-card" },
      h("div", { class: "sc-head" }, h("h2", { text: "Post as GalaxySMP" })),
      h("p", { class: "text-2", text: "GalaxySMP is the server's own member account (with the BOT tag). It posts the Question of the Day, welcomes and level-ups by itself. You can also post as it here; nobody can sign in to it." }),
      h("label", { class: "field" }, h("span", { text: "Channel" }), sel), text,
      h("div", { class: "cx-row" }, send,
        h("button", { class: "btn btn-secondary", type: "button", text: "Use the site as GalaxySMP", onclick: async () => {
          try { await postJson("/api/mod/use-galaxysmp", {}); location.href = "/community"; } catch (e) { toast(e.message); }
        } })));
  }

  // ---------- Question of the Day ----------
  function qotdPanel() {
    const list = h("div", { class: "qotd-list" }, h("p", { class: "text-3", text: "Loading…" }));
    const input = h("input", { class: "input", maxlength: 200, placeholder: "e.g. What's your favorite biome to build in?", "aria-label": "New question" });
    const add = h("button", { class: "btn btn-primary", type: "button", text: "Add" });
    async function draw() {
      let d;
      try { d = await getJson("/api/panel/qotd"); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
      const next = d.questions.filter((q) => !q.usedAt);
      list.replaceChildren(
        h("p", { class: "text-3 small", style: "margin:0", text: `${d.questions.length} questions · ${next.length} not asked yet. When every question has been asked, they start again from the oldest.` }),
        ...d.questions.slice(0, 60).map((q) => h("div", { class: "qotd-row" },
          h("span", { text: q.text }),
          h("span", { class: "text-3 small", text: q.usedAt ? `asked ${new Date(q.usedAt).toLocaleDateString()}` : "not asked yet" }),
          h("button", { class: "icon-btn", type: "button", "aria-label": "Delete question", title: "Delete", onclick: async () => {
            try { await postJson("/api/panel/qotd", { action: "delete", id: q.id }); draw(); } catch (e) { toast(e.message); }
          } }, iconEl("trash")))));
    }
    add.addEventListener("click", async () => {
      add.disabled = true;
      try { const r = await postJson("/api/panel/qotd", { action: "add", text: input.value }); toast(r.message); input.value = ""; draw(); } catch (e) { toast(e.message); }
      add.disabled = false;
    });
    draw();
    return h("section", { class: "panel sc-card" },
      h("div", { class: "sc-head" }, h("h2", { text: "Question of the Day" })),
      h("p", { class: "text-2", text: "Every morning at 6:30 (New York time), @GalaxySMP asks one of these in #Chat, and players answer in a thread. Your own questions are asked first." }),
      h("div", { class: "cx-row" }, input, add),
      h("details", { class: "qotd-all" }, h("summary", { text: "All questions" }), list));
  }

  // ---------- Jewish holiday decorations ----------
  function holidayPanel(d) {
    const on = d.holidays?.on !== false;
    const preview = (id, night) => window.open(`/?holiday=${id}${night ? `&night=${night}` : ""}`, "_blank", "noopener");
    const list = [["rosh", "Rosh Hashanah"], ["sukkot", "Sukkot"], ["chanukah", "Chanukah", 5], ["tubishvat", "Tu BiShvat"], ["purim", "Purim"], ["pesach", "Pesach"], ["lagbaomer", "Lag BaOmer"], ["shavuot", "Shavuot"]];
    return h("section", { class: "panel sc-card" },
      h("div", { class: "sc-head" }, h("h2", { text: "Holiday decorations" }), h("span", { class: `sg-status ${on ? "done" : "declined"}`, text: on ? "On" : "Off" })),
      h("p", { class: "text-2", text: "On Jewish holidays, a small gold emblem appears next to the logo on every page and a greeting shows on the home page. On Chanukah the menorah lights one more candle each night. The dates follow the Hebrew calendar by themselves." }),
      h("div", { class: "cx-row", style: "flex-wrap:wrap" }, h("span", { class: "text-3 small", text: "Preview:" }),
        ...list.map(([id, name, night]) => h("button", { class: "btn btn-ghost btn-sm", type: "button", text: name, onclick: () => preview(id, night) }))),
      h("div", { class: "cx-row" }, h("button", { class: `btn ${on ? "btn-secondary" : "btn-primary"}`, type: "button", text: on ? "Turn off" : "Turn on",
        onclick: () => save({ action: "holidays", on: !on }).catch((e) => toast(e.message)) })));
  }

  // ---------- friend bot (GalaxySMP under Play > Friends) ----------
  let fbTimer = null;
  function friendBotPanel(d) {
    const fb = d.friendbot;
    // while the bot isn't online (starting, waiting for sign-in...), the card and its log refresh by themselves
    clearTimeout(fbTimer);
    const refresh = () => {
      fbTimer = setTimeout(async () => {
        const card = box.querySelector(".fb-card");
        if (!card || !document.body.contains(card)) return;
        if (document.visibilityState !== "visible") { refresh(); return; }
        try {
          const nd = await getJson("/api/panel/server-control");
          const open = card.querySelector("details.fb-logbox")?.open;
          const fresh = friendBotPanel(nd);
          if (open != null) { const dd = fresh.querySelector("details.fb-logbox"); if (dd) dd.open = open; }
          card.replaceWith(fresh);
        } catch { refresh(); }
      }, fb?.state === "online" ? 30_000 : 4000);
    };
    refresh();
    // the sign-in code, even if the plugin didn't pick it out of the log itself
    if (fb && !fb.signin && fb.state !== "online") {
      const line = [...(fb.lines || [])].reverse().find((l) => /enter the code:?\s+[A-Z0-9-]{6,12}/i.test(l));
      if (line) {
        const code = line.match(/enter the code:?\s+([A-Z0-9-]{6,12})/i)[1].toUpperCase();
        fb.signin = { code, url: "https://www.microsoft.com/link" };
        fb.state = "signin";
        fb.detail = "Sign in with the bot's Xbox account to finish.";
      }
    }
    const STATES = { online: ["done", "Online"], signin: ["pending", "Needs sign-in"], starting: ["pending", "Starting"], installing: ["pending", "Installing"],
      restarting: ["pending", "Restarting"], waiting: ["pending", "Waiting for memory"], error: ["declined", "Problem"], off: ["declined", "Off"] };
    const fresh = fb && Date.now() - new Date(fb.at).getTime() < 15 * 60e3;
    const [cls, label] = !fb ? ["declined", "Not set up yet"] : STATES[fb.state] || ["pending", fb.state];
    const send = (body) => save({ action: "friendbot", ...body }).catch((e) => toast(e.message));
    const parts = [
      h("div", { class: "sc-head" }, h("h2", { text: "Friend bot" }), h("span", { class: `sg-status ${cls}`, text: label })),
      h("p", { class: "text-2", text: "Shows GalaxySMP under Play > Friends > Joinable Friends for everyone who is friends with the bot's Xbox account. It runs on the Minecraft server itself, so it's online whenever the server is, and restarts by itself if it stops." }),
    ];
    if (!fb) parts.push(h("p", { class: "note small", text: "Install GalaxyLink 2.46 or newer and restart the server. The bot sets itself up (it downloads what it needs the first time)." }));
    else {
      if (fb.detail) parts.push(h("p", { class: "text-3 small", style: "margin:0", text: fb.detail + (fresh ? "" : " (last update from the server was a while ago)") }));
      if (fb.state === "signin" && fb.signin) {
        parts.push(h("div", { class: "fb-signin" },
          h("b", { text: "Sign in once with the bot's Xbox account (not your own)" }),
          h("span", { class: "text-2 small", text: "1. Open the link. 2. Type this code. 3. Sign in as the bot account." }),
          h("code", { class: "fb-code", text: fb.signin.code }),
          h("div", { class: "cx-row", style: "flex-wrap:wrap;gap:8px" },
            h("a", { class: "btn btn-primary btn-sm", href: fb.signin.url, target: "_blank", rel: "noopener noreferrer", text: "Open Microsoft sign-in" }),
            h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Copy code", onclick: () => navigator.clipboard?.writeText(fb.signin.code).then(() => toast("Code copied.")).catch(() => {}) })),
          h("span", { class: "text-3 small", text: "The code works for about 15 minutes. When you've signed in, this card turns Online by itself. If the code expired, press Restart bot for a new one." })));
      }
      const auto = h("input", { type: "checkbox", id: "fb-auto" });
      auto.checked = Boolean(fb.autoFriend);
      auto.addEventListener("change", () => send({ autoFriend: auto.checked }));
      parts.push(h("label", { class: "fb-toggle" }, auto, h("span", {}, h("b", { text: "Accept friend requests by themselves" }),
        h("span", { class: "text-3 small", text: "Off: accept them yourself on xbox.com while signed in as the bot (safer for the bot's account)." }))));
      parts.push(h("div", { class: "cx-row" },
        h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Restart bot", onclick: () => send({ restart: true }) }),
        h("button", { class: `btn btn-sm ${fb.enabled ? "btn-ghost" : "btn-primary"}`, type: "button", text: fb.enabled ? "Turn off" : "Turn on", onclick: () => send({ enabled: !fb.enabled }) }),
        fb.lines?.length ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Copy log", onclick: () => navigator.clipboard?.writeText(fb.lines.join("\n")).then(() => toast("Log copied.")).catch(() => {}) }) : null));
      // the bot's own log, live (open while it isn't online, so you can see what it's doing)
      if (fb.lines?.length) {
        const pre = h("pre", { class: "fb-log", text: fb.lines.join("\n") });
        const det = h("details", { class: "fb-logbox", open: fb.state !== "online" },
          h("summary", { text: `Bot log (${fresh ? "live" : "last seen " + new Date(fb.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})` }), pre);
        parts.push(det);
        requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
      }
    }
    return h("section", { class: "panel sc-card fb-card" }, ...parts);
  }

  // ---------- lock the whole website ----------
  function lockdownPanel(d) {
    const l = d.lockdown || {};
    const title = h("input", { class: "input", id: "sc-lock-title", maxlength: 80, placeholder: "e.g. We're upgrading GalaxySMP" });
    title.value = l.title || "";
    const msg = h("textarea", { class: "input", id: "sc-lock-msg", rows: 4, maxlength: 600, placeholder: "e.g. The website and server are closed while we install a big update. We'll be back on Sunday!" });
    msg.value = l.message || "";
    const preview = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Preview", onclick: () => openDialog({
      title: "Preview",
      body: h("div", { class: "lock-preview" },
        Object.assign(h("div", { class: "lock-preview-icon", "aria-hidden": "true" }), { innerHTML: LOCK_SVG }),
        h("h3", { text: title.value.trim() || "GalaxySMP is closed right now" }),
        h("p", { text: msg.value.trim() || "We'll be back soon." })),
      actions: [{ label: "Close" }],
    }) });
    const btn = h("button", { class: `btn ${l.on ? "btn-primary" : "btn-danger"}`, type: "button", text: l.on ? "Unlock the website" : "Lock the website" });
    btn.addEventListener("click", () => {
      if (l.on) return save({ action: "lockdown", on: false }).catch((e) => toast(e.message));
      if (!title.value.trim()) { toast("Add a title first."); title.focus(); return; }
      openDialog({
        title: "Lock the whole website?",
        body: h("div", { class: "text-2" },
          h("p", { style: "margin:0 0 8px", text: "Everyone except you will only see the lock screen with your title and message. The Minecraft server closes to players too: everyone is moved out with your message and nobody can join." }),
          h("p", { style: "margin:0", text: "Unlock it here any time. If you get signed out, use \"Owner sign-in\" at the bottom of the lock screen." })),
        actions: [{ label: "Cancel" }, { label: "Lock the website", kind: "danger", onClick: () => save({ action: "lockdown", on: true, title: title.value, message: msg.value }) }],
      });
    });
    const update = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Save changes", hidden: !l.on,
      onclick: () => save({ action: "lockdown", on: true, title: title.value, message: msg.value }).catch((e) => toast(e.message)) });
    return h("section", { class: `panel sc-card${l.on ? " sc-locked" : ""}` },
      h("div", { class: "sc-head" }, h("h2", { text: "Lock the website" }),
        h("span", { class: `sg-status ${l.on ? "declined" : "done"}`, text: l.on ? `Locked since ${nice(l.since || Date.now())}` : "Open" })),
      h("p", { class: "text-2", text: "Closes the whole website and the Minecraft server. Visitors see a lock icon with your title and message; only you can still use the site." }),
      field("Title", title), field("Message", msg),
      h("div", { class: "cx-row" }, btn, update, preview));
  }

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
