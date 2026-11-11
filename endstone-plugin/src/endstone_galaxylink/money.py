"""Money helpers and item helpers shared by the economy, shop and auction house.

Money is stored as whole cents so prices like $0.25 add up exactly.
"""

import re

INFINITE = "∞"


def fmt(cents, op=False):
    """$12.50 for small amounts, $1.5K / $12.5K / $3.25M / $1B / $2T for big ones (like DonutSMP)."""
    if op:
        return INFINITE
    sign = "-" if cents < 0 else ""
    dollars = abs(cents) / 100
    if dollars < 999.995:
        return f"{sign}${dollars:,.0f}" if dollars == int(dollars) else f"{sign}${dollars:,.2f}"
    units = ((1e3, "K"), (1e6, "M"), (1e9, "B"), (1e12, "T"), (1e15, "Q"))
    for i in range(len(units) - 1, -1, -1):
        size, letter = units[i]
        if dollars >= size * 0.999995:
            text = f"{dollars / size:.2f}".rstrip("0").rstrip(".")
            if text == "1000" and i + 1 < len(units):  # 999.999K -> 1M
                text, letter = "1", units[i + 1][1]
            return f"{sign}${text}{letter}"
    return f"{sign}${dollars:,.0f}"


def exact(cents):
    """Same short style everywhere (the owner asked for K, M, B, T on all money)."""
    return fmt(cents)


_AMOUNT = re.compile(r"^\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?|\.[0-9]+)\s*([kmbt]?)$", re.I)
_MULT = {"": 1, "k": 1e3, "m": 1e6, "b": 1e9, "t": 1e12}
MAX_CENTS = 10 ** 17  # $1 quadrillion: far beyond anything players will reach


def parse(text):
    """'1000', '$1,000', '2.5k', '3m' -> cents. Returns None if it isn't a positive amount."""
    m = _AMOUNT.match(str(text or "").strip())
    if not m:
        return None
    value = float(m.group(1).replace(",", "")) * _MULT[m.group(2).lower()]
    cents = int(round(value * 100))
    if cents <= 0 or cents > MAX_CENTS:
        return None
    return cents


def to_cents(dollars):
    return None if dollars is None else int(round(float(dollars) * 100))


# ---------- items ----------
def pretty_id(item_id):
    """minecraft:diamond_sword -> Diamond Sword"""
    return str(item_id).split(":")[-1].replace("_", " ").title()


def item_id(stack):
    try:
        return stack.type.id
    except Exception:
        return str(stack.type)


def is_special(stack):
    """Named or enchanted items are never sold by /sell (so nobody loses their best gear)."""
    try:
        meta = stack.item_meta
        return bool(meta.has_display_name or meta.has_enchants)
    except Exception:
        return False


def item_label(stack):
    try:
        meta = stack.item_meta
        if meta.has_display_name:
            return meta.display_name
    except Exception:
        pass
    return pretty_id(item_id(stack))


def enchant_lines(stack):
    try:
        meta = stack.item_meta
        if not meta.has_enchants:
            return []
        out = []
        for ench, level in meta.enchants.items():
            key = getattr(ench, "id", None) or str(ench)
            out.append(f"{pretty_id(key)} {level}")
        return out
    except Exception:
        return []


# ---------- NBT <-> JSON (keeps enchantments, names, damage on auction items) ----------
def nbt_to_json(tag):
    from endstone import nbt as N
    if isinstance(tag, N.CompoundTag):
        return {"t": "c", "v": {k: nbt_to_json(v) for k, v in tag.items()}}
    if isinstance(tag, N.ListTag):
        return {"t": "l", "v": [nbt_to_json(v) for v in tag]}
    if isinstance(tag, N.StringTag):
        return {"t": "s", "v": tag.value}
    if isinstance(tag, N.ByteArrayTag):
        return {"t": "ba", "v": list(bytes(tag))}
    if isinstance(tag, N.IntArrayTag):
        return {"t": "ia", "v": list(tag)}
    for code, cls in (("b", N.ByteTag), ("sh", N.ShortTag), ("i", N.IntTag), ("lg", N.LongTag),
                      ("f", N.FloatTag), ("d", N.DoubleTag)):
        if isinstance(tag, cls):
            return {"t": code, "v": tag.value}
    raise ValueError(f"unknown tag {type(tag).__name__}")


def json_to_nbt(data):
    from endstone import nbt as N
    t, v = data["t"], data["v"]
    if t == "c":
        return N.CompoundTag({k: json_to_nbt(x) for k, x in v.items()})
    if t == "l":
        return N.ListTag([json_to_nbt(x) for x in v])
    if t == "s":
        return N.StringTag(v)
    if t == "ba":
        return N.ByteArrayTag(bytes(v))
    if t == "ia":
        return N.IntArrayTag(v)
    return {"b": N.ByteTag, "sh": N.ShortTag, "i": N.IntTag, "lg": N.LongTag, "f": N.FloatTag, "d": N.DoubleTag}[t](v)


def snapshot(stack):
    """Everything needed to give an identical item back later."""
    snap = {"id": item_id(stack), "amount": stack.amount, "data": getattr(stack, "data", 0)}
    try:
        snap["nbt"] = nbt_to_json(stack.nbt)
    except Exception:
        pass
    try:
        meta = stack.item_meta
        snap["meta"] = {
            "name": meta.display_name if meta.has_display_name else None,
            "lore": list(meta.lore) if meta.has_lore else None,
            "damage": meta.damage if meta.has_damage else None,
            "enchants": {getattr(e, "id", str(e)): lvl for e, lvl in meta.enchants.items()} if meta.has_enchants else {},
        }
    except Exception:
        pass
    return snap


def rebuild(snap):
    from endstone.inventory import ItemStack
    stack = ItemStack(snap["id"], int(snap.get("amount", 1)), int(snap.get("data", 0) or 0))
    if snap.get("nbt"):
        try:
            stack.nbt = json_to_nbt(snap["nbt"])
            if item_id(stack) == snap["id"] and stack.amount == int(snap.get("amount", 1)):
                return stack
            stack = ItemStack(snap["id"], int(snap.get("amount", 1)), int(snap.get("data", 0) or 0))
        except Exception:
            stack = ItemStack(snap["id"], int(snap.get("amount", 1)), int(snap.get("data", 0) or 0))
    meta_info = snap.get("meta")
    if meta_info:
        try:
            meta = stack.item_meta
            if meta_info.get("name"):
                meta.display_name = meta_info["name"]
            if meta_info.get("lore"):
                meta.lore = meta_info["lore"]
            if meta_info.get("damage"):
                meta.damage = int(meta_info["damage"])
            for key, lvl in (meta_info.get("enchants") or {}).items():
                meta.add_enchant(key, int(lvl), True)
            stack.set_item_meta(meta)
        except Exception:
            pass
    return stack


def give(player, stack_or_list):
    """Adds items to a player's inventory and drops anything that doesn't fit at their feet."""
    stacks = stack_or_list if isinstance(stack_or_list, list) else [stack_or_list]
    dropped = 0
    for stack in stacks:
        try:
            left = player.inventory.add_item(stack) or {}
        except Exception:
            left = {0: stack}
        for extra in left.values():
            try:
                player.dimension.drop_item(player.location, extra)
                dropped += extra.amount
            except Exception:
                pass
    return dropped


def make_stacks(item, count):
    """count items of one type, split into full stacks."""
    from endstone.inventory import ItemStack
    first = ItemStack(item, 1)
    size = max(1, first.max_stack_size)
    out = []
    while count > 0:
        n = min(size, count)
        out.append(ItemStack(item, n))
        count -= n
    return out
