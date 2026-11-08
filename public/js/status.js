import { startStatus, statusText } from "/js/site.js";

const $ = (id) => document.getElementById(id);

function render(s) {
  const hero = $("status-hero");
  const word = $("status-word");
  const motd = $("status-motd");
  word.classList.remove("skeleton");
  hero.classList.remove("is-online", "is-offline");

  if (!s || s.reason === "lookup_failed") {
    word.textContent = "Status unavailable";
    motd.textContent = "Status information is temporarily unavailable. Retrying shortly.";
    return;
  }
  if (s.manual) {
    hero.classList.remove("is-maintenance");
    hero.classList.add(statusText(s).cls);
    word.textContent = s.title;
    motd.textContent = s.message;
    $("st-players").textContent = "–";
    $("st-version").textContent = "–";
    const state = s.online ? "Open" : s.color === "amber" ? "Paused" : "Closed";
    $("st-java").textContent = state;
    $("st-bedrock").textContent = state;
    $("st-checked").textContent = new Date(s.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return;
  }
  if (!s.configured) {
    word.textContent = "Launching soon";
    motd.textContent = "The server address will be published here soon.";
  } else if (s.online) {
    hero.classList.add("is-online");
    word.textContent = "Online";
    motd.textContent = s.motd || "";
  } else {
    hero.classList.add("is-offline");
    word.textContent = "Offline";
    motd.textContent = "The server may be restarting. Please check back shortly.";
  }

  const updown = (v) => (v ? "Up" : "Down");
  $("st-players").textContent = s.online ? `${s.players.online} / ${s.players.max}` : "0";
  $("st-version").textContent = s.online && s.version ? s.version : "–";
  $("st-java").textContent = s.configured && s.java ? updown(s.java.online) : "–";
  $("st-bedrock").textContent = s.configured && s.bedrock ? updown(s.bedrock.online) : "–";
  $("st-checked").textContent = new Date(s.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

startStatus(render);
