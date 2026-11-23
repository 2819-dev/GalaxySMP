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
  return rows[0] ? { welcome: rows[0].value, custom: true, updated: { at: rows[0].updated_at, by: rows[0].updated_by } } : { welcome: DEFAULT_WELCOME, custom: false, updated: null };
}

function validWelcome(body) {
  const intro = clean(body?.intro, 1200);
  if (!intro) throw new HttpError(400, "The welcome text can't be empty.");
  const tabs = (Array.isArray(body?.tabs) ? body.tabs : []).slice(0, 8).map((t, i) => {
    const title = clean(t?.title, 24);
    if (!title) throw new HttpError(400, `Tab ${i + 1} needs a name.`);
    return { title, text: clean(t?.text, 1500) };
  });
  return { enabled: body?.enabled !== false, intro, tabs };
}

// The latest news and the next event, shown as live info on the welcome screen.
export async function welcomeNews(sql) {
  const [n] = await sql`SELECT title FROM news_posts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`.catch(() => []);
  const [e] = await sql`SELECT title, starts_at FROM events WHERE deleted_at IS NULL AND starts_at > now() ORDER BY starts_at LIMIT 1`.catch(() => []);
  const when = e ? new Date(e.starts_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }) : null;
  return { title: n?.title || null, event: e?.title || null, when };
}

export async function welcomeMessage(sql) {
  return { type: "welcome", welcome: (await loadWelcome(sql)).welcome, news: await welcomeNews(sql) };
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
