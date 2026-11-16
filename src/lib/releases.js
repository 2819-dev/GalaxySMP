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
  {
    id: "2026-11-18",
    title: "Notifications inbox, anniversaries, crate odds and two-step sign-in",
    body: `**Notifications inbox**
A new bell at the top of every page keeps your recent notifications: messages, friend requests, jobs, trades and more, so you never miss anything even without phone notifications. Tap one to go straight to it.

**Join anniversaries**
Every year on the day you first joined GalaxySMP, you get an anniversary badge, a post on #Timeline and a gift in game ($500 for each year). The badge looks better every year you stay.

**Crate odds**
A new Crate Odds page (in the footer under Play) lists every prize in each crate and the exact chance of winning it.

**Two-step sign-in**
Protect your account with codes from an authenticator app. Turn it on in Account settings > Security. It's optional.

**New badge looks**
Badges now come in 20 colors, with holographic, glow and sparkle finishes and many more icons.`,
  },
  {
    id: "2026-11-19",
    title: "Teams, Streak Freezes, the Plot Showcase and more",
    body: `**Teams**
Make a team of up to 8 players in Community > Friends > Team. Pick a name and a tag of up to 5 letters and numbers, which shows in gray before your name in chat. Teams get a private team chat on the website (also /tc in game), teammates can build on each other's plots, and there's a Top Teams leaderboard.

**Daily streaks, upgraded**
Your profile now shows your streak with this week's days. Streak Freezes save your streak by themselves if you miss a day: you earn one every 7 days, Galaxy Pro+ gets one each month, and you can get more in the Store. Big milestones are celebrated on #Timeline. Streak reminders are now at most one gentle note in the evening, and only when your streak would end that night.

**Plot Showcase**
Tap Showcase on the map to see everyone's builds, most liked first. Plot owners choose what's shown: Public, Location Hidden (photos and likes, but not where it is) or Plot Hidden. In game: /plot public, /plot nolocation or /plot private.

**Achievements guide and Compare**
Every profile has an Achievements guide showing how to get each achievement and how many players have it, with yours ticked. Tap Compare on any profile to see two players' stats side by side.`,
  },
  {
    id: "2026-11-20",
    title: "Off-Topic channels and a more reliable Friends tab",
    body: `**Off-Topic**
A new Off-Topic category at the bottom of Community: **OT | General** for chatting about anything that isn't GalaxySMP, **OT | Media** for pictures, memes and clips, and **OT | Announcements** for off-topic news from the staff team.

**Joining from the Friends tab**
The account that shows GalaxySMP under Play > Friends now runs alongside the server itself, so it's online whenever the server is. Add GalaxyPRO#9842 as a friend to see GalaxySMP in your Friends tab.`,
  },
  {
    id: "2026-11-20b",
    title: "Light and dark mode moved to Account settings",
    body: `Choose Auto, Light or Dark in Account settings > Appearance. Auto follows your device's setting, and it's the default. The button at the top of every page has been removed to keep the header clean.`,
  },
  {
    id: "2026-11-21",
    title: "Threads, voice messages, slow mode and holiday decorations",
    body: `**Threads**
Tap "Reply in thread" on any message to start a side conversation without filling up the channel. The original message shows how many replies it has; tap it to open the thread. You'll get a notification when someone replies to your thread.

**Voice messages**
Galaxy+ and Galaxy Pro+ members can now send voice messages of up to 1 minute in chat and in DMs. Tap the microphone next to the message box, listen back, then send. Everyone can play them.

**Slow mode**
Staff can turn on slow mode in a busy channel, so members can only send one message every few seconds. You'll see a note above the message box when it's on.

**Holiday decorations**
On Jewish holidays the website now wears a small gold emblem next to the logo and a greeting on the home page. On Chanukah, the menorah lights one more candle each night.

**Vote on our ideas**
The GalaxySMP team will now post some ideas in #Suggestions for you to vote on. The first one is Auction House price alerts: tell us if you'd use it!`,
  },
  {
    id: "2026-11-21b",
    title: "A cleaner header on every screen size",
    body: `- The notifications bell and your profile picture now keep their full size on every screen, instead of getting squeezed on laptops and smaller computers.
- The header is less crowded on computers: the server address now lives on the home page and in the menu.
- The "Get the GalaxySMP app" banner is easy to read again in light mode.`,
  },
  {
    id: "2026-11-21c",
    title: "Member profiles open every time",
    body: `- Tapping one member after another in the Members list now opens each profile straight away. Before, the second tap could close the card instead.
- Profile cards now have a close button, and on phones they leave the list visible above them so you can tap the next member.`,
  },
  {
    id: "2026-11-21d",
    title: "Plot Showcase is easier to find on phones",
    body: `The map buttons now fit on every phone screen, and **Showcase** sits first in the top-left corner of the map with its own icon. On phones, pinch to zoom the map. You can also go straight to it at galaxymc.us/map#showcase.`,
  },
  {
    id: "2026-11-22",
    title: "Vote for Player of the Month",
    body: `Look for the **Voting Computers** in game. When voting is open, tap one, choose **Start Voting** and pick the player who made GalaxySMP better this month. You can search by name or browse everyone who has played on the server.

You get one vote each month, and you can change it while voting is open. Your vote is secret: no other players can see who you voted for. When voting is closed, the computers say so, and the floating label above them shows whether voting is open.`,
  },
  {
    id: "2026-11-22b",
    title: "A more stable server",
    body: `We fixed a cause of unexpected server restarts. Shop NPCs and floating labels (leaderboards, crates, shop signs and Voting Computers) are now handled more safely when nobody is nearby. If the server ever does stop unexpectedly, staff now get the full details straight away so it can be fixed quickly.`,
  },
  {
    id: "2026-11-22c",
    title: "Server stability fix",
    body: `We found and fixed the cause of the recent unexpected restarts, which happened while floating labels (leaderboards, crates, shop signs) were being updated. Labels and shop NPCs now work in a way that can't crash the server.`,
  },
  {
    id: "2026-11-22d",
    title: "Uptime on the Status page",
    body: `The Status page now shows how much GalaxySMP has been online over the last 7 and 30 days, a bar for each of the last 30 days, and any recent outages or unexpected restarts. We're also making the server lighter on memory so it stays online more reliably.`,
  },
  {
    id: "2026-11-22e",
    title: "Rank badges above heads",
    body: `Rank badges above players' heads now stay in place. If anything else changes a player's name tag, the badge is put back straight away. As always, a player with more than one rank shows the highest one in the server's rank order.`,
  },
  {
    id: "2026-11-23",
    title: "Bedwars: team upgrades, parties, modes and more",
    body: `**Team Upgrades**
Each island now has a Team Upgrades NPC. Spend diamonds on Sharpened Swords, Reinforced Armor, Maniac Miner (faster mining), a Heal Pool at your base, and traps that blind and slow the next enemy who comes near your bed.

**Parties and modes**
Make a party in /bedwars > Party and you'll always be on the same team. In the waiting room, vote for Solo, Duos or 4v4.

**Faster games**
Sudden Death now starts after 10 minutes: every remaining bed breaks, so games always finish.

**Rejoin and spectate**
If you disconnect while your bed stands, you have 2 minutes to come back to your team. Knocked-out players can watch anyone still playing with /bedwars > Watch a player.

**Quests and effects**
New daily quests: play, win, get kills and break beds in Bedwars. Victory and kill effects can be won by playing (10, 25 and 50 wins), found in the Season Pass, or bought in the Store. Pick yours with /cosmetics.

**On the website**
- Every profile now shows recent Bedwars games. Tap one for the full recap.
- The Leaderboards page shows the game being played right now, live.
- Bedwars leaderboards now have This week and This month. The weekly #1 in wins gets $5,000 and the Weekly Bedwars Champion badge.
- Turn on "Bedwars games" in Account settings > Notifications to hear when players are waiting for a game.`,
  },
  {
    id: "2026-11-23b",
    title: "Screenshots wall, who's online and achievement compare",
    body: `**Screenshots wall**
#Builds now has a Screenshots tab for your best moments on GalaxySMP: sunsets, funny fails, Bedwars wins. Post up to 4 screenshots with a caption and like your favorites.

**Who's online**
The home page shows who's playing right now and what they're doing, like playing Bedwars or building on their plot. Sign in to see names.

**Compare achievements**
Compare on any profile now also lists the achievements you both have, and the ones only one of you has.`,
  },
  {
    id: "2026-11-23c",
    title: "Private polls",
    body: `Some polls are now private, marked with a lock. On a private poll, you only see your own vote: the results and who voted for what stay with the server owner. Vote as usual, and change your vote any time until it closes.`,
  },
  {
    id: "2026-11-23d",
    title: "Rank badges fixed in game",
    body: `Rank badges in game chat and above heads now always show your highest rank, including right after a server restart. The server also remembers everyone's ranks, so they show correctly even before it reconnects to the website.`,
  },
  {
    id: "2026-11-24a",
    title: "Friend Streaks and Happening now",
    body: `**Friend Streaks:** invite a friend from Community > Friends to start a Friend Streak. Every day you both play on GalaxySMP, your streak grows by one; miss a day and it starts again. You can have up to 5. If your friend hasn't played yet today, tap Remind to send them a nudge. Reach 7, 30, 100 and 365 days to earn game money for both of you, plus a badge at 100 days.

**Happening now:** the top of #Timeline now shows what's on right now (events, minigames, Build Contests and Bedwars games), with a Join button.`,
  },
  {
    id: "2026-11-24b",
    title: "GalaxySMP merch is coming to the Store",
    body: `The Store is getting a Merch section with real GalaxySMP gear, made to order and shipped to your door. You'll see the exact shipping cost before you pay, can pay with a card or Galaxy Credits, and get a notification with tracking when your order ships. The first items will appear in the Store soon.`,
  },
];

