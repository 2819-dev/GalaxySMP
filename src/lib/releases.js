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
  {
    id: "2026-11-15",
    title: "Gift cards, #Chat in game, public plots on the map and more",
    body: `**Gift cards**
Send Galaxy Credits as a beautifully designed gift card, with designs for birthdays, thank-yous, the winter holidays, Chanukah, Pesach, Rosh Hashanah, Purim and more. Add a personal message, pay with credits or a card, and share the private link. Your friend opens a wrapped gift box on screen and redeems the credits in one tap. Find them in the Store under Gift cards.

**#Chat is now part of the game**
Messages in #Chat appear in Minecraft chat, and what players say in game appears in #Chat, so you can talk with everyone online from your phone.

**Public plots on the map**
Free plots now show as green boxes on the map. Want others to see your build? Type /plot public in game, or tap your plot on the map. Public plots show your plot's name, photos and likes when someone taps them. Private plots no longer appear on the map.

**Auction House prices**
Every listing now shows the item's average price over the last 30 days and whether it's a good deal. Tap "Price history" for a chart.

**Achievement rarity**
Profiles now show how rare each achievement is, with Rare, Epic and Legendary tags for the hardest ones.

**Also new**
- "Add to calendar" on every event in #Events.
- New members get a Getting Started checklist with a $2,500 reward for finishing it.
- The Store is back to clean line icons.`,
  },
  {
    id: "2026-11-15b",
    title: "Gift cards get a new premium look",
    body: `Every gift card design has been redrawn with bold abstract artwork, rich gradients and a glassy finish. When someone opens your gift, the card now spins out of the box to show its designed back before landing in front of them.`,
  },
  {
    id: "2026-11-15c",
    title: "Design your own gift card",
    body: `Gift cards are now yours to design. Choose a background, add abstract artwork, pick a foil finish (gold, silver, rose gold or holographic) with a foil pattern, and choose a greeting or write your own. The ready-made designs are still there as one-tap starting points. Open the Store and tap "Design your own" under Gift cards.`,
  },
  {
    id: "2026-11-15d",
    title: "Gift card text limits",
    body: `Custom greetings on gift cards can now be up to 22 characters and personal messages up to 160, so every card looks great. A live counter under each field shows how many characters you've used and turns orange as you get close to the limit.`,
  },
  {
    id: "2026-11-16",
    title: "Plots can now change hands with their builds",
    body: `Staff can now unclaim a plot without clearing it. The builds stay in place and the plot becomes available to claim again, builds included. This is useful when a player leaves the server but their build is worth keeping for someone else.`,
  },
  {
    id: "2026-11-16b",
    title: "Rank badges in game and a more stable server",
    body: `- **Rank badges.** Rank badges now show as pictures above players' heads and in chat, at normal text size. They appear after the next server restart.
- **Rank order.** The member list on the website now follows the rank order exactly, and rank changes show the right tag straight away.
- **Stability.** The live map no longer reads parts of the world that aren't loaded, and unexpected server stops are now reported to staff so they can be fixed quickly.`,
  },
  {
    id: "2026-11-16c",
    title: "The live map is now in 3D",
    body: `Tap **3D** on the live map to see the world as blocks at their real heights: hills, mountains, lakes and builds, with players, spawn and plots on top. Drag to turn, use two fingers to move and pinch to zoom. Tap **2D** to go back to the flat map. The 3D view fills in as players explore, so new areas appear over the next few days.`,
  },
  {
    id: "2026-11-17",
    title: "Build Contests and Friends",
    body: `**Build Contests**
A new minigame you can host. Galaxy+ and Pro+ members choose Build Contest in the Minigame Center, pick a theme, a build time and an optional prize, and Minigame Staff approve it like any hosted game. Everyone who joins gets their own plot and builds in Creative. Your own items are kept safe and returned at the end. When time is up, everyone tours the builds with the builders' names hidden and rates each one from 1 to 5. The top three share the prize, and wins appear on profiles, the leaderboard and #Timeline.

**Friends**
Add friends from their profile or from the new Friends page under Messages in Community. You'll see who is in game right now and get a notification when a friend joins the server.`,
  },
  {
    id: "2026-11-17b",
    title: "Clearer notices during big updates",
    body: `When GalaxySMP closes for a big update, the website now shows a simple notice explaining what's happening and when we expect to be back, and the server shows the same message if you try to join.`,
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
