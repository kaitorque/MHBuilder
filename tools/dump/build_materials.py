"""Build data/materials.json: armor / charm / weapon crafting recipes and where each material comes from.

Armor and charm recipes, item names, descriptions and rarity come from the live game dump (MHWMasterDataUtils).
Weapon trees and recipes come from MHWorldData (see build_weapons); zenny costs from the game dump.
Sources (monster rewards, gathering, quest rewards, combinations) and item icons come from the
Gathering Hall Studios MHWorldData SQLite (tools/dump/mhw_ghs.db), matched by English item name
because the two use different item ids. Item icons are copied from the MHOTOMO assets.
"""
from __future__ import annotations

import json
import shutil
import sqlite3
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DUMP = ROOT / "tools/dump/MHWMasterDataUtils/MHWMasterDataUtils.Exporter/data"
GHS = ROOT / "tools/dump/mhw_ghs.db"
ICON_SRC = ROOT / "tools/dump/mhotomo/apk_extract/assets/flutter_assets/assets/3.0x"
ICON_DST = ROOT / "src/MHBuilder/wwwroot/icons/mh"
OUT = ROOT / "data/materials.json"

# MHWorldData icon_name -> MHOTOMO item_<file>.png
ICONS = {
    "Fang": "tooth", "Scale": "scale", "Body": "fur", "Carapace": "shell", "Hide": "skin",
    "Tail": "tail", "Bone": "dragonbone", "Wing": "wing", "Ore": "rock", "Voucher": "ticket",
    "Vocuher": "ticket", "Sac": "bag", "Gem": "gem", "Mantle": "raregem", "Coin": "coin",
    "Jaw": "headbone", "Liquid": "potion", "Bug": "bug", "Webbing": "web", "Plate": "plate",
    "Question": "questionmark", "Dung": "dung", "Book": "book", "Streamstone": "streamstone",
    "Feystone": "feystone", "Herb": "herb", "Seed": "seed", "Mushroom": "mushroom", "Meat": "meat",
    "Egg": "egg", "Smoke": "smoke", "Bottle": "bottle", "EmptyBottle": "bottle", "Trap": "trap",
    "TrapTool": "traptool", "BarrelBomb": "bomb", "Sphere": "armorsphere", "Slinger": "slinger",
    "Knife": "dagger", "Boomerang": "boomerang", "Binoculars": "binoculars", "Decoration": "jewel",
    "Ammo": "bowgun_ammo", "Pellets": "bowgun_ammo", "Husk": "shell", "Web": "web", "Bait": "meat",
    "Barrel": "bomb", "Charm": "questionmark", "CharmOre": "rock",
}
RANK_ORDER = {"MR": 0, "HR": 1, "LR": 2, None: 3}
SLOT_FILES = ["heads", "chests", "arms", "waists", "legs"]
# Same order as convert_game_dump.py: MHBuilder weapon id = index * 100_000 + game id.
WEAPON_FILES = [
    "great-swords", "long-swords", "sword-and-shields", "dual-blades", "hammers", "hunting-horns",
    "lances", "gunlances", "switch-axes", "charge-blades", "insect-glaives", "bows",
    "light-bowguns", "heavy-bowguns",
]
MAX_QUESTS = 8


def load(name: str):
    return json.loads((DUMP / name).read_text(encoding="utf-8"))


def eng(obj) -> str:
    return (obj.get("eng") or "") if isinstance(obj, dict) else str(obj or "")


def clean(text: str) -> str:
    # Game text wraps lines with a space where the Japanese layout had a break.
    return " ".join(text.replace("\r", " ").replace("\n", " ").split())


def recipe(entry) -> dict | None:
    items = [[int(c["id"]), int(c["quantity"])] for c in entry.get("craft") or [] if int(c["quantity"]) > 0]
    if not items:
        return None
    return {"zenny": int(entry.get("cost") or 0), "items": items}


