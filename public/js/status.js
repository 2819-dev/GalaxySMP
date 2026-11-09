import { startStatus, statusText } from "/js/site.js";

const $ = (id) => document.getElementById(id);
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function render(s) {
  const hero = $("status-hero");
  const word = $("status-word");
  const motd = $("status-motd");
  word.classList.remove("skeleton");
  hero.classList.remove("is-online", "is-offline", "is-maintenance");

  const show = (title, message) => {
    word.textContent = title;
    motd.textContent = message || "";
    motd.hidden = !motd.textContent;
  };

  if (!s || s.reason === "lookup_failed") {
    show("Status unavailable", "Status information is temporarily unavailable. Retrying shortly.");
    return;
  }

  $("st-checked").textContent = time(s.checkedAt);
  $("st-source").textContent = s.source === "plugin"
    ? "Reported by the GalaxySMP server itself."
    : s.configured && !s.manual ? "Checked through our own website, so your device never contacts a third party." : "";

  if (s.manual) {
    hero.classList.add(statusText(s).cls);
    show(s.title, s.message);
    $("st-players").textContent = "–";
    $("st-version").textContent = "–";
    return;
  }

  if (!s.configured) {
    show("Launching soon", "The server address will be published here soon.");
  } else if (s.online) {
    hero.classList.add("is-online");
    const n = s.players && s.players.online;
    show("Online", n === 0 ? "No one is playing right now. Be the first to join!" : s.motd);
  } else {
    hero.classList.add("is-offline");
    show("Offline", "The server may be restarting. Please check back shortly.");
  }

  const p = s.players || {};
  $("st-players").textContent = !s.online ? "0" : p.online == null ? "–" : p.max ? `${p.online} / ${p.max}` : String(p.online);
  $("st-version").textContent = s.online && s.version ? s.version : "–";
}

startStatus(render);
