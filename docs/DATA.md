# Data

The app reads only the JSON files in `data/`. Everything under `tools/dump/` is the pipeline that produced them;
only its scripts are tracked in git, and the extracted game files and tools stay local.

## Catalog (`data/*.json`)

Exported from the game's own tables (PC, final title update), so ids, defense and slots match the game exactly.

| File | Count | Notes |
|------|------:|-------|
| `skills.json` | 203 | Game skill ids, soft/hard caps, level descriptions |
| `armor.json` | 1648 | Max defense, resistances, slots, skills, set bonuses |
| `charms.json` | 110 families | Ranks I–V grouped by name |
| `decorations.json` | 404 | Slot size, skills, icon color |
| `weapons.json` | 3695 | Rarity, slots, damage, affinity |
| `materials.json` | | Crafting recipes and material sources (below) |

`SOURCE.json` records the exporter and the counts.

Public community databases (e.g. mhw-db) were not used: they lag behind the last title updates and list dozens of
late master-rank pieces with zero defense.

## Materials (`data/materials.json`)

Backs the **Materials** view: forge cost and materials per armor piece, charm rank and weapon, and where each
material comes from.

- **Armor and charm recipes, item names, descriptions, rarity:** the game export. 1632 armor pieces have a recipe;
  the rest are reward or event gear.
- **Weapons:** upgrade trees and recipes from MHWorldData (the game export's weapon trees are incomplete), zenny
  cost from the game export. Matched by name and weapon type; 36 of 3695 weapons have no match. The view counts the
  cheapest path: forge the nearest forgeable ancestor, then every upgrade. Kulve Taroth and Safi'jiiva weapons are
  flagged as siege rewards.
- **Material sources:** MHWorldData (monster drops with rank and chance, gathering spots, quest rewards,
  combinations), matched to game items by English name. About 60 materials have no source data (Guiding Lands
  materials, festival tickets and similar); their in-game description says where they come from.
- **Icons:** item icons copied into `src/MHBuilder/wwwroot/icons/mh/` and tinted in the browser.

## Regenerating

Local prerequisites under `tools/dump/` (not in git):

| Path | What |
|------|------|
| `pkgs/chunkG*.pkg` | Game chunks unpacked with [WorldChunkTool](https://github.com/mhvuze/WorldChunkTool) (needs `oo2core_8_win64.dll` from the game folder); about 80 GB |
| `MHWMasterDataUtils/` | [MHWMasterDataUtils](https://github.com/TanukiSharp/MHWMasterDataUtils); its Exporter writes `MHWMasterDataUtils.Exporter/data/*.json` from the chunks |
| `mhw_ghs.db` | [MHWorldData](https://github.com/gatheringhallstudios/MHWorldData) SQLite build |
| `mhotomo/` | Icon source assets |

Then, from the repository root:

```sh
python tools/dump/convert_game_dump.py     # skills, armor, charms, decorations, weapons, SOURCE.json
python tools/dump/build_materials.py       # materials.json and item icons
python tools/dump/restore_jewel_icons.py   # slot, jewel and gear icons
```

`convert_game_dump.py` adds 1 to ranged weapon rarity: the exporter applies that offset for melee weapons only.

**Known exporter limit:** some mid-chunk `skill_data.skl_dat` / `itemData.itm` revisions use headers the parser
skips (`0x00BB` / `0x00BD`). Armor, charms, jewels and the skill list still come from the latest parseable tables.
