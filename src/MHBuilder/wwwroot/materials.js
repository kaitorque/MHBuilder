/* Materials modal: what a set costs to forge and where each material comes from (data/materials.json). */

const MAT_CHARM_TAB = "Charm";
const MAT_WEAPON_TAB = "Weapon";
const materialsCache = new Map();
const SIEGE_SOURCES = {
  Kulve: "a Kulve Taroth Siege reward",
  Safi: "a Safi'jiiva Siege reward",
};

/**
 * pieces: armor objects with an id (builder pieces or result pieces); charm: { id, level } or null; weaponId: catalog
 * weapon or null. category: the tab to open on (see materialsTabFor).
 */
function openMaterials(title, pieces, charm, weaponId = null, category = ALL_TAB) {
  const armorIds = pieces.filter((p) => p?.id).map((p) => p.id);
  const charmSel = charm?.id ? { id: charm.id, level: charm.level } : null;
  if (!armorIds.length && !charmSel && !weaponId) return;
  openModal("materials", title, { armorIds, charm: charmSel, weaponId, category, item: null, lastQ: "" });
}

/** Materials tab for one equipment slot (armor slot key, "charm" or "weapon"), or null when it has nothing to forge. */
function materialsTabFor(loc, piece, weaponId) {
  if (loc === "weapon") return weaponId ? MAT_WEAPON_TAB : null;
  if (loc === "charm") return piece?.id ? MAT_CHARM_TAB : null;
  return piece?.id ? `p${piece.id}` : null;
}

function materialsData() {
  const { armorIds, charm, weaponId } = state.modal;
  const key = JSON.stringify([armorIds, charm, weaponId]);
  if (!materialsCache.has(key)) {
    const request = api("/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ armorIds, charmId: charm?.id ?? null, charmLevel: charm?.level ?? null, weaponId: weaponId ?? null }),
    }).catch((err) => {
      materialsCache.delete(key);
      throw err;
    });
    materialsCache.set(key, request);
  }
  return materialsCache.get(key);
}

const zennyText = (z) => `${Number(z || 0).toLocaleString("en-US")}z`;

/** Recipes shown for a tab: [{ label, zenny, items }] (items null = no forge recipe). */
function materialRecipes(data, tab) {
  const weaponRecipes = (data.weapon?.steps || []).map((s) => ({
    key: MAT_WEAPON_TAB,
    label: `${s.forge ? "Forge" : "Upgrade to"} ${s.name}`,
    zenny: s.zenny,
    items: s.items,
  }));
  const pieceRecipes = data.pieces.map((p) => ({ key: `p${p.id}`, label: p.name, zenny: p.zenny, items: p.items }));
  const charmRecipes = (data.charm?.ranks || []).map((r) => ({ key: MAT_CHARM_TAB, label: r.name, zenny: r.zenny, items: r.items }));
  const all = [...weaponRecipes, ...pieceRecipes, ...charmRecipes];
  return tab === ALL_TAB ? all : all.filter((r) => r.key === tab);
}

/** Why a weapon's materials are missing or partial, or null when the full path is known. */
function weaponPathNote(weapon) {
  if (!weapon || weapon.complete) return null;
  const siege = SIEGE_SOURCES[weapon.source];
  if (siege) return `${weapon.name} is ${siege}. It can't be forged, so no materials are counted for it.`;
  if (!weapon.steps.length) return `No forge or upgrade recipe for ${weapon.name} in the game data.`;
  return `Couldn't trace ${weapon.name} back to a weapon you can forge. Only the upgrades listed are counted.`;
}

/** Sum a list of recipes into [{ id, quantity, uses: [{ label, quantity }] }], rarest first. */
function totalMaterials(recipes, items) {
  const byId = new Map();
  for (const r of recipes) {
    for (const it of r.items || []) {
      const row = byId.get(it.id) || { id: it.id, quantity: 0, uses: [] };
      row.quantity += it.quantity;
      row.uses.push({ label: r.label, quantity: it.quantity });
      byId.set(it.id, row);
    }
  }
  return [...byId.values()].sort((a, b) =>
    (items[b.id]?.rarity ?? 0) - (items[a.id]?.rarity ?? 0) || String(items[a.id]?.name).localeCompare(String(items[b.id]?.name)));
}

const itemRank = (item) => (item.rarity >= 9 ? "MR" : item.rarity >= 5 ? "HR" : "LR");

