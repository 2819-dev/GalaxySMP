import { toast, config } from "/js/site.js";
import { startChat, stopChat } from "/js/chat.js";
import "/js/mod.js";
import { maybeAskForNotifications, refreshSubscription, openPreferences } from "/js/notify.js";

const $ = (id) => document.getElementById(id);
const views = ["loading", "auth", "code", "chat"];
function show(name) {
  for (const v of views) $("view-" + v).hidden = v !== name;
  $("auth-wrap").hidden = name === "chat";
  document.body.classList.toggle("app-mode", name === "chat");
  window.scrollTo(0, 0);
}

async function api(path, body) {
  const res = await fetch(path, body === undefined
    ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

// ---------- Signed in: open the chat ----------
async function showChat() {
  show("chat");
  try {
    await startChat({ onSignedOut: () => show("auth") });
    refreshSubscription();
    setTimeout(maybeAskForNotifications, 2500);
  } catch (e) {
    show("auth");
    toast(e.message || "Couldn't open the chat. Please try again.");
  }
}

$("notify-prefs").addEventListener("click", () => openPreferences());

$("sign-out").addEventListener("click", async () => {
  stopChat();
  await api("/api/auth/logout", {}).catch(() => {});
  show("auth");
});

// ---------- Create account / sign in toggles ----------
let mode = "signup";
const platform = "bedrock";

document.querySelectorAll("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    mode = b.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("form-signup").hidden = mode !== "signup";
    $("form-signin").hidden = mode !== "signin";
  })
);

function busy(form, on) {
  form.querySelector('button[type="submit"]').disabled = on;
}

// ---------- Create account ----------
$("form-signup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const err = $("su-error");
  err.textContent = "";
  const username = $("su-name").value.trim();
  const password = $("su-pass").value;
  if (!username) return (err.textContent = "Please enter your Minecraft username.");
  if (password.length < 8) return (err.textContent = "Passwords must be at least 8 characters.");
  if (password !== $("su-pass2").value) return (err.textContent = "The passwords do not match.");
  busy(form, true);
  try {
    const data = await api("/api/auth/link/start", { username, password, platform });
    form.reset();
    startWaiting(data);
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    busy(form, false);
  }
});

// ---------- Sign in ----------
$("form-signin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const err = $("si-error");
  err.textContent = "";
  busy(form, true);
  try {
    await api("/api/auth/login", { username: $("si-name").value.trim(), password: $("si-pass").value });
    form.reset();
    await loadMe();
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    busy(form, false);
  }
});

// ---------- Waiting for /link ----------
let pollTimer = null;
let clockTimer = null;

function stopWaiting() {
  clearTimeout(pollTimer);
  clearInterval(clockTimer);
}

function setCodeStatus(text, cls) {
  const s = $("code-status");
  s.classList.remove("is-online", "is-offline");
  if (cls) s.classList.add(cls);
  s.querySelector("span:last-child").textContent = text;
}

function startWaiting({ code, username, expiresAt, pollToken }) {
  stopWaiting();
  const command = `/link ${code}`;
  $("code-name").textContent = username;
  $("code-command").textContent = command;
  $("code-copy").onclick = async () => {
    try { await navigator.clipboard.writeText(command); toast("Copied"); } catch { toast(command); }
  };
  setCodeStatus("Waiting for confirmation from the server");
  show("code");

  const end = new Date(expiresAt).getTime();
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    $("code-timer").textContent = left
      ? `Code expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
      : "This code has expired. Start over to generate a new one.";
  };
  tick();
  clockTimer = setInterval(tick, 1000);

  const poll = async () => {
    try {
      const data = await api("/api/auth/link/poll", { pollToken });
      if (data.status === "linked") {
        stopWaiting();
        setCodeStatus("Account linked", "is-online");
        toast("Account linked");
        return loadMe();
      }
      if (data.status === "expired") {
        stopWaiting();
        return setCodeStatus("Code expired", "is-offline");
      }
      if (data.status === "banned") {
        stopWaiting();
        return setCodeStatus("This account has been banned from the community", "is-offline");
      }
      if (data.status === "claimed") {
        stopWaiting();
        show("auth");
        return;
      }
    } catch { /* network blip: keep trying */ }
    if (document.visibilityState === "visible" || Date.now() < end) pollTimer = setTimeout(poll, 3000);
  };
  pollTimer = setTimeout(poll, 3000);
}

$("code-restart").addEventListener("click", () => {
  stopWaiting();
  show("auth");
});

// ---------- Start ----------
async function loadMe() {
  try {
    const { user } = await api("/api/me");
    if (user) await showChat();
    else show("auth");
  } catch {
    show("auth");
  }
}

loadMe();

// On a Realm there's no plugin to confirm /link codes, so sign-up waits for our own server.
if (config.hosting === "realm") {
  const form = $("form-signup");
  form.replaceChildren();
  const p = document.createElement("p");
  p.className = "text-2";
  p.style.margin = "0";
  p.textContent = "New accounts open when GalaxySMP moves from Minecraft Realms to our own server. Accounts are confirmed with an in-game command, which Realms don't support. Check back soon!";
  form.append(p);
}
