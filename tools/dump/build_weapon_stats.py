"""Build data/weapon_stats.json: element and sharpness per weapon for the builder's attack panel.

data/weapons.json (from the game dump) has attack, affinity and slots but no element or sharpness, so those come from
MHWorldData (tools/dump/mhw_ghs.db), matched by name and weapon type like build_materials.py.

Output, keyed by MHBuilder weapon id (weapons without either field are left out):
  element         [{type, value, hidden}]  display values; dual blades can have two; hidden needs Free Elem/Ammo Up
  sharpness       [red, orange, yellow, green, blue, white, purple] hits at Handicraft 5 (400 in total)
  sharpnessMaxed  true when Handicraft adds nothing (the bar is already full without it)
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GHS = ROOT / "tools/dump/mhw_ghs.db"
WEAPONS = ROOT / "data/weapons.json"
OUT = ROOT / "data/weapon_stats.json"


def main() -> None:
    ours = json.loads(WEAPONS.read_text(encoding="utf-8"))
    db = sqlite3.connect(GHS)
    ghs = {}
    for name, wtype, e1, v1, e2, v2, hidden, sharp, maxed in db.execute(
            "select t.name, w.weapon_type, w.element1, w.element1_attack, w.element2, w.element2_attack, "
            "w.element_hidden, w.sharpness, w.sharpness_maxed "
            "from weapon w join weapon_text t on t.id = w.id and t.lang_id = 'en'"):
        entry = {}
        elements = [{"type": e.lower(), "value": v, "hidden": bool(hidden)} for e, v in ((e1, v1), (e2, v2)) if e and v]
        if elements:
            entry["element"] = elements
        if sharp:
            entry["sharpness"] = [int(x) for x in sharp.split(",")]
            entry["sharpnessMaxed"] = bool(maxed)
        ghs[(name, wtype)] = entry

    out, unmatched = {}, []
    for w in ours:
        entry = ghs.get((w["name"], w["type"]))
        if entry is None:
            unmatched.append(w["name"])
        elif entry:
            out[str(w["id"])] = entry

    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"weapons {len(ours)}, with stats {len(out)} "
          f"({sum('element' in e for e in out.values())} with element, "
          f"{sum('sharpness' in e for e in out.values())} with sharpness); "
          f"not in MHWorldData: {len(unmatched)} {unmatched[:12]}")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
