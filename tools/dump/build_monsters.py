"""Build data/monsters.json: large monster weaknesses, roar / wind / tremor, ailments and notes for the Monsters view.

Two sources, joined by English name:
  MHWorldData (tools/dump/mhw_ghs.db)  roar, wind pressure and tremor levels, ailments the monster inflicts, traps,
                                       the name of the alternate weakness state ("when charged")
  mhw.poedb.tw monster pages           game data: Hunter's Notes weakness stars (element and status, normal and
                                       alternate state), known habitats, the in-game "Useful Information" tip and
                                       the monster icon
Pages and icons are cached in tools/dump/poedb_monsters/ (delete a file or pass --refresh to fetch it again).
Weakness stars disagree for Anjanath and Tigrex; those are printed and the game data wins (Kiranico's hitzones agree
with the game: Anjanath takes at most 10 dragon, Tigrex 0 fire but 10 water on the head). poedb's rank list is
unreliable (Nergigante shows High Rank only), so ranks are left out. MHWorldData's monster fields have a few holes for
the last title updates; those are filled in by hand in FIXES. NOTES adds short, well-known mechanics the game tip
leaves out.
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GHS = ROOT / "tools/dump/mhw_ghs.db"
CACHE = ROOT / "tools/dump/poedb_monsters"
ICON_DST = ROOT / "src/MHBuilder/wwwroot/icons/monsters"
OUT = ROOT / "data/monsters.json"
BASE = "https://mhw.poedb.tw"
UA = {"User-Agent": "MHBuilder monster data (github.com/kaitorque/mhbuilder)"}
DELAY_S = 0.5

ELEMENTS = ["fire", "water", "thunder", "ice", "dragon"]
STATUSES = ["poison", "sleep", "paralysis", "blast", "stun"]

# poedb page -> monster its habitats, tip and weakness tables really belong to (that monster's own page has the same
# tables but no tip). These pages' own monsters keep MHWorldData's stars and habitats.
POEDB_SHIFTED = {"Behemoth": "Barroth", "Leshen": "Bazelgeuse", "Ancient Leshen": "Tzitzi-Ya-Ku"}

# MHWorldData leaves the first three empty; values follow the in-game Monster Field Guide. It also marks Xeno'jiiva's
# wind as dragon-level like Kushala's; its critical-state burst is major wind pressure (Game8 lists Kushala as
# Dragon/High and Xeno'jiiva as High).
FIXES = {
    "Furious Rajang": {"roar": "large", "ailments": ["thunderblight"]},
    "Raging Brachydios": {"roar": "large", "ailments": ["blastblight"]},
    "Safi'jiiva": {"roar": "large"},
    "Xeno'jiiva": {"wind": "large"},
}

# Alternate weakness state labels; the rest are MHWorldData's ("when charged" -> "Charged").
ALT_LABELS = {
    "Stygian Zinogre": "Charged (glowing)",
    "Safi'jiiva": "Second Hunter's Notes row",
}
# Name of the normal row where the game's default is itself a state.
BASE_LABELS = {"Alatreon": "Fire active"}

# Mechanics the in-game tip doesn't mention.
NOTES = {
    "Alatreon": ["Opens in dragon active mode, then alternates between fire active and ice active. "
                 "In ice active mode it is weak to fire and thunder instead of ice and water."],
    "Teostra": ["When enraged it can charge Supernova, a huge explosion centred on its body. Get far away."],
    "Tigrex": ["Its roar also damages hunters standing right next to it."],
    "Behemoth": ["Ecliptic Meteor hits the whole area; hide behind one of the Comet crystals it summons to survive it."],
}


def text(html: str) -> str:
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", html)).split())


def fetch(url: str, path: Path, refresh: bool, binary: bool = False):
    if path.exists() and not refresh:
        return path.read_bytes() if binary else path.read_text(encoding="utf-8")
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    time.sleep(DELAY_S)
    return data if binary else data.decode("utf-8")


def cards(html: str):
    """(card title, table html) for every card on a poedb page."""
    return re.findall(r"card-header'>.*?</i>\s*([^<]*?)\s*<small>.*?<table[^>]*>(.*?)</table>", html, re.S)


def star_rows(table: str, columns: list[str]) -> dict[str, dict[str, int | None]]:
    heads = [re.search(r"title='([^']*)'", c).group(1) if "title=" in c else text(c)
             for c in re.findall(r"<th[^>]*>(.*?)</th>", table, re.S)]
    if heads[1:] != columns:
        return {}
    rows = {}
    for r in re.findall(r"<tr>(.*?)</tr>", table.split("</thead>")[-1], re.S):
        cells = [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        rows[cells[0]] = {k: int(v) if v.isdigit() else None for k, v in zip(columns, cells[1:])}
    return rows


def parse_page(html: str) -> dict | None:
    info = {}
    m = re.search(r"<table class='table table-striped table-bordered filters'><tr><th>Rank</th>(.*?)</table>", html, re.S)
    if not m:
        return None
    for th, td in re.findall(r"<th>(.*?)</th><td>(.*?)</td>", "<th>Rank</th>" + m.group(1), re.S):
        info[text(th)] = td
    element, status = {}, {}
    for title, table in cards(html):
        if title == "Weakness":
            element = element or star_rows(table, ELEMENTS)
            status = status or star_rows(table, STATUSES)
    icon = re.search(r"src='(/images/cmn_micon00/\d+\.png)'", html)
    return {
        "habitats": [text(a) for a in re.findall(r"<a [^>]*>(.*?)</a>", info.get("Known Habitats", ""))],
        "tip": text(info.get("Useful Information", "")),
        "element": element,
        "status": status,
        "icon": icon.group(1) if icon else None,
    }


def poedb_monsters(refresh: bool) -> dict[str, dict]:
    index = fetch(f"{BASE}/eng/monsters/large", CACHE / "large.html", refresh)
    out = {}
    for pid, slug in dict.fromkeys(re.findall(r"href='/eng/monster/(\d+)/([^']+)'", index)):
        page = parse_page(fetch(f"{BASE}/eng/monster/{pid}/{slug}", CACHE / f"{pid}.html", refresh))
        # The large monster index also links unused ids ("Invalid Message") that have no info table.
        if page:
            page["id"] = int(pid)
            out[urllib.parse.unquote(slug)] = page
    return out


def ghs_monsters() -> list[dict]:
    db = sqlite3.connect(GHS)
    db.row_factory = sqlite3.Row
    location = dict(db.execute("select id, name from location_text where lang_id='en'").fetchall())
    habitats = {}
    for mid, lid in db.execute("select monster_id, location_id from monster_habitat order by id"):
        habitats.setdefault(mid, []).append(location[lid])
    rows = db.execute(
        "select m.*, t.name, t.ecology, t.description, t.alt_state_description from monster m"
        " join monster_text t on t.id = m.id and t.lang_id = 'en' where m.size = 'large' order by m.order_id").fetchall()
    out = []
    for r in rows:
        alt = {e: r[f"alt_weakness_{e}"] for e in ELEMENTS} if r["has_alt_weakness"] else None
        out.append({
            "name": r["name"],
            "ecology": r["ecology"],
            "description": " ".join((r["description"] or "").split()),
            "element": {e: r[f"weakness_{e}"] for e in ELEMENTS},
            "alt": alt,
            "altLabel": r["alt_state_description"],
            "status": {s: r[f"weakness_{s}"] for s in STATUSES},
            "roar": r["ailment_roar"],
            "wind": r["ailment_wind"],
            "tremor": r["ailment_tremor"],
            "ailments": [k.removeprefix("ailment_") for k in r.keys()
                         if k.startswith("ailment_") and k not in ("ailment_roar", "ailment_wind", "ailment_tremor") and r[k]],
            "traps": {"pitfall": bool(r["pitfall_trap"]), "shock": bool(r["shock_trap"])},
            "habitats": habitats.get(r["id"], []),
        })
    return out


def main() -> None:
    refresh = "--refresh" in sys.argv
    pages = poedb_monsters(refresh)
    for page_name, owner in POEDB_SHIFTED.items():
        pages[owner].update(habitats=pages[page_name]["habitats"], tip=pages[page_name]["tip"])
        pages[page_name].update(habitats=[], tip="", element={}, status={})

    monsters, mismatches, unmatched = [], [], []
    ICON_DST.mkdir(parents=True, exist_ok=True)
    for g in ghs_monsters():
        name = g["name"]
        p = pages.get(name)
        if p is None:
            unmatched.append(name)
            p = {"element": {}, "status": {}, "habitats": [], "tip": "", "icon": None}
        normal, alt_row = p["element"].get("normal"), p["element"].get("alt")
        status = p["status"].get("normal")
        for label, ours, theirs in (("element", g["element"], normal), ("status", g["status"], status)):
            if theirs and ours != theirs:
                mismatches.append(f"{name} {label}: MHWorldData {ours} game {theirs}")
        element = normal or g["element"]
        # The game's alternate row leaves unchanged elements blank.
        alt = {e: (v if v is not None else element[e]) for e, v in alt_row.items()} if alt_row and any(
            v is not None for v in alt_row.values()) else g["alt"]
        if alt and g["alt"] and alt != g["alt"]:
            mismatches.append(f"{name} alt: MHWorldData {g['alt']} game {alt}")
        if alt == element:
            alt = None

        m = {
            "name": name,
            "ecology": g["ecology"],
            "habitats": p["habitats"] or g["habitats"],
            "description": g["description"],
            "tip": p["tip"],
            "element": element,
            "status": status or g["status"],
            "roar": g["roar"],
            "wind": g["wind"],
            "tremor": g["tremor"],
            "ailments": g["ailments"],
            "traps": g["traps"],
        }
        if alt:
            label = ALT_LABELS.get(name) or (g["altLabel"] or "Alternate state").removeprefix("when ")
            m["alt"] = {"label": label[:1].upper() + label[1:], "element": alt}
            if name in BASE_LABELS:
                m["alt"]["baseLabel"] = BASE_LABELS[name]
        m.update(FIXES.get(name, {}))
        if NOTES.get(name):
            m["notes"] = NOTES[name]
        if p["icon"]:
            icon = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") + ".png"
            png = fetch(BASE + p["icon"], CACHE / "icons" / Path(p["icon"]).name, refresh, binary=True)
            (ICON_DST / icon).write_bytes(png)
            m["icon"] = icon
        monsters.append(m)

    OUT.write_text(json.dumps({"monsters": monsters}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"monsters {len(monsters)}, with alternate state {sum('alt' in m for m in monsters)}, "
          f"icons {sum('icon' in m for m in monsters)}, game tips {sum(bool(m['tip']) for m in monsters)}")
    print(f"not on poedb: {unmatched}")
    print(f"weakness disagreements (game data used): {len(mismatches)}")
    for line in mismatches:
        print("  " + line)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
