// Direct messages between community members. They also work in game: a DM shows in the player's
// game chat when they're online, and /dm <player> <message> in game sends one.
// The server owners can read DMs for safety (stated in the privacy policy).
import { permsOfUser } from "../lib/perms.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { checkMessage, compileWordList, maxLengthFor } from "../lib/filter.js";
import { isOwner } from "../lib/names.js";
import { hubStub } from "./chat.js";
import { headUrlFor } from "./heads.js";
import { toPlugin } from "./economy.js";
import { checkPlugin } from "./ranks.js";
import { notify as pushNotify } from "./notify.js";

const MAX = 500;
const clean = (v) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, MAX);
const pair = (x, y) => (Number(x) < Number(y) ? [Number(x), Number(y)] : [Number(y), Number(x)]);

async function notify(env, payload) {
  try {
    await hubStub(env).fetch("https://hub/internal/broadcast", { method: "POST", body: JSON.stringify({ type: "dm", ...payload }) }); // payload.type can override
  } catch { /* live update is best effort */ }
}

async function loadUser(sql, id) {
  const [u] = await sql`
    SELECT u.id, u.username, u.platform, u.banned, u.muted_until, u.mute_shown, r.power, p.xuid, p.head_at, p.gamerpic_at,
           (p.online_at > now() - interval '150 seconds') AS in_game
      FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN players p ON p.uuid = u.mc_uuid
     WHERE u.id = ${id}`;
  return u || null;
}

const userOut = (u) => ({ id: Number(u.id), username: u.username, head: headUrlFor(u), inGame: Boolean(u.in_game) });

