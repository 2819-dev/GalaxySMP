// Release notes. Each entry is posted once to #Updates (tag "release") by the 5-minute timer after the update
// goes live, and members who get "Updates & polls" notifications are told about it.
// Add a new entry at the end with every update.
import { notify } from "../routes/notify.js";
import { isOwner } from "./names.js";

export const RELEASES = [
  {
    id: "2026-11-14",
    title: "What's new: #Jobs, Galaxy Wrapped, a new Store and Season Pass looks",
    body: `**#Jobs**
Post a job in the new #Jobs channel (under Market) and pay another player to gather, build or craft for you. The reward is held from your balance when you post and only paid out once you confirm the job is done, so nobody can run off with your money. You choose whether the first player to accept gets the job, or you pick from everyone who offers.

**Galaxy Wrapped**
Your time on GalaxySMP, told as a story. Every two months you get a recap of your playtime, blocks, best friend on the server and your player type, plus how the whole server did. The full yearly Wrapped arrives on December 1. Open it at galaxymc.us/wrapped.

**A new Store**
The Store has been redesigned from the ground up: browse ranks and items in simple rows, compare every plan side by side, and buy in one tap. Every rank and item now has a heart: tap it to add it to your wishlist, which appears on your profile so friends can gift it to you. The Galaxy Cube is now listed as coming soon.

**Season Pass looks**
The Season Pass now unlocks website themes, profile titles and profile frames as well as money and keys. Choose yours in Account settings > Looks. The most exclusive looks are on the Galaxy Pro+ track.

**Invites**
Invite links now open the request-to-join page, so every new player is still approved before they can play. You'll still earn your reward once they've played for an hour.

**Polish**
- Cleaner headlines, cards and wording across the whole website.
- The Galaxy Cube page now explains the new way consoles connect.
- Names without a rank are now easy to read in light mode.`,
  },
  {
    id: "2026-11-14b",
    title: "Store update: new artwork, all perks at a glance and easier browsing",
    body: `- **New artwork.** Every rank and item in the Store now has its own pixel-art picture.
- **See all perks.** Each plan has a "See all perks" button that lists everything it includes, grouped by category.
- **Easier browsing.** A category bar stays at the top as you scroll and shows where you are. Tap "See all" on any row to see every item at once instead of swiping.`,
  },
];

// Posts any release note that hasn't been posted yet (oldest first). Safe to call often.
export async function postReleases(env, sql) {
  const keys = RELEASES.map((r) => `release:${r.id}`);
  const done = new Set((await sql`SELECT key FROM economy_config WHERE key = ANY(${keys})`).map((r) => r.key));
  for (const r of RELEASES) {
    const key = `release:${r.id}`;
    if (done.has(key)) continue;
    const claimed = await sql`INSERT INTO economy_config (key, value, updated_by) VALUES (${key}, ${JSON.stringify(new Date().toISOString())}::jsonb, 'server')
                              ON CONFLICT (key) DO NOTHING RETURNING key`;
    if (!claimed.length) continue; // another run got it first
    const owners = await sql`SELECT id, username, platform FROM users WHERE NOT banned ORDER BY id LIMIT 200`;
    const author = owners.find((u) => isOwner(env, u.username, u.platform === "bedrock"));
    await sql`INSERT INTO news_posts (title, body, tag, author_id) VALUES (${r.title}, ${r.body}, 'release', ${author?.id || null})`;
    await notify(env, "all", "news", { title: "New update", body: r.title, url: "/community#updates", tag: `release-${r.id}` }).catch(() => {});
  }
}
