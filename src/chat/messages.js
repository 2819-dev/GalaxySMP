// Shared database queries for chat messages.

export const REACTIONS = ["👍", "❤️", "😂", "😮", "🎉", "🔥"];
export const HISTORY_PAGE = 50;

// The player's in-game rank (the same roles show on the website), from rank_* columns.
export function rankOf(r) {
  return r.rank_prefix
    ? { name: r.rank_name, prefix: r.rank_prefix, color: r.rank_color, icon: r.rank_icon || null, gradient: r.rank_gradient || null, position: r.rank_position, priority: r.rank_priority ?? 100 }
    : null;
}


// Turns a database row into what the browser receives.
export function formatMessage(r) {
  return {
    id: Number(r.id),
    channelId: Number(r.channel_id),
    content: r.content,
    createdAt: r.created_at,
    seen: Boolean(r.seen_at),          // another member has seen it (it can't be edited after that)
    editedAt: r.edited_at || null,
    author: { id: r.author_id ? Number(r.author_id) : 0, username: r.username || r.game_name || "Player", role: r.role_key || "member", color: r.color || null, rank: rankOf(r) },
    fromGame: Boolean(r.game_xuid),
    replyTo: r.reply_to
      ? {
          id: Number(r.reply_to),
          username: r.reply_username,
          content: r.reply_deleted ? null : String(r.reply_content || "").slice(0, 120),
        }
      : null,
    reactions: (r.reactions || []).map((x) => ({ emoji: x.emoji, users: x.users.map(Number) })),
    pinned: Boolean(r.pinned_at),
    pollId: r.poll_id ? Number(r.poll_id) : null,
    image: r.image_id ? { id: Number(r.image_id), w: r.image_w, h: r.image_h } : null,
  };
}

const SELECT = `
  SELECT m.id, m.channel_id, m.content, m.created_at, m.game_xuid, m.game_name, m.reply_to, m.seen_at, m.edited_at, m.pinned_at, m.poll_id, m.image_id, mi.width AS image_w, mi.height AS image_h,
         u.id AS author_id, u.username, r.key AS role_key, r.color,
         rk.name AS rank_name, rk.prefix AS rank_prefix, rk.color AS rank_color, rk.icon AS rank_icon, rk.gradient AS rank_gradient, rk.position AS rank_position,
         p.content AS reply_content, pu.username AS reply_username,
         (p.id IS NOT NULL AND p.deleted_at IS NOT NULL) AS reply_deleted,
         COALESCE((
           SELECT json_agg(json_build_object('emoji', x.emoji, 'users', x.users) ORDER BY x.first)
             FROM (SELECT emoji, array_agg(user_id ORDER BY created_at) AS users, min(created_at) AS first
                     FROM reactions WHERE message_id = m.id GROUP BY emoji) x
         ), '[]'::json) AS reactions
    FROM messages m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN players pl ON pl.xuid = COALESCE(m.game_xuid, (SELECT x.xuid FROM players x WHERE x.uuid = u.mc_uuid LIMIT 1))
    LEFT JOIN player_top_rank prk ON prk.xuid = pl.xuid
    LEFT JOIN ranks rk ON rk.id = prk.rank_id
    LEFT JOIN messages p ON p.id = m.reply_to
    LEFT JOIN users pu ON pu.id = p.user_id
    LEFT JOIN message_images mi ON mi.id = m.image_id`;

export async function loadHistory(sql, channelId, beforeId) {
  const rows = await sql.query(
    `${SELECT} WHERE m.channel_id = $1 AND m.deleted_at IS NULL AND ($2::bigint IS NULL OR m.id < $2)
      ORDER BY m.id DESC LIMIT ${HISTORY_PAGE}`,
    [channelId, beforeId ?? null]
  );
  return rows.reverse().map(formatMessage);
}

// The messages around one message (for "jump to" from search and pins): 25 before, 25 after.
export async function loadAround(sql, channelId, id) {
  const before = await sql.query(`${SELECT} WHERE m.channel_id = $1 AND m.deleted_at IS NULL AND m.id <= $2 ORDER BY m.id DESC LIMIT 26`, [channelId, id]);
  const after = await sql.query(`${SELECT} WHERE m.channel_id = $1 AND m.deleted_at IS NULL AND m.id > $2 ORDER BY m.id LIMIT 25`, [channelId, id]);
  return { messages: [...before.reverse(), ...after].map(formatMessage), hasMore: before.length >= 26, hasNewer: after.length >= 25 };
}

export async function loadPins(sql, channelId) {
  const rows = await sql.query(`${SELECT} WHERE m.channel_id = $1 AND m.deleted_at IS NULL AND m.pinned_at IS NOT NULL ORDER BY m.pinned_at DESC LIMIT 50`, [channelId]);
  return rows.map(formatMessage);
}

// Search the text channels the member can see: words in the message, optionally by one person or in one channel.
export async function searchMessages(sql, { q, channelId, from, staff = false, limit = 30 }) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 5)
    .map((w) => `%${w.replace(/[%_\\]/g, "\\$&")}%`);
  if (!words.length && !from) return [];
  const rows = await sql.query(
    `${SELECT}
      JOIN channels ch ON ch.id = m.channel_id
     WHERE m.deleted_at IS NULL AND ch.kind = 'text' AND NOT ch.hidden AND (NOT ch.staff_only OR $4::boolean)
       AND ($1::int IS NULL OR m.channel_id = $1)
       AND ($2::text IS NULL OR u.username_lower = lower($2))
       AND (SELECT bool_and(m.content ILIKE w) FROM unnest($3::text[]) w)
     ORDER BY m.id DESC LIMIT ${Math.min(50, limit)}`,
    [channelId ?? null, from || null, words.length ? words : ["%"], Boolean(staff)]);
  return rows.map(formatMessage);
}

export async function loadMessage(sql, id) {
  const rows = await sql.query(`${SELECT} WHERE m.id = $1`, [id]);
  return rows[0] ? formatMessage(rows[0]) : null;
}

export async function loadReactions(sql, messageId) {
  const rows = await sql`
    SELECT emoji, array_agg(user_id ORDER BY created_at) AS users
      FROM reactions WHERE message_id = ${messageId}
     GROUP BY emoji ORDER BY min(created_at)`;
  return rows.map((r) => ({ emoji: r.emoji, users: r.users.map(Number) }));
}
