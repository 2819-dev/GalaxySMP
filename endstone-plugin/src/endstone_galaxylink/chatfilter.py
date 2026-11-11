"""In-game chat filter: bad words are scrambled with §k (Minecraft's "obfuscated" text).

Uses the same word list as the website (Staff Tools > Word filter), sent here over the live
connection, and the same tricks as the website filter: l33t spellings (c@ts), stretched
letters (caaats) and spaced-out letters (c A t, c.a.t.s).
The scrambled part is made of random letters (never the real word), so the word itself never
reaches anyone's chat.
Staff turn it on or off for the whole server with /chatfilter or on the website.
"""

import random
import re
import unicodedata

LEET = {"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "i", "€": "e"}
LINK_RE = re.compile(r"(?:https?://|www\.)\S+|\b[a-z0-9-]{2,}\.(?:com|net|org|gg|io|co|me|tv|xyz|us|live|dev|app|link)\b\S*", re.I)
TOKEN = re.compile(r"[A-Za-z0-9@$!|€]+")


def normalize(text):
    t = unicodedata.normalize("NFKD", str(text))
    t = "".join(ch for ch in t if not unicodedata.combining(ch) and ch not in "​‌‍‎‏⁠﻿")
    return "".join(LEET.get(ch, ch) for ch in t.lower())


def letter_pattern(word):
    return "".join(f"{re.escape(c)}+" for c in normalize(word) if c.isalnum())


def compile_words(rows):
    word_res, contains_res = [], []
    for row in rows or []:
        p = letter_pattern(row.get("word", ""))
        if not p:
            continue
        if row.get("match") == "contains":
            contains_res.append(re.compile(p))
        else:
            word_res.append(re.compile(f"^{p}(?:s|es|ed|ing|er|ers)?$"))
    return word_res, contains_res


def scramble(n):
    return "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(n))


class ChatFilter:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        saved = self.eco.get_config("chatfilter") or {}
        self.enabled = saved.get("enabled", True)
        self.rows = saved.get("words") or []
        self.word_res, self.contains_res = compile_words(self.rows)

    def save(self):
        self.eco.set_config("chatfilter", {"enabled": self.enabled, "words": self.rows})

    # ---------- from the website ----------
    def update_words(self, rows):
        if isinstance(rows, list):
            self.rows = [{"word": str(r.get("word", "")), "match": r.get("match", "word")} for r in rows if isinstance(r, dict)]
            self.word_res, self.contains_res = compile_words(self.rows)
            self.save()

    def set_enabled(self, on, by=None):
        self.enabled = bool(on)
        self.save()
        self.report()
        if by:
            for p in self.plugin.server.online_players:
                if p.is_op:
                    p.send_message(f"§7Chat filter turned {'§aon' if self.enabled else '§coff'}§7 by {by}.")

    def report(self):
        voice = getattr(self.plugin, "_voice", None)
        if voice and voice.ws:
            voice.send_json({"type": "chatfilter_state", "enabled": self.enabled})

    # ---------- filtering ----------
    def _bad(self, letters):
        return bool(letters) and (any(r.match(letters) for r in self.word_res) or any(r.search(letters) for r in self.contains_res))

    def bad_spans(self, text):
        """(start, end) character ranges in text that contain bad words."""
        tokens = []
        for m in TOKEN.finditer(text):
            word = m.group()
            # "!" and "|" only count as a letter (sh!t) inside a word, not as punctuation at its ends (shit!!)
            core = word.strip("!|")
            if not core:
                continue
            start = m.start() + (len(word) - len(word.lstrip("!|")))
            tokens.append((start, start + len(core), re.sub(r"[^a-z]", "", normalize(core))))
        spans = [(s, e) for s, e, letters in tokens if self._bad(letters)]
        # Spaced-out letters: "s h i t", "s.h.i.t" -> runs of one-letter tokens.
        run = []
        for tok in tokens + [(None, None, "")]:
            if len(tok[2]) == 1:
                run.append(tok)
                continue
            if len(run) > 1:
                for i in range(len(run)):
                    for j in range(i + 1, len(run)):
                        if self._bad("".join(t[2] for t in run[i:j + 1])):
                            spans.append((run[i][0], run[j][1]))
            run = []
        # Words hidden across spaces ("contains" words only): check the whole message's letters.
        if self.contains_res and not spans:
            letters_only = re.sub(r"[^a-z]", "", normalize(text))
            if any(r.search(letters_only) for r in self.contains_res):
                spans = [(s, e) for s, e, letters in tokens if letters]  # can't tell which part; scramble the words
        merged = []
        for s, e in sorted(spans):
            if merged and s <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(e, merged[-1][1]))
            else:
                merged.append((s, e))
        return merged

    def clean(self, text, keep_links=False):
        spans = self.bad_spans(text)
        if keep_links and spans:  # never scramble part of a link (operators and staff can share links)
            links = [(m.start(), m.end()) for m in LINK_RE.finditer(text)]
            spans = [(s, e) for s, e in spans if not any(ls <= s < le or ls < e <= le for ls, le in links)]
        if not spans:
            return text
        out, last = [], 0
        for s, e in spans:
            out.append(text[last:s])
            out.append(f"§k{scramble(e - s)}§r")
            last = e
        out.append(text[last:])
        return "".join(out)

    def on_chat(self, event):
        if self.enabled and (self.word_res or self.contains_res):
            p = event.player
            mod = getattr(self.plugin, "moderation", None)
            trusted = p.is_op or bool(mod and mod.is_staff(p))
            new = self.clean(event.message, keep_links=trusted)
            if new != event.message:
                event.message = new

    # ---------- /chatfilter ----------
    def command(self, sender, args):
        what = " ".join(args).strip().lower()
        if what in ("on", "enable", "true"):
            self.set_enabled(True, getattr(sender, "name", "the console"))
        elif what in ("off", "disable", "false"):
            self.set_enabled(False, getattr(sender, "name", "the console"))
        elif what in ("", "toggle"):
            self.set_enabled(not self.enabled, getattr(sender, "name", "the console"))
        sender.send_message(f"§7The chat filter is {'§aon' if self.enabled else '§coff'}§7. "
                            f"({len(self.rows)} words, same list as galaxymc.us Staff Tools > Word filter.) "
                            "Use /chatfilter on or /chatfilter off.")
