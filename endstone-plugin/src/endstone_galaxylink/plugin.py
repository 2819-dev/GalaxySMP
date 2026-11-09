"""GalaxyLink for Endstone (Bedrock Dedicated Server).

Adds /link CODE (the code comes from the GalaxySMP website), voice chat icons,
ranks (/ranks) and the economy: money, /pay, /shop, /sell, /ah and shop NPCs.
"""

import json
import threading
import time
import urllib.error
import urllib.request

from endstone import ColorFormat, Player
from endstone.command import Command, CommandSender
from endstone.event import (ActorDamageEvent, ActorExplodeEvent, BlockBreakEvent, BlockExplodeEvent,
                            BlockFromToEvent, BlockPlaceEvent, PlayerChatEvent, PlayerDeathEvent,
                            PlayerInteractActorEvent, PlayerInteractEvent, PlayerJoinEvent, PlayerQuitEvent,
                            event_handler)
from endstone.plugin import Plugin

from endstone_galaxylink import settings
from endstone_galaxylink.auction import AuctionHouse
from endstone_galaxylink.chatfilter import ChatFilter
from endstone_galaxylink.economy import HUD_TICKS, Economy
from endstone_galaxylink.helpmenu import HelpMenu
from endstone_galaxylink.npc import HOLD_TICKS, NpcManager
from endstone_galaxylink.plans import CHECK_TICKS, Plans
from endstone_galaxylink.minigames import STAFF_PERMISSION, Minigames
from endstone_galaxylink.plots import Plots
from endstone_galaxylink.ranks import RankManager, name_text, tag_text
from endstone_galaxylink.shop import Shop
from endstone_galaxylink.teleport import Teleports
from endstone_galaxylink.voice import VoiceLink

VERSION = "2.11.0"


def _cmd(description, usage, perm, aliases=None):
    c = {"description": description, "usages": usage if isinstance(usage, list) else [usage], "permissions": [perm]}
    if aliases:
        c["aliases"] = aliases
    return c


def _perm(description, default):
    return {"description": description, "default": default}

COOLDOWN_SECONDS = 5
TIMEOUT_SECONDS = 15


