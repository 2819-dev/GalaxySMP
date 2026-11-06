// Shared database queries for chat messages.

export const REACTIONS = ["👍", "❤️", "😂", "😮", "🎉", "🔥"];
export const HISTORY_PAGE = 50;

// Turns a database row into what the browser receives.
export function formatMessage(r) {
  return {
    id: Number(r.id),
    channelId: Number(r.channel_id),
    content: r.content,
    createdAt: r.created_at,
    author: { id: Number(r.author_id), username: r.username, role: r.role_key, color: r.color },
    replyTo: r.reply_to
      ? {
          id: Number(r.reply_to),
          username: r.reply_username,
          content: r.reply_deleted ? null : String(r.reply_content || "").slice(0, 120),
        }
      : null,
    reactions: (r.reactions || []).map((x) => ({ emoji: x.emoji, users: x.users.map(Number) })),
  };
}

const SELECT = `
  SELECT m.id, m.channel_id, m.content, m.created_at, m.reply_to,
         u.id AS author_id, u.username, r.key AS role_key, r.color,
         p.content AS reply_content, pu.username AS reply_username,
         (p.id IS NOT NULL AND p.deleted_at IS NOT NULL) AS reply_deleted,
         COALESCE((
           SELECT json_agg(json_build_object('emoji', x.emoji, 'users', x.users) ORDER BY x.first)
             FROM (SELECT emoji, array_agg(user_id ORDER BY created_at) AS users, min(created_at) AS first
                     FROM reactions WHERE message_id = m.id GROUP BY emoji) x
         ), '[]'::json) AS reactions
    FROM messages m
    JOIN users u ON u.id = m.user_id
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN messages p ON p.id = m.reply_to
    LEFT JOIN users pu ON pu.id = p.user_id`;

export async function loadHistory(sql, channelId, beforeId) {
  const rows = await sql.query(
    `${SELECT} WHERE m.channel_id = $1 AND m.deleted_at IS NULL AND ($2::bigint IS NULL OR m.id < $2)
      ORDER BY m.id DESC LIMIT ${HISTORY_PAGE}`,
    [channelId, beforeId ?? null]
  );
  return rows.reverse().map(formatMessage);
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
