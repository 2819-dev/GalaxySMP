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
  },  {
    id: "2026-11-25a",
    title: "Store cart, packs, bundles and a fairer economy",
    body: `**Shopping cart:** every Store item now has Add to cart next to Buy now. Check out everything at once with one payment, by card or Galaxy Credits, and one promo code for the whole cart. To send a gift, use Buy now on the item.

**Packs and bundles:** new item packs (Food, Tool, Builder, Miner, Rare and Legendary) and money-saving bundles are in the Store. In-game money in the Store is also cheaper.

**Rewards rebalanced:** daily rewards, quests, achievements, the Season Pass, Friend Streaks, invites and the weekly Bedwars champion now give item packs and crate keys, with smaller amounts of money. This keeps money valuable for everyone. Jobs still pay the same.

**AFK:** if you don't move for 3 minutes, you're marked AFK, and /afk switches it yourself. AFK time doesn't count as playtime.

**Also new:** rate the help you got when a support ticket closes, the Merch Supporter badge for buying 2 or more merch items, and #OT | Advertising now allows links, with one post every 20 minutes.`,
  },
  {
    id: "2026-11-26a",
    title: "A livelier Community",
    body: `**Question of the Day:** every morning @GalaxySMP asks a fun question in #Chat. Tap Answer to reply in its thread.

**Welcome waves:** when a new player joins for the first time, a welcome card appears in #Chat. Tap Wave to say hi, and they'll see how many people waved.

**Thanks:** tap the handshake on a helpful message to thank its author. At 25 thanks you earn the Helpful badge.

**Chat levels:** chatting earns XP (once a minute), and your level shows next to your name. Level-ups are announced in the new #Bot Commands channel, where you can type !level, !top and !help.

**While you were away:** come back after a day or more and Community shows you what you missed.

**Friend Streaks:** a day now also counts if you spend 15 minutes on Community and send at least one message.`,
  },
  {
    id: "2026-11-26b",
    title: "Meet GalaxySMP, the server's own account",
    body: `GalaxySMP is now a member of the Community, with a verified BOT tag. It posts the Question of the Day, welcomes new players, announces chat level-ups and answers !commands in #Bot Commands. Official posts, like these update notes, come from it too. Tap its name to see its profile. To join GalaxySMP from the Friends tab on Xbox, add GalaxyPRO#9842 as a friend.`,
  },
  {
    id: "2026-11-27-mobile",
    title: "A better fit on phones and in the app",
    body: `We went through every page on phone-sized screens and tidied up what didn't feel right.

**In the app:** pages no longer slide under the iPhone status bar or the home bar, and the message box sits clear of the bottom edge.

**Community:** tap a message to show its buttons, which are now bigger and easier to hit. The app banner no longer covers the newest messages, and channels like #Timeline no longer show chat-only buttons.

**Elsewhere:** the app banner only appears on the home and voice pages and never covers anything, profile names no longer overlap the banner picture, and the Store's cart button no longer sits on top of the category tabs.`,
  },
  {
    id: "2026-11-27-loading",
    title: "A new loading screen",
    body: `When you open the website, a grass block now drops in, breaks apart into the GalaxySMP letters and fills with the logo's colors. It plays in full the first time you open the site. After that it only appears if a page takes a moment to load, so moving around the site stays quick.`,
  },
  {
    id: "2026-11-27-rare-loading",
    title: "Rare loading screens",
    body: `Every so often, the loading screen is a rare one. Instead of grass, you might see a **Diamond** block that turns into a gold logo, a **Gold** block with a shiny gold logo, or the super rare **Galaxy** block with a starry purple logo. About 1 in 50 loading screens is rare, and Galaxy is the rarest of the three. If you catch one, share a screenshot in #Chat!`,
  },
  {
    id: "2026-11-17-startup-fix",
    title: "Server connection fix",
    body: `We fixed a problem that stopped the server from connecting to the website after a restart. While it was happening, the website showed the server as offline and in-game features linked to the website were unavailable. Everything is back to normal once the server updates. Thanks for your patience!`,
  },
  {
    id: "2026-11-17-stages",
    title: "Stages are here",
    body: `Host live talks, podcasts and shows in the new **#Stages** channel, under the new **Voice & Stages** category next to #Voice Chat.

**How it works:** speakers talk on the stage while everyone else listens in the audience, chats live and sends reactions. Speakers can **share their screen** (great for showing a build) or turn on their **camera**.

**Want to speak?** Tap **Request to speak** to raise your hand, and a host can invite you up.

**Who can host:** Galaxy+ and Galaxy Pro+ members can host their own stage and build a crew. Editors help run your stages, and Speakers can speak on them any time. Teams can host stages together: the organizer and Admins start them, and every team member can speak.

**Never miss one:** follow your favorite hosts and teams to get a notification (and a message in game) when they go live. Stages can also be scheduled ahead of time; they show in #Events with a Notify me button.

**Coming soon:** recorded episodes you can listen to any time.`,
  },
  {
    id: "2026-11-17-team-admins",
    title: "Team Admins",
    body: `Team organizers can now make members **Admins**. Admins can invite and remove members, change the team's name and tag, and host the team's stages. Only the organizer can make Admins, hand the team over or close it. When an organizer hands the team over, they stay on as an Admin.`,
  },
  {
    id: "2026-11-17-suggestions",
    title: "A tidier #Suggestions",
    body: `**#Suggestions** is easier to browse now:

**Status tabs:** Open, Planned, In progress, Done and Declined, each with a count. **In progress** is new, so you can see what's being worked on right now.

**Categories:** every idea has a category (Gameplay, Minigames, Website, Events, Store or Other). Tap one to see only those ideas, and pick one when you post.

**Search:** find ideas by any word.

**No more duplicates:** staff can merge an idea into one that was already posted, and its votes and comments move over.`,
  },
  {
    id: "2026-11-17-smarter-filter",
    title: "A smarter chat filter",
    body: `We made the chat filter smarter, on the website and in game.

**Catches more tricks:** fancy fonts, look-alike letters from other alphabets, letter emoji, and symbols or emoji hidden inside words.

**Fewer wrong blocks:** normal sentences like "hello from my phone", "my school starts at 8" or "I forgot my password" are fine now. The filter only steps in when real personal details follow, like a phone number, an address or a school's name.

**Less spam:** sending the same message over and over (even with different capitals or extra letters) is blocked.`,
  },
  {
    id: "2026-11-17-already-implemented",
    title: "\"Already implemented\" in #Suggestions",
    body: `Some ideas are already on the server! Staff can now mark a suggestion as **Already implemented** and tell you where to find it. These show in the **Done** tab, and you get a notification if it was your idea.`,
  },
  {
    id: "2026-11-17-stage-captions-recording",
    title: "Live captions and recording on Stages",
    body: `**Live captions:** what speakers say now shows as captions on the stage, as they talk. Tap **CC** to turn captions on or off. Captions work when the speaker uses Chrome, Edge or Safari (including phones).

**Recording:** stage hosts can now **record** a stage. The recording has everyone's voices, the screen share or cameras, and the captions, and it saves as a video on the host's device. When a stage is being recorded, everyone sees a red **Recording** sign.`,
  },
  {
    id: "2026-11-17-play-sessions",
    title: "Play Sessions: you voted, we built it",
    body: `You voted yes in #Suggestions, so **Play Sessions** are here, in **#Events**.

Post a plan like "Bedwars at 7 pm, who's in?" and others tap **I'm in**. You can set a **player limit**; when it's full, people join a waitlist and move up if someone leaves. Each plan has its own **chat** to get organized, and everyone who's in gets a reminder 10 minutes before it starts.`,
  },
  {
    id: "2026-11-17-episodes",
    title: "Podcast episodes on Stages",
    body: `Stage hosts can now post recorded **episodes** in **#Stages** so people can listen any time. Upload your podcast to YouTube as **Unlisted** and add the link. Episodes play right on GalaxySMP, and followers get a notification when a new one is out.

Also: when staff change the status of your suggestion, you now always get a notification.`,
  },
  {
    id: "2026-11-17-recordings-privacy",
    title: "Stage recordings and your privacy",
    body: `When a stage host records a stage (you'll always see the red **Recording** sign), the recording may be kept on GalaxySMP so staff can review it. Only the server owner and staff can watch these recordings. Our privacy policy has the details.`,
  },
  {
    id: "2026-11-17-hosting-pro",
    title: "Hosting stages is now a Galaxy Pro+ perk",
    body: `Hosting your own stage and posting podcast episodes are now **Galaxy Pro+** perks (the Owner can also allow other members). Team stages are still open to every team's organizer and Admins. Posting episodes for a team also needs Galaxy Pro+.`,
  },
  {
    id: "2026-11-17-episodes-upload",
    title: "Episodes: no YouTube needed",
    body: `Podcast episodes in **#Stages** are now uploaded straight to GalaxySMP, so you don't need a YouTube account. Tap **Add an episode** and either upload an audio file (MP3, M4A, WAV and more) or tap **Record now** to record one right there on your phone or computer. Episodes play right on the site.`,
  },
  {
    id: "2026-11-17-notif-history",
    title: "Smarter notifications",
    body: `**Choose how long notifications stay:** in **Account settings > Notifications**, pick what the bell keeps: the past day, week or month, everything, or only unread (each one is deleted once you've read it).

**No more notifications for what you're already looking at:** if you have a channel, DM or page open in Community, you won't get a notification about it.`,
  },
  {
    id: "2026-11-17-stages-library",
    title: "A new home for Stages",
    body: `**#Stages is now a library**, organized into three tabs:

- **Live:** stages happening now, coming up and recently live.
- **Episodes:** every podcast episode, with search and a Newest / Most played sort.
- **Shows:** every host and team gets their own show page with all their episodes, past stages and a Follow button.

**Continue listening:** the new player at the bottom remembers where you stopped, so you can pick up an episode right where you left off. It has buttons to skip back 15 seconds or forward 30.

**Covers:** every show gets its own colorful cover automatically.`,
  },
  {
    id: "2026-11-17-stages-types",
    title: "Stages: Podcasts, Live Streams and More",
    body: `#Stages now has three sections:

- **Podcasts:** hosts and speakers talk, voice only. A live podcast is saved as an episode automatically when it ends, so anyone can listen later. Podcasts can also be uploaded or recorded on the website.
- **Live:** live streams with screen sharing and cameras. They can only be watched while they're live, unless the host chooses **Save as a video**; saved streams appear under **Watch again**.
- **More:** other videos and audio, such as a team's rules or a build tour. Teams can make a post visible to their members only.

**A new setup before going live:** choose Podcast or Live Stream, add a title, description and category, set the rules (who can speak, live chat on or off, everyone or team members only), then check your microphone and camera. You start **backstage** with your speakers, where nobody else can join, and press **Go live** for a 3, 2, 1 countdown. Followers are notified at that moment.

**Also new:**
- **Playback speed** (1x to 2x) and **chapters**: hosts can add chapter times, and listeners tap a chapter to jump to it.
- **Comments** on episodes and videos.
- **Live polls:** hosts can ask a quick question during a stage and everyone sees the results live.`,
  },
  {
    id: "2026-11-17-server-diagnostics",
    title: "Better tools for keeping the server running",
    body: `We've improved how the server reports problems, so outages can be found and fixed faster.

- **Clearer crash reports:** when the server stops unexpectedly, the report now says what most likely caused it and how long the server was down.
- **Error tracking:** errors are now recorded with full details, so they can be found and fixed even when nobody was online to report them.
- **Health checks:** the server records its performance every minute, which helps us find the cause of lag.

Server logs are kept for 3 days and error reports for 30 days. See the Privacy Policy for details.`,
  },
  {
    id: "2026-11-23-the-sift",
    title: "The Sift is here: Dumplings, Blubs and new creatures",
    body: `A brand-new land has opened far beyond the edge of the world: **the Sift**. Pick **The Sift** under Featured Servers on the Main Menu, or step through a Sift portal.

- **The Sift:** a glowing island with three areas to explore: the teal Glow Meadow, the pink Rose Hills and the Bone Flats.
- **Dumplings:** soft, squishy little friends in eight colors that boing when they hop. Tame one with a **Dumpling Treat** (wheat, kelp and sugar makes 4). Jump on top of a Dumpling for a big bounce, with no fall damage.
- **Blubs:** glowing, chirpy creatures. Tame one with glow berries, then crouch and tap it to carry it on your shoulder.
- **Name your pet:** when you tame a Dumpling, Blub or Penguin, you'll be asked what you'd like to name it. No name tag or anvil needed.
- **Babies:** feed two of your tamed Dumplings or Penguins to get a baby. It belongs to you, grows up in 20 minutes, and baby Dumplings take one of their parents' colors.
- **Wildlife:** Seedlings scurry away from you, and Trills fly around in flocks.
- **Watch out at night:** Baby Sifters bite, Bearded Sifters fire glowing orbs, and Nesters pounce. They drop amethyst, bones and glow berries, and sometimes a Dumpling Treat.

Your pets are yours alone: other players can't feed, ride or hurt them.`,
  },
  {
    id: "2026-11-23-main-menu-phones",
    title: "Main Menu fixes for phones and tablets",
    body: `The Main Menu now fits smaller screens properly.

- **Fits your screen:** the title screen is more compact, and its buttons scroll when there isn't enough room, so nothing is cut off or overlapping.
- **Safer trips to the Sift:** if the Sift isn't finished yet when you arrive, you're brought straight back to spawn instead of falling.`,
  },
  {
    id: "2026-11-24-main-menu-fixes",
    title: "Main Menu fixes",
    body: `We've fixed several problems with the Main Menu.

- **No more crashes when joining:** fixed a problem that could close Minecraft on some phones and tablets.
- **Join Server works:** joining from Featured Servers is now reliable. You can also tap a server a second time to join it.
- **The menu shows right away:** you can no longer walk around while the Main Menu is still loading.
- **Simpler title screen:** Social and Link Account are now in the friends box at the bottom, so everything fits on smaller screens.
- **The Sift:** if it's still being built, the menu now tells you instead of sending you back to the server list.`,
  },
  {
    id: "2026-11-24-main-menu-social-join",
    title: "Main Menu: linked accounts and joining fixed",
    body: `More fixes for the Main Menu:

- **Linked accounts are recognized:** the friends box no longer asks you to link an account that's already linked. Your friends, requests and party now load properly too.
- **Easier joining:** there's now a **Join** button at the top of the Featured Servers list. Join Server and tapping a selected server again still work too, and you'll see the server's name when you arrive.
- **New button style:** the Main Menu buttons now use the GalaxySMP colors.`,
  },
  {
    id: "2026-11-24-sift-join-fix",
    title: "Joining the Sift fixed",
    body: `Picking **The Sift** on the Main Menu now takes you there. Before, you stayed where you were.

If a trip ever can't be completed, you'll now see a message instead of nothing happening.`,
  },
  {
    id: "2026-11-24-new-blub",
    title: "A brand-new look for Blubs",
    body: `Blubs have been completely redesigned. They're now chunky blue creatures with tall bunny ears, a teal belly, a small sleepy face and four stubby feet.

We've also simplified the Sift's wildlife: for now, Dumplings and Blubs are the creatures you'll find there. The Sift itself is getting a full redesign soon.`,
  },
  {
    id: "2026-11-24-sift-redesign-borders",
    title: "The Sift, reimagined, and world borders",
    body: `**The Sift has been completely rebuilt.** It's now a dreamy valley surrounded by tall red cliffs:

- **Salmon-pink ground** with mossy meadows full of blue, purple and yellow flowers, and fireflies at night.
- **Huge red rock pillars** with wide, flat tops covered in white weeping trees.
- **White weeping trees** with long hanging curtains, and **tall pink grass** everywhere.
- **A teal sky** while you're inside.
- Dumplings and Blubs live there. Pick **The Sift** on the Main Menu to visit.

**World borders.** Each server now has its own border, and the Sift and other servers sit outside the main world. Use the Main Menu to travel between them. If you reach a border, a glowing wall appears and you'll be gently moved back inside.`,
  },
  {
    id: "2026-11-24-sift-build-fix",
    title: "The Sift: building fixed",
    body: `We fixed a problem that stopped the Sift from being built, so it can now be visited from the Main Menu once it's ready.

Staff can also now name world borders and teleport to them.`,
  },
  {
    id: "2026-11-24-borders-visible-join-list",
    title: "Visible world borders and one-tap joining",
    body: `- **See the border:** a blue striped wall now appears when you get close to the edge of a world.
- **One-tap joining:** tap any server in the Featured Servers list to join it right away.`,
  },
  {
    id: "2026-11-24-smoother-sift-build",
    title: "Smoother server while the Sift is built",
    body: `The Sift is now built in the background more gently, so the server stays smooth and responsive while it's being made. It takes about 10 minutes after a restart.`,
  },
  {
    id: "2026-11-24-party-command-fix",
    title: "/party works again",
    body: `We fixed a problem that stopped the **/party** command from working in game. You can use **/party invite <player>**, **/party accept** and **/party leave** again, as well as **/p <message>** for party chat.`,
  },
  {
    id: "2026-11-24-bigger-sift",
    title: "The Sift is now much bigger",
    body: `- **A huge valley:** the Sift is now about 600 blocks across, with over 40 giant red rock pillars, endless meadows and tall cliffs all around.
- **Rounder Blubs:** Blubs now have a square face and a slightly longer body.

The bigger Sift is built in the background after the update, which takes about half an hour.`,
  },
  {
    id: "2026-11-24-new-main-menu",
    title: "A brand-new Main Menu",
    body: `The Main Menu has a fresh new layout.

- **Play:** three tabs in one place. **Homes** lists your homes, so you can teleport, rename, move or delete them with one tap. **Warps** shows My Warps, Featured Warps and All Warps. **Servers** shows each server with its picture, ping, players and a big Play button.
- **Mail:** your website messages and notifications, right in the game. Open a conversation and reply without leaving the menu.
- **Profile:** your player card, money and privacy setting.
- **Tutorial & Commands:** the tutorial, the commands you can use, the rules, what's new and the Store, all in one page.
- **Help:** send a message to staff from the menu.
- **Social** is now in the top-right corner. Settings are coming soon.`,
  },
  {
    id: "2026-11-24-menu-compass-fix",
    title: "Menu compass fix",
    body: `- The Menu compass is now always added to the last hotbar slot, even when that slot already has an item in it (the item is moved to a free slot).`,
  },
  {
    id: "2026-11-24-activity-cards",
    title: "Activity cards on the Servers screen",
    body: `- **Picture cards:** in **Play > Servers**, each server's activities now show as big cards with a picture, a name, a subtitle and a short description.
- GalaxySMP shows Survival, Plots, Jobs & Shops and Minigames. The Sift shows Adventure and Pets.`,
  },
  {
    id: "2026-11-24-chat-link-fix",
    title: "Fewer messages blocked as links",
    body: `- Normal sentences are no longer mistaken for links. Messages like "help. me" or "...buildings. One person..." now send as usual.
- You can now share **galaxymc.us** (and pages on it) in chat and DMs.
- Real links from other websites are still blocked, as before.`,
  },
  {
    id: "2026-11-24-mod-reasons",
    title: "Clearer reasons for mutes and bans",
    body: `- When staff mute or ban a member on the website, they can now add a reason that the member sees. Muted members see it in a notification and when they try to send a message. Banned members see it when they try to sign in.
- Staff can also add a separate note that only staff can see.`,
  },
];

