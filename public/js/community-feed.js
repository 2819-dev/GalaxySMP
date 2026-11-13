// #Timeline: what's happening on GalaxySMP, as feed cards (like the Muse app's feed): picture, who, what
// happened, a picture when there is one, then Like and Comments.
import { h, getJson, postJson } from "/js/dialog.js";
import { iconEl } from "/js/site.js";
import { faceSvg } from "/js/face.js";

const KIND_LABEL = { first_join: "New player", achievement: "Achievement", potw: "Player of the Week", botw: "Build of the Week", rank: "Rank-up", plan: "Supporter", contest: "Build Contest" };

function ago(d) {
  const s = Math.max(0, (Date.now() - new Date(d)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(d).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function renderTimeline(root, { toast, setTimer }) {
  const list = h("div", { class: "tl-feed" });
  const more = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Load more", hidden: true });
  root.append(h("div", { class: "cp-wrap tl-wrap" },
    h("div", { class: "tl-intro" }, h("h2", { text: "Timeline" }), h("p", { class: "text-3", text: "What's happening on GalaxySMP: new players, achievements, weekly winners and more." })),
    list, h("div", { class: "tl-more" }, more)));
  let oldest = null;
  let newest = null;

  function card(p) {
    const face = h("img", { class: "tl-face", alt: "", width: 44, height: 44, src: p.head || faceSvg(p.name), loading: "lazy" });
    face.addEventListener("error", () => { face.src = faceSvg(p.name); }, { once: true });
    const who = p.profile ? h("a", { class: "tlf-name", href: p.profile, text: p.name }) : h("b", { class: "tlf-name", text: p.name });
    const likeBtn = h("button", { class: `tl-act${p.liked ? " on" : ""}`, type: "button", "aria-pressed": String(p.liked) }, iconEl("heart"), h("span", { text: p.likes ? String(p.likes) : "Like" }));
    const comBtn = h("button", { class: "tl-act", type: "button" }, iconEl("message"), h("span", { text: p.comments ? String(p.comments) : "Comment" }));
    const comments = h("div", { class: "tl-comments", hidden: true });
    likeBtn.addEventListener("click", async () => {
      try {
        const r = await postJson(`/api/feed/${p.id}/like`, {});
        p.liked = r.liked; p.likes = r.likes;
        likeBtn.classList.toggle("on", r.liked);
        likeBtn.setAttribute("aria-pressed", String(r.liked));
        likeBtn.querySelector("span").textContent = r.likes ? String(r.likes) : "Like";
      } catch (e) { toast(e.message); }
    });
    comBtn.addEventListener("click", () => {
      comments.hidden = !comments.hidden;
      if (!comments.hidden) loadComments(p, comments, comBtn);
    });
    const actions = h("div", { class: "tl-actions" }, likeBtn, comBtn);
    if (p.canDelete) {
      actions.append(h("button", { class: "tl-act tl-del", type: "button", title: "Remove from the timeline", onclick: async () => {
        try { await postJson(`/api/feed/${p.id}/delete`, {}); art.remove(); } catch (e) { toast(e.message); }
      } }, iconEl("trash")));
    }
    const art = h("article", { class: `tl-card k-${p.kind}`, "data-id": String(p.id) },
      h("div", { class: "tl-top" }, face,
        h("div", { class: "tl-head" },
          h("div", { class: "tl-line" }, who, h("span", { class: "tl-what", text: ` ${p.title}` })),
          h("div", { class: "tl-meta" }, h("span", { class: "tl-kind" }, p.icon ? iconEl(p.icon) : null, KIND_LABEL[p.kind] || "Update"), h("span", { text: `· ${ago(p.at)}` })))),
      p.detail ? h("p", { class: "tl-detail", text: p.detail }) : null,
      p.image ? h("img", { class: "tl-image", src: p.image, alt: "", loading: "lazy" }) : null,
      actions, comments);
    return art;
  }

  async function loadComments(p, box, btn) {
    box.replaceChildren(h("p", { class: "text-3 small", text: "Loading…" }));
    let d;
    try { d = await getJson(`/api/feed/${p.id}/comments`); } catch (e) { box.replaceChildren(h("p", { class: "text-3 small", text: e.message })); return; }
    const input = h("input", { class: "input", maxlength: 300, placeholder: "Write a comment", "aria-label": "Write a comment" });
    const form = h("form", { class: "tl-cform" }, input, h("button", { class: "btn btn-primary btn-sm", type: "submit", text: "Post" }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      try {
        await postJson(`/api/feed/${p.id}/comments`, { body: input.value });
        input.value = "";
        p.comments += 1;
        btn.querySelector("span").textContent = String(p.comments);
        loadComments(p, box, btn);
      } catch (err) { toast(err.message); }
    });
    box.replaceChildren(...d.comments.map((c) => h("div", { class: "tl-comment" },
      h("b", { text: c.author }), h("span", { text: ` ${c.body}` }), h("span", { class: "tl-ctime", text: ago(c.at) }),
      c.canDelete ? h("button", { class: "tl-cdel", type: "button", title: "Remove", onclick: async () => {
        try { await postJson(`/api/feed/comments/${c.id}/delete`, {}); p.comments -= 1; btn.querySelector("span").textContent = p.comments ? String(p.comments) : "Comment"; loadComments(p, box, btn); } catch (err) { toast(err.message); }
      } }, iconEl("x")) : null)), form);
  }

  async function load(older) {
    let d;
    try { d = await getJson(`/api/feed${older && oldest ? `?before=${oldest}` : ""}`); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    if (!older) {
      if (!d.posts.length) { list.replaceChildren(h("div", { class: "panel empty", text: "Nothing here yet. New players, achievements and weekly winners show up here." })); return; }
      if (newest && d.posts[0]?.id === newest) return;  // nothing new
      list.replaceChildren(...d.posts.map(card));
    } else {
      list.append(...d.posts.map(card));
    }
    if (d.posts.length) {
      oldest = d.posts[d.posts.length - 1].id;
      if (!older) newest = d.posts[0].id;
    }
    more.hidden = !d.more;
  }
  more.addEventListener("click", () => load(true));
  load(false);
  setTimer(setInterval(() => { if (!document.hidden && !list.querySelector(".tl-comments:not([hidden])")) load(false); }, 30000));
}
