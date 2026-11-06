import { config, LOGO_SVG, startStatusPills } from "/js/site.js";

document.getElementById("hero-logo").innerHTML = LOGO_SVG;

const modes = document.getElementById("modes");
for (const m of config.gameModes) {
  const card = document.createElement("div");
  card.className = "card mode-card";
  card.innerHTML = `<div class="icon" aria-hidden="true"></div><h3></h3><p class="muted"></p>`;
  card.querySelector(".icon").textContent = m.icon;
  card.querySelector("h3").textContent = m.name;
  card.querySelector("p").textContent = m.text;
  modes.appendChild(card);
}

startStatusPills();