class GalaxyLink(Plugin):
    api_version = "0.5"
    description = "GalaxySMP: account linking (/link), website voice chat and ranks (/ranks)."
    website = "https://galaxymc.us"

    commands = {
        "link": _cmd("Link your account to the GalaxySMP website.", "/link <code: message>", "galaxylink.command.link"),
        "ranks": _cmd("Manage GalaxySMP ranks.", "/ranks", "galaxylink.command.ranks"),
        "money": _cmd("See your money (or someone else's).", "/money [player: message]", "galaxylink.command.money",
                      ["bal", "balance"]),
        "pay": _cmd("Send money to a player, like /pay Steve 2.5k", "/pay <player: player> <amount: message>",
                    "galaxylink.command.pay"),
        "baltop": _cmd("The richest players.", "/baltop", "galaxylink.command.baltop"),
        "shop": _cmd("Buy and sell items.", "/shop", "galaxylink.command.shop"),
        "sell": _cmd("Sell items: /sell, /sell hand or /sell all", "/sell [what: message]", "galaxylink.command.sell"),
        "ah": _cmd("The Auction House. /ah sell <price> sells the item in your hand.", "/ah [action: message]",
                   "galaxylink.command.ah", ["auction"]),
        "setmoney": _cmd("Set a player's money.", "/setmoney <player: player> <amount: message>", "galaxylink.command.setmoney"),
        "addmoney": _cmd("Give a player money.", "/addmoney <player: player> <amount: message>", "galaxylink.command.addmoney"),
        "takemoney": _cmd("Take money from a player.", "/takemoney <player: player> <amount: message>",
                          "galaxylink.command.takemoney"),
        "shopnpc": _cmd("Summon a shop NPC where you stand. Tap it to edit it.", "/shopnpc", "galaxylink.command.shopnpc"),
        "guide": _cmd("Help: server info, rules and commands.", "/guide", "galaxylink.command.guide", ["menu"]),
        "tpa": _cmd("Ask to teleport to a player.", "/tpa <player: player>", "galaxylink.command.tpa"),
        "tpahere": _cmd("Ask a player to teleport to you.", "/tpahere <player: player>", "galaxylink.command.tpahere"),
        "tpaccept": _cmd("Accept a teleport request.", "/tpaccept [player: message]", "galaxylink.command.tpaccept", ["tpyes"]),
        "tpdeny": _cmd("Say no to a teleport request.", "/tpdeny [player: message]", "galaxylink.command.tpdeny", ["tpno"]),
        "spawn": _cmd("Go to spawn.", "/spawn", "galaxylink.command.spawn"),
        "setspawn": _cmd("Set spawn to where you stand.", "/setspawn", "galaxylink.command.setspawn"),
        "home": _cmd("Teleport to one of your homes.", "/home [name: message]", "galaxylink.command.home"),
        "sethome": _cmd("Save a home where you stand.", "/sethome [name: message]", "galaxylink.command.sethome"),
        "delhome": _cmd("Delete a home.", "/delhome <name: message>", "galaxylink.command.delhome"),
        "homes": _cmd("List your homes.", "/homes", "galaxylink.command.homes"),
        "back": _cmd("Go back to where you died or last teleported from.", "/back", "galaxylink.command.back"),
        "plan": _cmd("See your subscription plan.", "/plan", "galaxylink.command.plan"),
        "plot": _cmd("Manage your plot. /plot shovel gets a claiming shovel.", "/plot [action: message]", "galaxylink.command.plot", ["plots"]),
        "chatfilter": _cmd("Turn the chat filter on or off for everyone.", "/chatfilter [state: message]", "galaxylink.command.chatfilter"),
        "minigames": _cmd("The Minigame Center: host, join or watch minigames.", "/minigames", "galaxylink.command.minigames", ["minigame", "mg"]),
        "tpd": _cmd("Teleport where you've been sent (e.g. to the staff member who accepted your minigame).", "/tpd", "galaxylink.command.tpd"),
        "plotaxe": _cmd("Get the Plot Axe to make plots and protected areas.", "/plotaxe", "galaxylink.command.plotaxe"),
    }
    permissions = {
        "galaxylink.command.link": _perm("Allows players to use /link.", True),
        "galaxylink.command.ranks": _perm("Allows managing ranks with /ranks (server operators).", "op"),
        "galaxylink.command.money": _perm("Allows /money.", True),
        "galaxylink.command.pay": _perm("Allows /pay.", True),
        "galaxylink.command.baltop": _perm("Allows /baltop.", True),
        "galaxylink.command.shop": _perm("Allows /shop.", True),
        "galaxylink.command.sell": _perm("Allows /sell.", True),
        "galaxylink.command.ah": _perm("Allows the Auction House.", True),
        "galaxylink.command.setmoney": _perm("Allows /setmoney (server operators).", "op"),
        "galaxylink.command.addmoney": _perm("Allows /addmoney (server operators).", "op"),
        "galaxylink.command.takemoney": _perm("Allows /takemoney (server operators).", "op"),
        "galaxylink.command.shopnpc": _perm("Allows /shopnpc and editing NPCs (server operators).", "op"),
        "galaxylink.command.guide": _perm("Allows /guide.", True),
        "galaxylink.command.tpa": _perm("Allows /tpa.", True),
        "galaxylink.command.tpahere": _perm("Allows /tpahere.", True),
        "galaxylink.command.tpaccept": _perm("Allows /tpaccept.", True),
        "galaxylink.command.tpdeny": _perm("Allows /tpdeny.", True),
        "galaxylink.command.spawn": _perm("Allows /spawn.", True),
        "galaxylink.command.setspawn": _perm("Allows /setspawn (server operators).", "op"),
        "galaxylink.command.home": _perm("Allows /home.", True),
        "galaxylink.command.sethome": _perm("Allows /sethome.", True),
        "galaxylink.command.delhome": _perm("Allows /delhome.", True),
        "galaxylink.command.homes": _perm("Allows /homes.", True),
        "galaxylink.command.back": _perm("Allows /back.", True),
        "galaxylink.command.plan": _perm("Allows /plan.", True),
        "galaxylink.command.plot": _perm("Allows /plot.", True),
        "galaxylink.command.plotaxe": _perm("Allows /plotaxe (server operators).", "op"),
        "galaxylink.command.minigames": _perm("Allows /minigames.", True),
        "galaxylink.command.chatfilter": _perm("Allows /chatfilter (server operators, or give it with a rank).", "op"),
        "galaxylink.command.tpd": _perm("Allows /tpd.", True),
        STAFF_PERMISSION: _perm("Minigame Staff: accept or decline minigame host requests. Give it with a rank.", "op"),
    }

    def on_enable(self) -> None:
        self._last_use = {}
        self._voice = None
        self.ranks = RankManager(self)
        self.economy = Economy(self)
        self.plans = Plans(self)
        self.shop = Shop(self)
        self.auction = AuctionHouse(self)
        self.npcs = NpcManager(self)
        self.help = HelpMenu(self)
        self.teleports = Teleports(self)
        self.plots = Plots(self)
        self.minigames = Minigames(self)
        self.chatfilter = ChatFilter(self)
        self.server.scheduler.run_task(self, self.minigames.tick, delay=600, period=600)
        self.server.scheduler.run_task(self, self.plots.tick, delay=1, period=1)
        self.server.scheduler.run_task(self, self.auction.tick, delay=600, period=600)
        self.register_events(self)
        self.server.scheduler.run_task(self, self.economy.tick, delay=HUD_TICKS, period=HUD_TICKS)
        self.server.scheduler.run_task(self, self.npcs.tick, delay=HOLD_TICKS, period=HOLD_TICKS)
        self.server.scheduler.run_task(self, self.plans.tick, delay=CHECK_TICKS, period=CHECK_TICKS)
        self._base = settings.WEBSITE.rstrip("/")
        if not settings.SECRET or settings.SECRET.startswith("PASTE_"):
            self.logger.warning("GalaxyLink is missing its secret. Download a fresh build from the website team.")
            return
        threading.Thread(target=self._ping, daemon=True).start()
        # Voice chat: positions out, name-tag icons in.
        self._voice = VoiceLink(self, self._base, settings.SECRET)
        self._voice.start()

    # ---------- Name tags and chat ----------
    def compose_tag(self, player, icon):
        """Above the head:
            [👑 OWNER]        rank (in the rank's color), only if they have one
            🎤 player1        voice icon, then the name in the rank's color
        The money line under it is the score tag (economy.py)."""
        rank = self.ranks.rank_for(player)
        plan_tag = self.plans.tag_for(player) if getattr(self, "plans", None) else None
        tags = [tag_text(t) for t in (rank, plan_tag) if t]  # e.g. [👑 OWNER] [⭐ GALAXY+]
        name = f"{name_text(player.name, rank or plan_tag)}§r"
        if icon:
            name = f"§r{icon} {name}"
        return "§r ".join(tags) + "§r\n" + name if tags else name

    def refresh_tags(self):
        if self._voice:
            self._voice._apply_icons()
        else:
            for p in self.server.online_players:
                p.name_tag = self.compose_tag(p, None)

    @event_handler
    def on_player_join(self, event: PlayerJoinEvent):
        player = event.player
        self.ranks.apply_permissions(player)
        self.economy.on_join(player)
        self.plans.bill(player)
        self.plots.on_join(player)
        self.minigames.on_join(player)
        player.send_message("§7Need help? Type §e/guide§7 for server info, rules and commands.")
        self.refresh_tags()
        if self._voice:
            self._voice.send_seen([player])

    @event_handler
    def on_player_quit(self, event: PlayerQuitEvent):
        self.ranks.forget(event.player)
        self.teleports.on_quit(event.player)

    @event_handler
    def on_player_death(self, event: PlayerDeathEvent):
        self.teleports.on_death(event.player)

    @event_handler
    def on_interact_actor(self, event: PlayerInteractActorEvent):
        self.npcs.on_interact(event)

    @event_handler
    def on_actor_damage(self, event: ActorDamageEvent):
        self.npcs.on_damage(event)
        self.plots.on_damage(event)

    # ---------- plot protection ----------
    @event_handler
    def on_block_break(self, event: BlockBreakEvent):
        self.plots.on_break(event)

    @event_handler
    def on_block_place(self, event: BlockPlaceEvent):
        self.plots.on_place(event)

    @event_handler
    def on_interact(self, event: PlayerInteractEvent):
        if self.minigames.on_interact(event):  # Minigame Computer
            return
        self.plots.on_interact(event)

    @event_handler
    def on_actor_explode(self, event: ActorExplodeEvent):
        self.plots.on_explode(event)

    @event_handler
    def on_block_explode(self, event: BlockExplodeEvent):
        self.plots.on_explode(event)

    @event_handler
    def on_flow(self, event: BlockFromToEvent):
        self.plots.on_flow(event)

    @event_handler
    def on_player_chat(self, event: PlayerChatEvent):
        self.chatfilter.on_chat(event)  # scrambles bad words with §k (when it's on)
        event.format = self.ranks.chat_format(event.player)

    def on_disable(self) -> None:
        if getattr(self, "_voice", None):
            self.economy.sync()
            self._voice.stop()
        if getattr(self, "economy", None):
            self.economy.db.close()

    # ---------- Website requests (run on a background thread) ----------
    def _request(self, path, body=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            self._base + path,
            data=data,
            method="POST" if data is not None else "GET",
            headers={
                "Authorization": "Bearer " + settings.SECRET,
                "Content-Type": "application/json",
                "User-Agent": "GalaxyLink-Endstone/" + VERSION,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as res:
                return res.status, json.loads(res.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read().decode("utf-8") or "{}")
            except ValueError:
                payload = {}
            return e.code, payload

    def _ping(self):
        try:
            status, data = self._request("/api/plugin/ping")
            if status == 200:
                self.logger.info("Connected to the GalaxySMP website. /link is ready.")
            else:
                self.logger.warning(f"Website answered {status}: {data.get('error', data)}")
        except Exception as e:  # network problems
            self.logger.warning(f"Could not reach the website at {self._base}: {e}")

    # ---------- /link ----------
    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        name = command.name
        player_only = {"pay", "shop", "sell", "ah", "baltop", "shopnpc", "ranks", "guide", "tpa", "tpahere", "tpaccept",
                       "tpdeny", "spawn", "setspawn", "home", "sethome", "delhome", "homes", "back", "plan", "plot", "plotaxe", "minigames", "tpd"}
        if name in player_only and not isinstance(sender, Player):
            sender.send_message(f"/{name} can only be used in game.")
            return True
        if name == "money":
            self.economy.cmd_money(sender, args)
            return True
        if name == "pay":
            self.economy.cmd_pay(sender, args)
            return True
        if name in ("setmoney", "addmoney", "takemoney"):
            self.economy.cmd_admin(sender, name, args)
            return True
        if name == "baltop":
            self.economy.open_top(sender)
            return True
        if name == "shop":
            self.shop.open(sender)
            return True
        if name == "sell":
            self.shop.cmd_sell(sender, args)
            return True
        if name == "ah":
            self.auction.command(sender, args)
            return True
        tp = self.teleports
        simple = {
            "guide": lambda: self.help.open(sender),
            "tpa": lambda: tp.request(sender, args, "to"),
            "tpahere": lambda: tp.request(sender, args, "here"),
            "tpaccept": lambda: tp.accept(sender, args),
            "tpdeny": lambda: tp.deny(sender, args),
            "spawn": lambda: tp.spawn(sender),
            "setspawn": lambda: tp.set_spawn(sender),
            "home": lambda: tp.home(sender, args),
            "sethome": lambda: tp.set_home(sender, args),
            "delhome": lambda: tp.del_home(sender, args),
            "homes": lambda: tp.list_homes(sender),
            "back": lambda: tp.go_back(sender),
            "plan": lambda: sender.send_message(self.plans.describe(sender)),
            "plot": lambda: self.plots.command(sender, args),
            "plotaxe": lambda: self.plots.give_axe(sender),
            "minigames": lambda: self.minigames.open(sender),
            "chatfilter": lambda: self.chatfilter.command(sender, args),
            "tpd": lambda: self.minigames.tpd_command(sender),
        }
        if name in simple:
            simple[name]()
            return True
        if name == "shopnpc":
            self.npcs.create(sender)
            return True
        if command.name == "ranks":
            if not isinstance(sender, Player):
                sender.send_message("Open /ranks in game, or use galaxymc.us (Staff Tools > Ranks).")
                return True
            self.ranks.open_menu(sender)
            return True
        if command.name != "link":
            return False
        if not isinstance(sender, Player):
            sender.send_message("This command can only be used by players.")
            return True

        code = " ".join(args).strip()
        if not code:
            sender.send_message(f"{ColorFormat.YELLOW}Usage: /link <code>. Generate a code on galaxymc.us/community.")
            return True

        player_id = str(sender.unique_id)
        now = time.monotonic()
        if now - self._last_use.get(player_id, 0) < COOLDOWN_SECONDS:
            sender.send_message(f"{ColorFormat.YELLOW}Please wait a few seconds before trying again.")
            return True
        self._last_use[player_id] = now

        name = sender.name
        sender.send_message(f"{ColorFormat.GRAY}Verifying your code...")
        body = {"code": code, "uuid": player_id, "name": name, "bedrock": True, "xuid": sender.xuid}
        threading.Thread(target=self._link, args=(body, sender.unique_id), daemon=True).start()
        return True

    def _link(self, body, unique_id):
        try:
            status, data = self._request("/api/plugin/link", body)
            ok = bool(data.get("ok"))
            message = data.get("message") or data.get("error") or "Unknown reply from the website."
            if status != 200:
                self.logger.warning(f"Link failed ({status}): {message}")
        except Exception as e:
            ok = False
            message = "The website could not be reached. Please try again shortly."
            self.logger.warning(f"Could not reach the website: {e}")

        color = ColorFormat.GREEN if ok else ColorFormat.RED

        def reply():
            player = self.server.get_player(unique_id)
            if player is not None:
                player.send_message(color + message)

        # Talk to the player from the main server thread.
        self.server.scheduler.run_task(self, reply)
