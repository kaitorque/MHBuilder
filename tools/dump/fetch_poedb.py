"""Fetch material sources from mhw.poedb.tw into tools/dump/poedb_sources.json for build_materials.py.

poedb uses the game's item ids, so every material in data/materials.json maps straight to its item page. Pages are
cached in tools/dump/poedb/ (delete a file or pass --refresh to fetch it again). Parsed per item:
  gathering  Locations table: map, rank, node type (e.g. "Mining Outcrop (Upsurge)", Guiding Lands region + level)
  safari     Tailraider Safari tables: map, rank and this item's share of the haul
  monsters   Monster table: drops with rank and chance (conditions poedb has no text for are dropped)
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "tools/dump/poedb"
OUT = ROOT / "tools/dump/poedb_sources.json"
MATERIALS = ROOT / "data/materials.json"
BASE = "https://mhw.poedb.tw/eng/item"
DELAY_S = 0.5
RANKS = {"Low Rank": "LR", "High Rank": "HR", "Master Rank": "MR"}


def text(html: str) -> str:
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", html)).split())


def tables(html: str):
    """(column names, [row cells as raw html]) for every table on the page."""
    for table in re.findall(r"<table[^>]*>(.*?)</table>", html, re.S):
        cols = [text(c) for c in re.findall(r"<th[^>]*>(.*?)</th>", table, re.S)]
        body = table.split("</thead>", 1)[-1]
        rows = [re.findall(r"<td[^>]*>(.*?)</td>", r, re.S) for r in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S)]
        yield cols, [r for r in rows if r]


def pct(s: str) -> int | None:
    m = re.search(r"(\d+)\s*%", s)
    return int(m.group(1)) if m else None


def parse(item_id: int, html: str) -> dict:
    gathering, safari, monsters = [], [], []
    for cols, rows in tables(html):
        if cols[:5] == ["Locations", "Rank", "Area", "qty", "Percentage"]:
            for c in rows:
                chance = pct(c[4])
                if chance:
                    gathering.append({"location": text(c[0]).removeprefix("The "), "rank": RANKS.get(text(c[1])),
                                      "node": text(c[2]), "stack": int(text(c[3]) or 1), "chance": chance})
        elif cols[:6] == ["Map", "Type", "Rank", "Star", "Items", "Percentage"]:
            for c in rows:
                m = re.search(rf"/eng/item/{item_id}/[^']*'>[^<]*</a>\s*x(\d+)\s*(\d+)%", c[4])
                if m:
                    safari.append({"map": text(c[0]).removeprefix("The "), "rank": RANKS.get(text(c[2])),
                                   "stack": int(m.group(1)), "chance": int(m.group(2))})
        elif cols[:5] == ["Monster", "Condition", "Rank", "Quantity", "Percent"]:
            for c in rows:
                condition = text(c[1]).replace(" %s", "")
                chance = pct(c[4])
                if chance and not condition.startswith("condition "):
                    monsters.append({"monster": text(c[0]), "rank": RANKS.get(text(c[2])), "condition": condition,
                                     "stack": int(text(c[3]) or 1), "chance": chance})
    entry = {}
    if gathering:
        entry["gathering"] = gathering
    if safari:
        entry["safari"] = safari
    if monsters:
        entry["monsters"] = monsters
    return entry


def page(item_id: int, name: str, refresh: bool) -> str:
    path = CACHE / f"{item_id}.html"
    if path.exists() and not refresh:
        return path.read_text(encoding="utf-8")
    url = f"{BASE}/{item_id}/{urllib.parse.quote(name)}"
    req = urllib.request.Request(url, headers={"User-Agent": "MHBuilder material data (github.com/kaitorque/mhbuilder)"})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
    # A wrong or missing name gets a generic page without the item's info table.
    if f">{item_id}<" not in html:
        raise SystemExit(f"poedb has no page for item {item_id} {name!r}: {url}")
    path.write_text(html, encoding="utf-8")
    time.sleep(DELAY_S)
    return html


def main() -> None:
    refresh = "--refresh" in sys.argv
    CACHE.mkdir(parents=True, exist_ok=True)
    items = json.loads(MATERIALS.read_text(encoding="utf-8"))["items"]
    out = {}
    for n, (iid, item) in enumerate(sorted(items.items(), key=lambda kv: int(kv[0])), 1):
        entry = parse(int(iid), page(int(iid), item["name"], refresh))
        if entry:
            out[iid] = entry
        if n % 100 == 0:
            print(f"{n}/{len(items)}")
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts = {k: sum(k in e for e in out.values()) for k in ("gathering", "safari", "monsters")}
    print(f"wrote {OUT}: {len(out)} of {len(items)} items with sources {counts}")


if __name__ == "__main__":
    main()
