// The Shop part of the Store: everything that's bought once (not a subscription).
// Prices are in US cents. "limit" = how many times one player can buy it.
// Payments aren't open yet: Admins give these from the panel (Players > a player > Give a Shop item).
export const SHOP = [
  {
    // Real things we ship (not given in game). "Coming soon" until "devices" is added to ON_SALE.
    id: "devices", name: "Galaxy Cube", blurb: "Our own device: join GalaxySMP from any console and use voice chat with real buttons.",
    physical: true,
    items: [
      { id: "galaxy_cube", name: "Galaxy Cube", priceText: "TBD", priceNote: "$20 to $50", icon: "cube", badge: "New", physical: true,
        description: "Sits next to your console: join GalaxySMP from Xbox, PlayStation or Switch, and talk in voice chat with TALK and MUTE buttons. Built and 3D-printed by GalaxySMP." },
    ],
  },
  {
    id: "money", name: "Money", blurb: "In-game money, added to your balance straight away.",
    items: [
      { id: "money_1k", name: "$1K", price: 50, cents: 100000, icon: "wallet", description: "A little extra spending money." },
      { id: "money_10k", name: "$10K", price: 150, cents: 1000000, icon: "coins", description: "Enough for a stack of crate keys." },
      { id: "money_100k", name: "$100K", price: 600, cents: 10000000, icon: "bank", description: "Big builds, big shops." },
      { id: "money_1m", name: "$1M", price: 2000, cents: 100000000, icon: "crown", badge: "Best value", description: "Become a Millionaire (that's an achievement too)." },
    ],
  },
  {
    // Item packs: given in game (or saved until you next join). Contents are in the plugin's packs.json.
    id: "packs", name: "Packs", blurb: "Useful items, delivered straight to your inventory.",
    items: [
      { id: "pack_food", name: "Food Pack", price: 50, packs: { food: 1 }, icon: "leaf", description: "32 steak, 16 golden carrots and 16 bread." },
      { id: "pack_tools", name: "Tool Pack", price: 75, packs: { tools: 1 }, icon: "pickaxe", description: "Iron pickaxe, axe, shovel and sword, plus a shield." },
      { id: "pack_builder", name: "Builder Pack", price: 100, packs: { builder: 1 }, icon: "bricks", description: "64 oak logs, 64 stone bricks, 32 glass and 32 torches." },
      { id: "pack_miner", name: "Miner Pack", price: 100, packs: { miner: 1 }, icon: "pickaxe", description: "An iron pickaxe, 64 torches, 32 ladders and 16 steak." },
      { id: "pack_rare", name: "Rare Pack", price: 200, packs: { rare: 1 }, icon: "gem", description: "4 diamonds, 2 golden apples, 4 ender pearls and 16 bottles o' enchanting." },
      { id: "pack_legendary", name: "Legendary Pack", price: 400, packs: { legendary: 1 }, icon: "crown", badge: "Rarest", description: "16 diamonds, 2 netherite scrap, an enchanted golden apple, a totem of undying and 64 bottles o' enchanting." },
    ],
  },
  {
    // Bundles: several things for less than buying each one.
    id: "bundles", name: "Bundles", blurb: "More for less: several things together, cheaper than buying each one.",
    items: [
      { id: "bundle_starter", name: "Starter Bundle", price: 399, limit: 1, icon: "rocket", badge: "Best for new players",
        bundle: { plan: "plus", packs: { tools: 1, food: 1, builder: 1 }, keys: { rare: 1 } }, worth: 625,
        description: "Galaxy+ for 30 days, a Tool Pack, a Food Pack, a Builder Pack and a Rare crate key. One per player." },
      { id: "bundle_adventurer", name: "Adventurer Bundle", price: 299, icon: "compass",
        bundle: { packs: { miner: 1, rare: 1, food: 1 }, keys: { common: 2 } }, worth: 450,
        description: "A Miner Pack, a Rare Pack, a Food Pack and 2 Common crate keys." },
      { id: "bundle_legend", name: "Legend Bundle", price: 899, icon: "crown", badge: "Best value",
        bundle: { plan: "pro", packs: { legendary: 1, rare: 1 }, keys: { galaxy: 1 } }, worth: 1350,
        description: "Galaxy Pro+ for 30 days, a Legendary Pack, a Rare Pack and a Galaxy crate key." },
    ],
  },
  {
    id: "plots", name: "Plots", blurb: "More land, on top of what your plan gives. Yours to keep.",
    items: [
      { id: "extra_plot", name: "Extra plot", price: 50, limit: 2, icon: "home", description: "One more plot to build on. You can buy this twice." },
      { id: "extra_shop_plot", name: "Extra shop plot", price: 50, limit: 2, icon: "store", description: "One more shop plot in the Shop District. You can buy this twice." },
    ],
  },
  {
    id: "streak", name: "Streak", blurb: "Keep your daily streak safe. A freeze is used up by itself if you miss a day of /daily.",
    items: [
      { id: "streak_freeze_1", name: "Streak Freeze", price: 50, freezes: 1, icon: "snowflake", description: "Saves your daily streak once if you miss a day." },
      { id: "streak_freeze_5", name: "5 Streak Freezes", price: 200, freezes: 5, icon: "snowflake", badge: "Best value", description: "Five freezes for your daily streak. You can hold up to 10." },
    ],
  },
  {
    id: "effects", name: "Effects", blurb: "Handy effects that stay on while you play.",
    items: [
      {
        id: "night_vision", name: "Night Vision", icon: "moon", description: "See clearly in caves and at night. Stays on until it runs out, even if you rejoin.",
        options: [
          { id: "1d", name: "1 day", days: 1, price: 50 },
          { id: "3d", name: "3 days", days: 3, price: 100 },
          { id: "7d", name: "1 week", days: 7, price: 150 },
          { id: "14d", name: "2 weeks", days: 14, price: 200 },
        ],
      },
    ],
  },
  {
    id: "cosmetics", name: "Exclusive cosmetics", blurb: "Particle trails follow you as you walk; everyone near you sees them. Pick one in game with /cosmetics.",
    items: [
      { id: "trail_hearts", name: "Hearts trail", price: 150, limit: 1, icon: "heart", description: "Little hearts wherever you go." },
      { id: "trail_flames", name: "Flames trail", price: 150, limit: 1, icon: "flame", description: "Leave a trail of fire (it doesn't burn anything)." },
      { id: "trail_notes", name: "Music Notes trail", price: 150, limit: 1, icon: "music", description: "Colorful music notes follow you." },
      { id: "trail_stars", name: "Starlight trail", price: 200, limit: 1, icon: "sparkles", description: "Glowing End Rod sparks." },
      { id: "trail_soul", name: "Soul Fire trail", price: 200, limit: 1, icon: "soul", description: "Spooky blue soul flames." },
      { id: "trail_cherry", name: "Cherry Blossom trail", price: 200, limit: 1, icon: "flower", description: "Pink petals drifting behind you." },
      { id: "trail_sparkle", name: "Sparkle trail", price: 150, limit: 1, icon: "sparkles", description: "Green sparkles. Included with Galaxy+ and Pro+." },
      { id: "trail_galaxy", name: "Galaxy trail", price: 250, limit: 1, icon: "orbit", description: "Deep purple space dust. Included with Galaxy Pro+." },
      { id: "join_firework", name: "Join firework", price: 100, limit: 1, icon: "firework", description: "A firework launches when you join. Included with Galaxy Pro+." },
      { id: "join_sound", name: "Join chime", price: 75, limit: 1, icon: "bell", description: "Everyone online hears a chime when you join." },
      { id: "join_message", name: "Custom join message", price: 150, limit: 1, icon: "message", description: "Write your own message that everyone sees when you join (e.g. \"has entered the galaxy!\")." },
      { id: "bw_win_rainbow", name: "Victory effect: Rainbow Burst", price: 200, limit: 1, icon: "sparkles", description: "A burst of colors when you win in Bedwars or PvP. Pick it in game with /cosmetics." },
      { id: "bw_win_dragon", name: "Victory effect: Dragon Roar", price: 300, limit: 1, icon: "flame", description: "A dragon's roar and purple breath when you win in Bedwars or PvP. Pick it with /cosmetics." },
      { id: "bw_win_confetti", name: "Victory effect: Confetti", price: 200, limit: 1, icon: "sparkles", description: "Confetti and a cheer when you win in Bedwars or PvP. Pick it with /cosmetics." },
      { id: "bw_kill_lightning", name: "Kill effect: Lightning", price: 200, limit: 1, icon: "bolt", description: "A crackle of lightning when you knock someone out in Bedwars or PvP." },
      { id: "bw_kill_smoke", name: "Kill effect: Puff of Smoke", price: 150, limit: 1, icon: "sparkles", description: "A puff of smoke when you knock someone out in Bedwars or PvP." },
      { id: "bw_kill_galaxy", name: "Kill effect: Galaxy Burst", price: 250, limit: 1, icon: "orbit", description: "A burst of purple space dust when you knock someone out. Free after 100 wins in Bedwars and PvP." },
    ],
  },
];

export const SHOP_ITEMS = Object.fromEntries(SHOP.flatMap((c) => c.items.map((i) => [i.id, { ...i, category: c.id }])));
// Things given in game (the Galaxy Cube is shipped, so staff can't "give" it and promo codes don't list it).
export const GAME_SHOP = SHOP.filter((c) => !c.physical);
export const COSMETIC_IDS = SHOP.find((c) => c.id === "cosmetics").items.map((i) => i.id);