// Ideas the server team posts in #Suggestions as @GalaxySMP so players can vote on them (each posted once).
export const OFFICIAL_SUGGESTIONS = [
  {
    id: "ah-price-alerts",
    title: "Auction House price alerts",
    body: "Pick an item and the most you'd pay, and get a notification (on the website and in game) as soon as someone lists it at or below that price. Vote below to tell us if you'd use this.",
  },
  {
    id: "play-sessions",
    title: "Play Sessions",
    body: "Post a plan like \"Bedwars at 7 pm, who's in?\" in #Events. Other players tap I'm in, and everyone who joined gets a reminder 10 minutes before it starts. Vote below to tell us if you'd use this.",
  },
];

async function postOfficialSuggestions(sql, author) {
  if (!author) return;
  for (const s of OFFICIAL_SUGGESTIONS) {
    const claimed = await sql`INSERT INTO economy_config (key, value, updated_by) VALUES (${`suggestion:${s.id}`}, ${JSON.stringify(new Date().toISOString())}::jsonb, 'server')
                              ON CONFLICT (key) DO NOTHING RETURNING key`;
    if (claimed.length) await sql`INSERT INTO suggestions (user_id, title, body, anonymous, official) VALUES (${author.id}, ${s.title}, ${s.body}, false, true)`;
  }
}

// Posts any release note that hasn't been posted yet (oldest first). Safe to call often.
export async function postReleases(env, sql) {
  const keys = RELEASES.map((r) => `release:${r.id}`);
  const done = new Set((await sql`SELECT key FROM economy_config WHERE key = ANY(${[...keys, ...OFFICIAL_SUGGESTIONS.map((x) => `suggestion:${x.id}`)]})`).map((r) => r.key));
  if (OFFICIAL_SUGGESTIONS.some((x) => !done.has(`suggestion:${x.id}`))) {
    const people = await sql`SELECT id, username, platform FROM users WHERE NOT banned ORDER BY id LIMIT 200`;
    await postOfficialSuggestions(sql, people.find((u) => isOwner(env, u.username, u.platform === "bedrock")));
  }
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
