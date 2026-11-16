// Community > Friends: your friends (who's in game right now), friend requests, and adding someone by name.
import { h, getJson, postJson, openDialog } from "/js/dialog.js";
import { iconEl } from "/js/site.js";
import { faceSvg } from "/js/face.js";

const ago = (d) => {
  if (!d) return "Hasn't played yet";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 60) return `Played ${Math.max(1, m)} min ago`;
  if (m < 1440) return `Played ${Math.round(m / 60)} h ago`;
  const days = Math.round(m / 1440);
  return `Played ${days} day${days === 1 ? "" : "s"} ago`;
};

// Two tabs: Friends and Team (the team lives here instead of its own page).
export function renderFriends(root, helpers) {
  const wrap = h("div", { class: "cp-wrap" });
  const body = h("div");
  const tabs = h("div", { class: "fr-tabs", role: "tablist" });
  let current = null;
  let timers = [];
  const sub = { ...helpers, setTimer: (t) => { timers.push(t); helpers.setTimer(t); } };
  const show = (which) => {
    if (current === which) return;
    current = which;
    timers.forEach(clearInterval);
    timers = [];
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === which)));
    body.replaceChildren();
    if (which === "team") import("/js/community-myteam.js").then((m) => m.renderMyTeam(body, sub));
    else renderFriendsList(body, sub);
  };
  for (const [key, label, ic] of [["friends", "Friends", "users"], ["team", "Team", "shield"]]) {
    const b = h("button", { class: "fr-tab", type: "button", role: "tab", "data-tab": key }, iconEl(ic), label);
    b.addEventListener("click", () => show(key));
    tabs.append(b);
  }
  wrap.append(h("div", { class: "tl-intro" }, h("h2", { text: "Friends & Team" })), tabs, body);
  root.append(wrap);
  show(location.hash === "#team" ? "team" : "friends");
}

