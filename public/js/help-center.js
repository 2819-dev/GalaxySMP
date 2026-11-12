// #Support: the Help Center (search answers and commands), quick "what do you need?" buttons that start a
// labeled ticket, and suggested answers while someone writes a ticket.
import { h, getJson, postJson, openDialog, field } from "/js/dialog.js";
import { iconEl } from "/js/site.js";
import { renderMarkdown } from "/js/markdown.js";

let cache = null;
export async function helpData(force) {
  if (!cache || force) cache = await getJson("/api/help-center");
  return cache;
}

const words = (t) => String(t).toLowerCase().match(/[a-z0-9]{3,}/g) || [];
const STOP = new Set(["the", "and", "how", "what", "can", "you", "for", "with", "this", "that", "are", "but", "not", "have", "was", "get", "why", "does", "when"]);

// The answers that best match some text (for search and for "maybe this helps" in the ticket form).
export function matchArticles(articles, text, max = 3) {
  const q = words(text).filter((w) => !STOP.has(w));
  if (!q.length) return [];
  return articles.map((a) => {
    const hay = `${a.question} ${a.keywords} ${a.answer}`.toLowerCase();
    const head = `${a.question} ${a.keywords}`.toLowerCase();
    const score = q.reduce((n, w) => n + (head.includes(w) ? 3 : hay.includes(w) ? 1 : 0), 0);
    return { a, score };
  }).filter((x) => x.score >= 2).sort((x, y) => y.score - x.score).slice(0, max).map((x) => x.a);
}

export const QUICK = [
  { label: "bug", title: "Report a bug", icon: "bug", hint: "Something isn't working" },
  { label: "store", title: "Store or payment", icon: "card", hint: "A purchase or plan" },
  { label: "question", title: "Lost items", icon: "bag", hint: "Items or money went missing", subject: "Lost items" },
  { label: "report", title: "Report a player", icon: "flag", hint: "Someone broke the rules" },
  { label: "appeal", title: "Appeal", icon: "scale", hint: "A ban or mute" },
  { label: "other", title: "Something else", icon: "message", hint: "Anything else" },
];

function article(a, canEdit, reload, toast) {
  const body = h("div", { class: "hc-answer" });
  body.append(renderMarkdown(a.answer));
  const d = h("details", { class: "hc-item" }, h("summary", {}, h("span", { text: a.question }), iconEl("arrow")), body);
  if (canEdit) {
    body.append(h("div", { class: "cx-row", style: "margin-top:8px" },
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Edit", onclick: () => editArticle(a, reload) }),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Delete", onclick: () => openDialog({
        title: "Delete this answer?", body: h("p", { class: "text-2", text: a.question }),
        actions: [{ label: "Cancel" }, { label: "Delete", kind: "danger", onClick: async () => { await postJson(`/api/help-center/${a.id}/delete`, {}); toast("Deleted."); reload(); } }],
      }) })));
  }
  return d;
}

function editArticle(a, reload) {
  const cat = h("input", { class: "input", id: "hc-cat", maxlength: 40, value: a?.category || "General" });
  const q = h("input", { class: "input", id: "hc-q", maxlength: 160, value: a?.question || "" });
  const ans = h("textarea", { class: "input", id: "hc-a", rows: 6, maxlength: 2000 });
  ans.value = a?.answer || "";
  const kw = h("input", { class: "input", id: "hc-k", maxlength: 300, value: a?.keywords || "", placeholder: "e.g. lost items died inventory" });
  openDialog({
    title: a ? "Edit answer" : "New answer",
    body: h("div", { class: "form" }, field("Section", cat), field("Question", q), field("Answer", ans, "**bold** works. Keep it short and friendly."),
      field("Search words", kw, "Extra words people might type, so it shows up in search and in the ticket form.")),
    actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => {
      await postJson("/api/help-center", { id: a?.id, category: cat.value, question: q.value, answer: ans.value, keywords: kw.value });
      reload();
    } }],
  });
}

// The Help Center block at the top of #Support. onAsk(quick) opens the ticket form.
export function helpCenterBlock({ toast, onAsk }) {
  const search = h("input", { class: "input hc-search", type: "search", placeholder: "Search for help, e.g. lost items, plots, money", "aria-label": "Search the Help Center" });
  const results = h("div", { class: "hc-list" });
  const quick = h("div", { class: "hc-quick" }, ...QUICK.map((qk) => h("button", { class: "hc-q", type: "button", onclick: () => onAsk(qk) },
    h("span", { class: "hc-q-ic" }, iconEl(qk.icon)), h("span", {}, h("b", { text: qk.title }), h("span", { text: qk.hint })))));
  const add = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ Add answer", hidden: true });
  const box = h("section", { class: "panel hc" },
    h("div", { class: "hc-head" }, h("span", { class: "tk-hero-icon" }, iconEl("lifebuoy")),
      h("div", {}, h("h2", { text: "Help Center" }), h("p", { class: "text-2", text: "Find a quick answer, or contact staff below. Only you and staff can see your tickets." }))),
    search, results, add,
    h("h3", { class: "hc-sub", text: "Contact staff" }), quick);
  let data = null;
  function draw() {
    const q = search.value.trim();
    const list = q ? matchArticles(data.articles, q, 8) : data.articles;
    const reload = async () => { data = await helpData(true); draw(); };
    const cmds = q ? data.commands.filter((c) => `${c.command} ${c.description}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
    const sections = new Map();
    for (const a of list) {
      if (!sections.has(a.category)) sections.set(a.category, []);
      sections.get(a.category).push(a);
    }
    results.replaceChildren(...[
      ...(q ? [h("div", { class: "hc-sec" }, ...list.map((a) => article(a, data.canEdit, reload, toast)))]
        : [...sections].map(([name, items]) => h("div", { class: "hc-sec" }, h("h3", { class: "hc-sec-name", text: name }), ...items.map((a) => article(a, data.canEdit, reload, toast))))),
      cmds.length ? h("div", { class: "hc-sec" }, h("h3", { class: "hc-sec-name", text: "Commands" }), ...cmds.map((c) => h("div", { class: "hc-cmd" }, h("code", { text: c.command }), h("span", { text: c.description })))) : null,
      !q ? h("details", { class: "hc-item" }, h("summary", {}, h("span", { text: `All commands (${data.commands.length})` }), iconEl("arrow")),
        h("div", { class: "hc-answer" }, ...data.commands.map((c) => h("div", { class: "hc-cmd" }, h("code", { text: c.command }), h("span", { text: c.description }))))) : null,
      q && !list.length && !cmds.length ? h("p", { class: "text-3", text: "No answers match that. Contact staff below and we'll help." }) : null,
    ].filter(Boolean));
    add.hidden = !data.canEdit;
    add.onclick = () => editArticle(null, reload);
  }
  search.addEventListener("input", () => data && draw());
  helpData().then((d) => { data = d; draw(); }).catch((e) => results.replaceChildren(h("p", { class: "text-3", text: e.message })));
  return box;
}