// Ideas the server team posts in #Suggestions as @GalaxySMP so players can vote on them (each posted once).
// Old list, kept for reference only. Posting in #Suggestions is switched off: the owner said never to post there.
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
  {
    id: "2026-11-17-community-app",
    title: "Community feels like an app",
    body: `Getting around Community is faster, especially on phones.

**On phones:**
- **Bottom tabs:** Home, Messages, Friends, Alerts and You, like a chat app. The chat now uses the whole screen.
- **Home** is your channel list. Tap a channel and it slides in; tap the arrow or swipe right to go back.
- **Swipe left** in a channel to see who's online.
- **Your phone's Back button** now goes back to the previous screen and closes open menus, instead of leaving the page.

**Everywhere:**
- **Unread counts:** channels with new messages show how many you missed, and a **red badge** when someone @mentions you or replies to you. They're remembered between visits, and **Mark all as read** clears them.
- **Quick switcher:** tap **Find a channel or person** above the channels (or press Ctrl+K, or Cmd+K on a Mac) to jump to any channel or start a message with anyone.
- **Back and Forward** in your browser move between the channels you visited.`,
  },
  {
    id: "2026-11-17-friend-bot-fix",
    title: "Friend list joining is back",
    body: `Joining GalaxySMP from **Play > Friends** (for Xbox, PlayStation and Switch players) works again. It stopped working after the Xbox friend bot updated to a newer version; the server now gives it the room it needs, and recovers on its own if it happens again.`,
  },
  {
    id: "2026-11-17-friend-bot-signin",
    title: "Friend list joining: setup improvements",
    body: `The Xbox friend bot that lets Xbox, PlayStation and Switch players join from **Play > Friends** is now easier for staff to set up and keep running, and it still shows GalaxySMP correctly when the server's details can't be read.`,
  },
  {
    id: "2026-11-17-community-menu",
    title: "Leaving Community on phones",
    body: `On phones, tap the **menu button** (three lines) at the top of the Community home screen to open the website menu and go to any page: Home, the Store, the Map and more.`,
  },
  {
    id: "2026-11-17-headings-admins",
    title: "Message headings are for Admins",
    body: `Big headings (**#**, **##**, **###**) and small text (**-#**) in Community messages and DMs now only format for Admins, so announcements stand out and chats stay easy to read. For everyone else, those lines show as normal text. Bold, italics, lists, quotes and code still work for everyone.`,
  },
  {
    id: "2026-11-18-explosion-crash-fix",
    title: "Server stability fix",
    body: `Fixed a server crash that could happen when something exploded (a creeper or TNT) near a protected plot. Explosions that would damage a protected plot or the Build Contest area are now stopped completely, and explosions everywhere else work as before.`,
  },
  {
    id: "2026-11-18-stability",
    title: "More server stability fixes",
    body: `We went through the server's plugin looking for anything that could cause a crash, and made several situations safer: staff rollbacks when the staff member leaves partway through, newly placed signs and shop helpers, and updates that arrive from the website.`,
  },
  {
    id: "2026-11-18-xbox-broadcast",
    title: "Friend list joining now runs on our host",
    body: `Joining GalaxySMP from **Play > Friends** (for Xbox, PlayStation and Switch players) is now handled by our server host's built-in Xbox Broadcast instead of a bot inside our plugin. This keeps the server lighter and simpler. Joining works the same way as before.`,
  },
  {
    id: "2026-11-18-command-plates",
    title: "Pressure plates that do things",
    body: `Some pressure plates around the server now do something when you step on them, like opening the **Guide** or taking you to **spawn**. Just walk onto them.`,
  },
  {
    id: "2026-11-18-rtp",
    title: "Random teleport: /rtp",
    body: `Looking for fresh land? Type **/rtp** (or **/wild**) to be teleported to a random safe spot in the wild, between 500 and 5,000 blocks from spawn, never on someone's plot and never in water or lava. You can use it every 5 minutes, and **/back** takes you back. Some pressure plates around spawn do it too: just step on one.`,
  },
  {
    id: "2026-11-18-rtp-command-blocks",
    title: "Random teleport plates fixed",
    body: `Random teleport pressure plates now work. Staff can also use **rtp @p** and **guide @p** in command blocks.`,
  },
  {
    id: "2026-11-18-rtp-no-wait",
    title: "/rtp: no more waiting",
    body: `**/rtp** now works every time, with no wait between uses. If the first spot isn't safe, it finds another one by itself.`,
  },
  {
    id: "2026-11-18-support-and-map",
    title: "New in game: /support and /map",
    body: `**/support** — Need help? Type **/support**, write what you need, and it goes straight to the staff team. Staff online in game see it right away, and the rest get a notification.

**/map** — Get the server map as a map item. Hold it to see the area around you, with other players and spawn marked. It's the same map as the Map page on the website. Type **/map** again to zoom in or out.`,
  },
  {
    id: "2026-11-18-ah-price-alerts",
    title: "Auction House price alerts",
    body: `You voted for it, so it's here. Pick an item and the most you'd pay for each one, and we'll let you know as soon as someone lists it at or below that price.

- **On the website:** open **#Auction House** and tap **Price alerts**, or **Alert me** on any listing.
- **In game:** open **/ah** and tap **Price alerts**.

You get the alert in game if you're playing, and as a notification on the website. You can set up to 10 alerts.`,
  },
  {
    id: "2026-11-18-marketplace",
    title: "Introducing the Marketplace",
    body: `**#Auction House** is now **#Marketplace**: one place to buy, sell, trade and find work.

- **Discover:** great deals, the newest Auction House items, player shops and open jobs, in rows you can swipe through.
- **Auction House**, **Shops**, **Trades** and **Jobs** each have their own tab.
- **One search** finds items and shops at once. Tap any item to see its details, price history and a **Buy** button.

Player Shops, Trades and #Jobs have moved here, and your old links still work.`,
  },
  {
    id: "2026-11-18-sell-orders-parkour",
    title: "Sell from the website, buy orders, parkour and a sharper map",
    body: `**Sell from the website.** In #Marketplace, tap **Sell**, pick an item from your inventory, then sell it to the Shop or list it on the Auction House. You need to be online in Minecraft.

**Buy orders.** Post "I'll buy 64 diamonds at $90 each" and the money is held. Anyone can sell to your order in game (**/ah > Buy orders**) or in the Marketplace, and they're paid right away. The items go into your inventory.

**Price alerts** now check player shops too, not just the Auction House.

**Parkour courses.** Type **/parkour** to see the courses, record times and your best. Step on the start plate to begin, hit every checkpoint, and reach the finish. Your first finish pays a reward, best times appear on **Leaderboards > Parkour**, and there are three new achievements to earn.

**The map** now has the right colour for every block in the game. Glass, rails, torches and buttons show the ground underneath, just like a real Minecraft map. Your plots and public plots are also outlined on the **/map** item.`,
  },
  {
    id: "2026-11-18-ratings-visit-collection",
    title: "Seller ratings, Visit from the map, and your Collection book",
    body: `**Seller ratings.** After you buy something in the Marketplace (Auction House, a shop chest or a buy order), you can rate the seller with 👍 or 👎. Ratings show next to sellers' names. Tap a seller to see their store: everything they're selling in one place.

**Visit from the map.** Public plots, shops and warps now have a **Visit in game** button on the Map page. If you're online you're teleported right away, and if not, it happens the next time you join. **Warps** now show on the map too.

**Follow a player.** Tap a player's head on the map, or pick them from the Players list, and the map follows them. It keeps following in 3D.

**Teleport from the Friends list.** When a friend is in game, tap **Teleport** to send them a teleport request without typing a command.

**Collection book.** Your profile now shows every kind of item you've had in your inventory, out of every item in the game, with a list of what's still missing. There are new achievements at 100, 250 and 500 items.`,
  },
  {
    id: "2026-11-19-loading-screens-plots",
    title: "New loading screens, and sell, rent or upgrade your plot",
    body: `**More loading screens.** The block that breaks into the GalaxySMP logo has new looks to find:
- **Rare** (about 1 in 333 each): Diamond, Gold, Emerald, Netherite, Amethyst, Lava, Ice
- **Super rare** (about 1 in 667 each): Galaxy, Ender
- **Mythic** (1 in 1,000): Rainbow

On Jewish holidays, New Year and the first day of each season, a holiday block shows up instead. Every screen you see is saved to your profile under **Loading screens**.

**Sell or rent your plot.** In the Plot Manager tap **Sell or rent**, or type **/plot sell <price>** or **/plot rent <price per day> <days>**. Listings appear in the new **Plots** tab of #Marketplace. Renters can build until their days run out, then the plot is all yours again.

**Upgrade your plot.** In the Plot Manager tap **Upgrade plot** to make it 8 blocks wider, 8 blocks longer or 16 blocks taller. The first upgrade costs $5,000 and each one after that costs double.`,
  },
  {
    id: "2026-11-19-security-stability",
    title: "Security and stability improvements",
    body: `This update makes GalaxySMP safer and more reliable, on the website and in game.

- **More stable server.** Plots, Bedwars, elevators and rollbacks now wait for the world to load before changing blocks, so they can't cause a crash. The server also keeps running smoothly if a single feature runs into a problem.
- **Fairer play.** Minigame items stay in their minigames, plots are better protected (pistons, animals, armor stands and buckets), and parkour times have to be earned on foot.
- **Safer trading.** When you buy or rent a plot from the website, you always pay the price you saw. Damaged gear can't go into shop chests or buy orders.
- **Website protection.** Live chat, voice chat and Stages are protected against message flooding, and permissions, promo codes and gifts have extra checks.

Thanks for playing on GalaxySMP. If you ever find a bug, please report it to staff instead of using it.`,
  },
  {
    id: "2026-11-19-giveaways-commands",
    title: "New: #Giveaways and chat commands",
    body: `**#Giveaways.** The GalaxySMP team now runs giveaways in the new #Giveaways channel. Tap **Enter** on a giveaway to join. When it ends, winners are picked at random and get their prize automatically: in-game money, crate keys, Galaxy Credits or Store items. You'll get a notification if you win.

**Chat commands.** Commands now start with **/** and work in any chat:
- Tap **+** next to the message box, then **Commands**, to pick one from a list. No typing needed.
- Or type **/** in the message box to see suggestions.

Try **/level**, **/top**, **/stats**, **/online**, **/status**, **/coinflip**, **/roll** and **/8ball**. Some answers are just for you, like **/balance**. Type **/help** to see everything you can use.`,
  },
  {
    id: "2026-11-20-reapply-moderator",
    title: "Apply for Moderator again any time",
    body: `If your Moderator application wasn't accepted before, you no longer have to wait to try again. Open #Applications and send a new one whenever you're ready, and tell us what's changed since last time.`,
  },
  {
    id: "2026-11-20-chat-levels-spam",
    title: "Fairer chat levels and better spam protection",
    body: `- **#Bot Commands is for commands only.** Type **/** to pick a command, or tap **+** › **Commands**.
- **Chat levels count real conversation.** Commands, very short messages (like "k" or a single emoji), repeated messages and deleted messages no longer earn chat XP. If a message is removed, the XP it earned is removed too.
- **Smarter spam protection.** The chat now catches near-copies of the same message, floods of one-word messages, repeated words and mass mentions. Members who keep spamming are muted for 10 minutes automatically.`,
  },
  {
    id: "2026-11-22-dm-pictures",
    title: "Galaxy Pro+: pictures in direct messages",
    body: `Galaxy Pro+ members can now send pictures in direct messages. Open a conversation, tap **+** next to the message box, then **Choose a photo**. You'll see a preview before you send it, and you can add a message too. The person you're talking to sees the picture right in the conversation (in game they get a note to view it on galaxymc.us).`,
  },
  {
    id: "2026-11-22-quiet-mode",
    title: "Quiet Mode for busy times",
    body: `Staff can now turn on **Quiet Mode** to keep the community calm during busy moments. While it's on, everyone can send one message every few minutes in each channel, and a note under the message box shows how long it lasts. When it ends, every channel goes back to normal by itself.`,
  },
  {
    id: "2026-11-23-secure-forms",
    title: "Secure forms in direct messages",
    body: `The GalaxySMP owner can now send a **secure form** in direct messages, for example to collect details needed to deliver a prize. Answering is always optional: you can tap **Decline**. Your answers are encrypted, and only the owner can read them.`,
  },
  {
    id: "2026-11-23-penguins-chips",
    title: "Penguins and Potato Chips have arrived",
    body: `**Penguins 🐧** Tame a penguin by feeding it fish. Once it's yours, nobody else can take it or hurt it. It follows you, waddles around, swims, and fights monsters and anyone who attacks you. Keep it close for **Penguin's Grace**: you swim fast in water and slide even faster on ice.

**Potato Chips 🥔** Four flavors, each with its own power:
- **Classic: Potato Power** (Strength III, Resistance II, Regeneration II and 8 extra hearts)
- **Flamin' Spicy: Fire Crunch** (Strength IV, Fire Resistance and Speed II)
- **Salt & Vinegar: Sour Rush** (Speed III, Haste III and Jump Boost II)
- **Galaxy Flavor: Cosmic Crunch** (all of the above and more, with 20 extra hearts)

Penguins and chips are super rare prizes in Galaxy Crates, and staff may hand them out at events. Both can be traded and sold. Chips can't be eaten during minigames.`,
  },
  {
    id: "2026-11-23-penguin-visuals",
    title: "Penguins and Chips: hearts and visible powers",
    body: `- **Taming hearts:** hearts now float up from a penguin when you tame it.
- **See your powers:** while a chip power is active, its name and time left appear above your hotbar (for example **Potato Power 2:41**), with matching particles around you that everyone nearby can see.
- **Penguin's Grace** also shows above your hotbar, with a splash of snow and water around you.`,
  },
  {
    id: "2026-11-23-chip-powers-v2",
    title: "Chip powers rebuilt, plus a penguin pointer",
    body: `**Cleaner chip powers.** Potato chip powers are now their own powers instead of a stack of regular effects, so your effects list stays clear and only the power's name and time left show above your hotbar.
- **Potato Power:** 60% more damage, 30% less damage taken, fast healing and 8 extra hearts (3 minutes)
- **Fire Crunch:** 90% more damage, immune to fire and lava, 40% faster (3 minutes)
- **Sour Rush:** 60% faster, no fall damage, 20% less damage taken (5 minutes)
- **Cosmic Crunch:** 70% more damage, 45% less damage taken, very fast healing, 10 extra hearts, 40% faster, and immune to fire, lava, drowning and fall damage (5 minutes)

**Penguin's Grace** works the same way: keep your penguin within 16 blocks to move faster in water (and never drown) and even faster on ice.

**Penguin pointer.** If your penguin wanders more than 16 blocks away, a small penguin icon and an arrow above your hotbar point you back to it. Only you can see it.`,
  },
  {
    id: "2026-11-23-pets-spawn",
    title: "Pets wait outside spawn, and chip powers now show up",
    body: `- **Pets wait outside spawn.** Tamed-type animals (wolves, cats, parrots, horses, penguins and more) no longer follow you into spawn, where they wouldn't survive. They wait just outside the edge until you come back.
- **Chip powers now show.** The power name, time left and Penguin's Grace now appear under your money above the hotbar, instead of being covered by it.`,
  },
  {
    id: "2026-11-23-welcome-screen",
    title: "A new welcome screen",
    body: `Every time you join, a full-screen welcome screen now greets you with the GalaxySMP logo, the website, who's online, your money, the latest news and the next event.

Use the tabs to learn the basics (Getting Started, Plots, Money & Store, Voice Chat, Minigames and Rules), then press **Continue** to start playing. New players are taken to spawn, and everyone else picks up right where they left off.`,
  },
  {
    id: "2026-11-23-title-screen",
    title: "A brand-new title screen",
    body: `The join screen has been rebuilt to feel like Minecraft's own title screen: the GalaxySMP logo over a slowly moving night landscape, with **Play**, **How to Play**, **Rules** and **What's New**.

**Play** opens a Featured Servers list with a picture, description and player count for each server. Keep an eye on it: special event servers will appear there too.

Also fixed: your view no longer looks zoomed in after joining.`,
  },
  {
    id: "2026-11-23-title-screen-3d",
    title: "The title screen, now in full 3D",
    body: `The join screen has a brand-new look: a real 3D view of a GalaxySMP valley at sunset, with snowy mountains, forests, a lake and the spawn tower glowing in the evening light, slowly drifting behind the logo. It now fills your whole screen, edge to edge.

The Featured Servers list has new 3D pictures too.`,
  },
  {
    id: "2026-11-23-main-menu",
    title: "The new GalaxySMP Main Menu",
    body: `Joining GalaxySMP now starts at a brand-new Main Menu:
- **3D scenes:** a different one every time you join: the Trial Chambers, the Deep Dark, Lush Caves, the Nether, the End, a desert of giant bones inspired by The Sift, and our own valley at sunset. Each one has GalaxySMP adventurers exploring it.
- **Your character** stands on the right, menu music plays, and a new yellow splash line appears under the logo each time.
- **Featured Servers:** pick a server to see its banner, your ping, how many players are there and its activities, then press **Join Server**. Event servers will show up here too.
- **A joining animation** like our website's loading screen: the server's block cracks and bursts, and rare blocks can appear.
- **Store**, **How to Play**, **Rules** and **What's New** are all one tap away.

Open the menu any time with **/menu**, with the new **GalaxySMP Menu** compass in your last hotbar slot, or from **/guide**.`,
  },
  {
    id: "2026-11-23-main-menu-wallpapers",
    title: "Main Menu: new backgrounds",
    body: `The Main Menu now shows official Minecraft artwork in the background: **The Copper Age**, **Wilderness Bound**, **Chaos Cubed** and **The Sift**, with a different one each time you join. The Featured Servers pictures use them too.`,
  },
  {
    id: "2026-11-23-social-backups",
    title: "Social, parties and easy account linking",
    body: `**Social** is now on the Main Menu (/menu):
- **Friends:** see who's online and where they are, send a teleport request, invite them to your party, or send a message. Friends are shared with galaxymc.us.
- **Requests:** accept or decline friend requests right in game.
- **Parties** (up to 4): when the party leader joins a server from the Main Menu, everyone comes along. Party chat with **/p**. Parties also keep you on the same Bedwars team.
- **Recent players:** people you played near lately, so you can add them as friends.
- **My Card:** your rank, playtime, money and achievements, and you choose whether friends can see it.

**Link Account:** not linked yet? The Main Menu shows a QR code. Scan it with your phone, pick a password, and you're done.

Also new: holiday greetings and decorations on the Main Menu, a notice when a server restart is coming, and nightly world backups kept safe in two places.`,
  },
];

