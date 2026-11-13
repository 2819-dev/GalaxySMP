// Community channels: Events (calendar), News, Polls, Builds, and the upgraded Suggestions cards.
// All user text goes in with textContent (or the safe markdown renderer), never as HTML.
import { h, openDialog, postJson, getJson, field, select } from "/js/dialog.js";
import { iconEl } from "/js/site.js";
import { renderMarkdown } from "/js/markdown.js";

const day = (d) => new Date(d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const time = (d) => new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const shortDate = (d) => new Date(d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
function ago(d) {
  const s = Math.max(0, (Date.now() - new Date(d)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return shortDate(d);
}
function until(d) {
  const s = (new Date(d) - Date.now()) / 1000;
  if (s <= 0) return "Now";
  if (s < 3600) return `In ${Math.ceil(s / 60)} min`;
  if (s < 86400) return `In ${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  const days = Math.round(s / 86400);
  return `In ${days} day${days === 1 ? "" : "s"}`;
}
const toLocalInput = (d) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};
const intro = (text, ...extra) => h("section", { class: "panel cx-intro" }, h("p", { class: "text-2", style: "margin:0", text }), ...extra);

// =====================================================================
// Events
// =====================================================================
const EVENT_KINDS = { event: "Event", bedwars: "Bedwars", build: "Build contest", party: "Party", update: "Server update" };
const ACCESS_NAMES = { all: "Everyone", plus: "Galaxy+ and Pro+", pro: "Galaxy Pro+ only" };

export function renderEvents(p, { toast, setTimer }) {
  const upcoming = h("div", { class: "stack", style: "gap:10px" });
  const live = h("div", { class: "stack", style: "gap:10px" });
  const past = h("div", { class: "stack", style: "gap:8px" });
  const add = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "New event", hidden: true });
  p.append(h("div", { class: "cp-wrap" },
    intro("Upcoming server events. Tap Remind me to get a notification 15 minutes before it starts. The server also announces each event in game when it begins.",
      h("div", { class: "cx-row" }, add)),
    h("h2", { class: "cx-h", text: "Upcoming" }), upcoming,
    h("h2", { class: "cx-h", text: "Minigames running now" }),
    h("p", { class: "text-3 small", style: "margin:-8px 0 0" }, "Hosted by players and run by Minigame Staff. Join at a Minigame Computer or with ", h("code", { text: "/minigames" }), "."),
    live,
    h("details", { class: "cx-past" }, h("summary", { text: "Past events" }), past)));

  async function load() {
    let d;
    try { d = await getJson("/api/community/events"); } catch (e) { upcoming.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    add.hidden = !d.canManage;
    add.onclick = () => eventDialog(null, load, toast);
    upcoming.replaceChildren(...(d.upcoming.length ? d.upcoming.map((e) => eventCard(e, d.canManage, load, toast)) : [h("div", { class: "panel empty", text: "No upcoming events. Check back soon." })]));
    const now = Date.now() / 1000;
    live.replaceChildren(...(d.minigames.length ? d.minigames.map((g) => {
      const open = g.signupEnds > now;
      const left = Math.max(0, g.signupEnds - now);
      return h("article", { class: "panel ev-card" },
        h("div", { class: "ev-main" }, h("h3", { class: "sg-title", text: g.game }),
          h("p", { class: "sg-foot", style: "margin:0" }, `Hosted by ${g.host} · ${g.players} player${g.players === 1 ? "" : "s"} · ${ACCESS_NAMES[g.access] || "Everyone"}`)),
        h("span", { class: `sg-status ${open ? "planned" : "done"}`, text: open ? `Sign-ups open · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}` : "In progress" }));
    }) : [h("div", { class: "panel empty", text: "No minigames are running right now." })]));
    past.replaceChildren(...(d.past.length ? d.past.map((e) => h("div", { class: "cx-past-row" }, h("b", { text: e.title }), h("span", { class: "text-3", text: ` · ${day(e.startsAt)}` }))) : [h("p", { class: "text-3 small", text: "None yet." })]));
  }
  load();
  setTimer(setInterval(load, 30000));
}

function eventCard(e, canManage, reload, toast) {
  const start = new Date(e.startsAt);
  const happening = start <= new Date();
  const remind = h("button", { class: `btn btn-sm ${e.reminding ? "btn-secondary" : "btn-primary"}`, type: "button" }, iconEl("bell"), e.reminding ? "Reminder on" : "Remind me");
  remind.setAttribute("aria-pressed", String(e.reminding));
  remind.addEventListener("click", async () => {
    try {
      const r = await postJson(`/api/community/events/${e.id}/remind`, {});
      toast(r.reminding ? "We'll remind you 15 minutes before it starts. Make sure notifications are on in your Account." : "Reminder removed.");
      reload();
    } catch (err) { toast(err.message); }
  });
  const cal = h("a", { class: "btn btn-ghost btn-sm", href: `/api/community/events/${e.id}/calendar`, download: `galaxysmp-event-${e.id}.ics` }, iconEl("calendar"), "Add to calendar");
  const actions = h("div", { class: "ev-actions" }, happening ? h("span", { class: "sg-status done", text: "Happening now" }) : remind, happening ? null : cal);
  if (canManage) {
    actions.append(
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Edit", onclick: () => eventDialog(e, reload, toast) }),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove", onclick: () => openDialog({
        title: `Remove "${e.title}"?`, body: h("p", { class: "text-2", text: "It disappears from the calendar and nobody gets its reminder." }),
        actions: [{ label: "Cancel" }, { label: "Remove", kind: "danger", onClick: async () => { await postJson(`/api/community/events/${e.id}/delete`, {}); reload(); } }],
      }) }));
  }
  return h("article", { class: "panel ev-cal" },
    h("div", { class: "ev-date", "aria-hidden": "true" },
      h("span", { class: "ev-mon", text: start.toLocaleDateString([], { month: "short" }) }),
      h("span", { class: "ev-day", text: String(start.getDate()) })),
    h("div", { class: "ev-info" },
      h("div", { class: "ev-kind", text: EVENT_KINDS[e.kind] || "Event" }),
      h("h3", { class: "sg-title", text: e.title }),
      h("p", { class: "ev-when" }, `${day(e.startsAt)}, ${time(e.startsAt)}${e.endsAt ? ` – ${time(e.endsAt)}` : ""}`, h("span", { class: "ev-until", text: ` · ${until(e.startsAt)}` })),
      e.location ? h("p", { class: "ev-where" }, iconEl("pin"), e.location) : null,
      e.description ? h("p", { class: "sg-text", text: e.description }) : null,
      h("div", { class: "ev-foot" }, actions, e.reminders ? h("span", { class: "text-3 small", text: `${e.reminders} getting a reminder` }) : null)));
}

function eventDialog(e, done, toast) {
  const title = h("input", { class: "input", id: "ev-title", maxlength: 80, value: e?.title || "", placeholder: "e.g. Friday Bedwars Night" });
  const kind = select("ev-kind", Object.entries(EVENT_KINDS), e?.kind || "event");
  const start = h("input", { class: "input", id: "ev-start", type: "datetime-local", value: e ? toLocalInput(e.startsAt) : "" });
  const end = h("input", { class: "input", id: "ev-end", type: "datetime-local", value: e?.endsAt ? toLocalInput(e.endsAt) : "" });
  const location = h("input", { class: "input", id: "ev-where", maxlength: 80, value: e?.location || "", placeholder: "e.g. Minigame Center, or /bedwars" });
  const desc = h("textarea", { class: "input", id: "ev-desc", rows: 4, maxlength: 1000, placeholder: "What happens, prizes, who can join" });
  desc.value = e?.description || "";
  const tell = h("input", { type: "checkbox", id: "ev-tell", checked: !e });
  openDialog({
    title: e ? "Edit event" : "New event",
    body: h("div", { class: "form" }, field("Name", title), field("Type", kind),
      h("div", { class: "cx-2col" }, field("Starts", start, "In your time zone."), field("Ends (optional)", end)),
      field("Where", location), field("Details", desc),
      e ? null : h("label", { class: "check" }, tell, "Notify everyone about this new event")),
    actions: [{ label: "Cancel" }, { label: e ? "Save" : "Add event", kind: "primary", onClick: async () => {
      if (!start.value) throw new Error("Choose when the event starts.");
      await postJson("/api/community/events", { id: e?.id, title: title.value, kind: kind.value, location: location.value, description: desc.value,
        startsAt: new Date(start.value).toISOString(), endsAt: end.value ? new Date(end.value).toISOString() : null, notify: tell.checked });
      toast(e ? "Event saved." : "Event added.");
      done();
    } }],
  });
}

// =====================================================================
// News
// =====================================================================
const NEWS_TAGS = { update: "Update", fix: "Fix", news: "News", event: "Event", store: "Store", recap: "Weekly recap", release: "Release notes" };

export function renderNews(p, { toast }) {
  const list = h("div", { class: "stack", style: "gap:12px" });
  const more = h("button", { class: "btn btn-secondary", type: "button", text: "Older posts", hidden: true });
  const add = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "New update", hidden: true });
  p.append(h("div", { class: "cp-wrap" }, intro("What's new on GalaxySMP: new features, fixes and the weekly recap every Monday.", h("div", { class: "cx-row" }, add)), list, more));
  let oldest = null;
  async function load(reset) {
    if (reset) { oldest = null; list.replaceChildren(); }
    let d;
    try { d = await getJson(`/api/community/news${oldest ? `?before=${oldest}` : ""}`); } catch (e) { list.append(h("p", { class: "text-3", text: e.message })); return; }
    add.hidden = !d.canManage;
    add.onclick = () => newsDialog(null, () => load(true), toast);
    if (reset && !d.posts.length) list.append(h("div", { class: "panel empty", text: "No updates yet." }));
    for (const n of d.posts) list.append(newsCard(n, d.canManage, () => load(true), toast));
    if (d.posts.length) oldest = Math.min(...d.posts.map((n) => n.id));
    more.hidden = !d.hasMore;
  }
  more.addEventListener("click", () => load(false));
  load(true);
}

function newsCard(n, canManage, reload, toast) {
  const body = h("div", { class: "nw-body md" });
  body.append(renderMarkdown(n.body));
  const foot = h("div", { class: "sg-foot" }, h("span", { text: `${n.author} · ${shortDate(n.createdAt)}${n.editedAt ? " (edited)" : ""}` }));
  if (canManage) {
    foot.append(
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Edit", onclick: () => newsDialog(n, reload, toast) }),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Delete", onclick: () => openDialog({
        title: "Delete this post?", body: h("p", { class: "text-2", text: n.title }),
        actions: [{ label: "Cancel" }, { label: "Delete", kind: "danger", onClick: async () => { await postJson(`/api/community/news/${n.id}/delete`, {}); reload(); } }],
      }) }));
  }
  return h("article", { class: "panel nw-card" },
    h("div", { class: "nw-tags" }, h("span", { class: `nw-tag ${n.tag}`, text: NEWS_TAGS[n.tag] || "News" }), n.pinned ? h("span", { class: "nw-pin" }, iconEl("pushpin"), "Pinned") : null),
    h("h3", { class: "nw-title", text: n.title }), body, foot);
}

function newsDialog(n, done, toast) {
  const title = h("input", { class: "input", id: "nw-title", maxlength: 100, value: n?.title || "", placeholder: "e.g. Bedwars is here!" });
  const tag = select("nw-tag", Object.entries(NEWS_TAGS), n?.tag || "update");
  const body = h("textarea", { class: "input", id: "nw-body", rows: 8, maxlength: 4000, placeholder: "Write the post. **bold**, *italic*, lists with - and links work." });
  body.value = n?.body || "";
  const pinned = h("input", { type: "checkbox", id: "nw-pin", checked: Boolean(n?.pinned) });
  const tell = h("input", { type: "checkbox", id: "nw-notify", checked: !n });
  const game = h("input", { type: "checkbox", id: "nw-game", checked: !n });
  openDialog({
    title: n ? "Edit update" : "New update",
    body: h("div", { class: "form" }, field("Title", title), field("Label", tag), field("Post", body),
      h("label", { class: "check" }, pinned, "Pin to the top"),
      n ? null : h("label", { class: "check" }, tell, "Send a notification to everyone"),
      n ? null : h("label", { class: "check" }, game, "Announce it in game too")),
    actions: [{ label: "Cancel" }, { label: n ? "Save" : "Post", kind: "primary", onClick: async () => {
      await postJson("/api/community/news", { id: n?.id, title: title.value, tag: tag.value, body: body.value, pinned: pinned.checked, notify: tell.checked, inGame: game.checked });
      toast(n ? "Post saved." : "Posted.");
      done();
    } }],
  });
}

// =====================================================================
// Polls
// =====================================================================
export function renderPolls(p, { toast, setTimer }) {
  const list = h("div", { class: "stack", style: "gap:12px" });
  const add = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "New poll", hidden: true });
  p.append(h("div", { class: "cp-wrap" }, intro("Vote on what happens next on GalaxySMP. You can change your vote until the poll closes.", h("div", { class: "cx-row" }, add)), list));
  async function load() {
    let d;
    try { d = await getJson("/api/community/polls"); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    add.hidden = !d.canManage;
    add.onclick = () => pollDialog(load, toast);
    list.replaceChildren(...(d.polls.length ? d.polls.map((pl) => pollCard(pl, d.canManage, load, toast)) : [h("div", { class: "panel empty", text: "No polls yet." })]));
  }
  load();
  setTimer(setInterval(load, 30000));
}

export function pollCard(pl, canManage, reload, toast, { chat = false } = {}) {
  const voted = pl.options.some((o) => o.mine);
  const showResults = voted || pl.closed;
  const total = pl.options.reduce((n, o) => n + o.votes, 0);
  const top = Math.max(0, ...pl.options.map((o) => o.votes));
  const chosen = new Set(pl.options.filter((o) => o.mine).map((o) => o.id));
  const opts = h("div", { class: "pl-opts", role: pl.multi ? "group" : "radiogroup", "aria-label": pl.question });
  const vote = async () => {
    try { await postJson(`/api/community/polls/${pl.id}/vote`, { optionIds: [...chosen] }); reload(); } catch (e) { toast(e.message); }
  };
  for (const o of pl.options) {
    const pct = total ? Math.round((o.votes / total) * 100) : 0;
    const b = h("button", { type: "button", class: `pl-opt${o.mine ? " mine" : ""}${showResults && o.votes === top && top > 0 ? " lead" : ""}`, disabled: pl.closed,
      role: pl.multi ? "checkbox" : "radio", "aria-checked": String(o.mine) });
    const bar = h("span", { class: "pl-bar" });
    if (showResults) bar.style.width = `${pct}%`;
    b.append(bar, h("span", { class: "pl-mark", "aria-hidden": "true", text: o.mine ? "✓" : "" }), h("span", { class: "pl-label", text: o.label }),
      ...(showResults ? [h("span", { class: "pl-pct", text: `${pct}%` })] : []));
    b.addEventListener("click", () => {
      if (pl.multi) chosen.has(o.id) ? chosen.delete(o.id) : chosen.add(o.id);
      else { if (chosen.has(o.id)) chosen.clear(); else { chosen.clear(); chosen.add(o.id); } }
      vote();
    });
    opts.append(b);
  }
  const status = pl.closed ? "Closed" : pl.closesAt ? `Closes ${day(pl.closesAt)}, ${time(pl.closesAt)}` : "Open";
  const foot = h("div", { class: "sg-foot" }, h("span", { class: `sg-status ${pl.closed ? "done" : "planned"}`, text: pl.closed ? "Closed" : "Open" }),
    h("span", { text: `${pl.voters} vote${pl.voters === 1 ? "" : "s"} · ${pl.multi ? "Choose any" : "Choose one"} · ${pl.closed ? `by ${pl.author}` : status}` }));
  if (chat && pl.canClose) {
    foot.append(h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Close poll", onclick: async () => { try { await postJson(`/api/community/polls/${pl.id}/close`, {}); reload(); } catch (e) { toast(e.message); } } }));
  } else if (canManage && !chat) {
    if (!pl.closed) foot.append(h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Close poll", onclick: async () => { await postJson(`/api/community/polls/${pl.id}/close`, {}); reload(); } }));
    foot.append(h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Delete", onclick: () => openDialog({
      title: "Delete this poll?", body: h("p", { class: "text-2", text: pl.question }),
      actions: [{ label: "Cancel" }, { label: "Delete", kind: "danger", onClick: async () => { await postJson(`/api/community/polls/${pl.id}/delete`, {}); reload(); } }],
    }) }));
  }
  return h("article", { class: `panel pl-card${chat ? " in-chat" : ""}` }, h("h3", { class: "sg-title", text: pl.question }),
    !showResults ? h("p", { class: "text-3 small", style: "margin:0 0 8px", text: "Vote to see the results." }) : null, opts, foot);
}

export function pollDialog(done, toast, { channelId = null, channelName = "" } = {}) {
  const q = h("input", { class: "input", id: "pl-q", maxlength: 140, placeholder: "e.g. What should the next event be?" });
  const box = h("div", { class: "stack", style: "gap:6px" });
  const addRow = (v = "") => {
    if (box.children.length >= 8) return;
    const inp = h("input", { class: "input", maxlength: 80, value: v, placeholder: `Answer ${box.children.length + 1}`, "aria-label": `Answer ${box.children.length + 1}` });
    box.append(inp);
  };
  addRow(); addRow();
  const more = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ Add answer", onclick: () => addRow() });
  const multi = h("input", { type: "checkbox", id: "pl-multi" });
  const length = select("pl-len", [["24", "1 day"], ["72", "3 days"], ["168", "1 week"], ["0", "Until I close it"]], "72");
  const tell = h("input", { type: "checkbox", id: "pl-notify", checked: true });
  openDialog({
    title: "New poll",
    body: h("div", { class: "form" }, field("Question", q),
      h("div", { class: "field" }, h("span", { class: "field-label", text: "Answers (2 to 8)" }), box, more),
      h("label", { class: "check" }, multi, "Let people choose more than one"),
      field("Runs for", length), channelId ? h("p", { class: "text-3 small", style: "margin:0", text: `It's posted as a message in #${channelName}.` }) : h("label", { class: "check" }, tell, "Notify everyone")),
    actions: [{ label: "Cancel" }, { label: "Post poll", kind: "primary", onClick: async () => {
      const data = { question: q.value, options: [...box.children].map((i) => i.value), multi: multi.checked, hours: Number(length.value), notify: tell.checked };
      await postJson(channelId ? "/api/chat/polls" : "/api/community/polls", channelId ? { ...data, channelId } : data);
      toast("Poll posted.");
      done();
    } }],
  });
}

// =====================================================================
// Builds
// =====================================================================
export function renderBuilds(p, { toast }) {
  let sort = "new";
  const grid = h("div", { class: "bd-grid" });
  const tabs = h("div", { class: "tabs-mini" });
  const add = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Share a build" });
  const botw = h("div");
  p.append(h("div", { class: "cp-wrap bd-wrap" },
    intro("Show off what you built. Like your favorites: the most liked build each week becomes Build of the Week and its builder gets a badge.",
      h("div", { class: "cx-row", style: "justify-content:space-between" }, tabs, add)),
    botw, grid));
  for (const [key, label] of [["new", "New"], ["week", "This week"], ["top", "Top"]]) {
    const b = h("button", { type: "button", "aria-pressed": String(key === sort), text: label });
    b.addEventListener("click", () => { sort = key; tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); load(); });
    tabs.append(b);
  }
  add.addEventListener("click", () => buildDialog(load, toast));
  async function load() {
    let d;
    try { d = await getJson(`/api/community/builds?sort=${sort}`); } catch (e) { grid.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    const winner = d.builds.find((b) => b.id === d.botwId);
    botw.replaceChildren(...(winner && sort === "new" ? [h("div", { class: "bd-botw-label" }, iconEl("trophy2"), "Build of the Week"), buildCard(winner, d, load, toast, true)] : []));
    const rest = d.builds.filter((b) => !(winner && sort === "new" && b.id === winner.id));
    grid.replaceChildren(...(rest.length ? rest.map((b) => buildCard(b, d, load, toast)) : [h("div", { class: "panel empty", text: sort === "week" ? "No builds posted this week yet." : "No builds yet. Share the first one." })]));
  }
  load();
}

const imgUrl = (i) => `/api/community/builds/image/${i.id}`;

function buildCard(b, d, reload, toast, big) {
  const cover = b.images[0];
  const img = h("img", { class: "bd-cover", src: imgUrl(cover), alt: `${b.title} by ${b.author}`, loading: "lazy", width: cover.w, height: cover.h });
  const open = h("button", { class: "bd-open", type: "button", "aria-label": `Open ${b.title}` }, img,
    b.images.length > 1 ? h("span", { class: "bd-count", text: `1/${b.images.length}` }) : null,
    b.botwWeek ? h("span", { class: "bd-badge" }, iconEl("trophy2"), "Build of the Week") : null);
  open.addEventListener("click", () => viewer(b, 0));
  const like = h("button", { class: `bd-like${b.liked ? " on" : ""}`, type: "button", "aria-pressed": String(b.liked), "aria-label": `Like (${b.likes})` }, iconEl("heart"), String(b.likes));
  like.addEventListener("click", async () => {
    try { await postJson(`/api/community/builds/${b.id}/like`, {}); reload(); } catch (e) { toast(e.message); }
  });
  const foot = h("div", { class: "bd-foot" }, like);
  if (b.mine || d.canModerate) {
    foot.append(h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Delete", onclick: () => openDialog({
      title: "Delete this build?", body: h("p", { class: "text-2", text: b.title }),
      actions: [{ label: "Cancel" }, { label: "Delete", kind: "danger", onClick: async () => { await postJson(`/api/community/builds/${b.id}/delete`, {}); reload(); } }],
    }) }));
  }
  return h("article", { class: `panel bd-card${big ? " big" : ""}` }, open,
    h("div", { class: "bd-info" },
      h("h3", { class: "sg-title", text: b.title }),
      h("p", { class: "bd-meta", text: `${b.author} · ${ago(b.createdAt)}${b.location ? ` · ${b.location}` : ""}` }),
      b.description ? h("p", { class: "bd-desc", text: b.description }) : null, foot));
}