// The one place every DM goes through (website and game).
async function sendDm(env, sql, from, to, text, via, audioId = null, imageId = null, formId = null) {
  if (!to || to.banned) throw new HttpError(404, "That member can't receive messages.");
  if (to.is_bot === true || (await sql`SELECT is_bot FROM users WHERE id = ${to.id}`)[0]?.is_bot) throw new HttpError(400, "GalaxySMP is the server's own account, so it can't read DMs. Open a ticket in #Support if you need help.");
  if (Number(from.id) === Number(to.id)) throw new HttpError(400, "You can't message yourself.");
  if (from.banned) throw new HttpError(403, "Your account has been banned.");
  if (from.muted_until && new Date(from.muted_until) > new Date()) throw new HttpError(403, "You're muted, so you can't send messages right now." + (from.mute_shown ? ` Reason: ${from.mute_shown}` : ""));
  const body = clean(text);
  if (!body && !audioId && !imageId) throw new HttpError(400, "Type a message first.");
  const words = compileWordList(await sql`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`);
  const fromPerms = { perms: await permsOfUser(env, sql, from.id) };
  const check = body ? checkMessage(body, words, { allowLinks: fromPerms.perms.includes("post_links"), maxLength: maxLengthFor(fromPerms) }) : { ok: true, text: "" };
  if (!check.ok) {
    await import("./mod.js").then((m) => m.logBlock(env, { userId: from.id, place: "dm", content: body, reason: check.reason, detail: check.detail }));
    throw new HttpError(400, check.message);
  }
  if (audioId) {  // a voice message the sender just recorded (not used anywhere yet)
    const [a] = await sql`SELECT a.id FROM message_audio a WHERE a.id = ${audioId} AND a.user_id = ${from.id}
                           AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.audio_id = a.id) AND NOT EXISTS (SELECT 1 FROM dm_messages y WHERE y.audio_id = a.id)`;
    if (!a) throw new HttpError(400, "That recording isn't available. Record it again.");
  }
  if (imageId) {  // a picture (Galaxy Pro+ and the owner), uploaded first with POST /api/chat/images
    const { uploadRights } = await import("./uploads.js");
    const r = await uploadRights(sql, { id: from.id, owner: Boolean(from.owner), perms: [] });
    if (r.blocked) throw new HttpError(403, "Staff turned off picture uploads for your account.");
    if (!r.dm) throw new HttpError(403, "Pictures in DMs are a Galaxy Pro+ perk.");
    const [i] = await sql`SELECT i.id FROM message_images i WHERE i.id = ${imageId} AND i.user_id = ${from.id}
                           AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.image_id = i.id) AND NOT EXISTS (SELECT 1 FROM dm_messages y WHERE y.image_id = i.id)`;
    if (!i) throw new HttpError(400, "That picture isn't available. Add it again.");
  }
  const [blocked] = await sql`SELECT 1 FROM dm_blocks WHERE (user_id = ${to.id} AND blocked_id = ${from.id}) OR (user_id = ${from.id} AND blocked_id = ${to.id})`;
  if (blocked) throw new HttpError(403, "You can't message this member.");
  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id
     WHERE m.sender_id = ${from.id} AND m.created_at > now() - interval '1 minute'`;
  if (n >= 12) throw new HttpError(429, "You're sending messages too fast. Please wait a moment.");
  const [a, b] = pair(from.id, to.id);
  const fromIsA = Number(from.id) === a;
  const [thread] = await sql`
    INSERT INTO dm_threads (user_a, user_b, last_message_at, a_unread, b_unread)
    VALUES (${a}, ${b}, now(), ${fromIsA ? 0 : 1}, ${fromIsA ? 1 : 0})
    ON CONFLICT (user_a, user_b) DO UPDATE SET last_message_at = now(),
      a_unread = dm_threads.a_unread + ${fromIsA ? 0 : 1}, b_unread = dm_threads.b_unread + ${fromIsA ? 1 : 0}
    RETURNING id`;
  const [msg] = await sql`INSERT INTO dm_messages (thread_id, sender_id, body, via, audio_id, image_id, form_id) VALUES (${thread.id}, ${from.id}, ${check.text}, ${via}, ${audioId}, ${imageId}, ${formId}) RETURNING id, created_at`;
  const [au] = audioId ? await sql`SELECT duration_ms FROM message_audio WHERE id = ${audioId}` : [];
  const [im] = imageId ? await sql`SELECT width, height FROM message_images WHERE id = ${imageId}` : [];
  const out = { id: Number(msg.id), threadId: Number(thread.id), from: Number(from.id), fromName: from.username, to: Number(to.id), body: check.text, at: msg.created_at, via,
    audio: au ? { id: Number(audioId), ms: Number(au.duration_ms) } : null,
    image: im ? { id: Number(imageId), w: Number(im.width), h: Number(im.height) } : null,
    form: formId ? { id: Number(formId) } : null };
  await notify(env, out);
  try { // phone/computer notification for the recipient, unless they have this conversation open right now
    const r = await hubStub(env).fetch(`https://hub/internal/viewing?user=${Number(to.id)}&view=dm:${Number(from.id)}`).then((x) => x.json()).catch(() => ({}));
    if (!r.viewing) await pushNotify(env, [to.id], "dms", { title: `Message from ${from.username}`, body: check.text || (imageId ? "📷 Picture" : "🎤 Voice message"), url: "/community#messages", tag: `dm-${from.id}` });
  } catch { /* best effort */ }
  // in game: show it to the recipient if they're playing (the plugin delivers game-to-game DMs itself)
  if (via === "web" && to.xuid && (check.text || imageId)) {
    const text = formId ? `${check.text} (open your DMs on galaxymc.us to answer it)`
      : imageId ? `${check.text ? check.text + " " : ""}[sent a picture: see it on galaxymc.us]` : check.text;
    try { await toPlugin(env, { type: "dm", toXuid: String(to.xuid), from: from.username, text }); } catch { /* server offline */ }
  }
  return out;
}

