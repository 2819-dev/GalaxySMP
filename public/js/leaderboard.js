// Money leaderboard (balances are sent by the Minecraft server).
import "/js/site.js";

const $ = (id) => document.getElementById(id);

export function money(cents) {
  const d = cents / 100;
  const trim = (n) => n.toFixed(2).replace(/\.?0+$/, "");
  if (Math.abs(d) < 10000) return "$" + d.toLocaleString("en-US", { maximumFractionDigits: 2 });
  for (const [size, letter] of [[1e15, "Q"], [1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (Math.abs(d) >= size) return `$${trim(d / size)}${letter}`;
  }
  return "$" + d;
}

async function load() {
  const list = $("lb-list");
  try {
    const res = await fetch("/api/economy/top");
    const data = await res.json();
    if (!data.ok) throw new Error();
    $("lb-players").textContent = data.totalPlayers.toLocaleString();
    $("lb-total").textContent = money(data.totalCents);
    list.replaceChildren();
    if (!data.players.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No balances yet. They appear once the server has players.";
      list.append(li);
    }
    data.players.forEach((p, i) => {
      const li = document.createElement("li");
      if (i < 3) li.dataset.top = String(i + 1);
      const rank = document.createElement("span"); rank.className = "lb-rank"; rank.textContent = `#${i + 1}`;
      const name = document.createElement("span"); name.className = "lb-name"; name.textContent = p.name;
      const bal = document.createElement("span"); bal.className = "lb-money"; bal.textContent = money(p.cents);
      bal.title = "$" + (p.cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
      li.append(rank, name, bal);
      list.append(li);
    });
    $("lb-updated").textContent = data.updated
      ? `Updated ${new Date(data.updated).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Server operators aren't listed.`
      : "";
  } catch {
    list.innerHTML = '<li class="empty">The leaderboard couldn\'t be loaded. Please try again later.</li>';
  }
}
load();
setInterval(load, 60_000);