function viewer(b, start) {
  let i = start;
  const img = h("img", { class: "bd-view-img", alt: "" });
  const count = h("span", { class: "text-3 small" });
  const show = () => {
    const cur = b.images[i];
    img.src = imgUrl(cur); img.width = cur.w; img.height = cur.h;
    img.alt = `${b.title}, photo ${i + 1} of ${b.images.length}`;
    count.textContent = b.images.length > 1 ? `Photo ${i + 1} of ${b.images.length}` : "";
  };
  const prev = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "← Previous", onclick: () => { i = (i - 1 + b.images.length) % b.images.length; show(); } });
  const next = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Next →", onclick: () => { i = (i + 1) % b.images.length; show(); } });
  show();
  openDialog({
    title: b.title,
    body: h("div", { class: "bd-view" }, img,
      b.images.length > 1 ? h("div", { class: "cx-row", style: "justify-content:space-between" }, prev, count, next) : null,
      h("p", { class: "bd-meta", text: `${b.author}${b.location ? ` · ${b.location}` : ""}` }),
      b.description ? h("p", { class: "bd-desc", text: b.description }) : null),
    actions: [{ label: "Close" }],
  });
}

// Shrinks a photo in the browser before sending it (max 1600 px, WebP or JPEG).
// opts.aspect (width / height) crops the middle to that shape, e.g. 1 for a profile picture, 3 for a banner.
export async function shrink(file, { max = 1600, aspect = null, limit = 680 * 1024 } = {}) {
  if (!/^image\//.test(file.type)) throw new Error(`${file.name} isn't a photo.`);
  const bmp = await createImageBitmap(file).catch(() => { throw new Error(`${file.name} couldn't be opened.`); });
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (aspect) {
    if (sw / sh > aspect) { const nw = Math.round(sh * aspect); sx = Math.round((sw - nw) / 2); sw = nw; }
    else { const nh = Math.round(sw / aspect); sy = Math.round((sh - nh) / 2); sh = nh; }
  }
  const scale = Math.min(1, max / Math.max(sw, sh));
  const w = Math.round(sw * scale), hgt = Math.round(sh * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = hgt;
  c.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, w, hgt);
  let blob = null;
  for (const [type, q] of [["image/webp", 0.82], ["image/jpeg", 0.82], ["image/jpeg", 0.65], ["image/jpeg", 0.5]]) {
    blob = await new Promise((r) => c.toBlob(r, type, q));
    if (blob && blob.type === type && blob.size < limit) break;
  }
  if (!blob || blob.size >= limit) throw new Error(`${file.name} is too large.`);
  const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
  return { mime: blob.type, data, width: w, height: hgt, preview: URL.createObjectURL(blob) };
}

function buildDialog(done, toast) {
  const photos = [];
  const title = h("input", { class: "input", id: "bd-title", maxlength: 60, placeholder: "e.g. Cherry blossom castle" });
  const desc = h("textarea", { class: "input", id: "bd-desc", rows: 3, maxlength: 500, placeholder: "What is it, how long it took (optional)" });
  const where = h("input", { class: "input", id: "bd-where", maxlength: 60, placeholder: "e.g. My plot near spawn, or 120 64 -40 (optional)" });
  const pick = h("input", { type: "file", accept: "image/*", multiple: true, id: "bd-files", class: "sr-only" });
  const thumbs = h("div", { class: "bd-thumbs" });
  const status = h("p", { class: "text-3 small", style: "margin:0" });
  const drawThumbs = () => {
    thumbs.replaceChildren(...photos.map((ph, i) => h("div", { class: "bd-thumb" }, h("img", { src: ph.preview, alt: `Photo ${i + 1}` }),
      h("button", { type: "button", "aria-label": `Remove photo ${i + 1}`, text: "×", onclick: () => { photos.splice(i, 1); drawThumbs(); } }))),
    ...(photos.length < 4 ? [h("label", { class: "bd-add", for: "bd-files" }, iconEl("cube"), photos.length ? "Add more" : "Add photos")] : []));
  };
  pick.addEventListener("change", async () => {
    const files = [...pick.files].slice(0, 4 - photos.length);
    pick.value = "";
    status.textContent = "Preparing photos…";
    for (const f of files) {
      try { photos.push(await shrink(f)); } catch (e) { toast(e.message); }
    }
    status.textContent = "";
    drawThumbs();
  });
  drawThumbs();
  openDialog({
    title: "Share a build",
    body: h("div", { class: "form" },
      h("div", { class: "field" }, h("span", { class: "field-label", text: "Photos (up to 4)" }), thumbs, pick, status,
        h("p", { class: "hint", text: "Screenshots from Minecraft work best. The first photo is the cover." })),
      field("Name", title), field("Description", desc), field("Where is it?", where)),
    actions: [{ label: "Cancel" }, { label: "Post build", kind: "primary", onClick: async () => {
      if (!photos.length) throw new Error("Add at least one photo.");
      await postJson("/api/community/builds", { title: title.value, description: desc.value, location: where.value,
        images: photos.map(({ mime, data, width, height }) => ({ mime, data, width, height })) });
      toast("Build shared.");
      done();
    } }],
  });
}

// =====================================================================
// Suggestions: card with staff response and comments; new-suggestion dialog with similar check
// =====================================================================
const STATUS_NAMES = { open: "Open", planned: "Planned", done: "Done", declined: "Declined" };

export function suggestionCard(s, canModerate, reload, toast) {
  const vote = async (value) => {
    try { await postJson(`/api/community/suggestions/${s.id}/vote`, { value: s.myVote === value ? 0 : value }); reload(); } catch (e) { toast(e.message); }
  };
  const up = h("button", { class: "sg-vote up", type: "button", "aria-pressed": String(s.myVote === 1), "aria-label": `Like (${s.likes})`, onclick: () => vote(1) }, iconEl("thumbsUp"), String(s.likes));
  const down = h("button", { class: "sg-vote down", type: "button", "aria-pressed": String(s.myVote === -1), "aria-label": `Dislike (${s.dislikes})`, onclick: () => vote(-1) }, iconEl("thumbsDown"), String(s.dislikes));
  let who;
  if (!s.anonymous) who = s.author;
  else if (s.author) who = `Anonymous (${s.mine ? "you" : s.author}, only ${s.mine ? "you and the owners" : "owners"} can see this)`;
  else who = "Anonymous";
  const comments = h("div", { class: "sg-comments", hidden: true });
  const toggle = h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-expanded": "false" }, iconEl("message"), s.comments ? `${s.comments} comment${s.comments === 1 ? "" : "s"}` : "Comment");
  toggle.addEventListener("click", () => {
    const opening = comments.hidden;
    comments.hidden = !opening;
    toggle.setAttribute("aria-expanded", String(opening));
    if (opening) loadComments(s, comments, toast, (n) => { toggle.lastChild.textContent = n ? `${n} comment${n === 1 ? "" : "s"}` : "Comment"; });
  });
  const foot = h("div", { class: "sg-foot" },
    h("span", { class: `sg-status ${s.status}`, text: STATUS_NAMES[s.status] }),
    h("span", { text: `${who} · ${new Date(s.createdAt).toLocaleDateString()}` }), toggle);
  if (canModerate) foot.append(h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Respond", onclick: () => respondDialog(s, reload, toast) }));
  if (canModerate || s.mine) {
    foot.append(h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Delete", onclick: () => openDialog({
      title: "Delete this suggestion?", body: h("p", { class: "text-2", text: s.title }),
      actions: [{ label: "Cancel" }, { label: "Delete", kind: "danger", onClick: async () => { await postJson(`/api/community/suggestions/${s.id}/delete`, {}); reload(); } }],
    }) }));
  }
  const reply = s.staffReply ? h("div", { class: `sg-reply ${s.status}` },
    h("div", { class: "sg-reply-head" }, iconEl("shield"), `Staff response from ${s.staffReply.by}`),
    h("p", { text: s.staffReply.text })) : null;
  return h("article", { class: "panel sg-card", id: `sg-${s.id}` },
    h("div", { class: "sg-votes" }, up, down),
    h("div", { class: "sg-body" }, h("h3", { class: "sg-title", text: s.title }), s.body ? h("p", { class: "sg-text", text: s.body }) : null, reply, foot, comments));
}

