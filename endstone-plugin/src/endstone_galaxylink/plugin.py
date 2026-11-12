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
from endstone.event import (ActorDamageEvent, ActorDeathEvent, ActorExplodeEvent, ActorSpawnEvent, BlockBreakEvent, BlockExplodeEvent,
                            BlockFromToEvent, BlockPlaceEvent, PlayerChatEvent, PlayerCommandEvent, PlayerDeathEvent,
                            PlayerDropItemEvent, PlayerInteractActorEvent, PlayerInteractEvent, PlayerJoinEvent, PlayerQuitEvent,
                            PlayerRespawnEvent,
                            event_handler)
from endstone.plugin import Plugin

from endstone_galaxylink import settings
from endstone_galaxylink.auction import AuctionHouse
from endstone_galaxylink.chatfilter import ChatFilter
from endstone_galaxylink.announcements import Announcements
from endstone_galaxylink.moderation import Moderation
from endstone_galaxylink.blocklog import BlockLog, states_of
from endstone_galaxylink.progress import Progress
from endstone_galaxylink.leaderboards import Leaderboards
from endstone_galaxylink.floating import FloatingTexts
from endstone_galaxylink.jobs import Jobs
from endstone_galaxylink.shopchests import ShopChests
from endstone_galaxylink.crates import Crates
from endstone_galaxylink.elevators import Elevators
from endstone_galaxylink.ranktags import RankTags
from endstone_galaxylink import ranks as ranks_module
from endstone_galaxylink.progress import HOSTILE, short as short_id
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

