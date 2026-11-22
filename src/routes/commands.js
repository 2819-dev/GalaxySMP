// Chat commands: type /level, /top, /coinflip... in any chat, or pick one with the Commands button (the "+" next to
// the message box), which shows a small form instead of typing.
//
// Who sees the answer depends on the command:
//   "public"   GalaxySMP posts the answer in the chat for everyone ("Bob used /coinflip")
//   "private"  only the person who ran it sees it (their balance, a staff confirmation...)
// A public answer in a channel you can't post in (or while muted) is shown only to you instead.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { can } from "../lib/perms.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { hubBroadcast } from "./chat.js";
import { botPost, levelInfo, levelFor } from "../chat/engage.js";

// Each option: { name, label, type: "text" | "member" | "number" | "choice", required, choices, hint, max }
export const COMMANDS = [
  // ---- Chat ----
  { name: "level", group: "Chat", description: "See your chat level, or someone else's", show: "public",
    options: [{ name: "member", label: "Member (leave empty for you)", type: "member" }] },
  { name: "top", group: "Chat", description: "The top 10 chatters", show: "public", options: [] },
  { name: "help", group: "Chat", description: "Every command you can use", show: "private", options: [] },
  // ---- Players ----
  { name: "balance", group: "Players", description: "Your in-game money", show: "private", options: [] },
  { name: "stats", group: "Players", description: "A player's stats: playtime, blocks, kills...", show: "public",
    options: [{ name: "player", label: "Player (leave empty for you)", type: "member" }] },
  { name: "online", group: "Players", description: "Who's playing on the server right now", show: "public", options: [] },
  // ---- Fun ----
  { name: "coinflip", group: "Fun", description: "Flip a coin", show: "public", options: [] },
  { name: "roll", group: "Fun", description: "Roll a dice", show: "public",
    options: [{ name: "sides", label: "Sides", type: "number", min: 2, max: 1000, hint: "6 if empty" }] },
  { name: "8ball", group: "Fun", description: "Ask the Magic 8 Ball a yes-or-no question", show: "public",
    options: [{ name: "question", label: "Your question", type: "text", required: true, max: 150 }] },
  // ---- Server ----
  { name: "status", group: "Server", description: "Is the server online, and how many are playing", show: "public", options: [] },
  { name: "ip", group: "Server", description: "How to join GalaxySMP", show: "public", options: [] },
  // ---- Staff ----
  { name: "giveaway", group: "Staff", description: "Start a giveaway in #Giveaways", show: "private", perm: "run_giveaways", form: "giveaway", options: [] },
  { name: "slowmode", group: "Staff", description: "Slow mode in this channel", show: "private", perm: "delete_messages",
    options: [{ name: "seconds", label: "Seconds between messages", type: "choice", required: true,
      choices: [["0", "Off"], ["5", "5 seconds"], ["10", "10 seconds"], ["30", "30 seconds"], ["60", "1 minute"], ["300", "5 minutes"], ["900", "15 minutes"], ["3600", "1 hour"]] }] },
  { name: "mute", group: "Staff", description: "Mute a member in chat", show: "private", perm: "mute_members",
    options: [{ name: "member", label: "Member", type: "member", required: true },
      { name: "minutes", label: "For how long", type: "choice", required: true, choices: [["10", "10 minutes"], ["60", "1 hour"], ["1440", "1 day"], ["10080", "7 days"], ["43200", "30 days"]] },
      { name: "reason", label: "Reason (they see it)", type: "text", max: 200 }] },
  { name: "unmute", group: "Staff", description: "Unmute a member", show: "private", perm: "mute_members",
    options: [{ name: "member", label: "Member", type: "member", required: true }] },
  { name: "quietmode", group: "Staff", description: "Quiet Mode: slow mode on every channel for a while", show: "private", perm: "admin_panel",
    options: [{ name: "action", label: "Turn it", type: "choice", required: true, choices: [["on", "On"], ["off", "Off"]] },
      { name: "length", label: "For how long (like 30m, 3h, 1d)", type: "text", max: 20, hint: "3h" },
      { name: "gap", label: "Wait between messages (like 30s, 5m)", type: "text", max: 20, hint: "5m" }] },
  { name: "say", group: "Staff", description: "Post a message here as GalaxySMP", show: "private", perm: "post_staff_channels",
    options: [{ name: "message", label: "Message", type: "text", required: true, max: 1500 }] },
];
const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));
const allowed = (user, c) => !c.perm || can(user, c.perm);

const EIGHT_BALL = ["It is certain.", "Without a doubt.", "Yes, definitely.", "You may rely on it.", "Most likely.", "Outlook good.", "Signs point to yes.",
  "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.",
  "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful."];
