// Account (settings): profile, notifications, subscription, purchases & payments, security, privacy.
import { toast, iconEl, isInstalled } from "/js/site.js";
import { faceSvg } from "/js/face.js";
import { moneyDollars } from "/js/money.js";
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { rankTag } from "/js/rank-paint.js";
import { enableNotifications, disableNotifications, pushSupported } from "/js/notify.js";

const $ = (id) => document.getElementById(id);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : "–");
const money = (n) => (n == null ? "–" : moneyDollars(n));
const usd = (n) => `$${Number(n).toFixed(2)}`;
let data = null;

const card = (title, desc, ...body) => h("section", { class: "panel acc-card" },
  h("div", { class: "acc-card-head" }, h("h2", { text: title }), desc ? h("p", { class: "text-3 small", text: desc }) : null), ...body);
const row = (label, value) => h("div", { class: "acc-row" }, h("span", { class: "acc-row-label", text: label }), value instanceof Node ? value : h("span", { text: String(value) }));

// ---------- sections ----------
const SECTIONS = {
  profile() {
    const p = data.profile;
    const face = h("img", { class: "acc-face", alt: "", width: 72, height: 72 });
    face.src = p.head || faceSvg(p.username);
    face.addEventListener("error", () => { face.src = faceSvg(p.username); }, { once: true });
    return [
      h("section", { class: "panel acc-hero" }, face,
        h("div", { class: "acc-hero-main" },
          h("h2", { text: p.username }),
          h("div", { class: "acc-hero-tags" }, p.rank ? rankTag(p.rank) : h("span", { class: "text-3 small", text: "No rank" }),
            p.inGame ? h("span", { class: "acc-badge ok", text: "Playing now" }) : null),
          h("div", { class: "acc-hero-actions" },
            h("a", { class: "btn btn-secondary btn-sm", href: `/player/${encodeURIComponent(p.username)}`, text: "View full profile" }),
            h("a", { class: "btn btn-ghost btn-sm", href: "/community", text: "Open community" })))),
      card("Details", null,
        row("Minecraft name", p.gamertag || p.username),
        row("Edition", p.platform === "bedrock" ? "Bedrock" : "Java"),
        row("Member since", fmtDate(p.joined)),
        row("Money", money(p.money)),
        row("Time played", `${p.playtimeH} hours`),
        row("Daily streak", `${p.streak} day${p.streak === 1 ? "" : "s"}`),
        row("Last in game", p.inGame ? "Now" : fmtDate(p.lastSeen)),
        p.mutedUntil ? row("Chat", `Muted until ${new Date(p.mutedUntil).toLocaleString()}`) : null),
      h("p", { class: "text-3 small", text: "Your profile picture is your Minecraft head (or your Xbox picture until your head arrives). Your name and rank come from the game." }),
    ];
  },

  async notifications() {
    const s = await getJson("/api/notify");
    const sub = pushSupported() ? await navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).catch(() => null) : null;
    let on = Boolean(sub) && Notification.permission === "granted";
    const status = h("p", { class: "text-2", style: "margin:0" });
    const toggle = h("button", { class: "btn btn-sm", type: "button" });
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const paint = () => {
      status.textContent = on ? "Notifications are on for this device."
        : !pushSupported() && ios && !isInstalled() ? "On iPhone and iPad, add GalaxySMP to your Home Screen first, then turn notifications on in the app."
        : !pushSupported() ? "This browser can't show notifications." : "Notifications are off on this device.";
      toggle.textContent = on ? "Turn off on this device" : "Turn on for this device";
      toggle.className = `btn btn-sm ${on ? "btn-secondary" : "btn-primary"}`;
    };
    paint();
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      try {
        if (on) { await disableNotifications(); on = false; toast("Notifications turned off on this device."); }
        else { on = await enableNotifications(); if (on) postJson("/api/notify/test", {}).catch(() => {}); }
      } catch (e) { toast(e.message); }
      paint();
      toggle.disabled = false;
    });
    const prefs = { ...s.prefs };
    const save = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Save preferences", disabled: true });
    const switches = Object.entries(s.kinds).map(([k, v]) => {
      const box = h("input", { type: "checkbox", class: "acc-switch", checked: prefs[k], "aria-label": v.name });
      box.addEventListener("change", () => { prefs[k] = box.checked; save.disabled = false; });
      return h("label", { class: "np-row" }, h("span", { class: "np-text" }, h("b", { text: v.name }), h("span", { class: "text-3 small", text: v.hint })), box);
    });
    save.addEventListener("click", async () => {
      save.disabled = true;
      try { await postJson("/api/notify/prefs", { prefs }); toast("Notification preferences saved."); } catch (e) { toast(e.message); save.disabled = false; }
    });
    return [
      card("This device", s.devices ? `${s.devices} device${s.devices === 1 ? "" : "s"} with notifications on.` : null,
        h("div", { class: "np-device" }, iconEl("bell"), h("div", { class: "np-device-text" }, status), toggle)),
      card("Notification preferences", "What you're notified about, on every device.", h("div", { class: "np-list" }, switches), h("div", { class: "acc-card-foot" }, save)),
    ];
  },

  subscription() {
    const s = data.subscription;
    const paid = s.plan !== "free";
    return [
      h("section", { class: `panel acc-plan plan-${s.plan}` },
        h("div", {}, h("span", { class: "eyebrow", text: "Current plan" }), h("h2", { text: s.name }),
          h("p", { class: "text-2 small", style: "margin:4px 0 0", text: paid ? (s.expires ? `Active until ${fmtDate(s.expires)}` : "Active (no end date)") + ` · ${usd(s.price)}/month + ${moneyDollars(s.gameCost)} in-game` : "Free forever. Upgrade any time for more plots, homes and cosmetics." })),
        h("a", { class: `btn ${paid ? "btn-secondary" : "btn-primary"}`, href: "/store#subscriptions", text: paid ? "Change plan" : "See plans" })),
      card("What your plan includes", null, h("ul", { class: "plan-perks", style: "margin:0" }, s.perks.map((p) => h("li", { text: p })))),
      card("Extras you own", null,
        row("Extra plots", String(s.extraPlots)),
        row("Extra shop plots", String(s.extraShopPlots)),
        row("Cosmetics", s.cosmetics.length ? s.cosmetics.join(", ") : "None yet"),
        row("Night Vision", s.nightVisionUntil ? `Until ${new Date(s.nightVisionUntil).toLocaleString()}` : "Off"),
        h("div", { class: "acc-card-foot" }, h("a", { class: "btn btn-secondary btn-sm", href: "/store#shop", text: "Browse the Shop" }),
          h("span", { class: "text-3 small", text: "Pick cosmetics in game with /cosmetics." }))),
    ];
  },

  purchases() {
    const list = data.orders.length
      ? h("div", { class: "acc-table" }, data.orders.map((o) => h("div", { class: "acc-order" },
        h("div", {}, h("b", { text: o.item }), o.option ? h("span", { class: "text-3 small", text: ` · ${o.option}` }) : null),
        h("span", { class: "text-3 small", text: o.source === "payment" ? `${usd(o.price)} by card` : o.source === "credits" ? `${usd(o.price)} in credits` : o.source === "promo" ? "Free with a promo code" : "Gift from staff" }),
        h("time", { class: "text-3 small", text: fmtDate(o.at) }))))
      : h("p", { class: "text-3", style: "margin:0", text: "No purchases yet." });
    return [
      card("Galaxy Credits", "Your Store balance. Top up once, then buy things in one tap.",
        h("div", { class: "acc-credits" },
          h("div", {}, h("span", { class: "text-3 small", text: "Balance" }), h("b", { class: "acc-credits-amount", text: usd(data.credits?.balance || 0) })),
          h("a", { class: "btn btn-primary btn-sm", href: "/store#credits", text: "Top up" })),
        data.credits?.history?.length
          ? h("div", { class: "acc-table", style: "margin-top:12px" }, data.credits.history.map((c) => h("div", { class: "acc-order" },
            h("div", {}, h("b", { text: ({ topup: "Top-up", purchase: "Bought", gift_in: "Gift received", gift_out: "Gift sent", refund: "Refund", staff: "From staff" })[c.reason] || c.reason }), c.detail ? h("span", { class: "text-3 small", text: ` · ${c.detail}` }) : null),
            h("span", { class: `small ${c.amount >= 0 ? "acc-plus" : "text-3"}`, text: `${c.amount >= 0 ? "+" : "-"}${usd(Math.abs(c.amount))}` }),
            h("time", { class: "text-3 small", text: fmtDate(c.at) }))))
          : h("p", { class: "text-3", style: "margin:12px 0 0", text: "No credit activity yet." }),
        h("p", { class: "text-3 small", style: "margin:12px 0 0", text: "Card payments are handled by Stripe on its own secure page; we never see your card. Need a refund? Open a support ticket." })),
      card("Purchase history", "Everything you've bought or been given from the Store.", list),
    ];
  },

  security() {
    const cur = h("input", { class: "input", id: "pw-current", type: "password", autocomplete: "current-password" });
    const next = h("input", { class: "input", id: "pw-new", type: "password", autocomplete: "new-password", minlength: 8 });
    const again = h("input", { class: "input", id: "pw-again", type: "password", autocomplete: "new-password" });
    const err = h("p", { class: "form-error", role: "alert" });
    const btn = h("button", { class: "btn btn-primary", type: "submit", text: "Change password" });
    const form = h("form", { class: "form", style: "max-width:420px" },
      field("Current password", cur), field("New password", next, "At least 8 characters, and not your username."), field("New password again", again), err, btn);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      if (next.value !== again.value) { err.textContent = "The new passwords don't match."; return; }
      btn.disabled = true;
      try {
        await postJson("/api/account/password", { current: cur.value, next: next.value });
        form.reset();
        toast("Password changed. Other devices were signed out.");
      } catch (e2) { err.textContent = e2.message; }
      btn.disabled = false;
    });
    const others = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Sign out of other devices", onclick: async () => {
      try { const r = await postJson("/api/account/signout-others", {}); toast(r.signedOut ? `Signed out of ${r.signedOut} other device${r.signedOut === 1 ? "" : "s"}.` : "You're not signed in anywhere else."); load("security"); }
      catch (e) { toast(e.message); }
    } });
    return [
      card("Password", "Use it to sign in on galaxymc.us. Forgot it? Make a new account code in game with /link to set a new one.", form),
      card("Signed-in devices", `You're signed in on ${data.sessions} device${data.sessions === 1 ? "" : "s"} (including this one).`, h("div", { class: "acc-card-foot" }, others)),
    ];
  },

  privacy() {
    const blocked = data.blocked.length
      ? h("div", { class: "acc-table" }, data.blocked.map((b) => h("div", { class: "acc-order" }, h("b", { text: b.username }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Unblock", onclick: async () => {
          await postJson(`/api/dm/block/${b.id}`, { blocked: false }).catch((e) => toast(e.message));
          toast(`Unblocked ${b.username}.`);
          load("privacy");
        } }))))
      : h("p", { class: "text-3", style: "margin:0", text: "You haven't blocked anyone. Block someone from your conversation with them in Direct Messages." });
    const realName = data.realName ? (() => {
      const box = h("input", { type: "checkbox", id: "acc-rn-hide" });
      box.checked = data.realNameHidden;
      const status = h("p", { class: "text-3 small", style: "margin:8px 0 0" });
      const say = () => { status.textContent = box.checked ? "Only you and staff can see your real name." : "Everyone in the community can see your real name on your profile."; };
      say();
      box.addEventListener("change", async () => {
        try {
          await postJson("/api/account/real-name", { hidden: box.checked });
          data.realNameHidden = box.checked;
          say();
          toast(box.checked ? "Your real name is hidden." : "Your real name is shown.");
        } catch (e) { box.checked = !box.checked; toast(e.message); }
      });
      return card("Real name", null,
        h("p", { class: "text-2", style: "margin:0 0 10px" }, "Your real name: ", h("b", { text: data.realName }), ". It shows on your profile card next to your username. To change it, ask staff."),
        h("label", { class: "acc-rn-switch", for: "acc-rn-hide" }, box, h("span", { text: "Hide my real name from other players" })),
        status);
    })() : null;
    const activity = data.hasXbox ? (() => {
      const box = h("input", { type: "checkbox", id: "acc-act" });
      box.checked = data.showActivity;
      box.addEventListener("change", async () => {
        try {
          await postJson("/api/account/activity", { show: box.checked });
          toast(box.checked ? "Your Xbox activity shows on your profile." : "Your Xbox activity is hidden.");
        } catch (e) { box.checked = !box.checked; toast(e.message); }
      });
      return card("Activity", "Like Discord: your profile shows what you're playing.",
        h("label", { class: "acc-rn-switch", for: "acc-act" }, box, h("span", { text: "Show my Xbox activity on my profile" })),
        h("p", { class: "text-3 small", style: "margin:8px 0 0", text: "When you're on GalaxySMP it always shows \"Playing Minecraft\". This switch is about what you do on Xbox Live outside the server." }));
    })() : null;
    return [
      realName,
      activity,
      card("Blocked members", "Blocked members can't send you direct messages.", blocked),
      card("Your data", null,
        h("p", { class: "text-2", style: "margin:0 0 10px", text: "Read what we store and why in the privacy policy. To have your account and messages deleted, open a ticket in Community → Support." }),
        h("div", { class: "acc-card-foot" }, h("a", { class: "btn btn-secondary btn-sm", href: "/privacy", text: "Privacy policy" }),
          h("a", { class: "btn btn-ghost btn-sm", href: "/community#support", text: "Contact support" }))),
    ];
  },
};

// ---------- navigation ----------
async function load(name) {
  const sec = SECTIONS[name] ? name : "profile";
  document.querySelectorAll("[data-sec]").forEach((a) => a.setAttribute("aria-current", String(a.dataset.sec === sec)));
  const main = $("acc-main");
  try {
    if (sec !== "notifications") data = await getJson("/api/account");
    const parts = await SECTIONS[sec]();
    main.replaceChildren(...parts.filter(Boolean));
  } catch (e) {
    main.replaceChildren(h("p", { class: "text-3", text: e.message || "Couldn't load your account." }));
  }
}

window.addEventListener("hashchange", () => load(location.hash.slice(1)));
(async () => {
  let me = null;
  try { me = (await getJson("/api/me")).user; } catch { /* signed out */ }
  if (!me) { $("acc-signedout").hidden = false; return; }
  $("acc-app").hidden = false;
  const icons = { profile: "user", notifications: "bell", subscription: "star", purchases: "card", security: "lock2", privacy: "shield" };
  document.querySelectorAll("[data-sec]").forEach((a) => a.prepend(iconEl(icons[a.dataset.sec])));
  load(location.hash.slice(1));
})();
