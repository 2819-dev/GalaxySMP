// ============================================================
//  GalaxySMP site settings: the ONE place to change server info.
// ============================================================
const config = {
  serverName: "GalaxySMP",
  website: "https://galaxymc.us",

  // Where GalaxySMP is hosted right now:
  //   "realm"  = Minecraft Realms (invite only, no server address yet)
  //   "server" = our own server (shows the address and live player count)
  hosting: "server",

  // Manual status. While enabled, the website shows this instead of a live check.
  // Use it for Realm closures or maintenance. Set enabled: false to go back to automatic.
  // color: "green" (open), "amber" (maintenance / migrating), "red" (closed)
  manualStatus: {
    enabled: false,
    open: false,
    color: "amber",
    title: "Migrating to Server",
    message: "We're moving GalaxySMP from our Realm to our own server. Check back soon.",
  },

  // GalaxySMP is Bedrock only. Players need the address AND the port.
  // Replace "your.server.ip" with the real address from the BisectHosting panel.
  bedrockAddress: "galaxymc.smp.live",
  bedrockPort: 9030,

  minecraftVersion: "1.21",

  // Shown on the home page. icon = one of: mountain, target, cloud, cube
  gameModes: [
    { name: "Always Online", icon: "always", tone: "survival", text: "The server runs 24/7, so your world, plots and shops are there whenever you want to play." },
    { name: "Minigames", icon: "minigames", tone: "minigames", text: "Skyblock, Bedwars, parkour, PvP and more at the Minigame Center, with new rounds all day." },
    { name: "Proximity Voice", icon: "mic", tone: "skyblock", text: "Talk to players near you in game: voices get quieter as they walk away. Right in your browser." },
    { name: "Economy & Jobs", icon: "coins", tone: "creative", text: "Earn money with jobs, sell at the Shop, run your own shop chests and trade on the Auction House." },
    { name: "Plots & Protection", icon: "shield", tone: "plots", text: "Claim your own plot and shop plot. Nobody can grief them, and staff can roll back damage." },
    { name: "Rewards & Crates", icon: "gift", tone: "rewards", text: "Daily rewards, 3 daily quests, 44 achievements, crates and leaderboards to climb." },
  ],
};

export default config;