async function loadComments(s, box, toast, setCount) {
  box.replaceChildren(h("p", { class: "text-3 small", text: "Loading…" }));
  let d;
  try { d = await getJson(`/api/community/suggestions/${s.id}/comments`); } catch (e) { box.replaceChildren(h("p", { class: "text-3 small", text: e.message })); return; }
  setCount(d.comments.length);
  const input = h("textarea", { class: "input", rows: 2, maxlength: 500, placeholder: "Add a comment", "aria-label": "Add a comment" });
  const send = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Comment" });
  send.addEventListener("click", async () => {
    if (!input.value.trim()) return;
    send.disabled = true;
    try { await postJson(`/api/community/suggestions/${s.id}/comments`, { body: input.value }); loadComments(s, box, toast, setCount); }
    catch (e) { toast(e.message); send.disabled = false; }
  });
  box.replaceChildren(
    ...d.comments.map((c) => h("div", { class: "sg-comment" },
      h("div", { class: "sg-comment-head" }, h("b", { text: c.author }), h("span", { class: "text-3", text: ` · ${ago(c.createdAt)}` }),
        c.mine || d.canModerate ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Delete", onclick: async () => {
          try { await postJson(`/api/community/suggestion-comments/${c.id}/delete`, {}); loadComments(s, box, toast, setCount); } catch (e) { toast(e.message); }
        } }) : null),
      h("p", { text: c.body }))),
    h("div", { class: "sg-comment-new" }, input, send));
}