// ---------- website ----------
export async function listThreads(request, env) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  const rows = await sql`
    SELECT t.id, t.last_message_at, CASE WHEN t.user_a = ${me.id} THEN t.a_unread ELSE t.b_unread END AS unread,
           o.id AS other_id, o.username, p.xuid, p.head_at, p.gamerpic_at, (p.online_at > now() - interval '150 seconds') AS in_game,
           (SELECT CASE WHEN m.call IS NOT NULL THEN (CASE m.call->>'status' WHEN 'missed' THEN '📞 Missed call' WHEN 'declined' THEN '📞 Call declined' ELSE '📞 Call' END) WHEN m.body = '' AND m.image_id IS NOT NULL THEN '📷 Picture' WHEN m.body = '' AND m.audio_id IS NOT NULL THEN '🎤 Voice message' ELSE m.body END FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS preview,
           (SELECT sender_id FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_sender
      FROM dm_threads t
      JOIN users o ON o.id = CASE WHEN t.user_a = ${me.id} THEN t.user_b ELSE t.user_a END
      LEFT JOIN players p ON p.uuid = o.mc_uuid
     WHERE t.user_a = ${me.id} OR t.user_b = ${me.id}
     ORDER BY t.last_message_at DESC LIMIT 100`;
  const blocks = await sql`SELECT blocked_id FROM dm_blocks WHERE user_id = ${me.id}`;
  return json({
    ok: true,
    threads: rows.map((r) => ({
      id: Number(r.id), unread: r.unread, at: r.last_message_at, preview: r.preview, mine: Number(r.last_sender) === Number(me.id),
      other: userOut({ id: r.other_id, username: r.username, xuid: r.xuid, head_at: r.head_at, gamerpic_at: r.gamerpic_at, in_game: r.in_game }),
    })),
    blocked: blocks.map((b) => Number(b.blocked_id)),
    unread: rows.reduce((n, r) => n + Number(r.unread || 0), 0),
  });
}

// A call's line in the DM conversation between the person who called (or added them) and the person called:
// info = { status: "ended" | "missed" | "declined", seconds, group } ("group": more than two people were in the call).
export async function logCall(env, fromId, toId, info) {
  const sql = getDb(env);
  const [a, b] = pair(fromId, toId);
  if (a === b) return;
  const fromIsA = Number(fromId) === a;
  const unread = info.status === "missed" ? 1 : 0;   // a missed call shows as new for the person who missed it
  const [thread] = await sql`
    INSERT INTO dm_threads (user_a, user_b, last_message_at, a_unread, b_unread)
    VALUES (${a}, ${b}, now(), ${fromIsA ? 0 : unread}, ${fromIsA ? unread : 0})
    ON CONFLICT (user_a, user_b) DO UPDATE SET last_message_at = now(),
      a_unread = dm_threads.a_unread + ${fromIsA ? 0 : unread}, b_unread = dm_threads.b_unread + ${fromIsA ? unread : 0}
    RETURNING id`;
  const call = { status: String(info.status), seconds: Math.max(0, Math.round(Number(info.seconds) || 0)), group: Boolean(info.group) };
  const [msg] = await sql`INSERT INTO dm_messages (thread_id, sender_id, body, via, call) VALUES (${thread.id}, ${fromId}, '', 'web', ${JSON.stringify(call)}::jsonb) RETURNING id, created_at`;
  const [from] = await sql`SELECT username FROM users WHERE id = ${fromId}`;
  await notify(env, { id: Number(msg.id), threadId: Number(thread.id), from: Number(fromId), fromName: from?.username || "", to: Number(toId), body: "", at: msg.created_at,
    via: "web", audio: null, image: null, form: null, call });
}

