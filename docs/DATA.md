# Data

The app reads only the JSON files in `data/`. Everything under `tools/dump/` is the pipeline that produced them;
only its scripts are tracked in git, and the extracted game files and tools stay local.

## Catalog (`data/*.json`)

Exported from the game's own tables (PC, final title update), so ids, defense and slots match the game exactly.

| File | Count | Notes |
|------|------:|-------|
| `skills.json` | 203 | Game skill ids, soft/hard caps, level descriptions |
| `armor.json` | 1648 | Base and fully upgraded defense, resistances, slots, skills, set bonuses |
| `charms.json` | 110 families | Ranks I–V grouped by name |
| `decorations.json` | 404 | Slot size, skills, icon color |
| `weapons.json` | 3695 | Rarity, slots, damage, affinity |
| `materials.json` | | Crafting recipes and material sources (below) |

`SOURCE.json` records the exporter and the counts.

The game tables only hold base defense. Upgrading adds a fixed amount per rarity (R1 +36 down to R8 +6, R9 +38 down
to R12 +18; `UPGRADE_DEFENSE` in `convert_game_dump.py`), which matches MHWorldData for every piece both list. The
search, stats and minimums all use the fully upgraded value.

Public community databases (e.g. mhw-db) were not used: they lag behind the last title updates and list dozens of
late master-rank pieces with zero defense.

## Materials (`data/materials.json`)

Backs the **Materials** view: forge cost and materials per armor piece, charm rank and weapon, and where each
material comes from.

- **Armor and charm recipes, item names, descriptions, rarity:** the game export. 1632 armor pieces have a recipe;
  the rest are reward or event gear. The export has no materials for 8 charm ranks added in later title updates
  (Master's Charm V, Critical Charm III and others); those come from MHWorldData, matched by name.
- **Weapons:** upgrade trees and recipes from MHWorldData (the game export's weapon trees are incomplete), zenny
  cost from the game export. Matched by name and weapon type; 36 of 3695 weapons have no match. 3 of those
  (Black Eagle, Strong Ale, Azure Era "Soaring Dragon") take their forge recipe from the game export, and 19 late
  upgrades (Xeno'jiiva "+", Black Lightning Eagle, Master Ale, ...) are entered by hand in `MANUAL_UPGRADES`. The other
  14 are the loaner weapons from the removed Monster Hunter movie event quests and have no recipe. The view counts the
  cheapest path: forge the nearest forgeable ancestor, then every upgrade. Kulve Taroth and Safi'jiiva weapons are
  flagged as siege rewards.
- **Material sources:** MHWorldData (monster drops with rank and chance, quest rewards, combinations), matched to
  game items by English name. Gathering comes from [mhw.poedb.tw](https://mhw.poedb.tw/eng/) (every map and rank,
  including Hoarfrost Reach and the Guiding Lands, by node type), which also supplies Tailraider Safari hauls and
  monster drops for items MHWorldData has none for (master rank small monsters). poedb uses the game's item ids.
  Items still without source data (festival tickets and similar) show what their in-game description says.
- **Icons:** item icons copied into `src/MHBuilder/wwwroot/icons/mh/` and tinted in the browser.

## Monsters (`data/monsters.json`)

Backs the **Monsters** view: every large monster's weakness stars, roar / wind pressure / tremor level and the
ailments it inflicts.

- **Weakness stars** (element and status, plus the alternate state such as Fulgur Anjanath charged or Barroth in
  mud): the game's Hunter's Notes values via [mhw.poedb.tw](https://mhw.poedb.tw/eng/monsters/large). MHWorldData
  agrees except for Anjanath and Tigrex, where the build prints the difference and uses the game values (Kiranico's
  hitzones back the game values).
- **Roar, wind, tremor, ailments, traps, alternate state names:** MHWorldData, with the gaps for Furious Rajang,
  Raging Brachydios and Safi'jiiva filled in by hand (`FIXES` in `build_monsters.py`).
- **Habitats, in-game tip, icons:** poedb. Three poedb pages hold another monster's info (the Behemoth page has
  Barroth's, Leshen has Bazelgeuse's, Ancient Leshen has Tzitzi-Ya-Ku's); `POEDB_SHIFTED` moves them back.
- **Notes:** a few short hand-written mechanics the game tip leaves out (`NOTES`).
- Counter skills shown with each threat use the game's own skill level text from `skills.json`.

## Regenerating

Local prerequisites under `tools/dump/` (not in git):

| Path | What |
|------|------|
| `pkgs/chunkG*.pkg` | Game chunks unpacked with [WorldChunkTool](https://github.com/mhvuze/WorldChunkTool) (needs `oo2core_8_win64.dll` from the game folder); about 80 GB |
| `MHWMasterDataUtils/` | [MHWMasterDataUtils](https://github.com/TanukiSharp/MHWMasterDataUtils); its Exporter writes `MHWMasterDataUtils.Exporter/data/*.json` from the chunks |
| `mhw_ghs.db` | [MHWorldData](https://github.com/gatheringhallstudios/MHWorldData) SQLite build |
| `mhotomo/` | Icon source assets |
| `poedb/`, `poedb_sources.json` | Cached mhw.poedb.tw item pages and the sources parsed from them (`fetch_poedb.py`) |
| `poedb_monsters/` | Cached mhw.poedb.tw monster pages and icons (`build_monsters.py`) |

Then, from the repository root:

```sh
python tools/dump/convert_game_dump.py     # skills, armor, charms, decorations, weapons, SOURCE.json
python tools/dump/build_materials.py       # materials.json and item icons
python tools/dump/fetch_poedb.py           # poedb pages for every material (cached; --refresh refetches)
python tools/dump/build_materials.py       # again, to merge poedb_sources.json
python tools/dump/restore_jewel_icons.py   # slot, jewel and gear icons
python tools/dump/build_monsters.py        # monsters.json and monster icons (cached; --refresh refetches)
```

`fetch_poedb.py` reads the material list from `materials.json`, so it runs after a first build; once
`poedb_sources.json` exists, a single `build_materials.py` run is enough unless new materials appear.

`convert_game_dump.py` adds 1 to ranged weapon rarity: the exporter applies that offset for melee weapons only.

**Known exporter limit:** some mid-chunk `skill_data.skl_dat` / `itemData.itm` revisions use headers the parser
skips (`0x00BB` / `0x00BD`). Armor, charms, jewels and the skill list still come from the latest parseable tables.
