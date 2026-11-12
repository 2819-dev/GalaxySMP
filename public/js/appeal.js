// Ban appeal: send an appeal without signing in, then check the answer with a private link.
import { toast } from "/js/site.js";

const $ = (id) => document.getElementById(id);
const STATUS = { open: ["Waiting for staff", "planned"], accepted: ["Accepted", "done"], declined: ["Declined", "declined"] };
const WHICH = { game: "Minecraft server ban", website: "Community ban", both: "Minecraft server and community ban" };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

async function showStatus(token) {
  const box = $("ap-status");
  $("ap-form-box").hidden = true;
  box.hidden = false;
  box.replaceChildren(el("p", "text-3", "Loading your appeal…"));
  let d;
  try { d = await fetch(`/api/appeals/${encodeURIComponent(token)}`).then((r) => r.json()); } catch { d = { ok: false }; }
  if (!d.ok) { box.replaceChildren(el("p", null, d.error || "We couldn't find that appeal. Check the link.")); return; }
  const a = d.appeal;
  const [label, cls] = STATUS[a.status];
  const link = `${location.origin}/appeal?t=${token}`;
  const copy = el("button", "btn btn-secondary btn-sm", "Copy link");
  copy.type = "button";
  copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(link); toast("Link copied."); } catch { /* not allowed */ } });
  const parts = [
    el("div", "ap-head"),
    el("p", "text-3 small", `${WHICH[a.which]} · sent ${new Date(a.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`),
    el("h2", "ap-h", "Your appeal"),
    el("p", "ap-msg", a.message),
  ];
  parts[0].append(el("b", null, a.gamertag), el("span", `sg-status ${cls}`, label));
  if (a.reply) {
    const r = el("div", `sg-reply ${a.status === "accepted" ? "done" : "declined"}`);
    r.append(el("div", "sg-reply-head", "Staff answer"), el("p", null, a.reply));
    parts.push(r);
    if (a.status === "accepted") parts.push(el("p", "text-2", "Your ban has been lifted. Welcome back, and please follow the rules."));
  } else {
    const keep = el("div", "note small");
    keep.append(el("p", null, "Save this page's link to check for an answer: it's the only way to see it."), copy);
    parts.push(keep);
  }
  box.replaceChildren(...parts);
}

const token = new URLSearchParams(location.search).get("t");
if (token) showStatus(token);

$("ap-message").addEventListener("input", () => { $("ap-count").textContent = String($("ap-message").value.length); });
$("ap-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("ap-error").textContent = "";
  const btn = $("ap-send");
  btn.disabled = true;
  try {
    const res = await fetch("/api/appeals", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamertag: $("ap-gamertag").value, message: $("ap-message").value }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) throw new Error(d.error || "Your appeal couldn't be sent. Please try again.");
    history.replaceState(null, "", `/appeal?t=${d.token}`);
    showStatus(d.token);
  } catch (err) {
    $("ap-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