export async function getConversation(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  const other = await loadUser(sql, Number(params.userId));
  if (!other) throw new HttpError(404, "That member doesn't exist.");
  const [a, b] = pair(me.id, other.id);
  const [thread] = await sql`SELECT id FROM dm_threads WHERE user_a = ${a} AND user_b = ${b}`;
  let messages = [];
  if (thread) {
    const before = Number(url.searchParams.get("before")) || null;
    const rows = await sql`
      SELECT d.id, d.sender_id, d.body, d.via, d.created_at, d.read_at, d.edited_at, d.audio_id, a.duration_ms, d.image_id, i.width AS img_w, i.height AS img_h, d.form_id, d.call FROM dm_messages d
        LEFT JOIN message_audio a ON a.id = d.audio_id LEFT JOIN message_images i ON i.id = d.image_id
       WHERE d.thread_id = ${thread.id} AND (${before}::bigint IS NULL OR d.id < ${before})
       ORDER BY d.id DESC LIMIT 60`;
    messages = rows.reverse().map((m) => ({ id: Number(m.id), from: Number(m.sender_id), body: m.body, via: m.via, at: m.created_at,
      read: Boolean(m.read_at), editedAt: m.edited_at || null, audio: m.audio_id ? { id: Number(m.audio_id), ms: Number(m.duration_ms) } : null,
      image: m.image_id ? { id: Number(m.image_id), w: Number(m.img_w), h: Number(m.img_h) } : null,
      form: m.form_id ? { id: Number(m.form_id) } : null, call: m.call || null }));
    // opening the conversation reads their messages: the sender can't edit them any more
    // (looking as this member with "Act as Member" doesn't mark their messages as read)
    const read = me.acting_by ? [] : await sql`UPDATE dm_messages SET read_at = now() WHERE thread_id = ${thread.id} AND sender_id <> ${me.id} AND read_at IS NULL RETURNING id`;
    if (read.length) await notify(env, { type: "dm_read", ids: read.map((r) => Number(r.id)), from: Number(me.id), to: Number(other.id) });
    if (!me.acting_by) await sql`UPDATE dm_threads SET a_unread = CASE WHEN user_a = ${me.id} THEN 0 ELSE a_unread END,
                                   b_unread = CASE WHEN user_b = ${me.id} THEN 0 ELSE b_unread END WHERE id = ${thread.id}`;
  }
  const [blockedByMe] = await sql`SELECT 1 FROM dm_blocks WHERE user_id = ${me.id} AND blocked_id = ${other.id}`;
  return json({ ok: true, threadId: thread ? Number(thread.id) : null, other: userOut(other), messages, blocked: Boolean(blockedByMe) });
}

export async function postMessage(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const from = { ...(await loadUser(sql, me.id)), owner: Boolean(me.owner) };
  const to = await loadUser(sql, Number(params.userId));
  const audioId = Number.isInteger(Number(body.audioId)) && Number(body.audioId) > 0 ? Number(body.audioId) : null;
  const imageId = Number.isInteger(Number(body.imageId)) && Number(body.imageId) > 0 ? Number(body.imageId) : null;
  const msg = await sendDm(env, sql, from, to, body.body, "web", audioId, imageId);
  return json({ ok: true, message: msg });
}

export async function setBlock(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const other = Number(params.userId);
  if (other === Number(me.id)) throw new HttpError(400, "You can't block yourself.");
  if (body.blocked) await sql`INSERT INTO dm_blocks (user_id, blocked_id) VALUES (${me.id}, ${other}) ON CONFLICT DO NOTHING`;
  else await sql`DELETE FROM dm_blocks WHERE user_id = ${me.id} AND blocked_id = ${other}`;
  return json({ ok: true, blocked: Boolean(body.blocked) });
}

// ---------- owners: read any conversation (for safety) ----------
async function requireOwner(request, env) {
  const user = await requireUser(request, env);
  if (!isOwner(env, user.username, user.platform === "bedrock")) throw new HttpError(403, "Only the server owners can do that.");
  return user;
}