function renderFriendsList(root, { toast, setTimer, openDM }) {
  const input = h("input", { class: "input", id: "fr-add", maxlength: 32, placeholder: "Website or Minecraft name", autocomplete: "off" });
  const addBtn = h("button", { class: "btn btn-primary", type: "submit" }, iconEl("userPlus"), "Send request");
  const form = h("form", { class: "fr-add" }, input, addBtn);
  const lists = h("div", { class: "fr-lists" });
  root.append(h("div", { class: "fr-lists" },
    h("p", { class: "text-3", style: "margin:0", text: "See when your friends are on the server. You'll get a notification when a friend joins (turn it off in Account settings > Notifications)." }),
    h("section", { class: "panel fr-box" }, h("h3", { class: "fr-h", text: "Add a friend" }), form),
    lists));

  const act = async (action, userId, label) => {
    try {
      await postJson("/api/friends", { action, userId });
      if (label) toast(label);
      load();
    } catch (e) { toast(e.message); }
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    addBtn.disabled = true;
    try {
      const r = await postJson("/api/friends", { action: "request", username: name });
      toast(r.state === "friends" ? `You and ${name} are now friends.` : `Friend request sent to ${name}.`);
      input.value = "";
      load();
    } catch (err) { toast(err.message); }
    addBtn.disabled = false;
  });

  const face = (f) => {
    const img = h("img", { class: "fr-face", alt: "", width: 36, height: 36, src: f.head || faceSvg(f.gamertag || f.username) });
    img.onerror = () => { img.onerror = null; img.src = faceSvg(f.gamertag || f.username); };
    return img;
  };
  const person = (f, sub, ...buttons) => h("div", { class: "fr-row" },
    h("a", { class: "fr-who", href: f.gamertag ? `/player/${encodeURIComponent(f.gamertag)}` : "#" },
      h("span", { class: "fr-face-wrap" }, face(f), f.inGame ? h("span", { class: "fr-dot", title: "In game now" }) : null),
      h("span", { class: "fr-name" }, h("b", { text: f.gamertag || f.username }), h("small", { class: f.inGame ? "fr-on" : "text-3", text: sub }))),
    h("span", { class: "fr-btns" }, ...buttons));
  const btn = (text, cls, onclick, icon) => h("button", { class: `btn btn-sm ${cls}`, type: "button", onclick }, icon ? iconEl(icon) : null, text);

  async function load() {
    let d;
    try { d = await getJson("/api/friends"); } catch (e) { lists.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    const parts = [];
    if (d.incoming.length) {
      parts.push(h("section", { class: "panel fr-box" }, h("h3", { class: "fr-h", text: `Friend requests (${d.incoming.length})` }),
        ...d.incoming.map((f) => person(f, "Wants to be your friend",
          btn("Accept", "btn-primary", () => act("accept", f.id, `You and ${f.gamertag || f.username} are now friends.`)),
          btn("Decline", "btn-ghost", () => act("decline", f.id))))));
    }
    parts.push(streakSection(d));
    const online = d.friends.filter((f) => f.inGame).length;
    parts.push(h("section", { class: "panel fr-box" },
      h("h3", { class: "fr-h", text: d.friends.length ? `Your friends · ${online} in game` : "Your friends" }),
      ...(d.friends.length ? d.friends.map((f) => person(f, (f.inGame ? "In game now" : ago(f.lastSeen)) + (f.streak?.status === "active" && f.streak.length ? ` · 🔥 ${f.streak.length}` : ""),
        btn("Message", "btn-secondary", () => (openDM ? openDM(f.id) : (location.href = `/community#dm-${f.id}`)), "message"),
        btn("", "btn-ghost fr-more", () => openDialog({
          title: `Remove ${f.gamertag || f.username}?`,
          body: h("p", { text: "You'll stop seeing each other in your Friends lists." }),
          actions: [{ label: "Keep" }, { label: "Remove friend", kind: "danger", onClick: () => act("remove", f.id) }],
        }), "trash")))
        : [h("p", { class: "text-3", text: "No friends yet. Add someone above, or tap Add friend on a player's profile." })])));
    if (d.outgoing.length) {
      parts.push(h("section", { class: "panel fr-box" }, h("h3", { class: "fr-h", text: "Requests you sent" }),
        ...d.outgoing.map((f) => person(f, "Waiting for them to accept", btn("Cancel", "btn-ghost", () => act("cancel", f.id))))));
    }
    lists.replaceChildren(...parts);
    root.querySelectorAll(".fr-more").forEach((b) => b.setAttribute("aria-label", "Remove friend"));
  }
  // ---------- Friend Streaks (like Duolingo) ----------
  const NEXT = [[7, "$100, a Food Pack and a key"], [30, "$500, a Rare Pack and a key"], [100, "a Legendary Pack, keys and a badge"], [365, "2 Legendary Packs and a Galaxy key"]];
  const sAct = async (action, f, label) => {
    try {
      const r = await postJson("/api/friends/streak", { action, userId: f.id });
      toast(r.message || label || "Done.");
      load();
    } catch (e) { toast(e.message); }
  };
  function streakCard(f) {
    const st = f.streak;
    const name = f.gamertag || f.username;
    const lit = st.doneToday;
    let status, action = null;
    if (st.doneToday) status = "You both played today";
    else if (!st.meToday && !st.themToday) status = st.length ? "Play today to keep it going" : "Play on the same day to start it";
    else if (!st.meToday) status = `${name} played today. Your turn!`;
    else status = `Waiting for ${name} to play today`;
    if (st.canNudge) action = btn("Remind", "btn-secondary", () => sAct("nudge", f), "bell");
    const next = NEXT.find(([n]) => n > st.length);
    const menu = btn("", "btn-ghost fs-more", () => openDialog({
      title: `End your Friend Streak with ${name}?`,
      body: h("p", { text: `Your ${st.length}-day streak will be gone, and you can start a new one later. Your best was ${st.best} days.` }),
      actions: [{ label: "Keep it" }, { label: "End streak", kind: "danger", onClick: () => sAct("end", f) }],
    }), "trash");
    menu.setAttribute("aria-label", "End Friend Streak");
    return h("div", { class: `fs-card${lit ? " lit" : ""}${st.length && !lit && (!st.meToday || !st.themToday) ? " risk" : ""}` },
      h("div", { class: "fs-top" }, face(f), h("b", { class: "fs-name", text: name }), menu),
      h("div", { class: "fs-flame" }, iconEl("flame"), h("span", { class: "fs-num", text: String(st.length) })),
      h("div", { class: "fs-days", text: st.length === 1 ? "day" : "days" }),
      h("div", { class: "fs-today" },
        h("span", { class: `fs-tick${st.meToday ? " on" : ""}`, title: st.meToday ? "You played today" : "You haven't played today" }, "You"),
        h("span", { class: `fs-tick${st.themToday ? " on" : ""}`, title: st.themToday ? `${name} played today` : `${name} hasn't played today` }, name)),
      h("p", { class: "fs-status", text: status }),
      next ? h("p", { class: "fs-next text-3", text: `${next[0] - st.length} more day${next[0] - st.length === 1 ? "" : "s"} to ${next[0]}: ${next[1]} each` }) : null,
      action);
  }
  function inviteDialog(d) {
    const free = d.friends.filter((f) => !f.streak && f.gamertag);
    openDialog({
      title: "Start a Friend Streak",
      body: h("div", { class: "form" },
        h("p", { class: "text-2", style: "margin:0", text: "Pick a friend. Every day you both play on GalaxySMP, your streak grows. Miss a day and it starts again." }),
        free.length ? h("div", { class: "fs-pick" }, ...free.map((f) => h("button", { class: "fs-pick-row", type: "button", onclick: (e) => { e.target.closest("dialog")?.close(); sAct("invite", f); } },
          face(f), h("b", { text: f.gamertag || f.username }), h("span", { class: "text-3 small", text: "Invite" }))))
          : h("p", { class: "text-3", text: "All your friends who play already have a streak or an invite with you. Add more friends first." })),
      actions: [{ label: "Close" }],
    });
  }
  function streakSection(d) {
    const all = d.friends.filter((f) => f.streak);
    const active = all.filter((f) => f.streak.status === "active").sort((x, y) => y.streak.length - x.streak.length);
    const incoming = all.filter((f) => f.streak.status === "pending" && !f.streak.byMe);
    const outgoing = all.filter((f) => f.streak.status === "pending" && f.streak.byMe);
    const room = d.streakCount < d.maxStreaks;
    const box = h("section", { class: "panel fr-box" },
      h("div", { class: "fs-head" },
        h("h3", { class: "fr-h", style: "margin:0" }, iconEl("flame"), ` Friend Streaks · ${d.streakCount}/${d.maxStreaks}`),
        room && d.friends.length ? btn("Start one", "btn-primary", () => inviteDialog(d), "plus") : null),
      h("p", { class: "text-3 small", style: "margin:0", text: "Play on GalaxySMP on the same days as a friend to grow your streak. Rewards at 7, 30, 100 and 365 days." }));
    for (const f of incoming) {
      box.append(person(f, "Wants to start a Friend Streak with you",
        btn("Accept", "btn-primary", () => sAct("accept", f)), btn("Decline", "btn-ghost", () => sAct("decline", f))));
    }
    if (active.length) box.append(h("div", { class: "fs-grid" }, ...active.map(streakCard)));
    else if (!incoming.length && !outgoing.length) box.append(h("p", { class: "text-3", text: d.friends.length ? "No Friend Streaks yet. Tap Start one to invite a friend." : "Add a friend first, then start a Friend Streak together." }));
    for (const f of outgoing) box.append(person(f, "Friend Streak invite sent", btn("Cancel", "btn-ghost", () => sAct("cancel", f))));
    return box;
  }

  load();
  setTimer(setInterval(load, 30_000));
}