function respondDialog(s, done, toast) {
  const status = select("sg-status", Object.entries(STATUS_NAMES), s.status);
  const reply = h("textarea", { class: "input", id: "sg-reply", rows: 3, maxlength: 500, placeholder: "e.g. Great idea! We're adding this next week." });
  reply.value = s.staffReply?.text || "";
  openDialog({
    title: "Respond to suggestion",
    body: h("div", { class: "form" }, h("p", { class: "text-2", style: "margin:0", text: s.title }), field("Status", status),
      field("Response (optional)", reply, "Shown on the suggestion. The person who posted it gets a notification.")),
    actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => {
      await postJson(`/api/community/suggestions/${s.id}/respond`, { status: status.value, reply: reply.value });
      toast("Response saved.");
      done();
    } }],
  });
}

export function newSuggestion(done, toast) {
  const title = h("input", { class: "input", id: "sg-title", maxlength: 80, placeholder: "e.g. Add a fishing contest" });
  const similar = h("div", { class: "sg-similar", hidden: true });
  const body = h("textarea", { class: "input", id: "sg-body", maxlength: 500, rows: 4, placeholder: "Details (optional)" });
  const anon = h("input", { type: "checkbox", id: "sg-anon" });
  let t = null;
  title.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = title.value.trim();
      if (q.length < 4) { similar.hidden = true; return; }
      const d = await getJson(`/api/community/suggestions/similar?q=${encodeURIComponent(q)}`).catch(() => ({ similar: [] }));
      similar.hidden = !d.similar.length;
      similar.replaceChildren(h("p", { class: "sg-similar-head", text: "Similar ideas already posted. Vote on one of these instead?" }),
        ...d.similar.map((x) => h("a", { class: "sg-similar-row", href: `#sg-${x.id}`, onclick: (e) => {
          e.preventDefault();
          document.querySelector("dialog.dialog")?.close();
          document.querySelector("dialog.dialog")?.remove();
          const el = document.getElementById(`sg-${x.id}`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          el?.classList.add("flash");
          setTimeout(() => el?.classList.remove("flash"), 1600);
        } }, h("span", { class: `sg-status ${x.status}`, text: STATUS_NAMES[x.status] }), h("span", { text: x.title }), h("span", { class: "text-3 small", text: `${x.likes} like${x.likes === 1 ? "" : "s"}` }))));
    }, 350);
  });
  openDialog({
    title: "New suggestion",
    body: h("div", { class: "form" },
      field("Title", title), similar,
      field("Details", body),
      h("label", { class: "check" }, anon, "Post anonymously ", h("span", { class: "text-3 small", text: "(other players won't see your name; only the server owners can)" }))),
    actions: [{ label: "Cancel" }, {
      label: "Post", kind: "primary",
      onClick: async () => {
        await postJson("/api/community/suggestions", { title: title.value, body: body.value, anonymous: anon.checked });
        toast("Suggestion submitted.");
        done();
      },
    }],
  });
}
