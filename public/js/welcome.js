// Onboarding: the step-by-step welcome every member goes through once (it can't be skipped).
import { iconEl, toast } from "/js/site.js";
import { h, postJson } from "/js/dialog.js";
import { faceSvg } from "/js/face.js";
import { enableNotifications, pushSupported } from "/js/notify.js";

const card = document.getElementById("ob-card");
const bar = document.getElementById("ob-bar");
const count = document.getElementById("ob-count");
let info = null;
const a = { first: "", last: "", nameHidden: false, rules: false, interests: [], bio: "", color: null, found: null, foundOther: "", invitedBy: null, invitedName: "", notify: null };
let step = 0;

const field = (label, control, hint) => h("div", { class: "field" }, h("label", { class: "field-label", for: control.id, text: label }), control, hint ? h("p", { class: "hint", text: hint }) : null);
const err = h("p", { class: "form-error", role: "alert" });
const fail = (msg) => { err.textContent = msg; return false; };

// ---------- the steps ----------
const STEPS = [
  {
    id: "welcome", icon: "sparkles", title: "Welcome to GalaxySMP!",
    body: () => [
      h("p", { class: "text-2 ob-lead", text: `Hi ${info.username}! Your Minecraft account is linked. Let's set up your profile. It only takes a minute.` }),
      h("ul", { class: "ob-list" }, ["Your name", "The server rules", "What you like to play", "A bit about you"].map((t) => h("li", {}, iconEl("check"), t))),
    ],
    next: "Let's go",
  },
  {
    id: "name", icon: "user", title: "What's your name?",
    body: () => {
      const first = h("input", { class: "input", id: "ob-first", autocomplete: "given-name", maxlength: 30, value: a.first, placeholder: "First name" });
      const last = h("input", { class: "input", id: "ob-last", autocomplete: "family-name", maxlength: 30, value: a.last, placeholder: "Last name" });
      first.addEventListener("input", () => { a.first = first.value; });
      last.addEventListener("input", () => { a.last = last.value; });
      const who = h("div", { class: "ob-seg", role: "radiogroup", "aria-label": "Who can see your name" });
      const opts = [[false, "Everyone", "users"], [true, "Only me and staff", "lock2"]];
      const draw = () => who.replaceChildren(...opts.map(([hidden, label, ic]) => {
        const b = h("button", { class: "ob-seg-btn", type: "button", role: "radio", "aria-checked": String(a.nameHidden === hidden) }, iconEl(ic), label);
        b.addEventListener("click", () => { a.nameHidden = hidden; draw(); hint.textContent = hintText(); });
        return b;
      }));
      const hintText = () => (a.nameHidden ? "Only you and staff can see your name." : "Your name shows on your profile, next to your username.");
      const hint = h("p", { class: "hint", text: hintText() });
      draw();
      setTimeout(() => first.focus(), 50);
      return [
        h("div", { class: "ob-two" }, field("First name", first), field("Last name", last)),
        h("div", { class: "ob-who" }, h("span", { class: "field-label", text: "Who can see it" }), who, hint),
        h("p", { class: "text-3 small", style: "margin:12px 0 0", text: "You can change who sees it any time in Account → Privacy." }),
      ];
    },
    check: () => {
      const ok = (v) => /^[\p{L}][\p{L}' .-]{0,29}$/u.test(v.trim());
      if (!a.first.trim() || !a.last.trim()) return fail("Type your first and last name.");
      if (!ok(a.first) || !ok(a.last)) return fail("Names can only use letters, spaces, - and '.");
      return true;
    },
  },
  {
    id: "rules", icon: "shield", title: "The server rules",
    body: () => {
      const box = h("div", { class: "ob-rules" }, h("p", { class: "text-3", text: "Loading the rules…" }));
      fetch("/api/help").then((r) => r.json()).then((d) => {
        if (!d.rules?.length) { box.replaceChildren(h("p", {}, "Read them on the ", h("a", { href: "/rules", target: "_blank", text: "Rules page" }), ".")); return; }
        box.replaceChildren(...d.rules.flatMap((sec) => [h("h3", { text: sec.title }),
          h("ul", {}, sec.items.map((item) => {
            const li = h("li");
            String(item).split(/\*\*(.+?)\*\*/).forEach((part, i) => li.append(i % 2 ? h("b", { text: part }) : part));
            return li;
          }))]));
      }).catch(() => {});
      const tick = h("input", { type: "checkbox", id: "ob-agree" });
      tick.checked = a.rules;
      tick.addEventListener("change", () => { a.rules = tick.checked; });
      return [box, h("label", { class: "ob-agree", for: "ob-agree" }, tick, h("span", { text: "I've read the rules and I agree to follow them." }))];
    },
    check: () => a.rules || fail("Please tick \"I agree\" to continue."),
  },
  {
    id: "interests", icon: "minigames", title: "What do you like to play?",
    body: () => {
      const grid = h("div", { class: "ob-chips" });
      for (const it of info.interests) {
        const b = h("button", { class: "ob-chip", type: "button", "aria-pressed": String(a.interests.includes(it.id)), text: it.name });
        b.addEventListener("click", () => {
          a.interests = a.interests.includes(it.id) ? a.interests.filter((x) => x !== it.id) : [...a.interests, it.id];
          b.setAttribute("aria-pressed", String(a.interests.includes(it.id)));
        });
        grid.append(b);
      }
      return [h("p", { class: "text-2", style: "margin-top:0", text: "Pick as many as you like. They show on your profile so people with the same interests can find you." }), grid];
    },
    check: () => a.interests.length > 0 || fail("Pick at least one."),
  },
  {
    id: "about", icon: "message", title: "A bit about you",
    body: () => {
      const bio = h("textarea", { class: "input", id: "ob-bio", rows: 3, maxlength: 120, placeholder: "e.g. I love building castles and taming wolves!" });
      bio.value = a.bio;
      const left = h("span", { class: "text-3 small" });
      const upd = () => { a.bio = bio.value; left.textContent = `${120 - bio.value.length} left`; };
      bio.addEventListener("input", upd);
      upd();
      const colors = h("div", { class: "ob-colors", role: "radiogroup", "aria-label": "Profile color" });
      const draw = () => colors.replaceChildren(...info.colors.map((c) => {
        const b = h("button", { class: "ob-color", type: "button", role: "radio", "aria-checked": String(a.color === c), "aria-label": c, style: `--c:${c}` });
        b.addEventListener("click", () => { a.color = c; draw(); });
        return b;
      }));
      if (!a.color) a.color = info.colors[0];
      draw();
      return [
        field("About you (optional)", bio, "Shown on your profile. Don't share where you live, your school or your phone number."), left,
        h("div", { class: "field", style: "margin-top:14px" }, h("span", { class: "field-label", text: "Your profile color" }), colors),
      ];
    },
  },
  {
    id: "found", icon: "pin", title: "How did you find GalaxySMP?",
    body: () => {
      const list = h("div", { class: "ob-options", role: "radiogroup" });
      const other = h("input", { class: "input", id: "ob-other", maxlength: 60, placeholder: "Where?", value: a.foundOther });
      other.addEventListener("input", () => { a.foundOther = other.value; });
      const otherField = field("Where did you hear about us?", other);
      const draw = () => {
        list.replaceChildren(...info.found.map((f) => {
          const b = h("button", { class: "ob-option", type: "button", role: "radio", "aria-checked": String(a.found === f.id), text: f.name });
          b.addEventListener("click", () => { a.found = f.id; draw(); });
          return b;
        }));
        otherField.hidden = a.found !== "other";
      };
      draw();
      // who invited you (optional): type the first letters, pick from the list
      const search = h("input", { class: "input", id: "ob-inv", placeholder: "Type the first letters of their name", autocomplete: "off", maxlength: 32 });
      const results = h("div", { class: "gift-list" });
      const picked = h("div", { class: "gift-picked", hidden: !a.invitedBy });
      const showPicked = () => {
        const change = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove" });
        change.addEventListener("click", () => { a.invitedBy = null; a.invitedName = ""; picked.hidden = true; search.hidden = false; });
        const img = h("img", { class: "gift-face", alt: "", width: 28, height: 28, src: faceSvg(a.invitedName) });
        picked.replaceChildren(img, h("b", { text: a.invitedName }), change);
        picked.hidden = false;
        search.hidden = true;
      };
      if (a.invitedBy) showPicked();
      let t = null;
      search.addEventListener("input", () => {
        clearTimeout(t);
        const q = search.value.trim();
        if (q.length < 2) { results.replaceChildren(); return; }
        t = setTimeout(async () => {
          const d = await fetch(`/api/store/members?q=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => ({}));
          results.replaceChildren(...(d.members || []).map((m) => {
            const img = h("img", { class: "gift-face", alt: "", width: 28, height: 28 });
            img.src = m.head || faceSvg(m.username);
            const b = h("button", { class: "gift-option", type: "button" }, img, h("span", { text: m.username }));
            b.addEventListener("click", () => { a.invitedBy = m.id; a.invitedName = m.username; results.replaceChildren(); search.value = ""; showPicked(); });
            return b;
          }));
        }, 200);
      });
      return [list, otherField,
        h("div", { class: "field", style: "margin-top:16px" }, h("label", { class: "field-label", for: "ob-inv", text: "Did a member invite you? (optional)" }), search, picked, results),
        h("p", { class: "text-3 small", style: "margin:8px 0 0", text: "Only staff see this answer." })];
    },
    check: () => {
      if (!a.found) return fail("Pick one.");
      if (a.found === "other" && !a.foundOther.trim()) return fail("Tell us where.");
      return true;
    },
  },
  {
    id: "notify", icon: "bell", title: "Stay in the loop",
    body: () => {
      const supported = pushSupported();
      const status = h("p", { class: "text-2", style: "margin:0", text: supported
        ? "Get a notification when someone messages you, mentions you, or there's a new announcement. You can change this any time."
        : "Your browser can't show notifications here. On iPhone and iPad, add GalaxySMP to your Home Screen first, then turn them on in Account → Notifications." });
      const on = h("button", { class: "btn btn-primary", type: "button", text: a.notify === true ? "Notifications are on" : "Turn on notifications", disabled: !supported || a.notify === true });
      on.addEventListener("click", async () => {
        on.disabled = true;
        try {
          await enableNotifications();
          a.notify = true;
          on.textContent = "Notifications are on";
          toast("Notifications are on.");
        } catch (e) {
          on.disabled = false;
          toast(e.message || "Notifications weren't turned on.");
        }
      });
      return [status, h("div", { class: "ob-notify" }, on)];
    },
    next: () => (a.notify ? "Next" : "Not now"),
  },
  {
    id: "done", icon: "check", title: "You're all set!",
    body: () => [
      h("p", { class: "text-2 ob-lead", text: `Welcome to the galaxy, ${a.first.trim()}! Here's where to go next:` }),
      h("div", { class: "ob-links" },
        h("a", { class: "ob-link", href: "/community" }, iconEl("message"), h("span", {}, h("b", { text: "Community" }), h("span", { class: "text-3 small", text: "Chat, events and messages" }))),
        h("a", { class: "ob-link", href: "/voice" }, iconEl("mic"), h("span", {}, h("b", { text: "Voice chat" }), h("span", { class: "text-3 small", text: "Talk while you play" }))),
        h("a", { class: "ob-link", href: "/store" }, iconEl("cart"), h("span", {}, h("b", { text: "Store" }), h("span", { class: "text-3 small", text: "Plans, money and more" })))),
    ],
    final: true,
  },
];

// ---------- drawing ----------
function draw() {
  const s = STEPS[step];
  err.textContent = "";
  bar.style.width = `${Math.round((step / (STEPS.length - 1)) * 100)}%`;
  count.textContent = s.final ? "Done!" : step ? `Step ${step} of ${STEPS.length - 2}` : "";
  const back = h("button", { class: "btn btn-ghost", type: "button", text: "Back", hidden: step === 0 || s.final });
  back.addEventListener("click", () => { step--; draw(); });
  const label = typeof s.next === "function" ? s.next() : s.next || (STEPS[step + 1]?.final ? "Finish" : "Next");
  const next = h("button", { class: "btn btn-primary ob-next", type: "button", text: s.final ? "Go to Community" : label });
  next.addEventListener("click", async () => {
    if (s.final) { location.href = "/community"; return; }
    if (s.check && !s.check()) return;
    if (STEPS[step + 1].final) { // save everything before the last screen
      next.disabled = true;
      try {
        await postJson("/api/onboarding", a);
      } catch (e) {
        next.disabled = false;
        err.textContent = e.message;
        return;
      }
    }
    step++;
    draw();
  });
  card.replaceChildren(
    h("div", { class: "ob-head" }, h("span", { class: "ob-icon" }, iconEl(s.icon)), h("h1", { text: s.title })),
    h("div", { class: "ob-body-content" }, ...[].concat(s.body())),
    err,
    h("div", { class: "ob-actions" }, back, next));
  card.classList.remove("ob-in");
  void card.offsetWidth;
  card.classList.add("ob-in");
  window.scrollTo(0, 0);
}

(async () => {
  try {
    const r = await fetch("/api/onboarding", { credentials: "same-origin" });
    if (r.status === 401) { location.replace("/community"); return; }
    info = await r.json();
  } catch {
    card.replaceChildren(h("p", { class: "text-3", text: "Couldn't load. Check your connection and refresh." }));
    return;
  }
  if (info.done) { location.replace("/community"); return; }
  Object.assign(a, { ...info.saved, nameHidden: info.saved.nameHidden, color: info.saved.color });
  draw();
})();
