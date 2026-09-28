"""Convert MHWMasterDataUtils game-dump JSON into MHBuilder catalog format (data/*.json)."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DUMP = ROOT / "tools/dump/MHWMasterDataUtils/MHWMasterDataUtils.Exporter/data"
OUT = ROOT / "data"


def eng(obj):
    if isinstance(obj, dict):
        return obj.get("eng") or obj.get("jpn") or ""
    return str(obj)


def norm_name(s: str) -> str:
    return s.replace("Α", "α").replace("Β", "β").replace("Γ", "γ")


# Defense gained by fully upgrading armor of each rarity; the game export only has base defense. Matches
# MHWorldData defense_max - defense_base for every piece both have.
UPGRADE_DEFENSE = {1: 36, 2: 32, 3: 28, 4: 24, 5: 22, 6: 20, 7: 12, 8: 6, 9: 38, 10: 32, 11: 24, 12: 18}


def rarity_to_rank(r: int) -> str:
    if r <= 4:
        return "low"
    if r <= 8:
        return "high"
    return "master"


def clean_text(text: str) -> str:
    # Game text wraps lines with a space where the Japanese layout had a break.
    return " ".join(text.replace("\r", " ").replace("\n", " ").split())


def load(name: str):
    return json.loads((DUMP / name).read_text(encoding="utf-8"))


def main() -> None:
    series = {s["id"]: eng(s["name"]) for s in load("armor-series.json")}
    raw_skills = load("skills.json")

    # Soft-cap unlockers: "Raises the maximum level of the X skill." (+ Fatalis Inheritance).
    raise_cap_re = re.compile(r"^Raises the maximum level of the (.+) skill\.?\s*$", re.I)
    name_to_id = {
        eng(s["name"]): int(s["id"])
        for s in raw_skills
        if not s.get("isSetBonus")
    }
    unlockers_by_skill: dict[str, set[int]] = defaultdict(set)
    inheritance_ability_ids: set[int] = set()
    for s in raw_skills:
        if not s.get("isSetBonus"):
            continue
        for a in s.get("abilities") or []:
            aid = int(a["id"])
            desc = eng(a.get("description")).strip()
            aname = eng(a.get("name")).strip()
            m = raise_cap_re.match(desc)
            if m:
                unlockers_by_skill[m.group(1)].add(aid)
            if aname == "Inheritance" or "Removes the skill level cap" in desc:
                inheritance_ability_ids.add(aid)

    skills_out = []
    for s in raw_skills:
        abilities = s.get("abilities") or []
        is_set = bool(s.get("isSetBonus"))
        ranks = []
        for a in abilities:
            if is_set or "requiredParts" in a:
                # Set-bonus threshold. grantsSkill unlocks a normal skill (usually secret skills).
                entry = {
                    "requiredParts": int(a.get("requiredParts") or a.get("level") or 0),
                }
                aname = eng(a.get("name")).strip()
                desc = eng(a.get("description")).strip()
                if aname:
                    entry["effectName"] = aname
                if desc:
                    entry["description"] = clean_text(desc)
                if a.get("skillId"):
                    entry["grantsSkill"] = int(a["skillId"])
                    entry["grantsLevel"] = int(a.get("level") or 1)
                else:
                    m = raise_cap_re.match(desc)
                    if m and m.group(1) in name_to_id:
                        entry["raisesCapFor"] = name_to_id[m.group(1)]
                    elif aname == "Inheritance" or "Removes the skill level cap" in desc:
                        entry["raisesAllCaps"] = True
                # Keep level alias = requiredParts for older readers
                entry["level"] = entry["requiredParts"]
                if entry["requiredParts"] > 0:
                    ranks.append(entry)
            elif "level" in a:
                rank = {"level": int(a["level"])}
                desc = clean_text(eng(a.get("description")))
                if desc:
                    rank["description"] = desc
                ranks.append(rank)
        if is_set:
            max_level = max((r["requiredParts"] for r in ranks), default=1)
            skills_out.append(
                {
                    "id": s["id"],
                    "name": eng(s["name"]),
                    "isSetBonus": is_set,
                    "ranks": sorted(
                        ranks,
                        key=lambda x: x.get("requiredParts", x.get("level", 0)),
                    ),
                    "maxLevel": max_level,
                    "baseMaxLevel": max_level,
                }
            )
            continue

        skill_name = eng(s["name"])
        unlockers = set(unlockers_by_skill.get(skill_name, ())) | inheritance_ability_ids
        hard = 0
        free = 0
        for a in abilities:
            if "level" not in a:
                continue
            lv = int(a["level"])
            hard = max(hard, lv)
            params = a.get("params") or []
            gated = any(isinstance(p, int) and p in unlockers for p in params)
            if not gated:
                free = max(free, lv)
        if hard <= 0:
            hard = free
        if free <= 0:
            free = hard
        skills_out.append(
            {
                "id": s["id"],
                "name": skill_name,
                "description": clean_text(eng(s.get("description"))),
                "isSetBonus": False,
                "ranks": sorted(ranks, key=lambda x: x.get("level", 0)),
                "maxLevel": hard,
                "baseMaxLevel": free,
            }
        )
    skills_out.sort(key=lambda x: x["id"])

    slot_files = [
        ("head", "heads.json"),
        ("chest", "chests.json"),
        ("gloves", "arms.json"),
        ("waist", "waists.json"),
        ("legs", "legs.json"),
    ]
    armor_out = []
    for type_name, fname in slot_files:
        for p in load(fname):
            name = norm_name(eng(p["name"]))
            if not name or name.startswith("INVALID"):
                continue
            rarity = int(p.get("rarity") or 0)
            slots = sorted(
                (int(x) for x in (p.get("slots") or []) if int(x) > 0),
                reverse=True,
            )
            piece_skills = [
                {"skill": int(sk["skillId"]), "level": int(sk["level"])}
                for sk in (p.get("skills") or [])
            ]
            set_skills = [int(x) for x in (p.get("setSkills") or [])]
            series_id = p.get("seriesId")
            gender_code = p.get("gender")
            gender = None
            if gender_code == 1:
                gender = "male"
            elif gender_code == 2:
                gender = "female"
            base_defense = int(p.get("defense") or 0)
            max_defense = base_defense + UPGRADE_DEFENSE.get(rarity, 0) if base_defense > 0 else 0
            entry = {
                "id": int(p["id"]),
                "name": name,
                "type": type_name,
                "rank": rarity_to_rank(rarity),
                "rarity": rarity,
                "defense": {
                    "base": base_defense,
                    "max": max_defense,
                    "augmented": max_defense,
                },
                "resistances": p.get("elementalResistances") or {},
                "slots": [{"rank": s} for s in slots],
                "skills": piece_skills,
                "setSkills": set_skills,
                "armorSet": {
                    "id": series_id,
                    "name": series.get(series_id),
                    "rank": rarity_to_rank(rarity),
                }
                if series_id is not None
                else None,
            }
            if gender:
                entry["gender"] = gender
            armor_out.append(entry)
    armor_out.sort(key=lambda x: x["id"])

    def charm_family_key(name: str) -> str:
        # "Attack Charm V" / "Attack Charm 5" / "Attack Charm II" -> "Attack Charm"
        n = re.sub(r"\s+[IVXLC]+\s*$", "", name, flags=re.IGNORECASE)
        n = re.sub(r"\s+\d+\s*$", "", n)
        return n.strip()

    charm_ranks = load("charms.json")
    by_family: dict = defaultdict(list)
    for c in charm_ranks:
        name = eng(c["name"])
        if not name or name.startswith("INVALID"):
            continue
        by_family[charm_family_key(name)].append(c)

    charms_out = []
    for family_name, ranks in sorted(by_family.items(), key=lambda x: x[0]):
        ranks_sorted = sorted(
            ranks, key=lambda x: (x.get("rarity", 0), x.get("order", 0), x["id"])
        )
        out_ranks = []
        for i, r in enumerate(ranks_sorted, start=1):
            out_ranks.append(
                {
                    "level": i,
                    "rarity": int(r.get("rarity") or 0),
                    "name": eng(r["name"]),
                    "skills": [
                        {"skill": int(sk["skillId"]), "level": int(sk["level"])}
                        for sk in (r.get("skills") or [])
                    ],
                }
            )
        charms_out.append(
            {
                "id": int(ranks_sorted[-1]["id"]),
                "name": family_name,
                "ranks": out_ranks,
            }
        )

    deco_out = []
    # Optional official icon_color map (MHWorldData decoration_base.csv).
    color_by_name: dict[str, str] = {}
    color_csv = Path(__file__).resolve().parent / "decoration_base.csv"
    if color_csv.exists():
        import csv as _csv
        with color_csv.open(encoding="utf-8") as f:
            for row in _csv.DictReader(f):
                name_key = (row.get("name_en") or "").strip().lower()
                col = (row.get("icon_color") or "").strip()
                if name_key and col:
                    color_by_name[name_key] = col
    for j in load("jewels.json"):
        name = eng(j["name"])
        if not name or name.startswith("INVALID"):
            continue
        m = re.search(r"(\d+)\s*$", name)
        slot = int(m.group(1)) if m else 1
        icon_color = color_by_name.get(name.strip().lower()) or (
            "White" if "Shield Jewel" in name else "Gray"
        )
        deco_out.append(
            {
                "id": int(j["id"]),
                # Save data stores jewels slotted in gear by this id, not the item id.
                "equipmentId": int(j["equipmentId"]),
                "name": name,
                "slot": slot,
                "rarity": int(j.get("rarity") or 0),
                "iconColor": icon_color,
                "skills": [
                    {"skill": int(sk["skillId"]), "level": int(sk["level"])}
                    for sk in (j.get("skills") or [])
                ],
            }
        )
    deco_out.sort(key=lambda x: x["id"])

    weapon_files = [
        ("great-sword", "great-swords.json"),
        ("long-sword", "long-swords.json"),
        ("sword-and-shield", "sword-and-shields.json"),
        ("dual-blades", "dual-blades.json"),
        ("hammer", "hammers.json"),
        ("hunting-horn", "hunting-horns.json"),
        ("lance", "lances.json"),
        ("gunlance", "gunlances.json"),
        ("switch-axe", "switch-axes.json"),
        ("charge-blade", "charge-blades.json"),
        ("insect-glaive", "insect-glaives.json"),
        ("bow", "bows.json"),
        ("light-bowgun", "light-bowguns.json"),
        ("heavy-bowgun", "heavy-bowguns.json"),
    ]
    # MHWMasterDataUtils adds 1 to the stored rarity for melee weapons but not for ranged ones.
    RANGED_WEAPON_TYPES = {"bow", "light-bowgun", "heavy-bowgun"}
    weapons_out = []
    type_index = {t: i for i, (t, _) in enumerate(weapon_files)}
    for wtype, fname in weapon_files:
        path = DUMP / fname
        if not path.exists():
            continue
        for w in json.loads(path.read_text(encoding="utf-8")):
            name = norm_name(eng(w.get("name")))
            if not name or name.startswith("INVALID"):
                continue
            slots = sorted(
                (int(x) for x in (w.get("slots") or []) if int(x) > 0),
                reverse=True,
            )
            raw_id = int(w["id"])
            # Game files reuse ids per weapon type — make a stable unique id for MHBuilder.
            unique_id = type_index[wtype] * 100_000 + raw_id
            weapons_out.append(
                {
                    "id": unique_id,
                    "gameId": raw_id,
                    "name": name,
                    "type": wtype,
                    "rarity": int(w.get("rarity") or 0) + (1 if wtype in RANGED_WEAPON_TYPES else 0),
                    "slots": [{"rank": s} for s in slots],
                    "damage": int(w.get("damage") or 0),
                    "affinity": int(w.get("affinity") or 0),
                }
            )
    weapons_out.sort(key=lambda x: (x["type"], x["name"], x["id"]))

    (OUT / "skills.json").write_text(
        json.dumps(skills_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "armor.json").write_text(
        json.dumps(armor_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "charms.json").write_text(
        json.dumps(charms_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "decorations.json").write_text(
        json.dumps(deco_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "weapons.json").write_text(
        json.dumps(weapons_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    meta = {
        "source": "Monster Hunter World: Iceborne game data (PC, final title update)",
        "tool": "https://github.com/TanukiSharp/MHWMasterDataUtils",
        "note": "Skill ids are the game's own (not mhw-db ids). Slots and base defense come from the game tables; max defense adds the per-rarity upgrade.",
        "counts": {
            "skills": len(skills_out),
            "armor": len(armor_out),
            "charms": len(charms_out),
            "decorations": len(deco_out),
            "weapons": len(weapons_out),
            "armorZeroDefense": sum(1 for a in armor_out if a["defense"]["max"] <= 0),
            "armorDefenseMax": max((a["defense"]["max"] for a in armor_out), default=0),
        },
    }
    (OUT / "SOURCE.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