const num = (n) => Number(n || 0).toLocaleString("en-US");
const dollars = (c) => `$${(Math.floor(Number(c || 0)) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const hours = (s) => { const h = Math.floor(Number(s || 0) / 3600); return h >= 1 ? `${num(h)} hour${h === 1 ? "" : "s"}` : `${Math.floor(Number(s || 0) / 60)} minutes`; };

// GET /api/chat/commands: the commands this member can use (for the Commands button and typing "/")
export async function listCommands(request, env) {
  const user = await requireUser(request, env);
  return json({ ok: true, commands: COMMANDS.filter((c) => allowed(user, c)).map(({ perm, ...c }) => ({ ...c, staff: Boolean(perm) })) });
}

// Turns typed "/roll 20" or "/mute Steve 60 spamming" into { name, args } using the command's options in order
// (the last text option takes the rest of the line).
export function parseTyped(line) {
  const m = /^\/([a-z0-9]+)(?:\s+([\s\S]*))?$/i.exec(String(line || "").trim());
  if (!m) return null;
  const c = BY_NAME.get(m[1].toLowerCase());
  if (!c) return { unknown: m[1].toLowerCase() };
  const words = (m[2] || "").trim() ? m[2].trim().split(/\s+/) : [];
  const args = {};
  c.options.forEach((o, i) => {
    if (!words.length) return;
    const last = i === c.options.length - 1;   // the last option takes the rest of the line
    args[o.name] = last ? words.splice(0).join(" ") : words.shift();
  });
  return { name: c.name, args };
}

async function findMember(sql, name) {
  const n = String(name || "").replace(/^@/, "").trim().toLowerCase().slice(0, 32);
  if (!n) return null;
  const [u] = await sql`SELECT u.id, u.username, p.gamertag FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
                         WHERE (u.username_lower = ${n} OR lower(p.gamertag) = ${n}) AND NOT u.banned AND NOT u.is_bot LIMIT 1`;
  return u || null;
}

// Calls one of the site's own JSON handlers as this member (same sign-in), and returns its answer.
async function callAs(request, handler, path, { method = "GET", body = null, params = {} } = {}, env, ctx) {
  const url = new URL(path, request.url);
  const req = new Request(url, { method, headers: { Cookie: request.headers.get("Cookie") || "", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  try {
    const res = await handler(req, env, ctx, url, params);
    return await res.json();
  } catch (e) {
    if (e instanceof HttpError) return { ok: false, error: e.message };
    throw e;
  }
}

// Runs a command. Returns { text, show: "public" | "private" }.
async function run(request, env, ctx, sql, user, c, args, channel) {
  const say = (text, show = c.show) => ({ text, show });
  switch (c.name) {
    case "help": {
      const mine = COMMANDS.filter((x) => allowed(user, x));
      const groups = [...new Set(mine.map((x) => x.group))];
      return say("**Commands** (type them, or tap **+** › **Commands**)\n" + groups.map((g) => `**${g}**\n` +
        mine.filter((x) => x.group === g).map((x) => `\`/${x.name}${x.options.map((o) => o.required ? ` <${o.name}>` : ` [${o.name}]`).join("")}\` ${x.description}`).join("\n")).join("\n\n"));
    }
    case "level": {
      let who = { id: user.id, username: user.username };
      if (args.member) {
        who = await findMember(sql, args.member);
        if (!who) return say(`I couldn't find a member called "${String(args.member).slice(0, 32)}".`, "private");
      }
      const i = await levelInfo(sql, who.id);
      const bar = "▰".repeat(Math.round((i.into / i.next) * 10)).padEnd(10, "▱");
      return say(`**${who.username}** is chat level **${i.level}** (#${i.rank} on the server)\n${bar} ${num(i.into)} / ${num(i.next)} XP to level ${i.level + 1}`);
    }
    case "top": {
      const rows = await sql`SELECT u.username, x.xp FROM chat_xp x JOIN users u ON u.id = x.user_id WHERE NOT u.banned AND NOT u.is_bot ORDER BY x.xp DESC LIMIT 10`;
      if (!rows.length) return say("Nobody has any chat XP yet. Start chatting!");
      const medal = ["🥇", "🥈", "🥉"];
      return say("**Top chatters**\n" + rows.map((r, i) => `${medal[i] || `${i + 1}.`} ${r.username}: level ${levelFor(Number(r.xp)).level} (${num(r.xp)} XP)`).join("\n"));
    }
    case "balance": {
      const [p] = await sql`SELECT p.gamertag, p.xuid FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
      if (!p) return say("Link your Minecraft account first (type /link in game) to see your money here.");
      const { profile } = await import("./progress.js");
      const d = await callAs(request, profile, `/api/players/${encodeURIComponent(p.gamertag)}`, { params: { name: p.gamertag } }, env, ctx);
      if (!d.ok) return say("Your balance isn't available right now. Try again in a minute.");
      return say(`💰 You have **${dollars(d.player?.money)}** in game${d.player?.positions?.money ? ` (#${d.player.positions.money} on the server)` : ""}.`);
    }
    case "stats": {
      let name = args.player;
      if (!name) {
        const [p] = await sql`SELECT p.gamertag FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
        if (!p) return say("Link your Minecraft account first (type /link in game), or type a player's name.", "private");
        name = p.gamertag;
      } else {
        const m = await findMember(sql, name);
        if (m?.gamertag) name = m.gamertag;
      }
      const { profile } = await import("./progress.js");
      const d = await callAs(request, profile, `/api/players/${encodeURIComponent(name)}`, { params: { name } }, env, ctx);
      if (!d.ok || !d.player) return say(`I couldn't find a player called "${String(name).slice(0, 32)}".`, "private");
      const s = d.player.stats || {};
      return say(`📊 **${d.player.name}**\nPlaytime: ${hours(s.playtime)} · Blocks mined: ${num(s.mined)} · Placed: ${num(s.placed)}\n` +
        `Mobs defeated: ${num(s.kills)} · Deaths: ${num(s.deaths)} · Quests: ${num(s.quests)} · Daily streak: ${num(s.streak)}` +
        (d.player.bedwars?.games ? `\nBedwars: ${num(d.player.bedwars.wins)} wins in ${num(d.player.bedwars.games)} games` : ""));
    }
    case "online": {
      const { online } = await import("./online.js");
      const d = await callAs(request, (req, e) => online(req, e), "/api/online", {}, env, ctx);
      if (!d.up) return say("The server is offline right now.");
      if (!d.count) return say("Nobody is playing right now. Be the first!");
      const names = (d.players || []).map((p) => p.name || p.gamertag).filter(Boolean);
      return say(`🟢 **${d.count}** playing now: ${names.slice(0, 30).join(", ")}${names.length > 30 ? ` and ${names.length - 30} more` : ""}`);
    }
    case "coinflip":
      return say(`🪙 It's **${crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? "Heads" : "Tails"}**!`);
    case "roll": {
      const sides = Math.max(2, Math.min(1000, Math.round(Number(args.sides) || 6)));
      return say(`🎲 Rolled a **${1 + (crypto.getRandomValues(new Uint32Array(1))[0] % sides)}** (1 to ${sides}).`);
    }
    case "8ball": {
      const q = String(args.question || "").trim();
      if (!q) return say("Ask a question, like `/8ball Will I find diamonds today?`", "private");
      return say(`🎱 *${q.slice(0, 150)}*\n**${EIGHT_BALL[crypto.getRandomValues(new Uint8Array(1))[0] % EIGHT_BALL.length]}**`);
    }
    case "status": {
      const { handleStatus } = await import("./status.js");
      const d = await (await handleStatus(new Request(new URL("/api/status", request.url)), ctx, env)).json().catch(() => ({}));
      return say(d.online ? `🟢 **GalaxySMP is online** with ${d.players?.online || 0} player${d.players?.online === 1 ? "" : "s"}${d.version ? ` (Minecraft ${d.version})` : ""}.`
        : "🔴 **GalaxySMP is offline** right now. Check back soon!");
    }
    case "ip":
      return say("**How to join GalaxySMP** (Minecraft Bedrock)\nAddress: `galaxymc.smp.live` · Port: `9030`\nOn Xbox, PlayStation or Switch: add a friend on the GalaxySMP account and join from the Friends tab.");
    case "slowmode": {
      const { slowmode } = await import("./chat.js");
      const d = await callAs(request, slowmode, `/api/chat/channels/${channel.id}/slowmode`, { method: "POST", body: { seconds: Number(args.seconds) || 0 }, params: { id: String(channel.id) } }, env, ctx);
      return say(d.ok ? `${d.message} (in #${channel.name})` : d.error);
    }
    case "mute":
    case "unmute": {
      const target = await findMember(sql, args.member);
      if (!target) return say(`I couldn't find a member called "${String(args.member || "").slice(0, 32)}".`);
      const mod = await import("./mod.js");
      const d = await callAs(request, mod[c.name], `/api/mod/users/${target.id}/${c.name}`,
        { method: "POST", body: { minutes: Number(args.minutes), reason: args.reason || "" }, params: { id: String(target.id) } }, env, ctx);
      if (!d.ok) return say(d.error || "That didn't work.");
      return say(c.name === "mute" ? `🔇 **${target.username}** is muted for ${BY_NAME.get("mute").options[1].choices.find((x) => x[0] === String(args.minutes))?.[1] || `${args.minutes} minutes`}.`
        : `🔊 **${target.username}** is unmuted.`);
    }
    case "quietmode": {
      const q = await import("./quiet.js");
      if (args.action === "off") return say((await q.endQuiet(env, sql, user)) ? "Quiet Mode is off. Each channel's slow mode is back to how it was." : "Quiet Mode wasn't on.");
      if (!args.length || !args.gap) return say('Say how long it lasts and the wait between messages, like `/quietmode on 3h 5m`.');
      const { state, length } = await q.startQuiet(env, sql, user, { duration: args.length, gap: args.gap });
      return say(`Quiet Mode is on for ${q.formatDuration(length)}: one message every ${q.formatDuration(state.seconds)} in each channel. It ends ${new Date(state.until).toUTCString().replace(" GMT", " UTC")}.`);
    }
    case "say": {
      const text = String(args.message || "").trim().slice(0, 1500);
      if (!text) return say("Write a message.");
      const m = await botPost(sql, { channelId: channel.id, content: text, kind: "bot" });
      if (m) await hubBroadcast(env, { type: "message", message: m });
      await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'chat.say', ${JSON.stringify({ channel: channel.name, text: text.slice(0, 200) })}::jsonb)`;
      return say(`Posted in #${channel.name} as GalaxySMP.`);
    }
    case "giveaway": {
      const { startGiveaway, prizeLabel } = await import("./giveaways.js");
      const { giveaway } = await startGiveaway(env, sql, user, args);
      return say(`🎉 Giveaway **${giveaway.title}** started in #Giveaways (prize: ${prizeLabel(giveaway)}). It ends ${new Date(giveaway.ends_at).toUTCString().replace(" GMT", " UTC")}.`);
    }
  }
  return say("That command isn't ready yet.", "private");
}

