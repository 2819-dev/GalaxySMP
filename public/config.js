// ============================================================
//  GalaxySMP site settings: the ONE place to change server info.
//  Edit this file on GitHub; the website updates by itself in about a minute.
// ============================================================
const config = {
  serverName: "GalaxySMP",
  tagline: "One server. Every adventure.",
  description:
    "A friendly Java + Bedrock Minecraft server with Survival, Minigames, Skyblock and Creative. " +
    "Click an NPC in the hub to jump between worlds.",

  // Java players type this in Multiplayer > Add Server.
  // Replace "your.server.ip" with your real address from the BisectHosting panel.
  javaAddress: "your.server.ip",
  javaPort: 25565,

  // Bedrock players (phone, tablet, Xbox, Switch, PlayStation, Windows) need the address AND port.
  bedrockAddress: "your.server.ip",
  bedrockPort: 19132,

  minecraftVersion: "1.21",
  gameModes: [
    { name: "Survival", icon: "⛏️", text: "Build, mine and explore with friends." },
    { name: "Minigames", icon: "🎯", text: "Quick, fun games against other players." },
    { name: "Skyblock", icon: "🏝️", text: "Start on a tiny island in the sky and grow it." },
    { name: "Creative", icon: "🎨", text: "Unlimited blocks to build anything you imagine." },
  ],
};

export default config;
