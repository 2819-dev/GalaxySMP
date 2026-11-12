// Your profile picture in the top right of every page. Tapping it opens a small profile card with
// View full profile, Account (settings), quick links and Sign out. Signed out: a "Sign in" button.
import { icon } from "/js/site.js";
import { faceSvg } from "/js/face.js";

const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export async function renderAccountButton(slot) {
  if (!slot) return;
  let me = null;
  try { me = (await (await fetch("/api/me/header", { credentials: "same-origin" })).json()).user; } catch { /* offline */ }
  // New members finish the welcome steps first (the rules and privacy pages stay readable)
  if (me?.onboarding && !["/welcome", "/rules", "/privacy"].includes(location.pathname)) {
    location.replace("/welcome");
    return;
  }
  if (!me) {
    const a = make("a", "btn btn-ghost btn-sm acct-signin");
    a.href = "/community";
    a.innerHTML = icon("user"); // fixed icon only
    a.append(make("span", null, "Sign in"));
    slot.replaceChildren(a);
    return;
  }
  const face = (cls) => {
    const img = make("img", cls);
    img.alt = "";
    img.src = me.head || faceSvg(me.username);
    img.addEventListener("error", () => { img.src = faceSvg(me.username); }, { once: true });
    return img;
  };
  const btn = make("button", "acct-btn");
  btn.type = "button";
  btn.setAttribute("aria-label", `Your account (${me.username})`);
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  btn.append(face("acct-face"));
  if (me.inGame) {
    const dot = make("span", "acct-dot");
    dot.title = "Playing now";
    btn.append(dot);
  }
  slot.replaceChildren(btn);

  let card = null;
  const outside = (e) => { if (card && !card.contains(e.target) && !btn.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === "Escape") { close(); btn.focus(); } };
  const place = () => {
    if (!card) return;
    const r = btn.getBoundingClientRect();
    card.style.top = `${r.bottom + 8}px`;
    card.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  };
  function close() {
    card?.remove();
    card = null;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", outside, true);
    document.removeEventListener("keydown", esc);
    window.removeEventListener("resize", place);
  }

  btn.addEventListener("click", async () => {
    if (card) return close();
    card = make("div", "acct-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Your profile");

    const who = make("div", "acct-who");
    who.append(make("b", null, me.username));
    try {
      const { rankTag } = await import("/js/rank-paint.js");
      if (me.rank) who.append(rankTag(me.rank));
    } catch { /* the rank tag is optional */ }
    const bits = [me.inGame ? "Playing now" : null,
      me.money != null ? `$${Number(me.money).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : null];
    if (bits.some(Boolean)) who.append(make("span", "acct-sub", bits.filter(Boolean).join(" · ")));
    const head = make("div", "acct-card-head");
    head.append(face("acct-card-face"), who);

    const view = make("a", "btn btn-secondary btn-sm", "View full profile");
    view.href = `/player/${encodeURIComponent(me.username)}`;
    const acct = make("a", "btn btn-primary btn-sm", "Account");
    acct.href = "/account";
    const actions = make("div", "acct-actions");
    actions.append(view, acct);

    const links = make("div", "acct-links");
    const item = (href, ic, label) => {
      const a = make("a", "acct-link");
      a.href = href;
      a.innerHTML = icon(ic); // fixed icon only
      a.append(make("span", null, label));
      return a;
    };
    links.append(item("/community", "users", "Community"), item("/community#messages", "chat", "Messages"), item("/trades", "handshake", "Trades"), item("/account#notifications", "bell", "Notifications"),
      item("/account#subscription", "star", "Subscription"));
    if (me.staff) links.append(item("/staff", "tools", me.panel || "Staff Panel"));
    const out = make("button", "acct-link acct-signout");
    out.type = "button";
    out.innerHTML = icon("logout"); // fixed icon only
    out.append(make("span", null, "Sign out"));
    out.addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
      location.href = "/";
    });
    links.append(out);

    card.append(head, actions, links);
    document.body.append(card);
    place();
    btn.setAttribute("aria-expanded", "true");
    window.addEventListener("resize", place);
    setTimeout(() => { document.addEventListener("click", outside, true); document.addEventListener("keydown", esc); }, 0);
    acct.focus();
  });
}