// POST /api/chat/command { channelId, name, args } or { channelId, line: "/roll 20" }
export async function runCommand(request, env, ctx) {
  const user = await requireUser(request, env);
  await rateLimit(env, "POLL_LIMITER", `cmd:${user.id}`);
  const body = await readJson(request);
  let name = String(body.name || "").toLowerCase();
  let args = body.args && typeof body.args === "object" ? body.args : {};
  if (body.line) {
    const p = parseTyped(body.line);
    if (!p) throw new HttpError(400, "Commands start with /, like /help.");
    if (p.unknown) return json({ ok: true, show: "private", text: `There's no \`/${p.unknown.slice(0, 20)}\` command. Type \`/help\` to see them all.` });
    ({ name, args } = p);
  }
  const c = BY_NAME.get(name);
  if (!c) throw new HttpError(404, "Unknown command.");
  if (!allowed(user, c)) throw new HttpError(403, "Your rank can't use that command.");
  for (const o of c.options) {
    const v = args[o.name];
    if (o.required && (v == null || String(v).trim() === "")) throw new HttpError(400, `Fill in "${o.label}".`);
    if (v != null && String(v).length > (o.max || 100)) throw new HttpError(400, `"${o.label}" is too long.`);
    if (v != null && String(v) !== "" && o.type === "choice" && !o.choices.some((x) => x[0] === String(v))) throw new HttpError(400, `Choose a "${o.label}".`);
  }
  const sql = getDb(env);
  // the chat it was run in: must be one this member can see
  const [channel] = await sql`
    SELECT c.id, c.name, c.kind, (c.min_post_power <= 10 OR ${can(user, "post_staff_channels")}) AS can_post
      FROM channels c WHERE c.id = ${Number(body.channelId) || 0} AND NOT c.hidden AND (NOT c.staff_only OR ${can(user, "staff_chat")})`;
  if (!channel) throw new HttpError(404, "Unknown channel.");
  // fun and info answers are filtered like normal messages (a question in /8ball, say...)
  if (c.name === "8ball" || c.name === "say") {
    const { checkMessage, compileWordList } = await import("../lib/filter.js");
    {
      const words = compileWordList(await sql`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`);
      const text = c.name === "8ball" ? args.question : args.message;
      const chk = checkMessage(String(text || ""), words, { allowLinks: c.name === "say", maxLength: 1500 });
      if (!chk.ok) throw new HttpError(400, chk.message || "That isn't allowed.");
    }
  }
  const out = await run(request, env, ctx, sql, user, c, args, channel);
  let show = out.show;
  const muted = user.muted_until && new Date(user.muted_until) > new Date();
  if (show === "public" && (!channel.can_post || channel.kind !== "text" || muted)) show = "private";   // can't post there: only you see it
  if (show === "public") {
    const shown = c.options.filter((o) => args[o.name] != null && String(args[o.name]) !== "").map((o) => String(args[o.name]).slice(0, 60)).join(" ");
    const m = await botPost(sql, { channelId: channel.id, kind: "bot", content: out.text,
      meta: { command: `/${c.name}${shown ? " " + shown : ""}`, by: user.username, byId: Number(user.id) } });
    if (m) await hubBroadcast(env, { type: "message", message: m });
    return json({ ok: true, show: "public" });
  }
  return json({ ok: true, show: "private", text: out.text });
}
