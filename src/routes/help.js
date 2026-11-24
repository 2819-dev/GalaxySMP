// The in-game Help menu (/guide): Server Information, Rules and Commands.
// Admins edit it in Staff Tools > Help menu; the server gets a copy over GalaxyLink's live
// connection. The website's Rules page shows the same rules.
import { can } from "../lib/perms.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { toPlugin } from "./economy.js";
import DEFAULT_HELP from "../../endstone-plugin/src/endstone_galaxylink/help_default.json";
import DEFAULT_WELCOME from "../../endstone-plugin/src/endstone_galaxylink/welcome_default.json";

const ADMIN = 100;

export async function loadHelp(sql) {
  const rows = await sql`SELECT value, updated_at, updated_by FROM economy_config WHERE key = 'help'`;
  return rows[0] ? { help: rows[0].value, custom: true, updated: { at: rows[0].updated_at, by: rows[0].updated_by } } : { help: DEFAULT_HELP, custom: false, updated: null };
}

const clean = (v, max) => String(v ?? "").replace(/\r/g, "").replace(/§/g, "").trim().slice(0, max);

function validHelp(body) {
  const info = clean(body?.info, 2000);
  if (!info) throw new HttpError(400, "Server Information can't be empty.");
  const rules = (Array.isArray(body?.rules) ? body.rules : []).slice(0, 15).map((s, i) => {
    const title = clean(s.title, 60);
    if (!title) throw new HttpError(400, `Rule section ${i + 1} needs a title.`);
    const items = (Array.isArray(s.items) ? s.items : []).map((x) => clean(x, 300)).filter(Boolean).slice(0, 20);
    return { title, items };
  });
  if (!rules.length) throw new HttpError(400, "Add at least one rule section.");
  const commands = (Array.isArray(body?.commands) ? body.commands : []).slice(0, 60).map((c, i) => {
    let command = clean(c.command, 60);
    if (command && !command.startsWith("/")) command = "/" + command;
    if (!/^\/[a-z0-9_-]+/i.test(command)) throw new HttpError(400, `Command ${i + 1} should start with / and a command name.`);
    let example = clean(c.example, 80);
    if (example && !example.startsWith("/")) example = "/" + example;
    return { command, description: clean(c.description, 160), example, staff: Boolean(c.staff) };
  });
  return { info, rules, commands };
}

// Public: the website's Rules page and anyone curious.
export async function getHelp(request, env) {
  const { help } = await loadHelp(getDb(env));
  return json({ ok: true, ...help, commands: help.commands.filter((c) => !c.staff) }, 200, { "Cache-Control": "public, max-age=60" });
}

async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (!can(user, "help_menu")) throw new HttpError(403, "Your rank can't edit the Help menu.");
  return user;
}

export async function adminGetHelp(request, env) {
  await requireAdmin(request, env);
  return json({ ok: true, ...(await loadHelp(getDb(env))) });
}