VERSION = "2.26.0"


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
        "daily": _cmd("Claim your daily reward.", "/daily", "galaxylink.command.daily", ["reward"]),
        "quests": _cmd("See today's quests.", "/quests", "galaxylink.command.quests", ["quest"]),
        "achievements": _cmd("See your achievements.", "/achievements", "galaxylink.command.achievements", ["ach"]),
        "stats": _cmd("See your stats, or another player's.", "/stats [player: message]", "galaxylink.command.stats"),
        "leaderboard": _cmd("Place or remove floating leaderboards (staff).", "/leaderboard", "galaxylink.command.leaderboard", ["lb"]),
        "cosmetics": _cmd("Pick a particle trail and join effects.", "/cosmetics", "galaxylink.command.cosmetics", ["trails"]),
        "jobs": _cmd("Pick a job and earn money while you play.", "/jobs", "galaxylink.command.jobs", ["job"]),
        "crates": _cmd("Crates: place them, edit prizes, give keys (staff).", "/crates", "galaxylink.command.crates"),
        "givekey": _cmd("Give crate keys (staff).", "/givekey <player: message>", "galaxylink.command.givekey"),
        "elevator": _cmd("Get the Elevator Tool back, or open it (Galaxy+, Pro+ and staff).", "/elevator", "galaxylink.command.elevator", ["elevators"]),
        "ranktags": _cmd("Smooth gradient rank tags (pictures) on or off.", "/ranktags [state: message]", "galaxylink.command.ranktags"),
        "dm": _cmd("Send a direct message to a community member (website and game).", "/dm <player: message>", "galaxylink.command.dm", ["msgweb"]),
        "r": _cmd("Reply to your last direct message.", "/r <message: message>", "galaxylink.command.dm", ["reply"]),
        "report": _cmd("Report a player who is breaking the rules.", "/report [player: message]", "galaxylink.command.report"),
        "mod": _cmd("Staff moderation panel: warn, mute, kick, ban, reports and block logs.", "/mod", "galaxylink.command.mod"),
        "modban": _cmd("Ban a player (staff).", "/modban <player: message>", "galaxylink.command.modban"),
        "inspect": _cmd("Turn the block inspector on or off: see who placed or broke blocks.", "/inspect", "galaxylink.command.inspect"),
        "rollback": _cmd("Undo a player's block changes (griefing).", "/rollback [player: message]", "galaxylink.command.rollback"),
        "announcement": _cmd("Open the announcement panel, or announce a message to everyone.", "/announcement [message: message]", "galaxylink.command.announce", ["ann"]),
        "chatfilter": _cmd("Turn the chat filter on or off for everyone.", "/chatfilter [state: message]", "galaxylink.command.chatfilter"),
        "minigames": _cmd("The Minigame Center: host, join or watch minigames.", "/minigames", "galaxylink.command.minigames", ["minigame", "mg"]),
        "bedwars": _cmd("Play Bedwars.", "/bedwars [action: message]", "galaxylink.command.bedwars", ["bw"]),
        "leave": _cmd("Leave Bedwars and get your own items back.", "/leave", "galaxylink.command.bedwars"),
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
        "galaxylink.command.bedwars": _perm("Allows /bedwars and /leave.", True),
        "galaxylink.command.report": _perm("Allows /report.", True),
        "galaxylink.command.dm": _perm("Allows /dm and /r.", True),
        "galaxylink.command.ranktags": _perm("Allows /ranktags (operators).", "op"),
        "galaxylink.command.elevator": _perm("Allows /elevator (plans decide who can build).", True),
        "galaxylink.command.jobs": _perm("Allows /jobs.", True),
        "galaxylink.command.cosmetics": _perm("Allows /cosmetics.", True),
        "galaxylink.command.crates": _perm("Allows /crates (operators, or give it with a rank).", "op"),
        "galaxylink.command.givekey": _perm("Allows /givekey (operators, or give it with a rank).", "op"),
        "galaxylink.command.leaderboard": _perm("Allows /leaderboard (operators, or give it with a rank).", "op"),
        "galaxylink.command.daily": _perm("Allows /daily.", True),
        "galaxylink.command.quests": _perm("Allows /quests.", True),
        "galaxylink.command.achievements": _perm("Allows /achievements.", True),
        "galaxylink.command.stats": _perm("Allows /stats.", True),
        "galaxylink.command.mod": _perm("Allows /mod: warn, mute, kick, reports (operators, or give it with a rank).", "op"),
        "galaxylink.command.modban": _perm("Allows banning and unbanning in /mod (operators, or give it with a rank).", "op"),
        "galaxylink.command.inspect": _perm("Allows /inspect (operators, or give it with a rank).", "op"),
        "galaxylink.command.rollback": _perm("Allows /rollback (operators, or give it with a rank).", "op"),
        "galaxylink.command.announce": _perm("Allows /announce (server operators, or give it with a rank).", "op"),
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
        self.announcements = Announcements(self)
        self.moderation = Moderation(self)
        self.blocklog = BlockLog(self)
        self.progress = Progress(self)
        self.server.scheduler.run_task(self, self.progress.tick, delay=1200, period=1200)
        self.leaderboards = Leaderboards(self)
        self.floating = FloatingTexts(self)
        self.jobs = Jobs(self)
        self.shopchests = ShopChests(self)
        self.crates = Crates(self)
        self.elevators = Elevators(self)
        from endstone_galaxylink.dms import DirectMessages
        self.dms = DirectMessages(self)
        from endstone_galaxylink.cosmetics import Cosmetics, TRAIL_TICKS
        self.cosmetics = Cosmetics(self)
        self.ranktags = RankTags(self)
        from endstone_galaxylink.bedwars import Bedwars
        self.bedwars = Bedwars(self)
        from endstone_galaxylink.livemap import LiveMap
        self.livemap = LiveMap(self)
        ranks_module.PICTURES = self.ranktags
        try:
            from endstone_galaxylink.ranktags import pack_report, clean_world_packs
            clean_world_packs(self.logger)
            for line in pack_report():
                self.logger.info("Packs: " + line)
            self.logger.info(self.ranktags.status())
        except Exception as e:
            self.logger.warning(f"Couldn't check the world's packs: {e}")
        self.server.scheduler.run_task(self, self.ranks.refresh_pictures, delay=40)  # plan tags, even before ranks arrive
        self.server.scheduler.run_task(self, self.elevators.tick, delay=2, period=2)
        self.server.scheduler.run_task(self, self.elevators.check_tools, delay=1200, period=1200)
        self.server.scheduler.run_task(self, self.jobs.tick, delay=100, period=100)
        self.server.scheduler.run_task(self, self.cosmetics.tick, delay=TRAIL_TICKS, period=TRAIL_TICKS)
        self.server.scheduler.run_task(self, self.floating.update, delay=1400, period=1200)
        self.server.scheduler.run_task(self, self.leaderboards.update, delay=1300, period=1200)
        self.server.scheduler.run_task(self, self.moderation.tick, delay=600, period=600)
        self.server.scheduler.run_task(self, self.blocklog.tick, delay=20, period=20)
        self.server.scheduler.run_task(self, self.announcements.tick, delay=20, period=20)
        self.server.scheduler.run_task(self, self.minigames.tick, delay=600, period=600)
        self.server.scheduler.run_task(self, self.bedwars.tick, delay=100, period=10)
        self.server.scheduler.run_task(self, self.livemap.tick, delay=200, period=40)  # website map
        self.server.scheduler.run_task(self, self.plots.tick, delay=1, period=1)
        self.server.scheduler.run_task(self, self.plots.check_tools, delay=400, period=200)  # plot tools come back if missing
        self.server.scheduler.run_task(self, self.auction.tick, delay=600, period=600)
        self.register_events(self)
        # Minecraft's "Days played" line under the coordinates counts 20-minute game days, not real days,
        # which reads like a broken streak. Real daily streaks are in /daily and on profiles.
        self.server.scheduler.run_task(self, lambda: self.server.dispatch_command(self.server.command_sender, "gamerule showdaysplayed false"), delay=40)
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
        bw = getattr(self, "bedwars", None)
        team_name = bw.name_tag(player) if bw is not None else None
        if team_name:  # in Bedwars: the name in the team colour
            return f"§r{icon} {team_name}" if icon else team_name
        style = self.ranks.display_tag(player)  # only the tag with the best priority (e.g. OWNER over PRO+)
        tags = [tag_text(style)] if style else []
        name = f"{name_text(player.name, style)}§r"
        if icon:
            name = f"§r{icon} {name}"
        return "§r ".join(tags) + "§r\n" + name if tags else name

    def refresh_tags(self):
        if self._voice:
            self._voice._apply_icons()
        else:
            for p in self.server.online_players:
                p.name_tag = self.compose_tag(p, None)

    # ---------- operator on/off from the website (Control Panel, owner only) ----------
    # Operator status saved by an old Realm lives in the player's own data, so the server's /deop
    # can't remove it. Setting it on the player directly does. Offline players get it when they join.
    def _pending_ops_file(self):
        from pathlib import Path
        folder = Path(self.data_folder)
        folder.mkdir(parents=True, exist_ok=True)
        return folder / "pending_ops.json"

    def _pending_ops(self):
        try:
            return json.loads(self._pending_ops_file().read_text("utf-8"))
        except Exception:
            return {}

    def _save_pending_ops(self, data):
        try:
            self._pending_ops_file().write_text(json.dumps(data), "utf-8")
        except Exception as e:
            self.logger.warning(f"Couldn't save the operator change: {e}")

    def _apply_op(self, player, op):
        player.is_op = op
        safe = player.name.replace('"', "")
        try:  # keep the server's own operator list in step
            self.server.dispatch_command(self.server.command_sender, f'{"op" if op else "deop"} "{safe}"')
        except Exception:
            pass
        player.send_message("§aYou're now an operator." if op else "§eYou're no longer an operator.")

    def set_operator(self, xuid, name, op, by):
        player = next((p for p in self.server.online_players if str(p.xuid) == xuid), None)
        if player:
            self._apply_op(player, op)
            self.logger.info(f"[Website] {by} {'made' if op else 'removed'} operator {'' if op else 'from '}{player.name}")
        else:
            pending = self._pending_ops()
            pending[xuid] = op
            self._save_pending_ops(pending)
            self.logger.info(f"[Website] {by}: {name} will {'become' if op else 'stop being'} an operator when they next join")

    @event_handler
    def on_player_join(self, event: PlayerJoinEvent):
        player = event.player
        pending = self._pending_ops()
        if str(player.xuid) in pending:
            try:
                self._apply_op(player, bool(pending.pop(str(player.xuid))))
            finally:
                self._save_pending_ops(pending)
        self.ranks.apply_permissions(player)
        self.server.scheduler.run_task(self, self.ranks.refresh_pictures, delay=40)  # a new gradient name gets its pictures
        self.economy.on_join(player)
        self.plans.bill(player)
        self.plots.on_join(player)
        self.minigames.on_join(player)
        self.announcements.on_join(player)
        self.moderation.on_join(player)
        self.progress.on_join(player)
        self.shopchests.on_join(player)
        self.elevators.check_tool(player)
        self.cosmetics.on_join(player)
        self.bedwars.on_join(player)  # items from a Bedwars game they disconnected from come back
        player.send_message("§7Need help? Type §e/guide§7 for server info, rules and commands.")
        self.refresh_tags()
        if self._voice:
            self._voice.send_seen([player])
            from endstone_galaxylink.heads import send_head
            self.server.scheduler.run_task(self, lambda: send_head(self, player), delay=40)  # head for the website

    @event_handler
    def on_player_quit(self, event: PlayerQuitEvent):
        self.ranks.forget(event.player)
        self.teleports.on_quit(event.player)
        self.progress.on_quit(event.player)
        self.bedwars.on_quit(event.player)

    @event_handler
    def on_player_respawn(self, event: PlayerRespawnEvent):
        self.bedwars.on_respawn(event.player)

    @event_handler
    def on_drop_item(self, event: PlayerDropItemEvent):
        self.bedwars.on_drop(event)  # the Leave Bedwars item can't be dropped

    @event_handler
    def on_player_death(self, event: PlayerDeathEvent):
        self.teleports.on_death(event.player)
        self.progress.on_death(event.player)

    @event_handler
    def on_actor_death(self, event: ActorDeathEvent):
        """A player defeated a mob: counts for stats, quests and achievements."""
        try:
            killer = event.damage_source.actor
        except Exception:
            return
        if killer is None or not hasattr(killer, "xuid") or hasattr(event.actor, "xuid"):
            return
        player = self.server.get_player(killer.unique_id) if hasattr(killer, "unique_id") else None
        if player is not None:
            self.progress.on_kill(player, event.actor.type)
            self.jobs.on_kill(player, event.actor.type, short_id(event.actor.type) in HOSTILE)

    @event_handler
    def on_interact_actor(self, event: PlayerInteractActorEvent):
        if self.bedwars.on_interact_actor(event):  # Bedwars Item Shop
            return
        self.npcs.on_interact(event)

    @event_handler
    def on_actor_damage(self, event: ActorDamageEvent):
        if self.bedwars.on_damage(event):  # Bedwars deaths, teams and the waiting room
            return
        self.npcs.on_damage(event)
        self.plots.on_damage(event)

    # ---------- plot protection ----------
    @event_handler
    def on_block_break(self, event: BlockBreakEvent):
        if self.blocklog.on_break(event):  # block inspector
            return
        if self.bedwars.on_break(event):  # beds and the arena
            return
        if self.crates.on_break(event):  # crates can't be broken
            return
        self.shopchests.on_break(event)
        if event.cancelled:
            return
        self.plots.on_break(event)
        self.blocklog.log_break(event)
        if not event.cancelled:
            self.progress.on_break(event.player, event.block.type, states_of(event.block))
            self.jobs.on_break(event.player, event.block)

    @event_handler
    def on_block_place(self, event: BlockPlaceEvent):
        if self.blocklog.on_place(event):
            return
        if self.bedwars.on_place(event):  # the arena keeps track of placed blocks
            return
        self.plots.on_place(event)
        self.blocklog.log_place(event)
        if not event.cancelled:
            self.progress.on_place(event.player)
            self.jobs.on_place(event.player, event.block)

    @event_handler
    def on_interact(self, event: PlayerInteractEvent):
        if self.blocklog.on_interact(event):  # block inspector
            return
        if event.has_item and self.bedwars.on_use(event):  # the Leave Bedwars item
            return
        if self.crates.on_interact(event) or self.shopchests.on_interact(event):  # crates and shop chests
            return
        if self.elevators.on_interact(event):  # call buttons and the floor panel
            return
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
        if self.moderation.on_chat(event):  # muted players can't chat
            return
        self.chatfilter.on_chat(event)  # scrambles bad words with §k (when it's on)
        pics = getattr(self, "ranktags", None)
        if False and pics is not None and pics.enabled and pics.chat_pictures:  # gradients are only above heads now
            # Discord style: "[👑 OWNER] Name" line (pictures) once, then each message on its own line in the
            # normal Minecraft font. More messages from the same person within 2 minutes skip the name line.
            p = event.player
            now = time.time()
            last = getattr(self, "_last_chat", None)
            if not last or last[0] != str(p.xuid) or now - last[1] > 120:
                header = self.ranks.chat_header(p)
                for r in event.recipients:
                    try:
                        r.send_message(header)
                    except Exception:
                        pass
            self._last_chat = (str(p.xuid), now)
            event.format = "§f{1}"
            self.logger.info(f"<{p.name}> {event.message}")
        else:
            event.format = self.ranks.chat_format(event.player)

    @event_handler
    def on_actor_spawn(self, event: ActorSpawnEvent):
        floating = getattr(self, "floating", None)
        if floating is not None and floating.expecting is not None:
            floating.on_spawn(event)  # the floating label we're summoning right now

    @event_handler
    def on_player_command(self, event: PlayerCommandEvent):
        if self.bedwars.on_command(event):  # only a few commands work during Bedwars
            return
        self.moderation.on_command(event)  # muted players can't /msg or /me

    def on_disable(self) -> None:
        if getattr(self, "blocklog", None):
            self.blocklog.flush()
        if getattr(self, "progress", None):
            self.progress.save()
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
                       "tpdeny", "spawn", "setspawn", "home", "sethome", "delhome", "homes", "back", "plan", "plot", "plotaxe", "minigames", "tpd",
                       "report", "mod", "inspect", "rollback", "daily", "quests", "achievements", "stats", "leaderboard", "jobs", "crates", "elevator"}
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
            "bedwars": lambda: self.bedwars.command(sender, args),
            "leave": lambda: self.bedwars.leave(sender),
            "chatfilter": lambda: self.chatfilter.command(sender, args),
            "announcement": lambda: self.announcements.command(sender, args),
            "report": lambda: self.moderation.report_command(sender, args),
            "dm": lambda: self.dms.command(sender, args),
            "r": lambda: self.dms.reply(sender, args),
            "daily": lambda: self.progress.daily_menu(sender),
            "quests": lambda: self.progress.quests_menu(sender),
            "achievements": lambda: self.progress.achievements_menu(sender),
            "stats": lambda: self.progress.stats_command(sender, args),
            "leaderboard": lambda: self.leaderboards.menu(sender),
            "jobs": lambda: self.jobs.menu(sender),
            "cosmetics": lambda: self.cosmetics.menu(sender),
            "elevator": lambda: self.elevators.command(sender),
            "ranktags": lambda: self.ranktags.command(sender, args),
            "crates": lambda: self.crates.admin_menu(sender),
            "givekey": lambda: self.crates.givekey_command(sender, args),
            "mod": lambda: self.moderation.panel(sender),
            "modban": lambda: self.moderation.ban_command(sender, args),
            "inspect": lambda: self.blocklog.toggle(sender),
            "rollback": lambda: self.blocklog.rollback_command(sender, args),
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
