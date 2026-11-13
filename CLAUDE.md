# GalaxySMP notes for Claude

- With every update you deploy, add a release note to the end of `RELEASES` in `src/lib/releases.js`
  (new `id`, professional title and body). The website posts it to #Updates once, by itself.
- Small database changes can go in `src/lib/autoschema.js` (they run automatically, must be safe to run twice).
  Also keep a copy in `migrations/`.
- Never use the word "Webshop" on the site; it's the "Store".