export async function ownerThreads(request, env, ctx, url) {
  await requireOwner(request, env);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 32);
  const sql = getDb(env);
  const rows = await sql`
    SELECT t.id, t.last_message_at, a.id AS a_id, a.username AS a_name, b.id AS b_id, b.username AS b_name,
           (SELECT count(*)::int FROM dm_messages m WHERE m.thread_id = t.id) AS count,
           (SELECT CASE WHEN m.body = '' AND m.image_id IS NOT NULL THEN '📷 Picture' WHEN m.body = '' AND m.audio_id IS NOT NULL THEN '🎤 Voice message' ELSE m.body END FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS preview
      FROM dm_threads t JOIN users a ON a.id = t.user_a JOIN users b ON b.id = t.user_b
     WHERE ${q} = '' OR lower(a.username) LIKE ${"%" + q + "%"} OR lower(b.username) LIKE ${"%" + q + "%"}
     ORDER BY t.last_message_at DESC LIMIT 100`;
  return json({ ok: true, threads: rows.map((r) => ({ id: Number(r.id), at: r.last_message_at, count: r.count, preview: r.preview,
    a: { id: Number(r.a_id), username: r.a_name }, b: { id: Number(r.b_id), username: r.b_name } })) });
}

export async function ownerThread(request, env, ctx, url, params) {
  const owner = await requireOwner(request, env);
  const sql = getDb(env);
  const [t] = await sql`SELECT t.id, a.username AS a_name, b.username AS b_name FROM dm_threads t
                          JOIN users a ON a.id = t.user_a JOIN users b ON b.id = t.user_b WHERE t.id = ${Number(params.id)}`;
  if (!t) throw new HttpError(404, "That conversation doesn't exist.");
  const rows = await sql`SELECT m.id, m.body, m.via, m.created_at, m.image_id, m.audio_id, u.username FROM dm_messages m LEFT JOIN users u ON u.id = m.sender_id
                          WHERE m.thread_id = ${t.id} ORDER BY m.id DESC LIMIT 300`;
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${owner.id}, 'dm.read', ${JSON.stringify({ between: [t.a_name, t.b_name] })}::jsonb)`;
  return json({ ok: true, between: [t.a_name, t.b_name],
    messages: rows.reverse().map((m) => ({ id: Number(m.id), from: m.username || "?", via: m.via, at: m.created_at,
      body: [m.body, m.image_id ? `[📷 Picture: /api/chat/images/${m.image_id}]` : "", !m.body && m.audio_id ? "🎤 Voice message" : ""].filter(Boolean).join(" "),
      image: m.image_id ? { id: Number(m.image_id) } : null })) });
}

// ---------- the game: /dm <player> <message> ----------
export async function pluginDm(request, env) {
  await checkPlugin(request, env);
  const b = await readJson(request);
  const sql = getDb(env);
  const fromXuid = String(b.fromXuid || "");
  const toName = String(b.to || "").trim().toLowerCase();
  const [fromRow] = await sql`SELECT u.id FROM players p JOIN users u ON u.mc_uuid = p.uuid WHERE p.xuid = ${fromXuid}`;
  if (!fromRow) return json({ ok: false, message: "Link your account first: type /link and follow the steps on galaxymc.us." });
  // the exact name first; a name that only starts with what was typed must be the only one (never message "Bobby" for "Bob")
  let targets = await sql`
    SELECT u.id FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
     WHERE lower(u.username) = ${toName} OR lower(p.gamertag) = ${toName}
     LIMIT 1`;
  if (!targets.length) {
    targets = await sql`SELECT u.id FROM users u WHERE lower(u.username) LIKE ${toName.replace(/[\\%_]/g, (c) => "\\" + c) + "%"} LIMIT 2`;
    if (targets.length > 1) return json({ ok: false, message: `More than one member's name starts with "${b.to}". Type their full name.` });
  }
  if (!targets.length) return json({ ok: false, message: `No community member called ${b.to}. They need to link their account on galaxymc.us first.` });
  const from = await loadUser(sql, fromRow.id);
  const to = await loadUser(sql, targets[0].id);
  try {
    const msg = await sendDm(env, sql, from, to, b.text, "game");
    return json({ ok: true, to: to.username, toXuid: to.xuid ? String(to.xuid) : null, text: msg.body });
  } catch (e) {
    return json({ ok: false, message: e.message });
  }
}

