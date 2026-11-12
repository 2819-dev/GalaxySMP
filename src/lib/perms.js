// Website permissions. Each rank gets a list of these (Control Panel > Ranks > edit a rank). A member has every
// permission of every rank they hold; the owner has all of them. Separate from in-game commands.
export const PERMS = [
  // Community
  { key: "post_staff_channels", group: "Community", label: "Post in staff-only channels", hint: "#Announcements, #Updates, #Events and #Polls" },
  { key: "team_listed", group: "Community", label: "Listed on #Meet The Team", hint: "Shows on the team page and can write a team bio" },
  { key: "pin_messages", group: "Community", label: "Pin messages" },
  { key: "mention_everyone", group: "Community", label: "Mention @everyone and @here" },
  { key: "post_links", group: "Community", label: "Post links" },
  { key: "long_messages", group: "Community", label: "Longer messages (2,000 characters)" },
  { key: "chat_polls", group: "Community", label: "Make polls in chat", hint: "Galaxy+ and Galaxy Pro+ can always" },
  { key: "chat_pictures", group: "Community", label: "Send pictures in chat", hint: "Galaxy+ and Galaxy Pro+ can always" },
  { key: "voice_rooms", group: "Community", label: "Create voice rooms" },
  // Moderation
  { key: "mod_panel", group: "Moderation", label: "Mod Panel access", hint: "Opens the Staff Panel" },
  { key: "delete_messages", group: "Moderation", label: "Delete other people's messages" },
  { key: "handle_reports", group: "Moderation", label: "Handle reports", hint: "Chat and in-game reports" },
  { key: "answer_tickets", group: "Moderation", label: "Answer support tickets" },
  { key: "mute_members", group: "Moderation", label: "Mute and unmute members" },
  { key: "ban_members", group: "Moderation", label: "Ban and unban on the website" },
  { key: "review_appeals", group: "Moderation", label: "Review ban appeals" },
  { key: "remove_pictures", group: "Moderation", label: "Remove pictures and stop uploads" },
  { key: "remove_timeline", group: "Moderation", label: "Remove #Timeline posts and comments" },
  { key: "see_real_names", group: "Moderation", label: "See hidden real names" },
  // Admin Panel
  { key: "admin_panel", group: "Admin Panel", label: "Admin Panel access", hint: "Everything in the Mod Panel's pages, plus admin tools" },
  { key: "manage_ranks", group: "Admin Panel", label: "Manage ranks" },
  { key: "manage_badges", group: "Admin Panel", label: "Manage badges" },
  { key: "manage_economy", group: "Admin Panel", label: "Manage the economy (player money)" },
  { key: "give_plans", group: "Admin Panel", label: "Give plans (Galaxy+ / Pro+)" },
  { key: "promo_codes", group: "Admin Panel", label: "Promo codes" },
  { key: "help_menu", group: "Admin Panel", label: "Help menu and Help Center" },
  { key: "custom_emoji", group: "Admin Panel", label: "Custom emoji" },
  { key: "server_map", group: "Admin Panel", label: "Server map on/off" },
];
export const PERM_KEYS = new Set(PERMS.map((p) => p.key));
export const ALL_PERMS = [...PERM_KEYS];

// The staff level other parts of the site still use for ordering and simple checks, worked out from perms:
// 100 with Admin Panel access, 50 with Mod Panel access, otherwise a regular member.
export function tierFor(perms) {
  const set = perms instanceof Set ? perms : new Set(perms || []);
  return set.has("admin_panel") ? 100 : set.has("mod_panel") ? 50 : 10;
}

// Does this user (from getUser) have this permission?
export function can(user, key) {
  if (!user) return false;
  if (user.owner) return true;
  return Array.isArray(user.perms) ? user.perms.includes(key) : false;
}

// Permissions of any member by id (for code that has a user id but not a signed-in user).
export async function permsOfUser(env, sql, userId) {
  const { isOwner } = await import("./names.js");
  const [u] = await sql`
    SELECT u.username, u.platform,
           (SELECT coalesce(array_agg(DISTINCT pm), '{}') FROM players pl JOIN player_ranks x ON x.xuid = pl.xuid JOIN ranks rk ON rk.id = x.rank_id,
                   unnest(rk.web_perms) pm WHERE pl.uuid = u.mc_uuid) AS perms
      FROM users u WHERE u.id = ${userId}`;
  if (!u) return [];
  return isOwner(env, u.username, u.platform === "bedrock") ? ALL_PERMS : (u.perms || []).filter((p) => PERM_KEYS.has(p));
}
