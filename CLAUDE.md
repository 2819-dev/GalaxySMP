# GalaxySMP notes for Claude

- With every update you deploy, add a release note to the end of `RELEASES` in `src/lib/releases.js`
  (new `id`, professional title and body). The website posts it to #Updates once, by itself.
- Small database changes can go in `src/lib/autoschema.js` (they run automatically, must be safe to run twice).
  Also keep a copy in `migrations/`.
- Never use the word "Webshop" on the site; it's the "Store".
- Never clutter the navigation, sidebar, drawer, footer or Community channel list with new pages. Put new features
  inside existing pages (a tab, a section, a dialog or a button on a related page) unless the owner asks for a page.
- Never re-suggest ideas the owner said no to or skipped. So far: scheduled staff posts, per-channel notification
  settings, weekend boosts, treasure hunts, Bedwars Quick Buy, Bedwars tournaments, map heatmap, player-made guides,
  gifting reminders, birthdays, profile/plot guestbooks, Hall of Fame, item price guide, bug report board, advent
  calendar, "recently bought"/live tickers, vote page, Build of the Month, install-as-app, saved messages,
  "Remind me" on messages, share to DM, bounties, Party Time, weekly bingo, daily playtime chest, Galaxy Pet,
  Most Active this week, trivia nights, looking for group, weekly lottery. Add to this list whenever the owner says no.