// Edit your own DM, only while the other person hasn't read it yet.
export async function editMessage(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const [m] = await sql`
    SELECT m.id, m.sender_id, m.read_at, t.user_a, t.user_b FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id WHERE m.id = ${Number(params.id)}`;
  if (!m) throw new HttpError(404, "That message no longer exists.");
  if (Number(m.sender_id) !== Number(me.id)) throw new HttpError(403, "You can only edit your own messages.");
  if (m.read_at) throw new HttpError(409, "They've already read this message, so it can't be edited.");
  const from = await loadUser(sql, me.id);
  if (from.muted_until && new Date(from.muted_until) > new Date()) throw new HttpError(403, "You're muted, so you can't edit messages right now.");
  const text = clean(body.body);
  if (!text) throw new HttpError(400, "Type a message first.");
  const words = compileWordList(await sql`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`);
  const fromPerms = { perms: await permsOfUser(env, sql, from.id) };
  const check = checkMessage(text, words, { allowLinks: fromPerms.perms.includes("post_links"), maxLength: maxLengthFor(fromPerms) });
  if (!check.ok) throw new HttpError(400, check.message);
  const [done] = await sql`UPDATE dm_messages SET body = ${check.text}, edited_at = now() WHERE id = ${m.id} AND read_at IS NULL RETURNING id, edited_at`;
  if (!done) throw new HttpError(409, "They've just read this message, so it can't be edited any more.");
  const other = Number(m.user_a) === Number(me.id) ? Number(m.user_b) : Number(m.user_a);
  await notify(env, { type: "dm_edit", id: Number(m.id), body: check.text, editedAt: done.edited_at, from: Number(me.id), to: other });
  return json({ ok: true, body: check.text, editedAt: done.edited_at });
}

// ---------- secure forms (the owner only) ----------
// The owner sends questions in a DM (e.g. "Full name"). The member answers in the conversation; the answers are
// encrypted (AES-GCM, key derived from a server secret) and only the owner can read them, not even the member
// afterwards. Answering is optional: the member can decline.
async function formKey(env) {
  const root = env.FORMS_KEY || env.VAPID_PRIVATE_KEY;   // a secret that only exists on Cloudflare (not in the plugin)
  if (!root) throw new HttpError(503, "Secure forms aren't set up on this server.");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(root)), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("galaxysmp-dm-forms"), info: new Uint8Array() },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await formKey(env), new TextEncoder().encode(JSON.stringify(obj))));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
async function unseal(env, text) {
  const [, iv, ct] = String(text).split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await formKey(env), unb64(ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

function formOut(f, me, ownerView) {
  return {
    id: Number(f.id), title: f.title || "", questions: f.questions, status: f.status,
    mine: Number(f.to_id) === Number(me.id),       // I'm the one asked to answer
    sender: ownerView, createdAt: f.created_at, answeredAt: f.answered_at || null,
  };
}

// POST /api/dm/forms { to: userId, title, questions: ["Full name", ...] }   (the owner)
export async function createForm(request, env) {
  const owner = await requireOwner(request, env);
  const body = await readJson(request);
  const questions = (Array.isArray(body.questions) ? body.questions : []).map((q) => String(q || "").replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean);
  if (!questions.length) throw new HttpError(400, "Add at least one question.");
  if (questions.length > 8) throw new HttpError(400, "A form can have up to 8 questions.");
  const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  const sql = getDb(env);
  const from = { ...(await loadUser(sql, owner.id)), owner: true };
  const to = await loadUser(sql, Number(body.to) || 0);
  if (!to) throw new HttpError(404, "That member doesn't exist.");
  const [f] = await sql`INSERT INTO dm_forms (from_id, to_id, title, questions) VALUES (${owner.id}, ${to.id}, ${title}, ${JSON.stringify(questions)}::jsonb) RETURNING id`;
  const msg = await sendDm(env, sql, from, to, `🔒 Secure form${title ? `: ${title}` : ""}`, "web", null, null, Number(f.id));
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${owner.id}, 'dm.form_sent', ${JSON.stringify({ to: to.username, questions: questions.length })}::jsonb)`;
  return json({ ok: true, message: msg });
}

// GET /api/dm/forms/:id   (the member it was sent to, or the owner)
export async function getForm(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  const [f] = await sql`SELECT * FROM dm_forms WHERE id = ${Number(params.id) || 0}`;
  const ownerView = Boolean(me.owner && !me.acting_by);
  if (!f || (!ownerView && Number(f.to_id) !== Number(me.id))) throw new HttpError(404, "That form isn't available.");
  const out = formOut(f, me, ownerView);
  // only the owner sees the answers (decrypted here, on request)
  if (ownerView && f.status === "answered" && f.answers) {
    try { out.answers = await unseal(env, f.answers); } catch { out.answers = null; out.unreadable = true; }
    await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${me.id}, 'dm.form_read', ${JSON.stringify({ form: Number(f.id) })}::jsonb)`;
  }
  return json({ ok: true, form: out });
}

