// Staff panel tabs: Overview (live numbers + quick controls), Tickets (support live chat)
// and Players (one card per player with everything staff need). All text goes in with textContent.
import { h, openDialog, postJson, getJson, select, field, muteDialog, banDialog, voiceMuteDialog, MUTE_LABELS } from "/js/dialog.js";
import { ticketChat, chip, when, LABELS, PRIORITIES, ticketEvent } from "/js/tickets.js";
import { iconEl } from "/js/site.js";

const $ = (id) => document.getElementById(id);
// a button with a line icon in front of its text
const ibtn = (name, label, onclick, cls = "btn btn-secondary") => {
  const b = h("button", { class: cls, type: "button", onclick });
  b.append(iconEl(name), label);
  return b;
};
const money = (n) => (n == null ? "–" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
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
  "ticket.update": "updated a ticket", "game.announce": "announced in game", "game.givekey": "gave crate keys", "game.warn": "warned a player",
  "game.mute": "muted a player", "game.unmute": "unmuted a player", "game.kick": "kicked a player", "game.ban": "banned a player", "game.unban": "unbanned a player",
  "rank.assign": "gave a rank", "rank.remove": "removed a rank", "rank.update": "edited a rank", "rank.create": "made a rank", "rank.delete": "deleted a rank",
  "plan.give": "gave a plan", "plan.remove": "removed a plan", "economy.money": "changed money", "economy.shop": "changed shop prices",
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
function headImg(src, size = 36) {
  const img = h("img", { class: "pp-head", alt: "", width: size, height: size, loading: "lazy" });
  img.src = src || "/img/icon-192.png";
  img.addEventListener("error", () => { img.src = "/img/icon-192.png"; }, { once: true });
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
      d.online.length ? h("div", { class: "ov-online" }, d.online.map((p) => h("button", { class: "ov-player", type: "button", onclick: () => openPlayer(p.xuid) }, headImg(p.head, 28), h("span", { text: p.name }))))
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
    box.replaceChildren(...[warn, packWarn].filter(Boolean), grid, h("div", { class: "ov-cols" }, quick, h("div", { class: "stack", style: "gap:16px" }, online, recent)));
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
        headImg(t.user?.head, 36),
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
        h("span", { class: "pl-head-wrap" }, headImg(p.head, 36), p.online ? h("span", { class: "pl-dot", title: "In game" }) : null),
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
        headImg(p.head, 64),
        h("div", {},
          h("h3", { class: "pc-name" }, p.name, p.op ? h("span", { class: "pl-tag op", text: "OP" }) : null),
          h("p", { class: "text-3 small", style: "margin:2px 0 0", text: `${p.online ? "In game now" : `Last seen ${fmt(p.lastSeen)}`} · first joined ${fmt(p.firstSeen)}` }, p.online ? h("span", { class: "pc-online-dot" }) : null),
          h("div", { class: "pc-tags" },
            p.rank ? h("span", { class: "pl-tag", style: `--c:${p.rank.color || "#aab"}`, text: `Rank: ${p.rank.name}` }) : h("span", { class: "pl-tag", text: "No rank" }),
            p.plan ? h("span", { class: `pl-tag plan ${p.plan}`, text: `${PLAN_NAMES[p.plan]}${p.planExpires ? ` until ${new Date(p.planExpires).toLocaleDateString()}` : ""}` }) : h("span", { class: "pl-tag", text: "Galaxy Free" }),
            p.banned ? h("span", { class: "pl-tag bad", text: "Banned in game" }) : null))),
      h("div", { class: "pc-stats" },
        statTile("Money", p.money == null ? "–" : `$${short(p.money)}`), statTile("Hours", short(p.stats.playtimeH)), statTile("Mined", short(p.stats.mined)),
        statTile("Kills", short(p.stats.kills)), statTile("Deaths", short(p.stats.deaths)), statTile("Achievements", p.stats.achievements), statTile("Warnings", p.warns)),

      h("h4", { text: "In game" }),
      h("div", { class: "pc-actions" },
        act("Warn", "btn-secondary", gameAction("warn", "Warn", { reasonRequired: true })),
        act("Mute", "btn-secondary", gameAction("mute", "Mute", { lengths: LEN, defaultLen: 60 })),
        act("Unmute", "btn-secondary", gameAction("unmute", "Unmute", { noReason: true })),
        act("Kick", "btn-secondary", gameAction("kick", "Kick", { reasonRequired: true, text: "They're removed from the server but can join again." })),
        p.banned ? act("Unban", "btn-secondary", gameAction("unban", "Unban", { noReason: true }), true)
          : act("Ban", "btn-danger", gameAction("ban", "Ban", { lengths: [...LEN, ["perm", "Permanent"]], defaultLen: "perm", danger: true, reasonRequired: true }), true),
        act("Give crate keys", "btn-secondary", () => keyDialog(p, xuid, reload), true, "key")),

      admin ? h("h4", { text: "Rank, plan and money" }) : null,
      admin ? h("div", { class: "pc-actions" },
        act("Change rank", "btn-secondary", () => rankDialog(p, xuid, reload)),
        act("Change plan", "btn-secondary", () => planDialog(p, xuid, reload)),
        act("Change money", "btn-secondary", () => moneyDialog(p, xuid, reload)),
        act("Give a Shop item", "btn-secondary", () => shopDialog(p, d.shop, xuid, reload), false, "cart")) : null,
      h("h4", { text: "Store items" }),
      h("p", { class: "text-2 small", style: "margin:0", text: [
        `Cosmetics: ${d.shop.cosmetics.length ? d.shop.cosmetics.map((c) => c.replace(/^(trail|join)_/, "").replace(/_/g, " ")).join(", ") : "none"}`,
        `extra plots: ${p.extraPlots || 0}`, `extra shop plots: ${d.shop.extraShopPlots}`,
        d.shop.nightVisionUntil ? `Night Vision until ${fmt(d.shop.nightVisionUntil)}` : null].filter(Boolean).join(" · ") }),
      d.shop.orders.length ? h("div", { class: "pc-list", style: "margin-top:6px" }, d.shop.orders.slice(0, 8).map((o) => h("div", { class: "pc-li" },
        h("b", { text: o.item }), h("span", { text: `${o.option ? `(${o.option}) ` : ""}${o.source === "payment" ? "bought" : `given by ${o.by}`}` }), h("time", { class: "text-3 small", text: fmt(o.at) })))) : null,

      h("h4", { text: "Website and voice chat" }),
      acc ? h("div", {},
        h("p", { class: "text-2 small", style: "margin:0 0 8px", text: [
          `${acc.username} · joined ${fmt(acc.joined)}`,
          acc.mutedUntil ? `muted until ${fmt(acc.mutedUntil)}${acc.muteReason ? ` (${acc.muteReason})` : ""}` : null,
          acc.voiceMutedUntil ? `voice muted until ${fmt(acc.voiceMutedUntil)}` : null,
          acc.globalMic ? "has the Global Mic" : null,
          acc.banned ? `BANNED (${acc.banReason || "no reason"})` : null].filter(Boolean).join(" · ") }),
        h("div", { class: "pc-actions" },
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

  async function rankDialog(p, xuid, reload) {
    if (!ranksCache) ranksCache = (await getJson("/api/mod/ranks?q=%20%20none%20%20")).ranks;
    const sel = select("pa-rank", [["", "No rank"], ...ranksCache.map((r) => [r.id, r.name])], p.rankId ?? "");
    openDialog({
      title: `Rank for ${p.name}`,
      body: h("div", { class: "form" }, field("Rank", sel, "Ranks with Staff powers also make them a Moderator or Admin on the website.")),
      actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => { await postJson("/api/mod/ranks/assign", { xuid, rankId: sel.value === "" ? null : Number(sel.value) }); reload("Rank updated."); } }],
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
