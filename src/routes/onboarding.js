// Onboarding: a step-by-step welcome every member goes through once on the website (it can't be skipped).
// Steps: name (+ who can see it), rules, what they like to play, about them (bio + profile color),
// how they found the server (+ who invited them, staff only), notifications.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { checkMessage, compileWordList } from "../lib/filter.js";

export const INTERESTS = [
  { id: "building", name: "Building" }, { id: "survival", name: "Survival" }, { id: "exploring", name: "Exploring" },
  { id: "mining", name: "Mining" }, { id: "farming", name: "Farming" }, { id: "redstone", name: "Redstone" },
  { id: "minigames", name: "Minigames" }, { id: "pvp", name: "PvP" }, { id: "trading", name: "Trading & shops" },
  { id: "animals", name: "Pets & animals" }, { id: "decorating", name: "Decorating" }, { id: "friends", name: "Hanging out with friends" },
];
export const INTEREST_NAME = Object.fromEntries(INTERESTS.map((i) => [i.id, i.name]));
export const COLORS = ["#4F8CFF", "#8A5CFF", "#FF6FB5", "#FF5C5C", "#FFA23D", "#FFD447", "#3DDC84", "#2ED3C6"];
export const FOUND = [
  { id: "friend", name: "A friend" }, { id: "family", name: "Family" }, { id: "video", name: "A video (YouTube, TikTok...)" },
  { id: "list", name: "A server list" }, { id: "other", name: "Somewhere else" },
];

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const NAME_RE = /^[\p{L}][\p{L}' .-]{0,29}$/u;

export async function needsOnboarding(sql, userId) {
  const [u] = await sql`SELECT onboarded_at FROM users WHERE id = ${userId}`;
  return Boolean(u && !u.onboarded_at);
}

// GET /api/onboarding: what the steps need
export async function getOnboarding(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [u] = await sql`SELECT username, real_name, real_name_hidden, interests, bio, profile_color, found_via, onboarded_at FROM users WHERE id = ${user.id}`;
  const [first, ...rest] = String(u.real_name || "").split(" ");
  return json({
    ok: true, done: Boolean(u.onboarded_at), username: u.username,
    saved: { first: first || "", last: rest.join(" "), nameHidden: Boolean(u.real_name_hidden), interests: u.interests || [], bio: u.bio || "", color: u.profile_color || null, found: u.found_via || null },
    interests: INTERESTS, colors: COLORS, found: FOUND,
  }, 200, { "Cache-Control": "no-store" });
}

// POST /api/onboarding: everything at the end (the page checks each step first, this checks again)
export async function finishOnboarding(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request, 16384);
  const sql = getDb(env);
  const words = compileWordList(await sql`SELECT word, match FROM filter_words`);
  const ok = (text) => checkMessage(text, words, { allowLinks: false });

  const first = clean(body.first, 30), last = clean(body.last, 30);
  if (!first || !last) throw new HttpError(400, "Type your first and last name.");
  if (!NAME_RE.test(first) || !NAME_RE.test(last)) throw new HttpError(400, "Names can only use letters, spaces, - and '.");
  if (!ok(`${first} ${last}`).ok) throw new HttpError(400, "Please use your real name.");
  if (!body.rules) throw new HttpError(400, "Please read the rules and tick \"I agree\".");

  const interests = [...new Set((Array.isArray(body.interests) ? body.interests : []).map(String).filter((i) => INTEREST_NAME[i]))];
  if (!interests.length) throw new HttpError(400, "Pick at least one thing you like to play.");
  const bio = clean(body.bio, 120);
  if (bio) {
    const c = ok(bio);
    if (!c.ok) throw new HttpError(400, `About you: ${c.message}`);
  }
  const color = COLORS.includes(body.color) ? body.color : null;
  const found = FOUND.some((f) => f.id === body.found) ? body.found : null;
  if (!found) throw new HttpError(400, "Tell us how you found GalaxySMP.");
  const foundText = body.found === "other" ? clean(body.foundOther, 60) : "";
  let invitedBy = null;
  if (body.invitedBy) {
    const [inv] = await sql`SELECT id FROM users WHERE id = ${Number(body.invitedBy) || 0} AND id <> ${user.id}`;
    invitedBy = inv ? Number(inv.id) : null;
  }

  await sql`
    UPDATE users SET real_name = ${`${first} ${last}`}, real_name_hidden = ${Boolean(body.nameHidden)},
           rules_agreed_at = coalesce(rules_agreed_at, now()), interests = ${interests}, bio = ${bio || null},
           profile_color = ${color}, found_via = ${foundText ? `other: ${foundText}` : found}, invited_by = ${invitedBy},
           onboarded_at = coalesce(onboarded_at, now())
     WHERE id = ${user.id}`;
  return json({ ok: true });
}

// POST /api/account/profile { bio, interests, color } : edit the profile any time (Account > Profile)
export async function editProfile(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request, 8192);
  const sql = getDb(env);
  const interests = [...new Set((Array.isArray(body.interests) ? body.interests : []).map(String).filter((i) => INTEREST_NAME[i]))];
  const bio = clean(body.bio, 120);
  if (bio) {
    const words = compileWordList(await sql`SELECT word, match FROM filter_words`);
    const c = checkMessage(bio, words, { allowLinks: false });
    if (!c.ok) throw new HttpError(400, `About you: ${c.message}`);
  }
  const color = COLORS.includes(body.color) ? body.color : null;
  await sql`UPDATE users SET bio = ${bio || null}, interests = ${interests}, profile_color = ${color} WHERE id = ${user.id}`;
  return json({ ok: true });
}
