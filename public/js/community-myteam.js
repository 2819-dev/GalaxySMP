// Community > Friends > Team: make a team, invites, members, the team chat (also /tc in game) and the team leaderboard.
import { h, getJson, postJson, openDialog, field } from "/js/dialog.js";
import { iconEl } from "/js/site.js";
import { faceSvg } from "/js/face.js";

const hours = (s) => `${Math.round(Number(s || 0) / 3600).toLocaleString()} h`;

export function renderMyTeam(root, { toast, setTimer }) {
  const box = h("div", { class: "fr-lists" }, h("p", { class: "text-3", text: "Loading…" }));
  root.append(box);
  let chatTimer = null;
  let longTags = false;  // the site Owner can use a tag of up to 32 letters, numbers and spaces
  const tagMax = () => (longTags ? 32 : 5);
  const tagLabel = () => (longTags ? "Tag (as long as you like, up to 32 letters, numbers and spaces)" : "Tag (up to 5 letters and numbers)");
  const act = async (body, after) => {
    try { const r = await postJson("/api/teams", body); if (r.message) toast(r.message); after?.(); load(); }
    catch (e) { toast(e.message); }
  };

  async function load() {
    clearInterval(chatTimer);
    let d;
    try { d = await getJson("/api/teams/mine"); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    if (!d.linked) {
      box.replaceChildren(h("section", { class: "panel fr-box" }, h("h3", { class: "fr-h", text: "Teams" }),
        h("p", { class: "text-3", style: "margin:0", text: "Link your Minecraft account first (Account settings > Link), so your team works in game too." })));
      return;
    }
    longTags = Boolean(d.longTags);
    box.replaceChildren(...(d.team ? teamView(d.team) : noTeam(d.invites)), leaderboardButton());
  }

  // ---------- not in a team ----------
  function noTeam(invites) {
    const parts = [];
    if (invites.length) {
      parts.push(h("section", { class: "panel fr-box" }, h("h3", { class: "fr-h", text: "Team invites" }),
        ...invites.map((i) => h("div", { class: "fr-row" },
          h("span", { class: "fr-name" }, h("b", {}, h("span", { class: "team-tag", text: `[${i.tag}]` }), i.name), h("small", { class: "text-3", text: `${i.members} member${i.members === 1 ? "" : "s"}` })),
          h("span", { class: "fr-btns" },
            h("button", { class: "btn btn-sm btn-primary", type: "button", text: "Join", onclick: () => act({ action: "accept", teamId: i.id }) }),
            h("button", { class: "btn btn-sm btn-ghost", type: "button", text: "Decline", onclick: () => act({ action: "decline", teamId: i.id }) }))))));
    }
    const name = h("input", { class: "input", id: "tm-name", maxlength: 24, placeholder: "e.g. Star Builders" });
    const tag = h("input", { class: "input", id: "tm-tag", maxlength: tagMax(), placeholder: "e.g. STAR", autocapitalize: "characters" });
    const preview = h("span", { class: "tm-preview" });
    const draw = () => preview.replaceChildren(h("span", { class: "team-tag", text: `[${tag.value.trim() || "TAG"}]` }), h("b", { text: "YourName" }), h("span", { class: "text-3", text: ": hi team!" }));
    tag.addEventListener("input", draw);
    draw();
    const form = h("form", { class: "form tm-form" }, field("Team name", name), field(tagLabel(), tag),
      h("div", { class: "tm-preview-row" }, h("span", { class: "text-3 small", text: "In chat:" }), preview),
      h("button", { class: "btn btn-primary", type: "submit" }, iconEl("users"), "Create team"));
    form.addEventListener("submit", (e) => { e.preventDefault(); act({ action: "create", name: name.value, tag: tag.value }); });
    parts.push(h("section", { class: "panel fr-box" }, h("h3", { class: "fr-h", text: "Make a team" }),
      h("p", { class: "text-3", style: "margin:0 0 8px", text: "Up to 8 players. Your tag shows in gray before your name in chat, you get a private team chat (and /tc in game), and teammates can build on each other's plots." }),
      form));
    return parts;
  }

  // ---------- in a team ----------
  function teamView(t) {
    const members = h("section", { class: "panel fr-box" },
      h("div", { class: "tm-head" },
        h("div", {}, h("h3", { class: "fr-h", style: "margin:0" }, h("span", { class: "team-tag", text: `[${t.tag}]` }), t.name),
          h("span", { class: "text-3 small", text: `${t.members.length} of ${t.max} players · ${hours(t.stats.playtime)} played together · ${t.stats.achievements} achievements` })),
        t.isAdmin ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => editTeam(t) }, iconEl("pencil"), "Edit") : null),
      ...t.members.map((m) => {
        const img = h("img", { class: "fr-face", alt: "", width: 36, height: 36, src: m.head || faceSvg(m.name) });
        img.onerror = () => { img.onerror = null; img.src = faceSvg(m.name); };
        return h("div", { class: "fr-row" },
          h("a", { class: "fr-who", href: `/player/${encodeURIComponent(m.name)}` },
            h("span", { class: "fr-face-wrap" }, img, m.online ? h("span", { class: "fr-dot", title: "In game now" }) : null),
            h("span", { class: "fr-name" }, h("b", {}, m.name, m.leader ? h("span", { class: "tm-role tm-role-org", text: "Organizer" }) : m.admin ? h("span", { class: "tm-role", text: "Admin" }) : null),
              h("small", { class: m.online ? "fr-on" : "text-3", text: m.online ? "In game now" : m.leader ? "Owns the team" : m.admin ? "Helps run the team" : "Member" }))),
          memberButtons(t, m));
      }));
    const parts = [members];
    if (t.isAdmin) {
      const who = h("input", { class: "input", id: "tm-invite", maxlength: 32, placeholder: "Minecraft name" });
      const inv = h("form", { class: "fr-add" }, who, h("button", { class: "btn btn-primary", type: "submit" }, iconEl("userPlus"), "Invite"));
      inv.addEventListener("submit", (e) => { e.preventDefault(); if (who.value.trim()) act({ action: "invite", name: who.value }, () => { who.value = ""; }); });
      parts.push(h("section", { class: "panel fr-box" }, h("h3", { class: "fr-h", text: "Invite players" }), inv,
        ...t.invites.map((i) => h("div", { class: "fr-row" }, h("span", { class: "fr-name" }, h("b", { text: i.name }), h("small", { class: "text-3", text: "Invited" })),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Cancel", onclick: () => act({ action: "cancel-invite", xuid: i.xuid }) })))));
    }
    parts.push(teamChat(t));
    parts.push(h("div", { class: "cx-row" },
      t.isLeader ? h("button", { class: "btn btn-danger btn-sm", type: "button", text: "Close the team", onclick: () => confirmAct("Close the team?", "Everyone leaves the team and the team chat is deleted.", "Close team", { action: "disband" }) })
        : h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Leave team", onclick: () => confirmAct(`Leave ${t.name}?`, "You can be invited again later.", "Leave", { action: "leave" }) })));
    return parts;
  }

  // Organizer: make/remove Admins, hand over the team, remove anyone. Admins: remove regular members.
  function memberButtons(t, m) {
    if (m.leader || !t.isAdmin) return null;
    const btns = [];
    if (t.isLeader) {
      btns.push(m.admin
        ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove Admin", onclick: () => act({ action: "unadmin", xuid: m.xuid }) })
        : h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Make Admin", onclick: () => confirmAct(`Make ${m.name} an Admin?`, "Admins can invite and remove members, edit the team name and tag, and run the team's streams. Only you can make Admins, hand over the team or close it.", "Make Admin", { action: "admin", xuid: m.xuid }, "primary") }));
      btns.push(h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Make organizer", onclick: () => confirmAct(`Make ${m.name} the organizer?`, "They'll own the team instead of you. You'll stay on as an Admin.", "Make organizer", { action: "transfer", xuid: m.xuid }) }));
    }
    if (t.isLeader || !m.admin) btns.push(h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": `Remove ${m.name}`, onclick: () => confirmAct(`Remove ${m.name}?`, "They can be invited again later.", "Remove", { action: "kick", xuid: m.xuid }) }, iconEl("trash")));
    return h("span", { class: "fr-btns" }, ...btns);
  }

  function confirmAct(title, text, label, body, kind = "danger") {
    openDialog({ title, body: h("p", { class: "text-2", style: "margin:0", text }), actions: [{ label: "Cancel" }, { label, kind, onClick: () => act(body) }] });
  }

  function editTeam(t) {
    const name = h("input", { class: "input", id: "tm-edit-name", maxlength: 24, value: t.name });
    const tag = h("input", { class: "input", id: "tm-edit-tag", maxlength: Math.max(tagMax(), t.tag.length), value: t.tag });
    name.value = t.name; tag.value = t.tag;
    openDialog({ title: "Edit team", body: h("div", { class: "form" }, field("Team name", name), field(tagLabel(), tag)),
      actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => { const r = await postJson("/api/teams", { action: "edit", name: name.value, tag: tag.value }); toast(r.message); load(); } }] });
  }

  // ---------- team chat ----------
  function teamChat(t) {
    const list = h("div", { class: "tm-chat-list", "aria-live": "polite" });
    const input = h("input", { class: "input", id: "tm-chat-input", maxlength: 300, placeholder: `Message ${t.name}`, autocomplete: "off" });
    const form = h("form", { class: "tm-chat-form" }, input, h("button", { class: "btn btn-primary", type: "submit", "aria-label": "Send" }, iconEl("send")));
    let last = 0;
    const line = (m) => m.system
      ? h("div", { class: "tm-msg sys", text: m.text })
      : h("div", { class: `tm-msg${m.mine ? " mine" : ""}` },
        h("b", { text: m.name }), m.fromGame ? h("span", { class: "tm-game", text: "in game" }) : null,
        h("span", { class: "tm-text", text: m.text }),
        h("time", { class: "text-3", text: new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }));
    const poll = async () => {
      try {
        const d = await getJson(`/api/teams/chat${last ? `?after=${last}` : ""}`);
        if (!last && !d.messages.length) list.replaceChildren(h("p", { class: "text-3 small", style: "margin:0", text: "No messages yet. Say hi! In game, type /tc and a message." }));
        if (d.messages.length) {
          if (!last) list.replaceChildren();
          const near = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
          list.append(...d.messages.map(line));
          last = d.messages.at(-1).id;
          if (near || d.messages.some((m) => m.mine)) list.scrollTop = list.scrollHeight;
        }
      } catch { /* try again */ }
    };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      try { await postJson("/api/teams/chat", { text }); poll(); } catch (err) { toast(err.message); input.value = text; }
    });
    poll();
    chatTimer = setInterval(poll, 4000);
    setTimer(chatTimer);
    return h("section", { class: "panel fr-box" }, h("h3", { class: "fr-h", text: "Team chat" }),
      h("p", { class: "text-3 small", style: "margin:0 0 6px", text: "Only your team sees this. It's shared with /tc in game." }), list, form);
  }

  // ---------- leaderboard (a dialog, not a page) ----------
  function leaderboardButton() {
    return h("button", { class: "btn btn-secondary btn-sm", type: "button", style: "align-self:flex-start", onclick: async () => {
      let d;
      try { d = await getJson("/api/teams/leaderboard"); } catch (e) { toast(e.message); return; }
      openDialog({ title: "Top teams", body: d.teams.length ? h("ol", { class: "tm-board" }, ...d.teams.map((t, i) => h("li", {},
        h("span", { class: "tm-rank", text: `#${i + 1}` }),
        h("span", { class: "tm-board-name" }, h("span", { class: "team-tag", text: `[${t.tag}]` }), h("b", { text: t.name })),
        h("span", { class: "text-3 small", text: `${t.members} players · ${hours(t.playtime)}${t.contestWins ? ` · ${t.contestWins} contest win${t.contestWins === 1 ? "" : "s"}` : ""}` }))))
        : h("p", { class: "text-3", text: "No teams yet. Be the first!" }), actions: [{ label: "Close", kind: "primary" }] });
    } }, iconEl("trophy"), "Top teams");
  }

  load();
}