// Official posts come from the GalaxySMP member account (or the owner, if it doesn't exist yet).
async function officialAuthor(env, sql) {
  const [bot] = await sql`SELECT id, username FROM users WHERE is_bot ORDER BY id LIMIT 1`.catch(() => []);
  if (bot) return bot;
  const people = await sql`SELECT id, username, platform FROM users WHERE NOT banned ORDER BY id LIMIT 200`;
  return people.find((u) => isOwner(env, u.username, u.platform === "bedrock"));
}

async function postOfficialSuggestions(sql, author) {
  return;  // switched off: never post in #Suggestions
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
    await postOfficialSuggestions(sql, await officialAuthor(env, sql));
  }
  for (const r of RELEASES) {
    const key = `release:${r.id}`;
    if (done.has(key)) continue;
    const claimed = await sql`INSERT INTO economy_config (key, value, updated_by) VALUES (${key}, ${JSON.stringify(new Date().toISOString())}::jsonb, 'server')
                              ON CONFLICT (key) DO NOTHING RETURNING key`;
    if (!claimed.length) continue; // another run got it first
    const author = await officialAuthor(env, sql);
    await sql`INSERT INTO news_posts (title, body, tag, author_id) VALUES (${r.title}, ${r.body}, 'release', ${author?.id || null})`;
    await notify(env, "all", "news", { title: "New update", body: r.title, url: "/community#updates", tag: `release-${r.id}` }).catch(() => {});
  }
}
