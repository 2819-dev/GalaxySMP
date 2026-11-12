// Season pass: XP bar, tiers with a free and a Galaxy Pro+ reward, claim buttons, and the season's top players.
import { toast, iconEl } from "/js/site.js";
import { h, getJson, postJson } from "/js/dialog.js";
import { money } from "/js/money.js";

const root = document.getElementById("ss-root");
const KEY = { common: "Common key", rare: "Rare key", galaxy: "Galaxy key" };
const rewardText = (r) => [r.cents ? `${money(r.cents)}` : null, ...Object.entries(r.keys || {}).map(([k, n]) => `${n > 1 ? `${n} ` : ""}${KEY[k]}${n > 1 ? "s" : ""}`)].filter(Boolean).join(" + ");
const daysLeft = (d) => Math.max(0, Math.ceil((new Date(d) - Date.now()) / 864e5));

async function load() {
  let d;
  try { d = await getJson("/api/season"); }
  catch (e) {
    root.replaceChildren(h("section", { class: "panel" }, h("p", { class: "text-2", text: /sign in/i.test(e.message) || /401/.test(e.message) ? "Sign in to see the season pass." : e.message }),
      h("a", { class: "btn btn-primary", href: "/community", text: "Sign in" })));
    return;
  }
  const s = d.season, me = d.me;
  document.getElementById("ss-title").textContent = `${s.name} Pass`;
  const xp = me?.xp || 0;
  const level = s.tiers.filter((t) => xp >= t.xp).length;
  const next = s.tiers[level];
  const prevXp = level ? s.tiers[level - 1].xp : 0;
  const pct = next ? Math.round(((xp - prevXp) / (next.xp - prevXp)) * 100) : 100;

  const hero = h("section", { class: "panel ss-hero" },
    h("div", { class: "ss-hero-top" },
      h("div", {}, h("div", { class: "ss-level-k", text: "Tier" }), h("div", { class: "ss-level", text: `${level}` }), h("div", { class: "text-3 small", text: `of ${s.tiers.length}` })),
      h("div", { class: "ss-hero-main" },
        h("div", { class: "ss-xp-line" }, h("b", { text: `${xp.toLocaleString()} XP` }), h("span", { class: "text-3 small", text: next ? `${(next.xp - xp).toLocaleString()} XP to tier ${level + 1}` : "Every tier unlocked!" })),
        h("div", { class: "ss-bar" }, h("span", { style: `width:${pct}%` })),
        h("div", { class: "text-3 small", text: `${daysLeft(s.endsAt)} days left · ends ${new Date(s.endsAt).toLocaleDateString([], { month: "short", day: "numeric" })}` }))),
    h("div", { class: "ss-rules" },
      ...[["clock", `${d.xpRules.minute} XP`, "every minute you play"], ["check", `${d.xpRules.quest} XP`, "each quest"], ["trophy", `${d.xpRules.achievement} XP`, "each achievement"], ["sword", `${d.xpRules.bw_win} XP`, "each Bedwars win"]]
        .map(([ic, v, l]) => h("div", { class: "ss-rule" }, iconEl(ic), h("b", { text: v }), h("span", { class: "text-3 small", text: l })))),
    !me ? h("p", { class: "notice", text: "Link your Minecraft account (Account > Link) to earn XP and claim rewards." })
      : !me.pro ? h("p", { class: "text-3 small", style: "margin:10px 0 0" }, "The ", h("b", { text: "Pro+ track" }), " needs Galaxy Pro+. ", h("a", { href: "/store", text: "See plans" }), ".") : null);

  const claim = async (tier, track, btn) => {
    btn.disabled = true;
    try { const r = await postJson("/api/season/claim", { tier, track }); toast(r.message); load(); }
    catch (e) { toast(e.message); btn.disabled = false; }
  };
  const cell = (t, i, track) => {
    const tier = i + 1, open = xp >= t.xp;
    const claimed = (track === "pro" ? me?.claimedPro : me?.claimedFree)?.includes(tier);
    const locked = track === "pro" && !me?.pro;
    let action;
    if (claimed) action = h("span", { class: "ss-done", text: "Claimed ✓" });
    else if (!open || !me) action = h("span", { class: "text-3 small", text: `${t.xp.toLocaleString()} XP` });
    else if (locked) action = h("span", { class: "text-3 small", text: "Pro+ only" });
    else { const b = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Claim" }); b.addEventListener("click", () => claim(tier, track, b)); action = b; }
    return h("div", { class: `ss-reward ${track}${open ? " open" : ""}${claimed ? " claimed" : ""}${locked ? " locked" : ""}` },
      h("div", { class: "ss-reward-text", text: rewardText(t[track]) }), action);
  };
  const tiers = h("section", { class: "panel ss-tiers" },
    h("div", { class: "ss-row ss-head" }, h("span", { text: "Tier" }), h("span", { text: "Free" }), h("span", { class: "ss-pro-label", text: "Galaxy Pro+" })),
    ...s.tiers.map((t, i) => h("div", { class: `ss-row${xp >= t.xp ? " reached" : ""}${i === level ? " current" : ""}` },
      h("span", { class: "ss-tier", text: String(i + 1) }), cell(t, i, "free"), cell(t, i, "pro"))));

  const top = h("section", { class: "panel" }, h("h2", { class: "ss-h2", text: "Top this season" }),
    d.top.length ? h("ol", { class: "leaderboard" }, ...d.top.map((t, i) => h("li", {}, h("span", { class: "lb-rank", text: String(i + 1) }),
      h("a", { class: "lb-name", href: `/player/${encodeURIComponent(t.name)}`, text: t.name }), h("span", { class: "lb-val", text: `${t.xp.toLocaleString()} XP` }))))
      : h("p", { class: "text-3", text: "Nobody has earned XP yet this season. Be the first!" }));

  root.replaceChildren(hero, tiers, top, h("p", { class: "text-3 small", text: "Rewards go to you in game: right away if you're online, or the next time you join. A new season starts by itself when this one ends." }));
  const cur = tiers.querySelector(".ss-row.current");
  if (cur && level > 3) cur.scrollIntoView({ block: "center" });
}
load();
