// Season pass: XP bar, tiers with a free and a Galaxy Pro+ reward, claim buttons, and the season's top players.
import { toast, iconEl } from "/js/site.js";
import { h, getJson, postJson } from "/js/dialog.js";
import { money } from "/js/money.js";

const root = document.getElementById("ss-root");
const KEY = { common: "Common key", rare: "Rare key", galaxy: "Galaxy key" };
const rewardText = (r) => [r.cents ? `${money(r.cents)}` : null, ...Object.entries(r.keys || {}).map(([k, n]) => `${n > 1 ? `${n} ` : ""}${KEY[k]}${n > 1 ? "s" : ""}`)].filter(Boolean).join(" + ");
// Website looks unlocked by a tier (themes, titles, frames)
const unlockText = (u) => (u.kind === "theme" ? `${u.name} theme` : u.kind === "title" ? `"${u.name}" title` : u.name);
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
    h("p", { class: "text-3 small", style: "margin:10px 0 0" }, "Some tiers also unlock website themes, profile titles and profile frames. Use them in ", h("a", { href: "/account#looks", text: "Account settings > Looks" }), "."),
    !me ? h("p", { class: "notice", text: "Link your Minecraft account (Account > Link) to earn XP and claim rewards." })
      : !me.pro ? h("p", { class: "text-3 small", style: "margin:10px 0 0" }, "The ", h("b", { text: "Pro+ track" }), " needs Galaxy Pro+. ", h("a", { href: "/store", text: "See plans" }), ".") : null);

  const claim = async (tier, track, btn) => {
    btn.disabled = true;
    try { const r = await postJson("/api/season/claim", { tier, track }); toast(r.message); load(); }
    catch (e) { toast(e.message); btn.disabled = false; }
  };
  // Horizontal track: one column per tier; a Free row and a Galaxy Pro+ row. Locked rewards are grayed out,
  // rewards you've reached have a Claim button, claimed ones show a check.
  const card = (t, i, track) => {
    const tier = i + 1, open = xp >= t.xp;
    const claimed = (track === "pro" ? me?.claimedPro : me?.claimedFree)?.includes(tier);
    const locked = track === "pro" && !me?.pro;
    const r = t[track];
    const keyKind = Object.keys(r.keys || {})[0];
    const u = r.unlock;
    const ic = u ? h("span", { class: `ss-ic look ${u.kind}` }, iconEl(u.kind === "theme" ? "contrast" : u.kind === "title" ? "tag" : "user")) : h("span", { class: "ss-ic" }, iconEl(keyKind ? "key" : "coins"));
    if (u?.colors) ic.style.background = `linear-gradient(135deg, ${u.colors[1]}, ${u.colors[2]})`;
    let foot;
    if (claimed) foot = h("span", { class: "ss-done", text: "Claimed ✓" });
    else if (open && me && !locked) {
      const b = h("button", { class: "btn btn-primary btn-sm ss-claim", type: "button", text: "Claim" });
      b.addEventListener("click", () => claim(tier, track, b));
      foot = b;
    } else foot = h("span", { class: "ss-lock" }, iconEl("lock"), locked && open ? "Pro+" : `${t.xp.toLocaleString()} XP`);
    const state = claimed ? "claimed" : open && me && !locked ? "ready" : "locked";
    const text = u ? `${unlockText(u)} + ${rewardText(r)}` : rewardText(r);
    return h("div", { class: `ss-card ${track} ${state}${u ? " has-look" : ""}`, title: text },
      ic, u ? h("div", { class: "ss-card-text" }, h("b", { class: "ss-look", text: unlockText(u) }), h("span", { text: rewardText(r) })) : h("div", { class: "ss-card-text", text: rewardText(r) }), foot);
  };
  const strip = h("div", { class: "ss-strip", role: "region", "aria-label": "Season rewards", tabindex: 0 },
    h("div", { class: "ss-labels" },
      h("span", { class: "ss-label-tier", text: "Tier" }),
      h("span", { class: "ss-label free", text: "Free" }),
      h("span", { class: "ss-label pro", text: "Galaxy Pro+" })),
    ...s.tiers.map((t, i) => h("div", { class: `ss-col${xp >= t.xp ? " reached" : ""}${i === level ? " current" : ""}` },
      h("span", { class: "ss-tier", text: String(i + 1) }), card(t, i, "free"), card(t, i, "pro"))));
  const ready = s.tiers.reduce((n, t, i) => n + (xp >= t.xp && me ? (!me.claimedFree.includes(i + 1) ? 1 : 0) + (me.pro && !me.claimedPro.includes(i + 1) ? 1 : 0) : 0), 0);
  const tiers = h("section", { class: "panel ss-tiers" },
    h("div", { class: "ss-tiers-head" }, h("h2", { class: "ss-h2", text: "Rewards" }),
      h("span", { class: "text-3 small", text: ready ? `${ready} reward${ready === 1 ? "" : "s"} ready to claim` : "Swipe to see every tier" })),
    strip);
  const top = h("section", { class: "panel" }, h("h2", { class: "ss-h2", text: "Top this season" }),
    d.top.length ? h("ol", { class: "leaderboard" }, ...d.top.map((t, i) => h("li", {}, h("span", { class: "lb-rank", text: String(i + 1) }),
      h("a", { class: "lb-name", href: `/player/${encodeURIComponent(t.name)}`, text: t.name }), h("span", { class: "lb-val", text: `${t.xp.toLocaleString()} XP` }))))
      : h("p", { class: "text-3", text: "Nobody has earned XP yet this season. Be the first!" }));

  root.replaceChildren(hero, tiers, top, h("p", { class: "text-3 small", text: "Rewards go to you in game: right away if you're online, or the next time you join. A new season starts by itself when this one ends." }));
  // start the strip at the first reward you can claim (or where you are now)
  const first = strip.querySelector(".ss-card.ready") || strip.querySelector(".ss-col.current");
  if (first) strip.scrollLeft = Math.max(0, first.closest(".ss-col").offsetLeft - 100);
}
load();