def build_weapons(q, ghs_name, game_id_by_name):
    """MHBuilder weapon id -> {zenny, forgeItems?, items?, parent?, source?}.

    The game dump has no reliable weapon tree (bows all have parentId -1) and misses some late
    upgrade recipes, so the tree and recipes come from MHWorldData, matched by name + weapon type.
    forgeItems = crafted from scratch; items = upgrade from parent. Zenny is the game's crafting cost.
    """
    ours = json.loads((ROOT / "data/weapons.json").read_text(encoding="utf-8"))
    cost = {}
    for index, f in enumerate(WEAPON_FILES):
        for w in load(f"{f}.json"):
            cost[index * 100_000 + int(w["id"])] = int(w.get("craftingCost") or 0)

    recipes = defaultdict(list)
    for rid, iid, qty in q("select recipe_id, item_id, quantity from recipe_item"):
        game_id = game_id_by_name.get(ghs_name.get(iid))
        if game_id is None:
            raise SystemExit(f"recipe item not in the game dump: {ghs_name.get(iid, iid)}")
        if qty > 0:
            recipes[rid].append([game_id, qty])

    ghs = {}
    for wid, name, wtype, prev, craftable, create, upgrade, category in q(
            "select w.id, t.name, w.weapon_type, w.previous_weapon_id, w.craftable, w.create_recipe_id, "
            "w.upgrade_recipe_id, w.category from weapon w join weapon_text t on t.id=w.id and t.lang_id='en'"):
        ghs[(name, wtype)] = (wid, prev, craftable, create, upgrade, category)
    ghs_to_ours = {}
    for w in ours:
        g = ghs.get((w["name"], w["type"]))
        if g:
            ghs_to_ours.setdefault(g[0], w["id"])

    weapons, unmatched = {}, []
    for w in ours:
        g = ghs.get((w["name"], w["type"]))
        if not g:
            unmatched.append(w["name"])
            continue
        _, prev, craftable, create, upgrade, category = g
        entry = {"zenny": cost.get(w["id"], 0)}
        if craftable and recipes.get(create):
            entry["forgeItems"] = recipes[create]
        if prev in ghs_to_ours and recipes.get(upgrade):
            entry["parent"] = ghs_to_ours[prev]
            entry["items"] = recipes[upgrade]
        if category in ("Kulve", "Safi"):
            entry["source"] = category
        weapons[str(w["id"])] = entry
    return weapons, unmatched


