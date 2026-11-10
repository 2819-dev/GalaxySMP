// The Shop part of the Store: everything that's bought once (not a subscription).
// Prices are in US cents. "limit" = how many times one player can buy it.
// Payments aren't open yet: Admins give these from the panel (Players > a player > Give a Shop item).
export const SHOP = [
  {
    id: "money", name: "Money", blurb: "In-game money, added to your balance straight away.",
    items: [
      { id: "money_1k", name: "$1,000", price: 50, cents: 100000, icon: "💵", description: "A little extra spending money." },
      { id: "money_10k", name: "$10,000", price: 200, cents: 1000000, icon: "💰", description: "Enough for a stack of crate keys." },
      { id: "money_100k", name: "$100,000", price: 800, cents: 10000000, icon: "🏦", description: "Big builds, big shops." },
      { id: "money_1m", name: "$1,000,000", price: 2500, cents: 100000000, icon: "👑", badge: "Best value", description: "Become a Millionaire (that's an achievement too)." },
    ],
  },
  {
    id: "plots", name: "Plots", blurb: "More land, on top of what your plan gives. Yours to keep.",
    items: [
      { id: "extra_plot", name: "Extra plot", price: 50, limit: 2, icon: "🏡", description: "One more plot to build on. You can buy this twice." },
      { id: "extra_shop_plot", name: "Extra shop plot", price: 50, limit: 2, icon: "🏪", description: "One more shop plot in the Shop District. You can buy this twice." },
    ],
  },
  {
    id: "effects", name: "Effects", blurb: "Handy effects that stay on while you play.",
    items: [
      {
        id: "night_vision", name: "Night Vision", icon: "🌙", description: "See clearly in caves and at night. Stays on until it runs out, even if you rejoin.",
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
      { id: "trail_hearts", name: "Hearts trail", price: 150, limit: 1, icon: "💖", description: "Little hearts wherever you go." },
      { id: "trail_flames", name: "Flames trail", price: 150, limit: 1, icon: "🔥", description: "Leave a trail of fire (it doesn't burn anything)." },
      { id: "trail_notes", name: "Music Notes trail", price: 150, limit: 1, icon: "🎵", description: "Colorful music notes follow you." },
      { id: "trail_stars", name: "Starlight trail", price: 200, limit: 1, icon: "✨", description: "Glowing End Rod sparks." },
      { id: "trail_soul", name: "Soul Fire trail", price: 200, limit: 1, icon: "💙", description: "Spooky blue soul flames." },
      { id: "trail_cherry", name: "Cherry Blossom trail", price: 200, limit: 1, icon: "🌸", description: "Pink petals drifting behind you." },
      { id: "trail_sparkle", name: "Sparkle trail", price: 150, limit: 1, icon: "💚", description: "Green sparkles. Included with Galaxy+ and Pro+." },
      { id: "trail_galaxy", name: "Galaxy trail", price: 250, limit: 1, icon: "🌌", description: "Deep purple space dust. Included with Galaxy Pro+." },
      { id: "join_firework", name: "Join firework", price: 100, limit: 1, icon: "🎆", description: "A firework launches when you join. Included with Galaxy Pro+." },
      { id: "join_sound", name: "Join chime", price: 75, limit: 1, icon: "🔔", description: "Everyone online hears a chime when you join." },
      { id: "join_message", name: "Custom join message", price: 150, limit: 1, icon: "💬", description: "Write your own message that everyone sees when you join (e.g. \"has entered the galaxy!\")." },
    ],
  },
];

export const SHOP_ITEMS = Object.fromEntries(SHOP.flatMap((c) => c.items.map((i) => [i.id, { ...i, category: c.id }])));
export const COSMETIC_IDS = SHOP.find((c) => c.id === "cosmetics").items.map((i) => i.id);
