import { config, icon, startStatus } from "/js/site.js";

const worlds = document.getElementById("worlds");
for (const m of config.gameModes) {
  const el = document.createElement("div");
  el.className = "world";
  el.innerHTML = `<div class="ico">${icon(m.icon)}</div><h3></h3><p></p>`;
  el.querySelector("h3").textContent = m.name;
  el.querySelector("p").textContent = m.text;
  worlds.appendChild(el);
}

startStatus();