// POST /api/dm/forms/:id/:action   answer { answers: [...] } | decline   (the member)   delete   (the owner)
export async function formAction(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  const [f] = await sql`SELECT * FROM dm_forms WHERE id = ${Number(params.id) || 0}`;
  if (!f) throw new HttpError(404, "That form isn't available.");
  const action = params.action;
  if (action === "delete") {
    if (!me.owner) throw new HttpError(403, "Only the owner can delete a form's answers.");
    await sql`UPDATE dm_forms SET answers = NULL, status = 'deleted' WHERE id = ${f.id}`;
    await notify(env, { type: "dm_form", id: Number(f.id), from: Number(f.from_id), to: Number(f.to_id) });
    return json({ ok: true, message: "The answers were deleted." });
  }
  if (Number(f.to_id) !== Number(me.id)) throw new HttpError(403, "This form was sent to someone else.");
  if (f.status !== "waiting") throw new HttpError(409, "This form was already answered.");
  if (action === "decline") {
    await sql`UPDATE dm_forms SET status = 'declined', answered_at = now() WHERE id = ${f.id} AND status = 'waiting'`;
  } else if (action === "answer") {
    const body = await readJson(request);
    const answers = (Array.isArray(body.answers) ? body.answers : []).slice(0, f.questions.length).map((a) => String(a || "").replace(/\r/g, "").trim().slice(0, 500));
    if (answers.length !== f.questions.length || answers.some((a) => !a)) throw new HttpError(400, "Answer every question, or tap Decline.");
    const sealed = await seal(env, answers);
    const [ok] = await sql`UPDATE dm_forms SET status = 'answered', answers = ${sealed}, answered_at = now() WHERE id = ${f.id} AND status = 'waiting' RETURNING id`;
    if (!ok) throw new HttpError(409, "This form was already answered.");
  } else throw new HttpError(400, "Unknown action.");
  await notify(env, { type: "dm_form", id: Number(f.id), from: Number(f.from_id), to: Number(f.to_id) });
  try {
    await pushNotify(env, [Number(f.from_id)], "dms", { title: `${me.username} ${action === "answer" ? "answered" : "declined"} your secure form`,
      body: action === "answer" ? "Open the conversation to read the answers." : "They chose not to answer.", url: "/community#messages", tag: `dm-form-${f.id}` });
  } catch { /* best effort */ }
  return json({ ok: true, message: action === "answer" ? "Sent securely. Only the owner can see your answers." : "You declined the form." });
}

