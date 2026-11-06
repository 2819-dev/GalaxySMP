package net.galaxysmp.link;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * GalaxyLink: adds /link CODE. The code comes from the GalaxySMP website; this plugin
 * sends it, together with the player's name and UUID, to the website to prove the
 * player owns that Minecraft account.
 */
public final class GalaxyLink extends JavaPlugin implements CommandExecutor {

    private static final long COOLDOWN_MS = 5_000;

    private final Map<UUID, Long> lastUse = new ConcurrentHashMap<>();
    private HttpClient http;
    private String website;
    private String secret;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        website = getConfig().getString("website", "").replaceAll("/+$", "");
        secret = getConfig().getString("secret", "");
        http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

        var command = getCommand("link");
        if (command != null) command.setExecutor(this);

        if (website.isEmpty() || secret.isEmpty() || secret.startsWith("PASTE_")) {
            getLogger().warning("GalaxyLink is not set up: fill in 'website' and 'secret' in plugins/GalaxyLink/config.yml");
            return;
        }
        // Check the connection to the website once at startup and report it in the console.
        getServer().getScheduler().runTaskAsynchronously(this, this::ping);
    }

    private void ping() {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(website + "/api/plugin/ping"))
                    .timeout(Duration.ofSeconds(15))
                    .header("Authorization", "Bearer " + secret)
                    .GET().build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 200) {
                getLogger().info("Connected to the GalaxySMP website. /link is ready.");
            } else {
                getLogger().warning("Website answered " + res.statusCode() + ": " + res.body()
                        + " (check that 'secret' matches PLUGIN_SECRET in Cloudflare)");
            }
        } catch (Exception e) {
            getLogger().warning("Could not reach the website at " + website + ": " + e.getMessage());
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only players can use /link.");
            return true;
        }
        if (args.length != 1) {
            player.sendMessage(Component.text("Usage: /link CODE  (get your code on the GalaxySMP website)", NamedTextColor.YELLOW));
            return true;
        }
        long now = System.currentTimeMillis();
        Long last = lastUse.get(player.getUniqueId());
        if (last != null && now - last < COOLDOWN_MS) {
            player.sendMessage(Component.text("Please wait a few seconds before trying again.", NamedTextColor.YELLOW));
            return true;
        }
        lastUse.put(player.getUniqueId(), now);

        String code = args[0].trim();
        UUID uuid = player.getUniqueId();
        String name = player.getName();
        boolean bedrock = isBedrock(uuid);

        player.sendMessage(Component.text("Checking your code...", NamedTextColor.GRAY));
        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            Component reply = sendLink(code, uuid, name, bedrock);
            getServer().getScheduler().runTask(this, () -> {
                Player online = getServer().getPlayer(uuid);
                if (online != null) online.sendMessage(reply);
            });
        });
        return true;
    }

    private Component sendLink(String code, UUID uuid, String name, boolean bedrock) {
        JsonObject body = new JsonObject();
        body.addProperty("code", code);
        body.addProperty("uuid", uuid.toString());
        body.addProperty("name", name);
        body.addProperty("bedrock", bedrock);
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(website + "/api/plugin/link"))
                    .timeout(Duration.ofSeconds(15))
                    .header("Authorization", "Bearer " + secret)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonObject json = JsonParser.parseString(res.body()).getAsJsonObject();
            boolean ok = json.has("ok") && json.get("ok").getAsBoolean();
            String message = json.has("message") ? json.get("message").getAsString()
                    : json.has("error") ? json.get("error").getAsString() : "Unknown reply from the website.";
            if (res.statusCode() != 200) {
                getLogger().warning("Link failed (" + res.statusCode() + "): " + res.body());
            }
            return Component.text(message, ok ? NamedTextColor.GREEN : NamedTextColor.RED);
        } catch (Exception e) {
            getLogger().warning("Could not reach the website: " + e.getMessage());
            return Component.text("Couldn't reach the website right now. Try again in a minute.", NamedTextColor.RED);
        }
    }

    /** Bedrock players join through Geyser + Floodgate. Ask Floodgate if it's installed. */
    private boolean isBedrock(UUID uuid) {
        try {
            Class<?> api = Class.forName("org.geysermc.floodgate.api.FloodgateApi");
            Object instance = api.getMethod("getInstance").invoke(null);
            return (boolean) api.getMethod("isFloodgatePlayer", UUID.class).invoke(instance, uuid);
        } catch (Throwable ignored) {
            // Floodgate gives Bedrock players UUIDs that start with zeros.
            return uuid.getMostSignificantBits() == 0;
        }
    }
}