def main() -> None:
    game_items = {int(it["id"]): it for it in load("items.json")}

    armor = {}
    for f in SLOT_FILES:
        for a in load(f"{f}.json"):
            r = recipe(a)
            if r:
                armor[str(int(a["id"]))] = r
    charms = {}
    for c in load("charms.json"):
        r = recipe(c)
        if r:
            charms[eng(c["name"])] = r

    db = sqlite3.connect(GHS)
    q = lambda sql, *a: db.execute(sql, a).fetchall()
    ghs_by_name = {name: iid for iid, name in q("select id, name from item_text where lang_id='en'")}
    ghs_name = {iid: name for name, iid in ghs_by_name.items()}
    game_id_by_name = {eng(it["name"]): iid for iid, it in game_items.items()}

    weapons, unmatched_weapons = build_weapons(q, ghs_name, game_id_by_name)

    needed = sorted({i for r in [*armor.values(), *charms.values()] for i, _ in r["items"]}
                    | {i for w in weapons.values() for key in ("forgeItems", "items") for i, _ in w.get(key, [])})

    ghs_icon = {iid: (icon, color) for iid, icon, color in q("select id, icon_name, icon_color from item")}
    monster = dict(q("select id, name from monster_text where lang_id='en'"))
    condition = dict(q("select id, name from monster_reward_condition_text where lang_id='en'"))
    location = dict(q("select id, name from location_text where lang_id='en'"))
    quest = {qid: (name, rank, stars, cat) for qid, name, rank, stars, cat in q(
        "select q.id, t.name, q.rank, q.stars, q.category from quest q join quest_text t on t.id=q.id and t.lang_id='en'")}

    rewards = defaultdict(list)
    for mid, cid, rank, iid, stack, pct in q(
            "select monster_id, condition_id, rank, item_id, stack, percentage from monster_reward"):
        rewards[iid].append((mid, rank, condition.get(cid, "?"), pct, stack))
    gathering = defaultdict(list)
    for lid, area, rank, iid, stack, pct, nodes in q(
            "select location_id, area, rank, item_id, stack, percentage, nodes from location_item"):
        gathering[iid].append((lid, area, rank, pct, stack, nodes))
    quest_rewards = defaultdict(list)
    for qid, iid, stack, pct in q("select quest_id, item_id, stack, percentage from quest_reward"):
        quest_rewards[iid].append((qid, stack, pct))
    combos = defaultdict(list)
    for rid, a, b, qty in q("select result_id, first_id, second_id, quantity from item_combination"):
        combos[rid].append((a, b, qty))

    def item_ref(ghs_id):
        name = ghs_name.get(ghs_id, "?")
        return {"id": game_id_by_name.get(name), "name": name}

    items = {}
    unmatched = []
    icons_used = set()
    for gid in needed:
        it = game_items[gid]
        name = eng(it["name"])
        ghs_id = ghs_by_name.get(name)
        if ghs_id is None:
            unmatched.append(name)
        icon_name, color = ghs_icon.get(ghs_id, ("Question", "White"))
        icon = ICONS.get(icon_name, "questionmark")
        icons_used.add(icon)

        by_monster = defaultdict(list)
        for mid, rank, cond, pct, stack in rewards.get(ghs_id, []):
            by_monster[(mid, rank)].append([cond, pct, stack])
        monsters = [
            {"monster": monster.get(mid, "?"), "rank": rank,
             "drops": sorted(drops, key=lambda d: -d[1])}
            for (mid, rank), drops in by_monster.items()
        ]
        monsters.sort(key=lambda m: (RANK_ORDER.get(m["rank"], 3), -max(d[1] for d in m["drops"]), m["monster"]))

        gather = [
            {"location": location.get(lid, "?"), "area": area, "rank": rank, "chance": pct, "stack": stack, "nodes": nodes}
            for lid, area, rank, pct, stack, nodes in gathering.get(ghs_id, [])
        ]
        gather.sort(key=lambda g: (RANK_ORDER.get(g["rank"], 3), g["location"], -g["chance"], g["area"] or 0))

        quests = [
            {"quest": quest[qid][0], "rank": quest[qid][1], "stars": quest[qid][2], "category": quest[qid][3],
             "chance": pct, "stack": stack}
            for qid, stack, pct in quest_rewards.get(ghs_id, []) if qid in quest
        ]
        quests.sort(key=lambda x: (-x["chance"], RANK_ORDER.get(x["rank"], 3), x["quest"]))

        combine = [
            {"from": [item_ref(a), item_ref(b)], "quantity": qty}
            for a, b, qty in combos.get(ghs_id, [])
        ]

        entry = {
            "name": name,
            "description": clean(eng(it.get("description"))),
            "rarity": int(it.get("rarity") or 1),
            "icon": icon,
            "color": color or "White",
        }
        sources = {}
        if monsters:
            sources["monsters"] = monsters
        if gather:
            sources["gathering"] = gather
        if quests:
            sources["quests"] = quests[:MAX_QUESTS]
            if len(quests) > MAX_QUESTS:
                sources["moreQuests"] = len(quests) - MAX_QUESTS
        if combine:
            sources["combine"] = combine
        if sources:
            entry["sources"] = sources
        items[str(gid)] = entry

    OUT.write_text(json.dumps({"armor": armor, "charms": charms, "weapons": weapons, "items": items},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    ICON_DST.mkdir(parents=True, exist_ok=True)
    for icon in sorted(icons_used):
        shutil.copyfile(ICON_SRC / f"item_{icon}.png", ICON_DST / f"item_{icon}.png")

    no_source = sorted(v["name"] for v in items.values() if "sources" not in v)
    print(f"armor recipes {len(armor)}, charm recipes {len(charms)}, materials {len(items)}")
    print(f"weapons {len(weapons)} ({sum('forgeItems' in w for w in weapons.values())} forgeable, "
          f"{sum('items' in w for w in weapons.values())} upgradable, "
          f"{sum('source' in w for w in weapons.values())} siege rewards); "
          f"not in MHWorldData: {len(unmatched_weapons)} {unmatched_weapons[:12]}")
    print(f"unmatched in MHWorldData: {len(unmatched)} {unmatched[:20]}")
    print(f"materials without a known source (description only): {len(no_source)}")
    print("  " + ", ".join(no_source[:60]))
    print(f"icons copied: {len(icons_used)} {sorted(icons_used)}")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
