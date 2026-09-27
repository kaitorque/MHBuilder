/** MHW UI icons (from MHOTOMO assets) — armor slots + element resists. */

const ELEMENT_META = {
  fire: { label: "Fire", file: "el-fire.png" },
  water: { label: "Water", file: "el-water.png" },
  thunder: { label: "Thunder", file: "el-thunder.png" },
  ice: { label: "Ice", file: "el-ice.png" },
  dragon: { label: "Dragon", file: "el-dragon.png" },
};

const ARMOR_FILES = {
  head: "icon_head.png",
  chest: "icon_chest.png",
  gloves: "icon_arm.png",
  waist: "icon_waist.png",
  legs: "icon_leg.png",
  charm: "icon_charm.png",
};

/** Weapon-type icons (MHOTOMO). Default type when none picked: great-sword. */
const WEAPON_FILES = {
  "great-sword": "icon_great_sword.png",
  "long-sword": "icon_long_sword.png",
  "sword-and-shield": "icon_sword_shield.png",
  "dual-blades": "icon_dual_blades.png",
  hammer: "icon_hammer.png",
  "hunting-horn": "icon_hunting_horn.png",
  lance: "icon_lance.png",
  gunlance: "icon_gunlance.png",
  "switch-axe": "icon_switch_axe.png",
  "charge-blade": "icon_charge_blade.png",
  "insect-glaive": "icon_insect_glaive.png",
  bow: "icon_bow.png",
  "light-bowgun": "icon_light_bowgun.png",
  "heavy-bowgun": "icon_heavy_bowgun.png",
};

const DEFAULT_WEAPON_TYPE = "great-sword";

/** Official MHW / Iceborne rarity gem colors (monsterhunterwiki Item Colors). */
const RARITY_COLORS = {
  1: "#AAAAAA",
  2: "#DEDEDE",
  3: "#A1C42E",
  4: "#48AB3F",
  5: "#5CAEBB",
  6: "#595CDA",
  7: "#8D59EF",
  8: "#C76D46",
  9: "#B3436A",
  10: "#0AD5FA",
  11: "#FAC81E",
  12: "#B4F5FF",
};

/** MHW item/jewel icon colors (wiki Item Colors + MHWorldData aliases). */
const ITEM_ICON_COLORS = {
  White: "#EBEBEB",
  Red: "#E1505C",
  Green: "#47B267",
  Blue: "#577BFF",
  Yellow: "#E8C506",
  Purple: "#9788D1",
  Violet: "#685ECD",
  Cyan: "#4EC3E5",
  "Light Blue": "#4EC3E5",
  Orange: "#DF9C65",
  Pink: "#D98B94",
  Gray: "#AFAFAF",
  Grey: "#AFAFAF",
  Lime: "#86B239",
  "Light Green": "#86B239",
  Beige: "#BA954B",
  Brown: "#BA954B",
  LightBeige: "#D7C18D",
  Tan: "#D7C18D",
  DarkBeige: "#8A7040",
  DarkRed: "#AD1547",
  Rose: "#AD1547",
  DarkBlue: "#4C4CD9",
  DarkPurple: "#56379E",
  DarkGreen: "#3D7F3A",
  Moss: "#3D7F3A",
  Gold: "#FAC81E",
  Lemon: "#DFE500",
  Emerald: "#92D0C1",
  Vermilion: "#E16D44",
};

function rarityColor(r) {
  const n = Math.min(12, Math.max(1, Number(r) || 1));
  return RARITY_COLORS[n] || RARITY_COLORS[1];
}

