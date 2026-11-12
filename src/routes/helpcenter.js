// #Support > Help Center: answers to common questions (Admins add and edit them right in #Support) plus every
// player command from the in-game Help menu. The new-ticket form suggests matching answers while you type.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { loadHelp } from "./help.js";

const ADMIN = 100;
const DEFAULTS = [
  ["Getting started", "How do I join the server?", "Open **How to Join** on the website. If you're new, press **Request to join**, type your gamertag and the owner will add you. Then add the server in Minecraft with the address and port shown there.", "join connect address ip port whitelist allowlist add"],
  ["Getting started", "How do I link my Minecraft account to the website?", "Make an account on the Community page, then type **/link** and your code in game. Linking shows your rank, picture and stats on the website.", "link account code connect website"],
  ["Getting started", "Is GalaxySMP free?", "Yes! Everything is free to play. **Galaxy+** and **Galaxy Pro+** are optional plans in the Store with extra perks.", "free cost pay money price"],
  ["Playing", "How do I get a plot?", "Type **/plot** in game to claim a plot and build safely. Only you (and people you add) can build there.", "plot land claim build protect home"],
  ["Playing", "How do I earn money?", "Do **jobs** (/jobs), daily quests (/quests), claim **/daily**, sell items to other players with shop chests, or trade on the Auction House (/ah).", "money earn rich jobs quests daily sell coins"],
  ["Playing", "I died and lost my items. Can I get them back?", "Keep Inventory is on, so you keep your items when you die. If items vanished because of a bug or crash, open a ticket with **Lost items** and tell staff what you had and where.", "lost items died death inventory crash missing"],
  ["Playing", "How do I play Bedwars and other minigames?", "Type **/minigames** or **/bedwars** in game, or walk into the Minigame Center at spawn.", "bedwars minigames skyblock creative game"],
  ["Store & plans", "I bought something but didn't get it.", "Purchases are delivered the next time you're on the server. If it still hasn't arrived after you join, open a **Store or payment** ticket with the time you bought it.", "store bought purchase payment missing plan galaxy plus pro credits"],
  ["Store & plans", "What do Galaxy+ and Galaxy Pro+ give me?", "See the **Store** page for the full list: a tag next to your name, extra plots, polls in chat, website shop listings, profile pictures and more.", "galaxy plus pro perks benefits plan subscription"],
  ["Safety", "Someone is being mean or breaking the rules.", "Use **/report** in game, or the **Report** button on their profile or message on the website. Staff will look at it. Never share personal information.", "report rule breaker bully mean hacker cheat grief"],
  ["Safety", "I was banned or muted. What can I do?", "If you think it was a mistake, send a ban appeal on the **Appeals** page. Be honest and explain what happened.", "ban banned mute muted appeal unban kicked"],
];

async function articles(sql) {
  let rows = await sql`SELECT * FROM help_articles ORDER BY position, id`;
  if (!rows.length) {
    const [{ seeded }] = await sql`SELECT EXISTS (SELECT 1 FROM economy_config WHERE key = 'help_center_seeded') AS seeded`;
    if (!seeded) {  // first time: start with useful answers (Admins can change or remove them)
      await sql.transaction([
        ...DEFAULTS.map(([category, question, answer, keywords], i) =>
          sql`INSERT INTO help_articles (category, question, answer, keywords, position, updated_by) VALUES (${category}, ${question}, ${answer}, ${keywords}, ${i}, 'GalaxySMP')`),
        sql`INSERT INTO economy_config (key, value, updated_by) VALUES ('help_center_seeded', 'true'::jsonb, 'server') ON CONFLICT DO NOTHING`,
      ]);
      rows = await sql`SELECT * FROM help_articles ORDER BY position, id`;
    }
  }
  return rows.map((a) => ({ id: Number(a.id), category: a.category, question: a.question, answer: a.answer, keywords: a.keywords }));
}

// GET /api/help-center
export async function helpCenter(request, env) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  const [list, help] = await Promise.all([articles(sql), loadHelp(sql)]);
  return json({
    ok: true, canEdit: Number(me.role_power) >= ADMIN, articles: list,
    commands: (help.help.commands || []).filter((c) => !c.staff).map((c) => ({ command: c.command, description: c.description, example: c.example || "" })),
  });
}

const clean = (v, max) => String(v ?? "").replace(/\r/g, "").trim().slice(0, max);

// POST /api/help-center { id?, category, question, answer, keywords }  (Admins)
export async function saveArticle(request, env) {
  const me = await requireUser(request, env);
  if (Number(me.role_power) < ADMIN) throw new HttpError(403, "Only Admins can edit the Help Center.");
  const b = await readJson(request);
  const category = clean(b.category, 40) || "General";
  const question = clean(b.question, 160);
  const answer = clean(b.answer, 2000);
  if (question.length < 5) throw new HttpError(400, "Write the question.");
  if (answer.length < 5) throw new HttpError(400, "Write the answer.");
  const keywords = clean(b.keywords, 300).toLowerCase();
  const sql = getDb(env);
  if (b.id) {
    const [r] = await sql`UPDATE help_articles SET category = ${category}, question = ${question}, answer = ${answer}, keywords = ${keywords},
                                 updated_by = ${me.username}, updated_at = now() WHERE id = ${Number(b.id)} RETURNING id`;
    if (!r) throw new HttpError(404, "That answer no longer exists.");
  } else {
    await sql`INSERT INTO help_articles (category, question, answer, keywords, position, updated_by)
              VALUES (${category}, ${question}, ${answer}, ${keywords}, (SELECT coalesce(max(position), 0) + 1 FROM help_articles), ${me.username})`;
  }
  return json({ ok: true });
}

// POST /api/help-center/:id/delete  (Admins)
export async function deleteArticle(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  if (Number(me.role_power) < ADMIN) throw new HttpError(403, "Only Admins can edit the Help Center.");
  await getDb(env)`DELETE FROM help_articles WHERE id = ${Number(params.id) || 0}`;
  return json({ ok: true });
}