/** Monsters with the item's own rank first (rarity 1-4 LR, 5-8 HR, 9+ MR); MR variants also drop many HR items. */
function monstersByItemRank(item) {
  const list = item?.sources?.monsters || [];
  const rank = itemRank(item);
  return [...list.filter((m) => m.rank === rank), ...list.filter((m) => m.rank !== rank)];
}

const MAP_NAMES = ["Ancient Forest", "Wildspire Waste", "Coral Highlands", "Rotten Vale", "Elder's Recess", "Hoarfrost Reach"];
const GATHERED_ICONS = new Set(["rock", "dragonbone", "herb", "mushroom", "bug", "seed"]);

/**
 * Where a gathered material comes from per its description, for the ores and bones the gathering data lacks
 * (Guiding Lands, Hoarfrost Reach, most master rank nodes); null when the data has nodes or the text doesn't say.
 */
function describedGathering(item) {
  if (item.sources?.gathering?.length || !GATHERED_ICONS.has(item.icon)) return null;
  const d = item.description || "";
  const region = d.match(/Guiding Lands' (\w+) region/);
  if (region) return `Guiding Lands ${region[1]} region`;
  const map = MAP_NAMES.find((n) => d.includes(n));
  if (map) return map;
  if (/mining outcrops|^Mined from/i.test(d)) return "Mining outcrops";
  return null;
}

/** Non-gathering origin from the description (fest tickets, carves, Safari finds); null when it doesn't say. */
function describedSource(item) {
  const d = item.description || "";
  let m;
  if ((m = d.match(/attending the (.+? Fest)/))) return { label: "Event", rank: null, text: `${m[1]} reward (seasonal)` };
  if (/Tailraider Safari/.test(d)) return { label: "Safari", rank: null, text: "Tailraider Safari find" };
  if (/Steamworks/.test(d)) return { label: null, rank: null, text: "Steamworks reward" };
  if (/Botanical Research/.test(d)) return { label: null, rank: null, text: "Botanical Research" };
  if ((m = d.match(/^(?:Very rare |Rare )?(.+?) material\.\s*((?:Mostly )?[Oo]btained [^.]+)?/))) {
    const how = m[2] ? `, ${m[2].charAt(0).toLowerCase()}${m[2].slice(1)}` : "";
    return { label: "Drops", rank: itemRank(item), text: `${m[1]}${how}` };
  }
  return null;
}

/** "Kirin 16%, Kushala Daora 12%" for every monster of the item's rank; one monster also names its best drop. */
function monsterSource(item) {
  const ranked = monstersByItemRank(item);
  if (!ranked.length) return null;
  const rank = ranked[0].rank;
  const best = new Map();
  for (const o of ranked) {
    if (o.rank !== rank) continue;
    const [condition, pct] = o.drops[0];
    if (!best.has(o.monster) || best.get(o.monster).pct < pct) best.set(o.monster, { condition, pct });
  }
  const others = new Set(ranked.filter((o) => !best.has(o.monster)).map((o) => o.monster)).size;
  const more = others > 0 ? ` (+${others} in other ranks)` : "";
  if (best.size === 1) {
    const [[name, { condition, pct }]] = best;
    return { label: "Drops", rank, text: `${name} ${pct}% from ${condition}${more}` };
  }
  const list = [...best].sort((a, b) => b[1].pct - a[1].pct).map(([name, { pct }]) => `${name} ${pct}%`);
  return { label: "Drops", rank, text: `${list.join(", ")}${more}` };
}

/** Rows of the item's own rank, else of the first rank listed (lists come highest rank first). */
function rowsOfItemRank(item, rows) {
  const want = itemRank(item);
  const rank = rows.some((r) => r.rank === want) ? want : rows[0]?.rank;
  return { rank, rows: rows.filter((r) => r.rank === rank) };
}

/** A gathering row's place: the map, or for the Guiding Lands its region ("Guiding Lands Ancient Forest"). */
function gatherPlace(g) {
  const region = g.location === "Guiding Lands" && g.node?.includes(" - ") ? g.node.split(" - ")[0] : "";
  return region ? `Guiding Lands ${region}` : g.location;
}

/** "Wildspire Waste, Ancient Forest"; Guiding Lands places add their lowest region level. */
function gatherSource(item) {
  const { rank, rows } = rowsOfItemRank(item, item.sources?.gathering || []);
  if (!rows.length) {
    const described = describedGathering(item);
    return described ? { label: "Gather", rank: itemRank(item), text: described } : null;
  }
  const places = new Map();
  for (const g of rows) {
    const lv = Number(g.node?.match(/Lv(\d)/)?.[1]) || 0;
    const place = gatherPlace(g);
    places.set(place, places.has(place) ? Math.min(places.get(place), lv) : lv);
  }
  const list = [...places].map(([place, lv]) => (lv ? `${place} Lv${lv}+` : place));
  return { label: "Gather", rank, text: list.join(", ") };
}

/** "Ancient Forest 61%, Wildspire Waste 61%". */
function safariSource(item) {
  const { rank, rows } = rowsOfItemRank(item, item.sources?.safari || []);
  if (!rows.length) return null;
  return { label: "Safari", rank, text: rows.map((s) => `${s.map} ${s.chance}%`).join(", ") };
}

/** Where to get an item as parts of { label, rank, text }; label and rank may be null. */
function sourceParts(item) {
  const s = item?.sources || {};
  const parts = [monsterSource(item), gatherSource(item)].filter(Boolean);
  if (parts.length) return parts;
  const safari = safariSource(item);
  if (safari) return [safari];
  const q = s.quests?.[0];
  if (q) return [{ label: q.category === "event" ? "Event quest" : "Quest", rank: q.rank, text: `${q.quest} ★${q.stars} ${q.chance}%` }];
  const c = s.combine?.[0];
  if (c) return [{ label: "Combine", rank: null, text: c.from.map((f) => f.name).join(" + ") }];
  return [describedSource(item) || { label: null, rank: null, text: "No drop or gathering data, see details" }];
}

const rankTagHtml = (r) => (r ? `<span class="rank-tag rank-${r.toLowerCase()}">${r}</span>` : "");

/** One source part as HTML; the rank tag is left out when the summary already shows it. */
function sourcePartHtml(p, showRank = true) {
  const label = p.label ? `<span class="src-label">${escapeHtml(p.label)}${showRank ? rankTagHtml(p.rank) : ""}:</span> ` : "";
  return `${label}${escapeHtml(p.text)}${!p.label && showRank ? rankTagHtml(p.rank) : ""}`;
}

/** One-line "where do I get this" for list rows; a rank shared by every part leads the line once. */
function sourceSummaryHtml(item) {
  const parts = sourceParts(item);
  const ranks = new Set(parts.map((p) => p.rank).filter(Boolean));
  const shared = ranks.size === 1 && parts.every((p) => p.rank) ? [...ranks][0] : null;
  const body = parts.map((p) => sourcePartHtml(p, !shared)).join(`<span class="src-sep"> · </span>`);
  return shared ? `<span class="src-lead">${rankTagHtml(shared)}</span>${body}` : body;
}

async function renderMaterialsModal(q, cats, pane, extra, seq) {
  let data;
  try {
    data = await materialsData();
  } catch (err) {
    pane.innerHTML = `<p class="hint error">${escapeHtml(err.message)}</p>`;
    return;
  }
  if (seq !== modalRenderSeq) return;
  if (!data.available) {
    pane.innerHTML = `<p class="hint">Material data isn't installed. Run <code>python tools/dump/build_materials.py</code> and restart.</p>`;
    return;
  }
  const m = state.modal;
  if (q !== m.lastQ) {
    m.item = null;
    m.lastQ = q;
  }

  const tabs = [
    { key: ALL_TAB, html: "Whole set" },
    ...(data.weapon ? [{ key: MAT_WEAPON_TAB, html: `${weaponIcon(data.weapon.type, data.weapon.rarity, { size: 14 })} ${escapeHtml(data.weapon.name)}` }] : []),
    ...data.pieces.map((p) => ({ key: `p${p.id}`, html: `${armorIcon(p.slot, p.rarity, { size: 14 })} ${escapeHtml(p.name)}` })),
    ...(data.charm ? [{ key: MAT_CHARM_TAB, html: `${armorIcon("charm", data.charm.rarity, { size: 14 })} ${escapeHtml(data.charm.name)}` }] : []),
  ];
  if (!tabs.some((t) => t.key === m.category)) m.category = ALL_TAB;
  for (const t of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cat-btn" + (t.key === m.category ? " active" : "");
    btn.innerHTML = t.html;
    btn.onclick = () => {
      m.item = null;
      setModalCategory(t.key);
    };
    cats.appendChild(btn);
  }

  const recipes = materialRecipes(data, m.category);
  const totals = totalMaterials(recipes, data.items);
  if (m.item != null && data.items[m.item]) {
    renderMaterialDetail(pane, data.items[m.item], totals.find((t) => t.id === m.item));
    return;
  }

  const zenny = recipes.reduce((sum, r) => sum + (r.zenny || 0), 0);
  const noRecipe = recipes.filter((r) => !r.items);
  extra.innerHTML = `<span class="hint">Click a material to see where it comes from</span>`;
  const head = document.createElement("div");
  head.className = "mat-summary";
  head.innerHTML = `
    <span>Forging cost <strong>${zennyText(zenny)}</strong></span>
    <span>${totals.length} material${totals.length === 1 ? "" : "s"}</span>
    ${m.category === ALL_TAB && data.weapon?.steps.length > 1 ? `<span class="hint">Weapon counts every upgrade from ${escapeHtml(data.weapon.steps[0].name)}</span>` : ""}
    ${m.category === ALL_TAB && data.charm?.ranks.length > 1 ? `<span class="hint">Charm counts every upgrade from rank I</span>` : ""}`;
  pane.appendChild(head);
  const weaponNote = [ALL_TAB, MAT_WEAPON_TAB].includes(m.category) ? weaponPathNote(data.weapon) : null;
  if (weaponNote) {
    const warn = document.createElement("div");
    warn.className = "mat-warning";
    warn.innerHTML = `<strong>Weapon materials not counted</strong><span>${escapeHtml(weaponNote)}</span>`;
    pane.appendChild(warn);
  }
  const tabPieces = data.pieces.filter((p) => m.category === ALL_TAB || m.category === `p${p.id}`);
  const unobtainable = new Map();
  for (const p of tabPieces) {
    const note = unobtainableNote(p.set);
    if (note) unobtainable.set(note, [...(unobtainable.get(note) || []), p.name]);
  }
  for (const [note, names] of unobtainable) {
    const warn = document.createElement("div");
    warn.className = "mat-warning";
    warn.innerHTML = `<strong>Can't be earned in game: ${escapeHtml(names.join(", "))}</strong><span>${escapeHtml(note)}</span>`;
    pane.appendChild(warn);
  }
  const gifts = new Map();
  for (const p of tabPieces) {
    const gift = giftArmor(p.set, p.name);
    if (gift) gifts.set(gift, [...(gifts.get(gift) || []), p.name]);
  }
  for (const [gift, names] of gifts) {
    const info = document.createElement("div");
    info.className = "mat-warning mat-info";
    info.innerHTML = `<strong>${escapeHtml(gift.tag)}: ${escapeHtml(names.join(", "))}</strong><span>${escapeHtml(gift.note)}</span>`;
    pane.appendChild(info);
  }
  const charmSrc = [ALL_TAB, MAT_CHARM_TAB].includes(m.category) && data.charm ? charmSource(data.charm.name) : null;
  if (charmSrc) {
    const info = document.createElement("div");
    info.className = "mat-warning mat-info";
    info.innerHTML = `<strong>${escapeHtml(charmSrc.tag)}: ${escapeHtml(data.charm.name)}</strong>
      <span>${escapeHtml(charmSrc.title)}</span>
      ${charmSrc.lines.map((l) => `<span>${escapeHtml(l)}</span>`).join("")}`;
    pane.appendChild(info);
  }
  const giftNames = new Set([...gifts.values()].flat());
  if (charmSrc) giftNames.add(data.charm.name);
  const unexplained = noRecipe.filter((r) => !giftNames.has(r.label));
  if (unexplained.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = `No forge recipe in the game data for ${unexplained.map((r) => r.label).join(", ")} (reward, event or DLC gear).`;
    pane.appendChild(p);
  }

  const groups = m.category === MAT_CHARM_TAB || m.category === MAT_WEAPON_TAB
    ? recipes.map((r) => ({ title: `${r.label} · ${zennyText(r.zenny)}`, rows: totalMaterials([r], data.items) }))
    : [{ title: null, rows: totals }];
  let shown = 0;
  for (const g of groups) {
    const rows = g.rows.filter((t) => !q || String(data.items[t.id]?.name || "").toLowerCase().includes(q));
    if (!rows.length) continue;
    if (g.title) {
      const h = document.createElement("div");
      h.className = "mat-group-title";
      h.textContent = g.title;
      pane.appendChild(h);
    }
    for (const t of rows) {
      const item = data.items[t.id] || { name: `Item ${t.id}`, rarity: 1 };
      const row = document.createElement("button");
      row.type = "button";
      row.className = "pick-row mat-row";
      row.innerHTML = `
        <span class="pick-with-ico">
          ${itemIcon(item.icon, item.color, { size: 28 })}
          <span class="mat-text">
            <span class="mat-name" style="color:${rarityColor(item.rarity)}">${escapeHtml(item.name)}</span>
            <span class="sub">${sourceSummaryHtml(item)}</span>
          </span>
        </span>
        <span class="mat-qty">×${t.quantity}</span>`;
      row.onclick = () => {
        m.item = t.id;
        renderModal();
      };
      pane.appendChild(row);
      shown++;
    }
  }
  if (!shown && totals.length) {
    pane.insertAdjacentHTML("beforeend", `<p class="hint">No material matches “${escapeHtml($("modalSearch").value.trim())}”.</p>`);
  }
}

function renderMaterialDetail(pane, item, total) {
  const s = item.sources || {};
  const section = (title, body) => (body ? `<section class="mat-section"><h4>${title}</h4>${body}</section>` : "");
  const pct = (n) => `<span class="mat-pct">${n}%</span>`;
  const stack = (n) => (n > 1 ? ` ×${n}` : "");
  const rankTag = rankTagHtml;

  const uses = total?.uses.length
    ? `<ul class="mat-uses">${total.uses.map((u) => `<li><span>${escapeHtml(u.label)}</span><span class="mat-qty">×${u.quantity}</span></li>`).join("")}</ul>`
    : "";
  const monsters = monstersByItemRank(item).map((mo) => `
    <div class="mat-src">
      <div class="mat-src-head"><strong>${escapeHtml(mo.monster)}</strong>${rankTag(mo.rank)}</div>
      <div class="mat-drops">${mo.drops.map(([cond, p, n]) => `<span class="mat-drop">${escapeHtml(cond)}${stack(n)} ${pct(p)}</span>`).join("")}</div>
    </div>`).join("");
  const described = describedGathering(item);
  const gathering = (s.gathering || []).map((g) => `
    <div class="mat-line">
      <span><strong>${escapeHtml(g.location)}</strong>${g.node ? ` · ${escapeHtml(g.node)}` : ""}${g.area ? ` · area ${g.area}` : ""}${g.nodes > 1 ? ` · ${g.nodes} nodes` : ""}${rankTag(g.rank)}</span>
      <span>${stack(g.stack)} ${pct(g.chance)}</span>
    </div>`).join("") || (described
    ? `<div class="mat-line"><span><strong>${escapeHtml(described)}</strong>${rankTag(itemRank(item))}</span></div>
      <p class="hint">From the item description. Node areas and rates for this material aren't in the data.</p>`
    : "");
  const safari = (s.safari || []).map((sa) => `
    <div class="mat-line">
      <span><strong>${escapeHtml(sa.map)}</strong>${rankTag(sa.rank)}</span>
      <span>${stack(sa.stack)} ${pct(sa.chance)}</span>
    </div>`).join("");
  const origin = item.sources ? null : describedSource(item);
  const quests = (s.quests || []).map((qu) => `
    <div class="mat-line">
      <span><strong>${escapeHtml(qu.quest)}</strong> · ★${qu.stars} ${escapeHtml(qu.category || "")}${rankTag(qu.rank)}</span>
      <span>${stack(qu.stack)} ${pct(qu.chance)}</span>
    </div>`).join("");
  const combine = (s.combine || []).map((c) => `
    <div class="mat-line"><span>${c.from.map((f) => escapeHtml(f.name)).join(" + ")}</span><span>→ ×${c.quantity}</span></div>`).join("");

  pane.innerHTML = `
    <button type="button" class="btn small ghost mat-back">← All materials</button>
    <div class="mat-detail-head">
      ${itemIcon(item.icon, item.color, { size: 48 })}
      <div>
        <h3 style="color:${rarityColor(item.rarity)}">${escapeHtml(item.name)}</h3>
        <div class="sub">Rarity ${item.rarity}${total ? ` · need ×${total.quantity}` : ""}</div>
      </div>
    </div>
    ${item.description ? `<p class="mat-desc">${escapeHtml(item.description)}</p>` : ""}
    ${section("Needed for", uses)}
    ${section("Monster drops", monsters)}
    ${section("Gathering", gathering)}
    ${section("Tailraider Safari", safari)}
    ${section("Quest rewards", quests)}
    ${section("Combine", combine)}
    ${section("Where to get it", origin ? `<div class="mat-line"><span>${sourcePartHtml(origin)}</span></div>` : "")}
    ${item.sources || described ? "" : `<p class="hint">No drop, gathering or quest data for this item${origin ? ", so this comes from its description" : ". The description above says where it comes from"}.</p>`}`;
  pane.querySelector(".mat-back").onclick = () => {
    state.modal.item = null;
    renderModal();
  };
  pane.scrollTop = 0;
}
