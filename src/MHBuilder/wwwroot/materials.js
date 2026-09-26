/* Materials modal: what a set costs to forge and where each material comes from (data/materials.json). */

const MAT_CHARM_TAB = "Charm";
const MAT_WEAPON_TAB = "Weapon";
const materialsCache = new Map();
const SIEGE_SOURCES = {
  Kulve: "a Kulve Taroth Siege reward",
  Safi: "a Safi'jiiva Siege reward",
};

/** pieces: armor objects with an id (builder pieces or result pieces); charm: { id, level } or null; weaponId: catalog weapon or null. */
function openMaterials(title, pieces, charm, weaponId = null) {
  const armorIds = pieces.filter((p) => p?.id).map((p) => p.id);
  const charmSel = charm?.id ? { id: charm.id, level: charm.level } : null;
  if (!armorIds.length && !charmSel && !weaponId) return;
  openModal("materials", title, { armorIds, charm: charmSel, weaponId, category: ALL_TAB, item: null, lastQ: "" });
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

/** Monsters with the item's own rank first (rarity 1-4 LR, 5-8 HR, 9+ MR); MR variants also drop many HR items. */
function monstersByItemRank(item) {
  const list = item?.sources?.monsters || [];
  const rank = item.rarity >= 9 ? "MR" : item.rarity >= 5 ? "HR" : "LR";
  return [...list.filter((m) => m.rank === rank), ...list.filter((m) => m.rank !== rank)];
}

/** One-line "where do I get this" for list rows. */
function bestSourceText(item) {
  const s = item?.sources;
  if (!s) return "No drop or gathering data · see details";
  const parts = [];
  const m = monstersByItemRank(item)[0];
  if (m) {
    const [condition, pct] = m.drops[0];
    const others = s.monsters.length - 1;
    parts.push(`${m.monster} · ${m.rank} · ${condition} ${pct}%${others > 0 ? ` (+${others} monster${others > 1 ? "s" : ""})` : ""}`);
  }
  const g = s.gathering?.[0];
  if (g) parts.push(`Gather in ${g.location}${m ? "" : ` · ${g.rank}${g.area ? ` · area ${g.area}` : ""}`}`);
  const q = s.quests?.[0];
  if (!parts.length && q) parts.push(`Quest reward · ${q.quest} (${q.rank} ★${q.stars}) ${q.chance}%`);
  const c = s.combine?.[0];
  if (!parts.length && c) parts.push(`Combine ${c.from.map((f) => f.name).join(" + ")}`);
  return parts.join(" · ") || "See details";
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
  if (noRecipe.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = `No forge recipe in the game data for ${noRecipe.map((r) => r.label).join(", ")} (reward, event or DLC gear).`;
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
            <span class="sub">${escapeHtml(bestSourceText(item))}</span>
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
  const rankTag = (r) => (r ? `<span class="rank-tag rank-${r.toLowerCase()}">${r}</span>` : "");

  const uses = total?.uses.length
    ? `<ul class="mat-uses">${total.uses.map((u) => `<li><span>${escapeHtml(u.label)}</span><span class="mat-qty">×${u.quantity}</span></li>`).join("")}</ul>`
    : "";
  const monsters = monstersByItemRank(item).map((mo) => `
    <div class="mat-src">
      <div class="mat-src-head"><strong>${escapeHtml(mo.monster)}</strong>${rankTag(mo.rank)}</div>
      <div class="mat-drops">${mo.drops.map(([cond, p, n]) => `<span class="mat-drop">${escapeHtml(cond)}${stack(n)} ${pct(p)}</span>`).join("")}</div>
    </div>`).join("");
  const gathering = (s.gathering || []).map((g) => `
    <div class="mat-line">
      <span><strong>${escapeHtml(g.location)}</strong>${g.area ? ` · area ${g.area}` : ""}${g.nodes > 1 ? ` · ${g.nodes} nodes` : ""}${rankTag(g.rank)}</span>
      <span>${stack(g.stack)} ${pct(g.chance)}</span>
    </div>`).join("");
  const quests = (s.quests || []).map((qu) => `
    <div class="mat-line">
      <span><strong>${escapeHtml(qu.quest)}</strong> · ★${qu.stars} ${escapeHtml(qu.category || "")}${rankTag(qu.rank)}</span>
      <span>${stack(qu.stack)} ${pct(qu.chance)}</span>
    </div>`).join("") + (s.moreQuests ? `<p class="hint">…and ${s.moreQuests} more quest${s.moreQuests > 1 ? "s" : ""} with lower odds.</p>` : "");
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
    ${section("Quest rewards", quests)}
    ${section("Combine", combine)}
    ${item.sources ? "" : `<p class="hint">No drop, gathering or quest data for this item. The description above says where it comes from.</p>`}`;
  pane.querySelector(".mat-back").onclick = () => {
    state.modal.item = null;
    renderModal();
  };
  pane.scrollTop = 0;
}
