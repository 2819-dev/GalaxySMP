// Staff panel tabs: Overview (live numbers + quick controls), Tickets (support live chat)
// and Players (one card per player with everything staff need). All text goes in with textContent.
import { faceSvg } from "/js/face.js";
import { moneyDollars } from "/js/money.js";
import { h, openDialog, postJson, getJson, select, field, muteDialog, banDialog, voiceMuteDialog, MUTE_LABELS } from "/js/dialog.js";
import { ticketChat, chip, when, LABELS, PRIORITIES, ticketEvent } from "/js/tickets.js";
import { iconEl } from "/js/site.js";
import { ranksDialog } from "/js/rank-picker.js";

const $ = (id) => document.getElementById(id);
// a button with a line icon in front of its text
const ibtn = (name, label, onclick, cls = "btn btn-secondary") => {
  const b = h("button", { class: cls, type: "button", onclick });
  b.append(iconEl(name), label);
  return b;
};
const money = (n) => (n == null ? "–" : moneyDollars(n));
// 1234 -> "1,234", 1234567 -> "1.2M": keeps the stat tiles from overflowing
const short = (n) => {
  n = Number(n) || 0;
  const a = Math.abs(n);
  const one = (x) => x.toFixed(1).replace(/\.0$/, "");
  if (a >= 999.95e6) return `${one(n / 1e9)}B`;
  if (a >= 999.5e3) return `${one(n / 1e6)}M`;
  if (a >= 1e5) return `${Math.round(n / 1e3)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
};
const fmt = (d) => (d ? new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "–");
const PLAN_NAMES = { plus: "Galaxy+", pro: "Galaxy Pro+" };
const KIND_WORDS = { warn: "Warned", mute: "Muted", unmute: "Unmuted", kick: "Kicked", ban: "Banned", unban: "Unbanned" };
const ACTION_WORDS = {
  "ticket.update": "updated a ticket", "game.announce": "announced in game", "game.givekey": "gave crate keys", "game.op": "made a player operator", "game.deop": "removed an operator", "game.warn": "warned a player",
  "game.mute": "muted a player", "game.unmute": "unmuted a player", "game.kick": "kicked a player", "game.ban": "banned a player", "game.unban": "unbanned a player",
  "rank.assign": "gave a rank", "rank.remove": "removed a rank", "rank.update": "edited a rank", "rank.create": "made a rank", "rank.delete": "deleted a rank",
  "plan.give": "gave a plan", "plan.remove": "removed a plan", "economy.money": "changed money", "economy.shop": "changed shop prices", "promo.create": "made a promo code", "promo.pause": "paused a promo code", "promo.resume": "turned on a promo code", "promo.delete": "deleted a promo code",
  mute: "muted a member", unmute: "unmuted a member", ban: "banned a member", unban: "unbanned a member", role: "changed a role", delete: "deleted a message",
};
const ICONS = {
  ticket: '<path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M13 6v2M13 11v2M13 16v2"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.3 5 2.6 5 5.8"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
};
function svg(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.8");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name]; // fixed strings above, never user text
  return s;
}
function headImg(src, size = 36, name = "") {
  const img = h("img", { class: "pp-head", alt: "", width: size, height: size, loading: "lazy" });
  img.src = src || faceSvg(name || "?");
  img.addEventListener("error", () => { img.src = faceSvg(name || "?"); }, { once: true });
  return img;
}

export function setupPanel({ loaders, power, owner, selectTab, toast, setBadge }) {
  const admin = power >= 100;

  // ---------- Overview ----------
  loaders.overview = async () => {
    const box = $("overview");
    let d;
    try { d = await getJson("/api/mod/overview"); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    const c = d.counts;
    const stat = (icon, label, value, sub, tab, tone) => h(tab ? "button" : "div", {
      class: `ov-stat${tone ? ` ${tone}` : ""}`, type: tab ? "button" : undefined, onclick: tab ? () => selectTab(tab) : undefined,
    }, h("span", { class: "ov-icon" }, svg(icon)), h("span", { class: "ov-num", text: String(value) }), h("span", { class: "ov-label", text: label }), sub ? h("span", { class: "ov-sub", text: sub }) : null);
    const srv = d.server.online
      ? stat("server", "Server online", `${d.server.players ?? 0}${d.server.max ? `/${d.server.max}` : ""}`, "players in game now", null, "good")
      : stat("server", "Server offline", "–", "in-game actions wait until it's back", null, "bad");
    const grid = h("div", { class: "ov-grid" },
      srv,
      stat("ticket", "Open tickets", c.openTickets, c.urgentTickets ? `${c.urgentTickets} high/urgent` : "need a staff reply", "tickets", c.openTickets ? "warn" : ""),
      stat("flag", "Open reports", c.reports, "chat + in game", "reports", c.reports ? "warn" : ""),
      stat("cube", "Players", c.players, `${c.newPlayers} new this week · ${c.activeToday} today`, "players"),
      stat("users", "Website accounts", c.members, `${c.newMembers} new this week`, "players"),
      stat("star", "Paid plans", c.plans, "Galaxy+ and Pro+", admin ? "players" : null),
      stat("shield", "Punishments", c.punishmentsWeek, "in game, last 7 days", "players"));

    // quick controls
    const annText = h("input", { class: "input", id: "ov-ann", maxlength: 200, placeholder: "e.g. Event at spawn in 10 minutes!", autocomplete: "off" });
    const annBtn = h("button", { class: "btn btn-primary", type: "submit", text: "Announce", disabled: !d.server.online });
    const annForm = h("form", { class: "toolbar", style: "margin:0" }, annText, annBtn);
    annForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      annBtn.disabled = true;
      try { await postJson("/api/mod/announce", { text: annText.value }); annText.value = ""; toast("Announced in game (with a chime)."); } catch (err) { toast(err.message); }
      annBtn.disabled = false;
    });
    const quick = h("section", { class: "panel ov-quick" },
      h("h2", { text: "Quick controls" }),
      h("div", { class: "ov-q" }, h("h3", {}, iconEl("megaphone"), "In-game announcement"), h("p", { class: "text-3 small", text: "Shows a box at the top of everyone's screen with a chime." }), annForm),
      h("div", { class: "ov-q-row" },
        ibtn("lifebuoy", "Answer tickets", () => selectTab("tickets")),
        ibtn("search", "Find a player", () => { selectTab("players"); $("pl-search").focus(); }),
        ibtn("filter", "Chat filter", () => selectTab("words")),
        admin ? ibtn("tag", "Ranks", () => selectTab("ranks")) : null,
        admin ? ibtn("coins", "Economy", () => selectTab("economy")) : null));

    const online = h("section", { class: "panel" }, h("h2", { text: `In game now (${d.online.length})` }),
      d.online.length ? h("div", { class: "ov-online" }, d.online.map((p) => h("button", { class: "ov-player", type: "button", onclick: () => openPlayer(p.xuid) }, headImg(p.head, 28, p.name), h("span", { text: p.name }))))
        : h("p", { class: "text-3 small", style: "margin:0", text: d.server.online ? "Nobody is playing right now." : "The server is offline." }));
    const recent = h("section", { class: "panel" }, h("h2", { text: "Recent staff activity" }),
      d.recent.length ? h("div", { class: "ov-recent" }, d.recent.map((r) => h("div", { class: "ov-recent-row" },
        h("b", { text: r.actor }), ` ${ACTION_WORDS[r.action] || r.action.replace(/[._]/g, " ")}`,
        r.details?.player ? h("span", { text: ` · ${r.details.player}` }) : null,
        h("time", { class: "text-3 small", text: when(r.at) })))) : h("p", { class: "text-3 small", text: "Nothing yet." }),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Full audit log", onclick: () => selectTab("audit") }));
    const warn = d.server.online && d.server.outdated
      ? h("div", { class: "panel ov-warn" }, h("b", {}, iconEl("alert"), "The server is running an old GalaxyLink plugin"),
        h("p", { class: "text-2 small", style: "margin:4px 0 0", text: `It's on ${d.server.plugin || "an older version"}, but the website is made for ${d.server.latest}. New features (cosmetics, Night Vision, website moderation, heads...) won't work in game until you install the newest plugin file and restart the server.` }))
      : null;
    const packWarn = d.server.online && d.server.iconsOutdated
      ? h("div", { class: "panel ov-warn" }, h("b", {}, iconEl("alert"), "The GalaxySMP Icons pack is old or missing"),
        h("p", { class: "text-2 small", style: "margin:4px 0 0", text: `The world loads Icons ${d.server.iconsPack}, but ${d.server.latestIcons} is needed. Rank icons, voice icons and the pause-menu logo will look wrong until you upload the newest GalaxySMP_Voice_Icons.mcpack to BDS-Addons and restart.` }))
      : null;
    const conflicts = d.server.online && d.server.iconConflicts?.length
      ? h("div", { class: "panel ov-warn" }, h("b", {}, iconEl("alert"), "Another pack is covering the GalaxySMP icons"),
        h("p", { class: "text-2 small", style: "margin:4px 0 0", text: `${d.server.iconConflicts.join(", ")} uses the same icon slot as GalaxySMP Icons. In the world's resource pack list, put GalaxySMP Icons above it (or remove that pack), then restart.` }))
      : null;
    // Server map: is it receiving anything from the server?
    const m = d.map || {};
    const ago = (t) => { const s = Math.max(0, (Date.now() - new Date(t)) / 1000); return s < 90 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
    const mapSilent = d.server.online && (!m.liveAt || Date.now() - new Date(m.liveAt) > 120_000);
    const mapWarn = m.enabled && d.server.online && (m.error || mapSilent)
      ? h("div", { class: "panel ov-warn" }, h("b", {}, iconEl("alert"), "The server map isn't getting updates"),
        h("p", { class: "text-2 small", style: "margin:4px 0 0", text: m.error
          ? `The server reported: ${m.error}`
          : `The server is online but hasn't sent anything for the map. The map needs GalaxyLink ${d.server.latest} (the server has ${d.server.plugin || "an older version"}). Install the newest plugin file and restart.` }))
      : null;
    const mapToggle = admin ? h("button", { class: "btn btn-secondary btn-sm", type: "button", text: m.enabled ? "Turn the map off" : "Turn the map on",
      onclick: async (e) => {
        e.target.disabled = true;
        try { await postJson("/api/panel/map", { enabled: !m.enabled }); toast(m.enabled ? "The map is off: galaxymc.us/map says Coming soon." : "The map is on: the server starts drawing it."); loaders.overview(); }
        catch (err) { toast(err.message); e.target.disabled = false; }
      } }) : null;
    const mapLine = h("div", { class: "ov-mapline" }, h("p", { class: "text-3 small", style: "margin:0" }, iconEl("map"), " Server map: ",
      m.enabled ? (m.chunks ? `on · ${m.chunks.toLocaleString()} chunks mapped, last drawn ${ago(m.lastChunk)}. ` : "on · nothing mapped yet. ") : "off · galaxymc.us/map shows Coming soon. ",
      m.enabled ? h("a", { href: "/map", text: "Open the map" }) : null), mapToggle);
    box.replaceChildren(...[warn, packWarn, conflicts, mapWarn].filter(Boolean), grid, mapLine, h("div", { class: "ov-cols" }, quick, h("div", { class: "stack", style: "gap:16px" }, online, recent)));
  };

  // ---------- Tickets ----------
  let ticketFilter = "active";
  let closeChat = null;
  const ticketList = async () => {
    const box = $("tickets-list");
    closeChat?.();
    closeChat = null;
    $("ticket-view").hidden = true;
    $("tickets-main").hidden = false;
    let d;
    try { d = await getJson(`/api/mod/tickets?status=${ticketFilter}`); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    setBadge("tickets", d.open);
    box.replaceChildren();
    if (!d.tickets.length) box.append(h("div", { class: "panel empty", text: ticketFilter === "active" ? "No open tickets. All caught up!" : "No tickets here." }));
    for (const t of d.tickets) {
      box.append(h("button", { class: `panel tk-row prio-${t.priority}${t.staffUnread ? " unread" : ""}`, type: "button", onclick: () => openTicket(t.id) },
        headImg(t.user?.head, 36, t.user?.username),
        h("span", { class: "tk-row-main" },
          h("span", { class: "tk-row-subject", text: t.subject }),
          h("span", { class: "tk-row-preview", text: `${t.user?.username || "?"}: ${t.preview || ""}` }),
          h("span", { class: "tk-chips" }, chip("label", t.label), chip("priority", t.priority), t.assignedTo ? h("span", { class: "text-3 small tk-assignee" }, iconEl("user"), t.assignedTo) : null)),
        h("span", { class: "tk-row-side" }, chip("status", t.status, true), h("span", { class: "text-3 small", text: when(t.lastMessageAt) }),
          t.staffUnread ? h("span", { class: "tk-unread", text: `${t.staffUnread} new` }) : null)));
    }
  };
  function openTicket(id) {
    $("tickets-main").hidden = true;
    const view = $("ticket-view");
    view.hidden = false;
    closeChat?.();
    closeChat = ticketChat(view, id, { staff: true, toast, onBack: ticketList });
    history.replaceState(null, "", `#tickets/${id}`);
  }
  loaders.tickets = () => {
    const m = location.hash.match(/^#tickets\/(\d+)/);
    if (m) openTicket(Number(m[1]));
    else ticketList();
  };
  document.querySelectorAll("[data-tk-filter]").forEach((b) => b.addEventListener("click", () => {
    ticketFilter = b.dataset.tkFilter;
    document.querySelectorAll("[data-tk-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    ticketList();
  }));
  // live updates through the community connection
  connectLive(ticketEvent, (data) => {
    if (data.type === "ticket" && !$("tickets-main").hidden && !document.querySelector('[data-panel="tickets"]').hidden) ticketList();
    if (data.type === "ticket" && document.querySelector('[data-panel="tickets"]').hidden) getJson("/api/mod/summary").then((s) => setBadge("tickets", s.openTickets)).catch(() => {});
  });

  // ---------- Players ----------
  let plTimer = null;
  const plSearch = async () => {
    const box = $("pl-results");
    let d;
    try { d = await getJson(`/api/mod/players?q=${encodeURIComponent($("pl-search").value)}&filter=${$("pl-filter").value}`); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    box.replaceChildren();
    if (!d.players.length) box.append(h("div", { class: "empty", text: "No players found." }));
    for (const p of d.players) {
      box.append(h("button", { class: "pl-row", type: "button", onclick: () => openPlayer(p.xuid) },
        h("span", { class: "pl-head-wrap" }, headImg(p.head, 36, p.name), p.online ? h("span", { class: "pl-dot", title: "In game" }) : null),
        h("span", { class: "pl-main" },
          h("span", { class: "pl-name" }, h("b", { text: p.name }), p.op ? h("span", { class: "pl-tag op", text: "OP" }) : null,
            p.rank ? h("span", { class: "pl-tag", style: `--c:${p.rank.color || "#aab"}`, text: p.rank.name }) : null,
            p.plan ? h("span", { class: `pl-tag plan ${p.plan}`, text: PLAN_NAMES[p.plan] }) : null,
            p.banned ? h("span", { class: "pl-tag bad", text: "Banned" }) : null),
          h("span", { class: "pl-sub", text: `${p.online ? "In game now" : `Last seen ${fmt(p.lastSeen)}`} · ${money(p.money)} · ${p.playtimeH} h played${p.warns ? ` · ${p.warns} warning${p.warns > 1 ? "s" : ""}` : ""}${p.account ? ` · website: ${p.account.username}` : ""}` })),
        h("span", { class: "pl-chev", "aria-hidden": "true", text: "›" })));
    }
  };
  loaders.players = () => {
    const m = location.hash.match(/^#players\/(\d+)/);
    if (m) openPlayer(m[1]);
    plSearch();
  };
  $("pl-search").addEventListener("input", () => { clearTimeout(plTimer); plTimer = setTimeout(plSearch, 250); });
  $("pl-filter").addEventListener("change", plSearch);

  let ranksCache = null;
  async function openPlayer(xuid) {
    let d;
    try { d = await getJson(`/api/mod/players/${encodeURIComponent(xuid)}`); } catch (e) { toast(e.message); return; }
    const p = d.player;
    const reload = (msg) => { if (msg) toast(msg); openPlayer(xuid); plSearch(); };
    const act = (label, cls, fn, needAdmin, ic) => (needAdmin && !admin ? null
      : h("button", { class: `btn btn-sm ${cls}`, type: "button", onclick: fn }, ic ? iconEl(ic) : null, label));
    const gameAction = (action, title, opts = {}) => () => {
      const reason = h("input", { class: "input", id: "pa-reason", maxlength: 200, placeholder: opts.reasonRequired ? "Required: what did they do?" : "Optional" });
      const lens = opts.lengths ? select("pa-len", opts.lengths, opts.defaultLen) : null;
      openDialog({
        title: `${title} ${p.name}`,
        body: h("div", { class: "form" }, opts.text ? h("p", { class: "text-2", text: opts.text }) : null, lens ? field("Length", lens) : null, opts.noReason ? null : field("Reason", reason)),
        actions: [{ label: "Cancel" }, {
          label: title, kind: opts.danger ? "danger" : "primary",
          onClick: async () => {
            await postJson(`/api/mod/players/${xuid}/${action}`, { reason: reason.value, minutes: lens ? (lens.value === "perm" ? null : Number(lens.value)) : null });
            reload(`${title} sent to the server.`);
          },
        }],
      });
    };
    const LEN = Object.entries(MUTE_LABELS);
    const statTile = (label, v) => h("div", { class: "pc-stat" }, h("b", { text: String(v) }), h("span", { text: label }));

    const notesBox = h("div", { class: "pc-notes" });
    for (const n of d.notes) {
      notesBox.append(h("div", { class: "pc-note" }, h("div", { class: "pc-note-head" }, h("b", { text: n.author }), h("time", { class: "text-3 small", text: fmt(n.at) }),
        admin ? h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": "Delete note", onclick: async () => { await postJson(`/api/mod/players/${xuid}/note-delete`, { id: n.id }); reload(); } }, iconEl("x")) : null),
      h("p", { text: n.body })));
    }
    const noteInput = h("textarea", { class: "input", rows: 2, maxlength: 500, placeholder: "Add a private staff note (only staff see notes)" });
    const noteForm = h("div", { class: "pc-note-form" }, noteInput, h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Add note", onclick: async () => {
      try { await postJson(`/api/mod/players/${xuid}/note`, { body: noteInput.value }); reload("Note saved."); } catch (e) { toast(e.message); }
    } }));

    const acc = p.account;
    const body = h("div", { class: "pc" },
      h("div", { class: "pc-top" },
        headImg(p.head, 64, p.name),
        h("div", {},
          h("h3", { class: "pc-name" }, p.name, p.op ? h("span", { class: "pl-tag op", text: "OP" }) : null),
          h("p", { class: "text-3 small", style: "margin:2px 0 0", text: `${p.online ? "In game now" : `Last seen ${fmt(p.lastSeen)}`} · first joined ${fmt(p.firstSeen)}` }, p.online ? h("span", { class: "pc-online-dot" }) : null),
          h("div", { class: "pc-tags" },
            p.rank ? h("span", { class: "pl-tag", style: `--c:${p.rank.color || "#aab"}`, text: `Rank: ${p.rank.name}` }) : h("span", { class: "pl-tag", text: "No rank" }),
            p.plan ? h("span", { class: `pl-tag plan ${p.plan}`, text: `${PLAN_NAMES[p.plan]}${p.planExpires ? ` until ${new Date(p.planExpires).toLocaleDateString()}` : ""}` }) : h("span", { class: "pl-tag", text: "Galaxy Free" }),
            p.banned ? h("span", { class: "pl-tag bad", text: "Banned in game" }) : null))),
      h("div", { class: "pc-stats" },
        statTile("Money", money(p.money)), statTile("Hours", short(p.stats.playtimeH)), statTile("Mined", short(p.stats.mined)),
        statTile("Kills", short(p.stats.kills)), statTile("Deaths", short(p.stats.deaths)), statTile("Achievements", p.stats.achievements), statTile("Warnings", p.warns)),

      h("h4", { text: "In game" }),
      h("div", { class: "pc-actions" },
        act("Warn", "btn-secondary", gameAction("warn", "Warn", { reasonRequired: true })),
        act("Mute", "btn-secondary", gameAction("mute", "Mute", { lengths: LEN, defaultLen: 60 })),
        act("Unmute", "btn-secondary", gameAction("unmute", "Unmute", { noReason: true })),
        act("Kick", "btn-secondary", gameAction("kick", "Kick", { reasonRequired: true, text: "They're removed from the server but can join again." })),
        p.banned ? act("Unban", "btn-secondary", gameAction("unban", "Unban", { noReason: true }), true)
          : act("Ban", "btn-danger", gameAction("ban", "Ban", { lengths: [...LEN, ["perm", "Permanent"]], defaultLen: "perm", danger: true, reasonRequired: true }), true),
        act("Give crate keys", "btn-secondary", () => keyDialog(p, xuid, reload), true, "key"),
        owner && acc && !acc.owner ? act("Act as member", "btn-secondary", () => openDialog({
          title: `See the site as ${acc.username || p.name}?`,
          body: h("p", { class: "text-2", text: "You'll be signed in to their account to see exactly what they see: channels, panels and buttons. It's look-only, so nothing you do changes anything. Use \"Back to my account\" or Sign out to come back. It ends by itself after 2 hours." }),
          actions: [{ label: "Cancel" }, { label: "Act as member", kind: "primary", onClick: async () => {
            await postJson(`/api/mod/act-as/${acc.id}`, {});
            location.href = "/community";
          } }],
        }), false, "user") : null,
        owner ? act(p.op ? "Remove operator" : "Make operator", p.op ? "btn-danger" : "btn-secondary", () => openDialog({
          title: p.op ? `Remove operator from ${p.name}?` : `Make ${p.name} an operator?`,
          body: h("p", { class: "text-2", text: p.op
            ? "They lose operator commands and creative tools. This also works on operator status left over from the old Realm, which /deop can't remove. If they're offline, it happens when they next join."
            : "Operators can use every command in game, including /gamemode and /give. Only give this to people you trust." }),
          actions: [{ label: "Cancel" }, { label: p.op ? "Remove operator" : "Make operator", kind: p.op ? "danger" : "primary", onClick: async () => {
            const r = await postJson(`/api/mod/players/${xuid}/setop`, { op: !p.op });
            reload(r.message);
          } }],
        }), true) : null),

      admin ? h("h4", { text: "Rank, plan and money" }) : null,
      admin ? h("div", { class: "pc-actions" },
        act("Change ranks", "btn-secondary", () => rankDialog(p, xuid, reload)),
        act("Profile picture", "btn-secondary", () => pictureDialog(p, xuid, reload)),
        act("Change plan", "btn-secondary", () => planDialog(p, xuid, reload)),
        act("Change money", "btn-secondary", () => moneyDialog(p, xuid, reload)),
        act("Give a Shop item", "btn-secondary", () => shopDialog(p, d.shop, xuid, reload), false, "cart")) : null,
      owner && acc ? h("h4", { text: `Galaxy Credits: $${Number(acc.credits || 0).toFixed(2)}` }) : null,
      owner && acc ? h("div", { class: "pc-actions" },
        act("Give credits", "btn-secondary", () => creditsDialog(acc, "give", reload), false, "coins"),
        act("Take credits", "btn-secondary", () => creditsDialog(acc, "take", reload))) : null,
      h("h4", { text: "Store items" }),
      h("p", { class: "text-2 small", style: "margin:0", text: [
        `Cosmetics: ${d.shop.cosmetics.length ? d.shop.cosmetics.map((c) => c.replace(/^(trail|join)_/, "").replace(/_/g, " ")).join(", ") : "none"}`,
        `extra plots: ${p.extraPlots || 0}`, `extra shop plots: ${d.shop.extraShopPlots}`,
        d.shop.nightVisionUntil ? `Night Vision until ${fmt(d.shop.nightVisionUntil)}` : null].filter(Boolean).join(" · ") }),
      d.shop.orders.length ? h("div", { class: "pc-list", style: "margin-top:6px" }, d.shop.orders.slice(0, 8).map((o) => h("div", { class: "pc-li" },
        h("b", { text: o.item }), h("span", { text: `${o.option ? `(${o.option}) ` : ""}${o.source === "payment" ? "bought by card" : o.source === "credits" ? "bought with credits" : o.source === "promo" ? `free with ${String(o.by).replace(/^promo /, "code ")}` : `given by ${o.by}`}` }), h("time", { class: "text-3 small", text: fmt(o.at) })))) : null,

      h("h4", { text: "Website and voice chat" }),
      acc ? h("div", {},
        h("p", { class: "text-2 small", style: "margin:0 0 8px", text: [
          `${acc.username} · joined ${fmt(acc.joined)}`,
          acc.realName ? `real name: ${acc.realName}${acc.realNameHidden ? " (they hid it from players)" : ""}` : null,
          acc.welcome ? `found us: ${({ friend: "a friend", family: "family", video: "a video", list: "a server list" })[acc.welcome.foundVia] || String(acc.welcome.foundVia || "?").replace(/^other: /, "")}${acc.welcome.invitedBy ? `, invited by ${acc.welcome.invitedBy}` : ""}` : "hasn't done the welcome steps yet",
          acc.welcome?.interests?.length ? `likes: ${acc.welcome.interests.join(", ")}` : null,
          acc.welcome?.bio ? `about: "${acc.welcome.bio}"` : null,
          acc.mutedUntil ? `muted until ${fmt(acc.mutedUntil)}${acc.muteReason ? ` (${acc.muteReason})` : ""}` : null,
          acc.voiceMutedUntil ? `voice muted until ${fmt(acc.voiceMutedUntil)}` : null,
          acc.globalMic ? "has the Global Mic" : null,
          acc.banned ? `BANNED (${acc.banReason || "no reason"})` : null].filter(Boolean).join(" · ") }),
        h("div", { class: "pc-actions" },
          admin ? act(acc.realName ? "Change real name" : "Add real name", "btn-secondary", () => realNameDialog(acc, reload)) : null,
          acc.mutedUntil ? act("Unmute on website", "btn-secondary", async () => { await postJson(`/api/mod/members/${acc.id}/unmute`, {}); reload("Unmuted."); })
            : act("Mute on website", "btn-secondary", () => muteDialog({ id: acc.id, username: acc.username }, reload)),
          acc.voiceMutedUntil ? act("Unmute in voice", "btn-secondary", async () => { await postJson(`/api/mod/members/${acc.id}/voice-unmute`, {}); reload("Unmuted in voice."); })
            : act("Mute in voice", "btn-secondary", () => voiceMuteDialog({ id: acc.id, username: acc.username }, reload)),
          acc.power < 50 ? act(acc.globalMic ? "Take Global Mic" : "Give Global Mic", "btn-secondary", async () => {
            await postJson(`/api/mod/members/${acc.id}/global-mic`, { allowed: !acc.globalMic }); reload(acc.globalMic ? "Global Mic removed." : "Global Mic given.");
          }, true) : null,
          acc.banned ? act("Unban on website", "btn-secondary", async () => { await postJson(`/api/mod/members/${acc.id}/unban`, {}); reload("Unbanned."); }, true)
            : act("Ban on website", "btn-danger", () => banDialog({ id: acc.id, username: acc.username }, reload), true)))
        : h("p", { class: "text-3 small", style: "margin:0", text: "Not linked to a website account yet." }),

      d.tickets.length ? h("h4", { text: "Support tickets" }) : null,
      d.tickets.length ? h("div", { class: "pc-list" }, d.tickets.map((t) => h("button", { class: "pc-li", type: "button", onclick: () => { closeDialogs(); selectTab("tickets"); openTicket(t.id); } },
        chip("label", t.label), h("span", { text: t.subject }), chip("status", t.status, true)))) : null,

      h("h4", { text: `Punishment history (${d.history.length})` }),
      d.history.length ? h("div", { class: "pc-list" }, d.history.map((x) => h("div", { class: `pc-li k-${x.kind}` },
        h("b", { text: KIND_WORDS[x.kind] || x.kind }),
        h("span", { text: `${["mute", "ban"].includes(x.kind) ? `(${x.minutes == null ? "permanent" : MUTE_LABELS[x.minutes] || `${x.minutes} min`}) ` : ""}by ${x.by}${x.reason ? `: ${x.reason}` : ""}` }),
        h("time", { class: "text-3 small", text: fmt(x.at) }))))
        : h("p", { class: "text-3 small", style: "margin:0", text: "Clean record." }),

      d.reports.length ? h("h4", { text: `Reports against them (${d.reports.length})` }) : null,
      d.reports.length ? h("div", { class: "pc-list" }, d.reports.map((r) => h("div", { class: "pc-li" },
        h("b", { text: r.reason }), h("span", { text: `${r.details ? `${r.details} · ` : ""}by ${r.by} · ${r.status}` }), h("time", { class: "text-3 small", text: fmt(r.at) })))) : null,

      h("h4", { text: "Staff notes" }), notesBox, noteForm);

    closeDialogs();
    openDialog({ title: "Member", body, actions: [{ label: "Close" }] }).dialog.classList.add("dialog-wide");
  }
  function closeDialogs() {
    document.querySelectorAll("dialog.dialog").forEach((d) => { try { d.close(); } catch { /* already closed */ } d.remove(); });
  }

  function rankDialog(p, xuid, reload) {
    ranksDialog({ name: p.name, xuid, rankIds: p.rankIds || (p.rankId ? [p.rankId] : []), onSaved: (msg) => reload(msg) });
  }
  // Profile picture: Minecraft head, Xbox picture, or a custom picture (cropped to a square here).
  function pictureDialog(p, xuid, reload) {
    let source = p.picSource === "auto" ? (p.hasHead ? "head" : "xbox") : p.picSource;
    let upload = null;
    const preview = h("img", { class: "pic-preview", alt: "Preview", width: 96, height: 96 });
    const showPreview = () => {
      preview.src = upload && source === "custom" ? upload.url : `/api/head/${xuid}?as=${source}&t=${Date.now()}`;
    };
    const opts = [["head", "Minecraft head", "The face of their skin, from the server."], ["xbox", "Xbox picture", "Their Xbox profile picture."], ["custom", "Custom picture", "A picture you upload, cropped to a square."]];
    const group = h("div", { class: "pic-opts", role: "radiogroup", "aria-label": "Picture" });
    const file = h("input", { type: "file", accept: "image/*", id: "pic-file", class: "sr-only" });
    const pick = h("label", { class: "btn btn-secondary btn-sm", for: "pic-file", text: p.hasCustomPic ? "Upload a different picture" : "Upload a picture" });
    const refresh = h("input", { type: "checkbox", id: "pic-refresh", checked: source === "xbox" });
    const extra = h("div", { class: "pic-extra" });
    const drawExtra = () => extra.replaceChildren(
      source === "custom" ? pick : null,
      source === "xbox" ? h("label", { class: "check" }, refresh, "Get their newest Xbox picture now") : null);
    const draw = () => {
      group.replaceChildren(...opts.map(([k, name, hint]) => {
        const b = h("button", { type: "button", class: `pic-opt${k === source ? " on" : ""}`, role: "radio", "aria-checked": String(k === source),
          onclick: () => { source = k; draw(); drawExtra(); showPreview(); } }, h("b", { text: name }), h("span", { class: "text-3 small", text: hint }));
        if (k === "head" && !p.hasHead) { b.disabled = true; b.title = "The server hasn't sent their head yet."; }
        return b;
      }));
    };
    file.addEventListener("change", async () => {
      const f = file.files[0];
      file.value = "";
      if (!f) return;
      try { upload = await squarePicture(f); source = "custom"; draw(); drawExtra(); preview.src = upload.url; }
      catch (e) { toast(e.message); }
    });
    draw(); drawExtra();
    preview.src = `/api/head/${xuid}?t=${Date.now()}`;
    openDialog({
      title: `Profile picture for ${p.name}`,
      body: h("div", { class: "form" }, h("div", { class: "pic-top" }, preview, h("p", { class: "text-3 small", style: "margin:0", text: "Shown on their profile, in the community, the leaderboards and the server map." })), group, extra, file),
      actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => {
        if (source === "custom" && !upload && !p.hasCustomPic) throw new Error("Upload a picture first.");
        await postJson(`/api/mod/players/${xuid}/picture`, { source, image: source === "custom" && upload ? { mime: upload.mime, data: upload.data } : null, refreshXbox: source === "xbox" && refresh.checked });
        reload("Profile picture updated.");
      } }],
    });
  }

  function planDialog(p, xuid, reload) {
    const plan = select("pa-plan", [["", "Galaxy Free (no plan)"], ["plus", "Galaxy+"], ["pro", "Galaxy Pro+"]], p.plan || "");
    const days = select("pa-days", [["30", "30 days"], ["90", "90 days"], ["365", "1 year"], ["0", "Forever"]], "30");
    const extra = h("input", { class: "input", id: "pa-extra", type: "number", min: 0, max: 50, value: String(p.extraPlots ?? 0) });
    openDialog({
      title: `Plan for ${p.name}`,
      body: h("div", { class: "form" }, field("Plan", plan), field("How long", days), field("Extra plots", extra, "On top of what their plan gives.")),
      actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => { await postJson("/api/mod/economy/plan", { xuid, plan: plan.value || null, days: Number(days.value), extraPlots: Number(extra.value) }); reload("Plan updated."); } }],
    });
  }
  function realNameDialog(acc, reload) {
    const input = h("input", { class: "input", id: "pa-realname", maxlength: 60, placeholder: "e.g. Alex", autocomplete: "off", value: acc.realName || "" });
    openDialog({
      title: `Real name for ${acc.username}`,
      body: h("div", {}, h("p", { class: "text-2", style: "margin-top:0", text: "Shown on their profile card next to their username. Everyone sees it unless they hide it in Account → Privacy (then only they and staff do). Leave it empty to remove it." }),
        field("Real name", input)),
      actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => {
        await postJson(`/api/panel/members/${acc.id}/real-name`, { name: input.value });
        reload(input.value.trim() ? "Real name saved." : "Real name removed.");
      } }],
    });
  }

  function creditsDialog(acc, action, reload) {
    const amount = h("input", { class: "input", id: "pa-credits", type: "number", min: 0.01, step: "0.01", value: action === "give" ? "5.00" : "", inputmode: "decimal" });
    openDialog({
      title: action === "give" ? `Give credits to ${acc.username}` : `Take credits from ${acc.username}`,
      body: h("div", {}, h("p", { class: "text-2", style: "margin-top:0", text: action === "give"
        ? "They can spend these in the Store. They come from your unlimited owner credits, so they aren't real money."
        : `They have $${Number(acc.credits || 0).toFixed(2)}. You can't take more than they have.` }), field("Amount ($)", amount)),
      actions: [{ label: "Cancel" }, { label: action === "give" ? "Give" : "Take", kind: action === "give" ? "primary" : "danger", onClick: async () => {
        const r = await postJson("/api/panel/credits", { userId: acc.id, action, amount: amount.value });
        reload(r.message);
      } }],
    });
  }

  function moneyDialog(p, xuid, reload) {
    const action = select("pa-money-act", [["add", "Add"], ["take", "Take away"], ["set", "Set to"]], "add");
    const amount = h("input", { class: "input", id: "pa-amount", inputmode: "decimal", placeholder: "e.g. 500" });
    openDialog({
      title: `Money for ${p.name} (now ${money(p.money)})`,
      body: h("div", { class: "form" }, field("Change", action), field("Amount ($)", amount)),
      actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => { await postJson("/api/mod/economy/money", { xuid, action: action.value, amount: amount.value }); reload("Money updated."); } }],
    });
  }
  function shopDialog(p, shop, xuid, reload) {
    const items = shop.catalog.flatMap((c) => c.items.map((i) => ({ ...i, cat: c.name })));
    const sel = select("pa-shop-item", items.map((i) => [i.id, `${i.cat}: ${i.name}`]), items[0].id);
    const opt = h("select", { class: "input", id: "pa-shop-opt" });
    const optField = field("How long", opt);
    const sync = () => {
      const it = items.find((i) => i.id === sel.value);
      opt.replaceChildren(...(it.options || []).map((o) => h("option", { value: o.id, text: o.name })));
      optField.hidden = !it.options;
    };
    sel.addEventListener("change", sync);
    sync();
    openDialog({
      title: `Give ${p.name} a Shop item`,
      body: h("div", { class: "form" }, field("Item", sel), optField,
        h("p", { class: "text-3 small", text: "Use this for giveaways, or for a purchase made another way. Money needs the server online." })),
      actions: [{ label: "Cancel" }, { label: "Give", kind: "primary", onClick: async () => {
        await postJson(`/api/mod/players/${xuid}/shopgive`, { item: sel.value, option: opt.value || null });
        reload("Given!");
      } }],
    });
  }

  function keyDialog(p, xuid, reload) {
    const kind = select("pa-key", [["common", "Common"], ["rare", "Rare"], ["galaxy", "Galaxy"]], "common");
    const amount = h("input", { class: "input", id: "pa-keys", type: "number", min: 1, max: 100, value: "1" });
    openDialog({
      title: `Give crate keys to ${p.name}`,
      body: h("div", { class: "form" }, field("Crate", kind), field("How many", amount)),
      actions: [{ label: "Cancel" }, { label: "Give", kind: "primary", onClick: async () => { await postJson(`/api/mod/players/${xuid}/givekey`, { kind: kind.value, amount: Number(amount.value) }); reload("Keys given."); } }],
    });
  }

  // ---------- Messages (owners): read any DM conversation ----------
  if (owner) {
    document.querySelector('[data-tab="dms"]').hidden = false;
    let dmTimer = null;
    const listDms = async () => {
      $("dm-owner-view").hidden = true;
      $("dm-owner-list").hidden = false;
      let d;
      try { d = await getJson(`/api/mod/dms?q=${encodeURIComponent($("dm-owner-search").value)}`); } catch (e) { $("dm-owner-list").replaceChildren(h("p", { class: "text-3", style: "padding:16px", text: e.message })); return; }
      const box = $("dm-owner-list");
      box.replaceChildren();
      if (!d.threads.length) box.append(h("div", { class: "empty", text: "No direct messages yet." }));
      for (const t of d.threads) {
        box.append(h("button", { class: "pl-row", type: "button", onclick: () => openDm(t.id) },
          h("span", { class: "pl-main" },
            h("span", { class: "pl-name" }, h("b", { text: `${t.a.username} ↔ ${t.b.username}` })),
            h("span", { class: "pl-sub", text: `${t.count} message${t.count === 1 ? "" : "s"} · last ${fmt(t.at)} · ${t.preview || ""}` })),
          h("span", { class: "pl-chev", "aria-hidden": "true", text: "›" })));
      }
    };
    const openDm = async (id) => {
      let d;
      try { d = await getJson(`/api/mod/dms/${id}`); } catch (e) { toast(e.message); return; }
      $("dm-owner-list").hidden = true;
      const view = $("dm-owner-view");
      view.hidden = false;
      view.replaceChildren(h("div", { class: "panel" },
        h("div", { class: "voice-head" }, h("h2", { text: `${d.between[0]} ↔ ${d.between[1]}` }),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "← Back", onclick: listDms })),
        h("div", { class: "pc-list" }, d.messages.map((m) => h("div", { class: "pc-li" },
          h("b", { text: m.from }), h("span", { text: m.body, style: "white-space:pre-wrap;overflow-wrap:anywhere" }),
          h("time", { class: "text-3 small", text: `${fmt(m.at)}${m.via === "game" ? " · game" : ""}` }))))));
    };
    loaders.dms = listDms;
    $("dm-owner-search").addEventListener("input", () => { clearTimeout(dmTimer); dmTimer = setTimeout(listDms, 250); });
  }

  return { openPlayer };
}

// The staff page listens to the community connection for live ticket updates.
function connectLive(...handlers) {
  let ws;
  let tries = 0;
  const open = () => {
    try { ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/chat/connect`); } catch { return; }
    ws.addEventListener("open", () => { tries = 0; });
    ws.addEventListener("message", (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      if (data.type !== "ticket") return;
      for (const fn of handlers) fn(data);
    });
    ws.addEventListener("close", () => { if (tries++ < 20) setTimeout(open, Math.min(30000, 2000 * tries)); });
  };
  open();
  setInterval(() => { try { if (ws?.readyState === 1) ws.send("ping"); } catch { /* */ } }, 30000);
}

// Crops a photo to a centred square and shrinks it to 256 x 256 (JPEG), in the browser.
async function squarePicture(file) {
  if (!/^image\//.test(file.type)) throw new Error("Choose a picture file.");
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("That picture couldn't be opened."); });
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  c.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
  const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
  return { mime: "image/jpeg", data, url: URL.createObjectURL(blob) };
}