export async function adminHelpAction(request, env, ctx, url, params) {
  const user = await requireAdmin(request, env);
  const sql = getDb(env);
  let help;
  if (params.action === "save") {
    help = validHelp((await readJson(request, 65536)).help);
    await sql`
      INSERT INTO economy_config (key, value, updated_by) VALUES ('help', ${JSON.stringify(help)}::jsonb, ${user.username})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  } else if (params.action === "reset") {
    help = DEFAULT_HELP;
    await sql`DELETE FROM economy_config WHERE key = 'help'`;
  } else {
    throw new HttpError(400, "Unknown action.");
  }
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, ${params.action === "save" ? "help.save" : "help.reset"}, '{}'::jsonb)`;
  const sent = await toPlugin(env, { type: "help", help });
  return json({ ok: true, help, sent });
}

// ---------- the in-game welcome screen (full screen on every join; text edited here, next to the Help menu) ----------
export async function loadWelcome(sql) {
  const rows = await sql`SELECT value, updated_at, updated_by FROM economy_config WHERE key = 'welcome'`;
  if (rows[0] && !rows[0].value.siftCard) {
    // The Sift arrived after this Main Menu was saved: add its card once (staff can remove it, and it stays removed)
    const v = rows[0].value, sift = DEFAULT_WELCOME.servers.find((s) => s.action === "sift");
    if (sift && Array.isArray(v.servers) && v.servers.length < 10 && !v.servers.some((s) => s.action === "sift")) v.servers = [...v.servers, sift];
    v.siftCard = true;
  }
  if (rows[0] && !rows[0].value.activityCards && Array.isArray(rows[0].value.servers)) {
    // Activity picture cards arrived after this Main Menu was saved: give the built-in servers their ready-made activities once
    for (const sv of rows[0].value.servers) {
      const def = DEFAULT_WELCOME.servers.find((d) => d.name === sv.name || (d.action === "sift" && sv.action === "sift"));
      if (def?.activities && !(sv.activities || []).length) sv.activities = def.activities;
    }
    rows[0].value.activityCards = true;
  }
  return rows[0] ? { welcome: { ...DEFAULT_WELCOME, ...rows[0].value }, custom: true, updated: { at: rows[0].updated_at, by: rows[0].updated_by } } : { welcome: DEFAULT_WELCOME, custom: false, updated: null };
}

const SERVER_IMAGES = ["galaxysmp", "event", "bedwars", "parkour", "build"];
const SERVER_ACTIONS = ["play", "spawn", "warp", "minigames", "sift", "soon"];
const ACTIVITY_PICS = ["survival", "pvp", "bedwars", "build", "event", "parkour", "plots", "shop", "pets", "adventure"];
const JOIN_BLOCKS = ["grass", "diamond", "gold", "emerald", "netherite", "amethyst", "lava", "ice", "galaxy", "ender", "rainbow"];

function validWelcome(body) {
  const intro = clean(body?.intro, 1200);
  if (!intro) throw new HttpError(400, "The How to Play overview can't be empty.");
  const tabs = (Array.isArray(body?.tabs) ? body.tabs : []).slice(0, 8).map((t, i) => {
    const title = clean(t?.title, 24);
    if (!title) throw new HttpError(400, `Tab ${i + 1} needs a name.`);
    return { title, text: clean(t?.text, 1500) };
  });
  const servers = (Array.isArray(body?.servers) ? body.servers : []).slice(0, 10).map((v, i) => {
    const name = clean(v?.name, 32);
    if (!name) throw new HttpError(400, `Server ${i + 1} needs a name.`);
    let image = String(v?.image || "galaxysmp").trim();
    if (!SERVER_IMAGES.includes(image)) {
      if (!/^https:\/\/[^\s"'<>]{4,300}$/.test(image)) throw new HttpError(400, `Server ${i + 1}: pick a picture, or paste a link that starts with https://`);
    }
    const action = SERVER_ACTIONS.includes(v?.action) ? v.action : "play";
    const warp = clean(v?.warp, 16);
    if (action === "warp" && !/^[A-Za-z0-9_-]{3,16}$/.test(warp)) throw new HttpError(400, `Server ${i + 1}: type the name of the warp it sends players to.`);
    const activities = (Array.isArray(v?.activities) ? v.activities : []).slice(0, 6).map((a, k) => {
      const title = clean(a?.title, 32);
      if (!title) throw new HttpError(400, `Server ${i + 1}, activity ${k + 1} needs a name.`);
      let pic = String(a?.pic || "event").trim();
      if (!ACTIVITY_PICS.includes(pic) && !/^https:\/\/[^\s"'<>]{4,300}$/.test(pic)) throw new HttpError(400, `Server ${i + 1}, activity ${k + 1}: pick a picture, or paste a link that starts with https://`);
      return { title, subtitle: clean(a?.subtitle, 48), text: clean(a?.text, 140), pic };
    });
    return { name, description: clean(v?.description, 90), tags: clean(v?.tags, 60), activities, image, action, warp: action === "warp" ? warp : "", enabled: v?.enabled !== false,
             anim: JOIN_BLOCKS.includes(v?.anim) ? v.anim : "grass", odds: Boolean(v?.odds), joinName: clean(v?.joinName, 24) || name };
  });
  if (!servers.some((v) => v.enabled && v.action === "play")) throw new HttpError(400, "Keep at least one server that's switched on and set to \"Play\" (the main server).");
  const splashes = (Array.isArray(body?.splashes) ? body.splashes : String(body?.splash || "").split("\n")).map((x) => clean(x, 60)).filter(Boolean).slice(0, 40);
  return { enabled: body?.enabled !== false, splashes, intro, tabs, servers, siftCard: true, activityCards: true };
}

// The latest news and the next event, shown as live info on the welcome screen.
export async function welcomeNews(sql) {
  const [n] = await sql`SELECT title FROM news_posts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`.catch(() => []);
  const [e] = await sql`SELECT title, starts_at FROM events WHERE deleted_at IS NULL AND starts_at > now() ORDER BY starts_at LIMIT 1`.catch(() => []);
  const when = e ? new Date(e.starts_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }) : null;
  return { title: n?.title || null, event: e?.title || null, when };
}

// Today's holiday for the Main Menu (the same days as the website's decorations and loading screen), or null.
const HOLIDAY_GREETS = {
  rosh: "Shanah Tovah!", sukkot: "Chag Sukkot Sameach!", chanukah: "Happy Chanukah!", tubishvat: "Happy Tu BiShvat!", purim: "Purim Sameach!",
  pesach: "Chag Pesach Sameach!", lagbaomer: "Happy Lag BaOmer!", shavuot: "Chag Shavuot Sameach!", newyear: "Happy New Year!",
  spring: "Happy first day of spring!", summer: "Happy first day of summer!", autumn: "Happy first day of autumn!", winter: "Happy first day of winter!",
};
export function holidayToday(now = new Date()) {
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const m = ny.getMonth() + 1, d = ny.getDate();
  let id = null, night = null;
  try {
    const fmt = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long", timeZone: "America/New_York" });
    const heb = (t) => { const o = {}; for (const p of fmt.formatToParts(t)) o[p.type] = p.value; return { day: Number(o.day), month: o.month || "" }; };
    const h = heb(now), is = (mo, a, b = a) => h.month === mo && h.day >= a && h.day <= b;
    if (is("Elul", 29) || is("Tishri", 1, 2)) id = "rosh";
    else if (is("Tishri", 14, 23)) id = "sukkot";
    else {
      for (let k = 0; k < 8 && !id; k++) { const b = heb(new Date(now.getTime() - k * 864e5)); if (b.month === "Kislev" && b.day === 24) { id = "chanukah"; night = k + 1; } }
      if (!id) {
        if (is("Shevat", 14, 15)) id = "tubishvat";
        else if (is("Adar", 13, 15) || is("Adar II", 13, 15)) id = "purim";
        else if (is("Nisan", 14, 22)) id = "pesach";
        else if (is("Iyar", 17, 18)) id = "lagbaomer";
        else if (is("Sivan", 5, 7)) id = "shavuot";
      }
    }
  } catch { /* no Hebrew calendar */ }
  if (!id) {
    if ((m === 12 && d === 31) || (m === 1 && d <= 2)) id = "newyear";
    else if (m === 3 && (d === 20 || d === 21)) id = "spring";
    else if (m === 6 && (d === 20 || d === 21)) id = "summer";
    else if (m === 9 && (d === 22 || d === 23)) id = "autumn";
    else if (m === 12 && (d === 21 || d === 22)) id = "winter";
  }
  return id ? { id, night, greet: id === "chanukah" ? `Happy Chanukah! Night ${night}` : HOLIDAY_GREETS[id] } : null;
}

export async function welcomeMessage(sql) {
  const news = await welcomeNews(sql);
  try {
    const { loadServerControl } = await import("./servercontrol.js");
    const sc = await loadServerControl(sql);
    news.holiday = sc.holidays?.on === false ? null : holidayToday();
  } catch (e) { console.error("holiday check failed", e); }
  return { type: "welcome", welcome: (await loadWelcome(sql)).welcome, news };
}

export async function adminGetWelcome(request, env) {
  await requireAdmin(request, env);
  return json({ ok: true, ...(await loadWelcome(getDb(env))) });
}

export async function adminWelcomeAction(request, env, ctx, url, params) {
  const user = await requireAdmin(request, env);
  const sql = getDb(env);
  if (params.action === "save") {
    const welcome = validWelcome((await readJson(request, 65536)).welcome);
    await sql`
      INSERT INTO economy_config (key, value, updated_by) VALUES ('welcome', ${JSON.stringify(welcome)}::jsonb, ${user.username})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  } else if (params.action === "reset") {
    await sql`DELETE FROM economy_config WHERE key = 'welcome'`;
  } else {
    throw new HttpError(400, "Unknown action.");
  }
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, ${params.action === "save" ? "welcome.save" : "welcome.reset"}, '{}'::jsonb)`;
  const sent = await toPlugin(env, await welcomeMessage(sql));
  return json({ ok: true, welcome: (await loadWelcome(sql)).welcome, sent });
}
