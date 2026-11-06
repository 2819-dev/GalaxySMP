import { startStatusPills, statusText } from "/js/site.js";

const $ = (id) => document.getElementById(id);

function render(s) {
  const big = $("status-big");
  const word = $("status-word");
  word.classList.remove("skeleton");
  big.classList.remove("is-online", "is-offline");

  if (!s) {
    word.textContent = "Status unavailable";
    $("status-motd").textContent = "We couldn't check the server just now. We'll try again in a minute.";
    return;
  }
  const { cls } = statusText(s);
  if (cls) big.classList.add(cls);

  if (!s.configured) {
    word.textContent = "Coming soon";
    $("status-motd").textContent = "The server address hasn't been added to the website yet.";
  } else if (s.reason === "lookup_failed") {
    word.textContent = "Status unavailable";
    $("status-motd").textContent = "We couldn't check the server just now. We'll try again in a minute.";
  } else {
    word.textContent = s.online ? "Online" : "Offline";
    $("status-motd").textContent = s.online ? (s.motd || "") : "The server might be restarting. Check back in a few minutes.";
  }

  const yesNo = (v) => (v ? "🟢 Up" : "🔴 Down");
  $("st-players").textContent = s.online ? `${s.players.online} / ${s.players.max}` : "0";
  $("st-version").textContent = s.online && s.version ? s.version : "-";
  $("st-java").textContent = s.configured && s.java ? yesNo(s.java.online) : "-";
  $("st-bedrock").textContent = s.configured && s.bedrock ? yesNo(s.bedrock.online) : "-";
  $("st-checked").textContent = new Date(s.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

startStatusPills(render);
