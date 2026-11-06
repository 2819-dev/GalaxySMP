import { startStatus } from "/js/site.js";

const $ = (id) => document.getElementById(id);

function render(s) {
  const hero = $("status-hero");
  const word = $("status-word");
  const motd = $("status-motd");
  word.classList.remove("skeleton");
  hero.classList.remove("is-online", "is-offline");

  if (!s || s.reason === "lookup_failed") {
    word.textContent = "Status unavailable";
    motd.textContent = "We couldn't reach the server just now. Trying again in a minute.";
    return;
  }
  if (!s.configured) {
    word.textContent = "Opening soon";
    motd.textContent = "The server address hasn't been published yet.";
  } else if (s.online) {
    hero.classList.add("is-online");
    word.textContent = "Online";
    motd.textContent = s.motd || "";
  } else {
    hero.classList.add("is-offline");
    word.textContent = "Offline";
    motd.textContent = "The server may be restarting. Check back in a few minutes.";
  }

  const updown = (v) => (v ? "Up" : "Down");
  $("st-players").textContent = s.online ? `${s.players.online} / ${s.players.max}` : "0";
  $("st-version").textContent = s.online && s.version ? s.version : "–";
  $("st-java").textContent = s.configured && s.java ? updown(s.java.online) : "–";
  $("st-bedrock").textContent = s.configured && s.bedrock ? updown(s.bedrock.online) : "–";
  $("st-checked").textContent = new Date(s.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

startStatus(render);