// ---------- the game: Mail on the Main Menu ----------
// POST /api/plugin/mail { uuid, markRead }  -> your latest conversations and notifications, for the in-game Mail page.
export async function pluginMail(request, env) {
  await checkPlugin(request, env);
  const b = await readJson(request);
  const uuid = String(b.uuid || "");
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return json({ ok: false, error: "Bad player id." });
  const sql = getDb(env);
  const [me] = await sql`SELECT id, muted_until, mute_shown FROM users WHERE mc_uuid = ${uuid}::uuid AND NOT is_bot AND NOT banned`;
  if (!me) return json({ ok: true, linked: false, threads: [], notifications: [], unread: 0 });
  const muted = me.muted_until && new Date(me.muted_until) > new Date() ? { until: new Date(me.muted_until).getTime(), reason: me.mute_shown || "" } : null;
  const threads = await sql`
    SELECT t.id, t.last_message_at,
           CASE WHEN t.user_a = ${me.id} THEN t.a_unread ELSE t.b_unread END AS unread,
           o.username AS other,
           (SELECT m.body FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
           (SELECT (m.sender_id = ${me.id}) FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_mine
      FROM dm_threads t JOIN users o ON o.id = CASE WHEN t.user_a = ${me.id} THEN t.user_b ELSE t.user_a END
     WHERE (t.user_a = ${me.id} OR t.user_b = ${me.id}) AND t.last_message_at IS NOT NULL
     ORDER BY t.last_message_at DESC LIMIT 12`;
  const notes = await sql`SELECT id, title, body, created_at, read_at FROM notifications
                           WHERE user_id = ${me.id} ORDER BY created_at DESC LIMIT 15`;
  const unread = threads.reduce((n, t) => n + (Number(t.unread) > 0 ? 1 : 0), 0) + notes.filter((n) => !n.read_at).length;
  if (b.markRead) {
    await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${me.id} AND read_at IS NULL`;
  }
  return json({
    ok: true, linked: true, unread, muted,
    threads: threads.map((t) => ({ id: Number(t.id), with: t.other, at: t.last_message_at, unread: Number(t.unread) || 0,
      last: String(t.last_body || "").slice(0, 160), mine: !!t.last_mine })),
    notifications: notes.map((n) => ({ id: Number(n.id), title: String(n.title || "").slice(0, 80), body: String(n.body || "").slice(0, 200),
      at: n.created_at, unread: !n.read_at })),
  });
}

// POST /api/plugin/mail/thread { uuid, id } -> the last messages of one conversation (marks it read).
export async function pluginMailThread(request, env) {
  await checkPlugin(request, env);
  const b = await readJson(request);
  const uuid = String(b.uuid || "");
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return json({ ok: false, error: "Bad player id." });
  const sql = getDb(env);
  const [me] = await sql`SELECT id FROM users WHERE mc_uuid = ${uuid}::uuid AND NOT is_bot AND NOT banned`;
  if (!me) return json({ ok: false, error: "Link your account first." });
  const [t] = await sql`SELECT id, user_a, user_b FROM dm_threads WHERE id = ${Number(b.id) || 0} AND (user_a = ${me.id} OR user_b = ${me.id})`;
  if (!t) return json({ ok: false, error: "That conversation doesn't exist." });
  const rows = await sql`SELECT m.body, m.image_id, m.audio_id, m.created_at, u.username, (m.sender_id = ${me.id}) AS mine
                           FROM dm_messages m LEFT JOIN users u ON u.id = m.sender_id
                          WHERE m.thread_id = ${t.id} ORDER BY m.id DESC LIMIT 15`;
  await sql`UPDATE dm_messages SET read_at = now() WHERE thread_id = ${t.id} AND sender_id <> ${me.id} AND read_at IS NULL`;
  if (Number(t.user_a) === Number(me.id)) await sql`UPDATE dm_threads SET a_unread = 0 WHERE id = ${t.id}`;
  else await sql`UPDATE dm_threads SET b_unread = 0 WHERE id = ${t.id}`;
  return json({ ok: true, messages: rows.reverse().map((m) => ({ from: m.username || "?", mine: !!m.mine, at: m.created_at,
    body: String(m.body || (m.image_id ? "📷 Picture" : m.audio_id ? "🎤 Voice message" : "")).slice(0, 300) })) });
}