function itemIconColor(name) {
  if (!name) return ITEM_ICON_COLORS.Gray;
  return ITEM_ICON_COLORS[name] || ITEM_ICON_COLORS.Gray;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Material Icons (Google, Apache 2.0) SVG paths. */
const MATERIAL_ICONS = {
  push_pin: "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z",
  push_pin_outlined: "M14 4v5c0 1.12.37 2.16 1 3H9c.65-.86 1-1.9 1-3V4h4m3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z",
  block: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
};

function materialIcon(name, size = 18, cls = "") {
  return `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${MATERIAL_ICONS[name]}"/></svg>`;
}

function pinIcon(on, size = 18) {
  return materialIcon(on ? "push_pin" : "push_pin_outlined", size);
}

function iconUrl(file) {
  return `/icons/${file}?v=13`;
}

function elementIcon(kind, { size = 20 } = {}) {
  const meta = ELEMENT_META[kind];
  if (!meta) return "";
  return `<img class="ico ico-el ico-el-${kind}" src="${iconUrl(meta.file)}" width="${size}" height="${size}" alt="${meta.label}" title="${meta.label}" />`;
}

function armorIcon(slot, rarity, { size = 22 } = {}) {
  const key = String(slot || "").toLowerCase();
  const file = ARMOR_FILES[key] || ARMOR_FILES.chest;
  const color = rarityColor(rarity);
  const label = key ? key.charAt(0).toUpperCase() + key.slice(1) : "Armor";
  return `<span class="ico mh-ico gear-ico" style="width:${size}px;height:${size}px" title="${escapeHtml(label)} · R${rarity || "?"}" role="img" aria-label="${escapeHtml(label)} rarity ${rarity || "?"}">${tintedLayer(file, color)}</span>`;
}

/** Weapon-type icon tinted with in-game rarity gem color. Defaults to Great Sword. */
function weaponIcon(type, rarity, { size = 22, title = "" } = {}) {
  const key = WEAPON_FILES[type] ? type : DEFAULT_WEAPON_TYPE;
  const file = WEAPON_FILES[key];
  const r = rarity == null || rarity === "" ? 12 : rarity;
  const color = rarityColor(r);
  const label = title || key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `<span class="ico mh-ico gear-ico" style="width:${size}px;height:${size}px" title="${escapeHtml(label)} · R${r}" role="img" aria-label="${escapeHtml(label)} rarity ${r}">${tintedLayer(file, color)}</span>`;
}

/** Defense shield (icon_defense, untinted). */
function defenseIcon({ size = 16 } = {}) {
  return `<img class="ico mh-ico def-ico" src="${iconUrl("mh/icon_defense.png")}" width="${size}" height="${size}" alt="Defense" title="Defense" />`;
}

/** Inside a .def-chip: shield, "Def" label, value. */
function defChipHtml(value, { size = 20 } = {}) {
  return `${defenseIcon({ size })}<span class="def-label">Def</span><span class="def-value">${value}</span>`;
}

function clampSlot(n, fallback = 1) {
  return Math.min(4, Math.max(1, Number(n) || fallback));
}

/** Material icon stems (item_<stem>.png) that data/materials.json refers to. */
const ITEM_ICON_STEMS = [
  "bag", "book", "bug", "coin", "dragonbone", "dung", "fur", "gem", "headbone", "plate", "potion",
  "questionmark", "raregem", "rock", "scale", "shell", "skin", "streamstone", "tail", "ticket", "tooth", "web", "wing",
];

/** Original MHOTOMO PNG multiplied by a color: white takes the tint, black outlines and gray shading survive. */
/** Every PNG drawn through tintedLayer; preloaded so tints can be baked synchronously. */
const TINT_FILES = [
  ...Object.values(ARMOR_FILES),
  ...Object.values(WEAPON_FILES),
  ...ITEM_ICON_STEMS.map((s) => `item_${s}.png`),
  ...[1, 2, 3, 4].flatMap((d) => [`item_jewel${d}.png`, `icon_jewel_filled${d}.png`]),
  ...[1, 2, 3, 4].flatMap((h) => Array.from({ length: h }, (_, i) => `icon_slot${h}_filled${i + 1}.png`)),
];
const tintSources = new Map();
const tintedUrls = new Map();

function preloadTintedIcons() {
  return Promise.all(TINT_FILES.map(async (file) => {
    const img = new Image();
    img.src = iconUrl(`mh/${file}`);
    try {
      await img.decode();
      tintSources.set(file, img);
    } catch {
      // Left out; tintedLayer falls back to the CSS mask for this file.
    }
  }));
}

/** Source PNG multiplied by color and clipped to its alpha, baked once per file+color into a blob URL. */
function tintedUrl(file, color) {
  const key = `${file}|${color}`;
  if (tintedUrls.has(key)) return tintedUrls.get(key);
  const img = tintSources.get(file);
  if (!img) return null;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext("2d");
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = color;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(img, 0, 0);
  const bytes = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  tintedUrls.set(key, url);
  return url;
}

// Baked <img> rather than CSS mask + blend: thousands of masked rows (e.g. every weapon) can make the browser drop mask images page-wide.
function tintedLayer(file, color, cls = "") {
  const baked = tintedUrl(file, color);
  if (baked) return `<img class="tint-layer ${cls}" src="${baked}" alt="" draggable="false" />`;
  const url = iconUrl(`mh/${file}`);
  return `<span class="tint-layer tint-css ${cls}" style="--tint:${color};--src:url('${url}')"></span>`;
}

/** Inventory jewel (item_jewelN), tinted by in-game icon color. */
function decoIcon(slotSize, iconColor, { size = 22, title = "" } = {}) {
  const sizeN = clampSlot(slotSize);
  const tip = title || `Jewel 【${sizeN}】 · ${iconColor || "Gray"}`;
  const crisp = sizeN < 4 ? " jewel-crisp" : "";
  return `<span class="ico mh-ico${crisp}" style="width:${size}px;height:${size}px" title="${escapeHtml(tip)}" role="img" aria-label="${escapeHtml(tip)}">${tintedLayer(`item_jewel${sizeN}.png`, itemIconColor(iconColor))}</span>`;
}

/** Armor that can't be earned in the current game, matched by armor set name prefix. */
const UNOBTAINABLE_ARMOR = [
  {
    set: "Artemis",
    note: "Artemis armor came from the Monster Hunter: The Movie collaboration event quest, which has been removed from the game. The only way to get it now is to add it with a save editor.",
  },
];

const ARENA_STEPS = "Arena quests come from the Arena Lass once you clear the matching optional quests. The armor goes straight to your equipment box.";

/** Armor earned, given away or bought outright instead of forged, by piece name or set name prefix. */
const GIFT_ARMOR = [
  {
    set: "Defender α",
    tag: "Gift / armory",
    note: "Defender α and Guardian α+ are the same armor under two names. Guardian α+ was given to everyone for free in a game update, and Defender α is bought from the armory for 300 zenny. Neither is forged from monster materials, so there's nothing to farm.",
  },
  {
    set: "Origin",
    tag: "Pre-order DLC",
    note: "Pre-order bonus for Monster Hunter: World. It can't be bought anymore. If you own it, claim it from the Housekeeper's Add-on and DLC menu.",
  },
  {
    piece: "Pulverizing Feather",
    tag: "Arena reward",
    note: `Get rank B or better on Arena Quests 01 to 07. ${ARENA_STEPS}`,
  },
  {
    piece: "Dragonseal Earrings α",
    tag: "Arena reward",
    note: `Get rank B or better on Arena Quests 08 (Radobaan and Uragaan) and 09 (Diablos and Black Diablos). ${ARENA_STEPS}`,
  },
  {
    piece: "Acrobat Earrings α+",
    tag: "Arena reward",
    note: `Get rank B or better on Arena Master Quests 01 to 05. ${ARENA_STEPS}`,
  },
  {
    piece: "Showman Earrings α+",
    tag: "Arena reward",
    note: `Get rank B or better on Arena Master Quests 06 and 07. ${ARENA_STEPS}`,
  },
];

const armorEntry = (list, setName, pieceName) =>
  list.find((u) => (u.piece ? u.piece === pieceName : String(setName || "").startsWith(u.set))) || null;
const unobtainableNote = (setName) => armorEntry(UNOBTAINABLE_ARMOR, setName)?.note || null;
const giftArmor = (setName, pieceName) => armorEntry(GIFT_ARMOR, setName, pieceName);

/** Small tag after an armor name: save-edit-only, or earned / gift / armory gear. */
function armorNoteTag(setName, pieceName) {
  const unobtainable = unobtainableNote(setName);
  if (unobtainable) return ` <span class="unobtainable-tag" title="${escapeHtml(unobtainable)}">Save edit only</span>`;
  const gift = giftArmor(setName, pieceName);
  return gift ? ` <span class="unobtainable-tag gift-tag" title="${escapeHtml(gift.note)}">${escapeHtml(gift.tag)}</span>` : "";
}

const HOUSEKEEPER_STEPS = "Talk to the Housekeeper in your Seliana room to get the quest, clear it, then talk to the Housekeeper again to receive the charm.";

/** Charms earned instead of forged, by charm name. */
const CHARM_SOURCES = {
  "Adamantine Charm": {
    tag: "Quest reward",
    title: "Optional quest: The Purr-fect Room: Stone",
    lines: ["Capture a Tigrex in the Hoarfrost Reach.", "Unlocks at MR 10 after the assignment \"Absolute Power\".", HOUSEKEEPER_STEPS],
  },
  "Razor Sharp Charm": {
    tag: "Quest reward",
    title: "Optional quest: The Purr-fect Room: Light Iron",
    lines: ["Capture an Acidic Glavenus in the Rotten Vale.", "Unlocks at MR 15 after \"The Disintegrating Blade\" and \"The Purr-fect Room: Stone\".", HOUSEKEEPER_STEPS],
  },
  "Sealer's Charm": {
    tag: "Quest reward",
    title: "Optional quest: The Purr-fect Room: Dark Iron",
    lines: ["Hunt an Odogaron and an Ebony Odogaron in the Rotten Vale.", "Unlocks at MR 16 after \"The Purr-fect Room: Light Iron\".", HOUSEKEEPER_STEPS],
  },
  "Gutsy Charm": {
    tag: "Quest reward",
    title: "Optional quest: The Purr-fect Room: Silver",
    lines: ["Capture a Seething Bazelgeuse in the Elder's Recess.", "Unlocks at MR 19 after \"The Purr-fect Room: Light Iron\".", HOUSEKEEPER_STEPS],
  },
  "Fair Wind Charm": {
    tag: "Pre-order DLC",
    title: "Pre-order bonus for Monster Hunter: World",
    lines: ["It can't be bought anymore. If you own it, claim it from the Housekeeper's Add-on and DLC menu."],
  },
};

const charmSource = (name) => CHARM_SOURCES[name] || null;

/** Small tag after a charm name when it's earned instead of forged. */
function charmNoteTag(name) {
  const src = charmSource(name);
  return src ? ` <span class="unobtainable-tag gift-tag" title="${escapeHtml([src.title, ...src.lines].join("\n"))}">${src.tag}</span>` : "";
}

/** Crafting material (item_<stem>.png), tinted by its in-game icon color. */
function itemIcon(stem, iconColor, { size = 22, title = "" } = {}) {
  const file = `item_${ITEM_ICON_STEMS.includes(stem) ? stem : "questionmark"}.png`;
  const tip = escapeHtml(title);
  return `<span class="ico mh-ico" style="width:${size}px;height:${size}px"${tip ? ` title="${tip}"` : ""} role="img" aria-label="${tip}">${tintedLayer(file, itemIconColor(iconColor))}</span>`;
}

/** Empty decoration slot cradle (icon_slotN, untinted). */
function slotIcon(slotSize, { size = 18 } = {}) {
  const sizeN = clampSlot(slotSize);
  return `<img class="ico mh-ico" src="${iconUrl(`mh/icon_slot${sizeN}.png`)}" width="${size}" height="${size}" alt="Slot ${sizeN}" title="Slot 【${sizeN}】" />`;
}

/**
 * Equipped jewel, stacked the way MHOTOMO does it on one 64×64 canvas:
 * icon_slot{host} cradle + icon_jewel_filled{deco} gem + icon_slot{host}_filled{deco} lit triangles.
 */
function filledSlotIcon(hostSize, decoSize, iconColor, { size = 16, title = "" } = {}) {
  const host = clampSlot(hostSize);
  const deco = Math.min(host, clampSlot(decoSize, host));
  const tip = title || (deco < host
    ? `Jewel 【${deco}】 in slot 【${host}】`
    : `Jewel 【${deco}】`);
  const color = itemIconColor(iconColor);
  return `<span class="ico mh-ico mh-stack" style="width:${size}px;height:${size}px" title="${escapeHtml(tip)}" role="img" aria-label="${escapeHtml(tip)}">
    <img src="${iconUrl(`mh/icon_slot${host}.png`)}" alt="" />
    ${tintedLayer(`icon_jewel_filled${deco}.png`, color)}
    ${tintedLayer(`icon_slot${host}_filled${deco}.png`, color)}
  </span>`;
}

function slotsIconsHtml(slots, { size = 16 } = {}) {
  const list = (slots || []).filter((n) => n > 0);
  if (!list.length) return `<span class="muted-dash">—</span>`;
  return list.map((n) => slotIcon(n, { size })).join("");
}

/** Free slots as icon then ×count (grouped by size). */
function freeSlotsSummaryHtml(freeSlots, remainingSlots, { size = 16 } = {}) {
  let groups = freeSlots;
  if (!groups || !groups.length) {
    const counts = {};
    for (const n of remainingSlots || []) {
      if (n > 0) counts[n] = (counts[n] || 0) + 1;
    }
    groups = Object.keys(counts)
      .map(Number)
      .sort((a, b) => b - a)
      .map((slotSize) => ({ slotSize, count: counts[slotSize] }));
  }
  if (!groups.length) return `<span class="muted-dash">—</span>`;
  return groups
    .map((g) => {
      const n = g.slotSize;
      const c = g.count;
      return `<span class="free-slot-group" title="【${n}】 ×${c}">${slotIcon(n, { size })}<span class="free-slot-count">×${c}</span></span>`;
    })
    .join("");
}

/** Empty cradle, or authentic inventory jewel for what's seated. */
function pieceSlotsFilledHtml(pieceSlots, placements, { size = 16 } = {}) {
  const slots = [...(pieceSlots || [])].filter((n) => n > 0);
  if (!slots.length) return "";
  const placed = [...(placements || [])];
  const parts = [];
  for (const hostSize of slots) {
    const idx = placed.findIndex((p) => Number(p.slotSize) === hostSize);
    if (idx >= 0) {
      const p = placed.splice(idx, 1)[0];
      const decoSize = Number(p.decoSlotSize) || Number(p.slotSize) || hostSize;
      const tip = decoSize < hostSize
        ? `${p.name} 【${decoSize}】 in 【${hostSize}】`
        : `${p.name} 【${decoSize}】`;
      parts.push(filledSlotIcon(hostSize, decoSize, p.iconColor, { size, title: tip }));
    } else {
      parts.push(slotIcon(hostSize, { size }));
    }
  }
  return `<span class="piece-slots">${parts.join("")}</span>`;
}

/** Makes a defense / resistance chip set that search minimum on click (see setStatMin). */
function statChipAttrs(stat, value) {
  return `data-min-stat="${stat}" data-min-value="${value}" role="button" tabindex="0"`;
}

function resistRowHtml(resists, { clickable = true } = {}) {
  const r = resists || {};
  return ["fire", "water", "thunder", "ice", "dragon"]
    .map((k) => {
      const v = r[k] ?? 0;
      const cls = v > 0 ? "pos" : v < 0 ? "neg" : "zero";
      return `<span class="resist-chip ${cls}" ${clickable ? statChipAttrs(k, v) : ""}>${elementIcon(k)}${v > 0 ? "+" : ""}${v}</span>`;
    })
    .join("");
}

/** "Slugger 2 · Marathon Runner 1" under a piece or charm; empty when it has no skills. */
function pieceSkillsHtml(skills, cls = "piece-skills") {
  if (!skills?.length) return "";
  return `<span class="${cls}">${skills.map((s) => escapeHtml(`${s.name} ${s.level}`)).join(" · ")}</span>`;
}

/** Seated jewels in the order pieceSlotsFilledHtml draws them (each host slot takes the first placement of its size). */
function orderByHostSlots(pieceSlots, placements) {
  const placed = [...(placements || [])];
  const out = [];
  for (const hostSize of (pieceSlots || []).filter((n) => n > 0)) {
    const idx = placed.findIndex((p) => Number(p.slotSize) === hostSize);
    if (idx >= 0) out.push(placed.splice(idx, 1)[0]);
  }
  return out;
}

/** One entry per seated jewel, in slot order, in the gem's color: "Attack Boost 1" (or "Agitator 1 + Health Boost 1"). */
function decoSkillsHtml(decos, cls = "deco-skills") {
  const list = (decos || []).filter(Boolean);
  if (!list.length) return "";
  const chips = list.map((d) => {
    const text = d.skills?.length ? d.skills.map((s) => `${s.name} ${s.level}`).join(" + ") : d.name;
    return `<span class="deco-skill" style="color:${itemIconColor(d.iconColor)}" title="${escapeHtml(d.name)}">${escapeHtml(text)}</span>`;
  });
  return `<span class="${cls}">${chips.join("")}</span>`;
}

function pieceRowHtml(label, piece, slot, placements, weaponMeta, actionsHtml = "") {
  if (!piece) return "";
  const rarity = piece.rarity ?? (slot === "charm" ? 10 : 1);
  const loc =
    slot === "head" ? "Head" :
    slot === "chest" ? "Chest" :
    slot === "gloves" ? "Gloves" :
    slot === "waist" ? "Waist" :
    slot === "legs" ? "Legs" :
    slot === "weapon" ? "Weapon" : "";
  const here = loc ? (placements || []).filter((p) => p.location === loc) : [];
  let slotIcons = "";
  if (slot === "charm") {
    slotIcons = "";
  } else if (placements) {
    slotIcons = pieceSlotsFilledHtml(piece.slots, here, { size: 20 });
  } else {
    slotIcons = `<span class="piece-slots">${slotsIconsHtml(piece.slots, { size: 20 })}</span>`;
  }
  const wType = weaponMeta?.type || DEFAULT_WEAPON_TYPE;
  const wRarity = weaponMeta?.rarity ?? piece.rarity ?? 12;
  const icon =
    slot === "weapon"
      ? weaponIcon(wType, wRarity, { size: 32, title: piece.name || "Weapon" })
      : armorIcon(slot, rarity, { size: 32 });
  const metaBits = [];
  if (slot === "weapon") {
    metaBits.push(`R${wRarity}`);
  } else {
    metaBits.push(`R${rarity}`);
  }
  if (piece.set) metaBits.push(escapeHtml(piece.set));
  return `<div class="piece-row" data-loc="${slot}">
    ${icon}
    <div class="piece-text">
      <span class="piece-slot">${label}</span>
      <span class="piece-name">${escapeHtml(piece.name)}${slot === "charm" ? charmNoteTag(piece.name) : armorNoteTag(piece.set, piece.name)}</span>
      <span class="piece-meta rarity-text" style="color:${rarityColor(slot === "weapon" ? wRarity : rarity)}">${metaBits.join(" · ")}</span>
      ${pieceSkillsHtml(piece.skills)}
      ${slotIcons}
      ${decoSkillsHtml(orderByHostSlots(piece.slots, here))}
    </div>
    ${actionsHtml ? `<div class="piece-actions">${actionsHtml}</div>` : ""}
  </div>`;
}
