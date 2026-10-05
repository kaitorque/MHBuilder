/* Monsters modal: large monster weaknesses, roar / wind / tremor and ailments (data/monsters.json). */

let monstersRequest = null;
const MONSTER_CLASSES = ["Elder Dragon", "Flying Wyvern", "Brute Wyvern", "Fanged Wyvern", "Bird Wyvern", "Piscine Wyvern", "Fanged Beast", "Relict"];
const MONSTER_ELEMENTS = ["fire", "water", "thunder", "ice", "dragon"];
/** Paired with MONSTER_ELEMENTS by index: each list column stacks an element over a status, like the Hunter's Notes. */
const MONSTER_STATUSES = ["poison", "sleep", "paralysis", "blast", "stun"];

/** A counter is a skill id at the level that negates the threat, or a set effect by name. */
const skillAt = (skill, level) => ({ skill, level });
const MONSTER_THREATS = {
  roar: { label: "Roar", levels: { small: { text: "Weak", counter: skillAt(11, 3) }, large: { text: "Strong", counter: skillAt(11, 5) } } },
  wind: {
    label: "Wind",
    levels: {
      small: { text: "Minor", counter: skillAt(12, 3) },
      large: { text: "Major", counter: skillAt(12, 5) },
      extreme: {
        text: "Dragon",
        note: "Dragon-level wind pressure, above major. Windproof 5 only negates minor and major.",
        counter: { effect: "Nullify Wind Pressure" },
      },
    },
  },
  tremor: { label: "Tremor", levels: { small: { text: "Minor", counter: skillAt(13, 1) }, large: { text: "Major", counter: skillAt(13, 3) } } },
};

/** Elemental blights are also prevented by 20+ resistance of that element; the resistance skill's level 3 adds +20. */
const elementBlight = (element, resistSkill, effect) => ({
  label: `${element}blight`,
  counter: skillAt(29, 3),
  effect,
  resist: { note: `${element} resistance 20 or higher also prevents it.`, counter: skillAt(resistSkill, 3) },
});

const MONSTER_AILMENTS = {
  fireblight: elementBlight("Fire", 24, "Burns you over time. Roll three times or step into water to put it out."),
  waterblight: elementBlight("Water", 25, "Stamina recovers much more slowly."),
  thunderblight: elementBlight("Thunder", 27, "You get stunned much more easily."),
  iceblight: elementBlight("Ice", 26, "Actions use more stamina."),
  dragonblight: elementBlight("Dragon", 28, "Seals your weapon's element and status."),
  blastblight: { label: "Blastblight", counter: skillAt(6, 3), effect: "Explodes after a while or when you're hit. Roll three times to shake it off." },
  poison: { label: "Poison", counter: skillAt(1, 3), effect: "Drains health over time. An Antidote or Nulberry cures it." },
  sleep: { label: "Sleep", counter: skillAt(3, 3), effect: "Puts you to sleep." },
  paralysis: { label: "Paralysis", counter: skillAt(2, 3), effect: "Paralyzes you for a moment." },
  bleed: { label: "Bleeding", counter: skillAt(7, 3), effect: "Moving drains health. Crouch or stand still to stop it." },
  stun: { label: "Stun", counter: skillAt(4, 3), effect: "Dazes you after heavy hits." },
  defensedown: { label: "Defense Down", counter: skillAt(8, 3), effect: "Lowers your defense for a while." },
  mud: { label: "Mud", counter: skillAt(5, 1), effect: "Mud slows your movement and dodges." },
  effluvia: { label: "Effluvium", counter: skillAt(116, 3), effect: "Builds up and lowers your maximum health. A Nulberry clears it." },
  regional: { label: "Snowman", counter: null, effect: "Thrown snow can turn you into a snowman in Hoarfrost Reach. Struggle free or get hit by a teammate." },
};

function monstersData() {
  monstersRequest ||= api("/api/monsters").catch((err) => {
    monstersRequest = null;
    throw err;
  });
  return monstersRequest;
}

const monsterDropsCache = new Map();
const RANK_NAMES = { LR: "Low Rank", HR: "High Rank", MR: "Master Rank" };

function monsterDrops(name) {
  if (!monsterDropsCache.has(name)) {
    monsterDropsCache.set(name, api(`/api/monsters/drops?name=${encodeURIComponent(name)}`).catch((err) => {
      monsterDropsCache.delete(name);
      throw err;
    }));
  }
  return monsterDropsCache.get(name);
}

function openMonsters() {
  openModal("monsters", "Monsters", { monster: null, sort: null, lastQ: "", dropRank: null });
}

/** ★★☆ for 0-3 stars; 0 is an ✕ like the Hunter's Notes. */
function monsterStarsHtml(n) {
  if (!n) return `<span class="mon-x">✕</span>`;
  return `<span class="mon-star">${"★".repeat(n)}</span><span class="mon-star off">${"★".repeat(3 - n)}</span>`;
}

const starText = (n) => (n ? "★".repeat(n) : "✕");

/** The picker skill behind a counter and the wanted level it needs (set effects are level 1). */
function counterSkill(c) {
  const k = c && (c.effect ? setEffectSkill(c.effect) : pickerSkill(c.skill));
  return k ? { k, level: k.setEffect ? 1 : c.level } : null;
}

/**
 * Counter line from the game's own text: "Earplugs 5: Nullifies weak and strong monster roars." or, for a set effect,
 * "Nullify Wind Pressure (Kushala Daora Flight, 3 pieces): Negates all wind pressure."
 */
function counterText(c) {
  const found = counterSkill(c);
  if (!found) return "";
  const { k, level } = found;
  if (k.setEffect) {
    const set = k.sets?.[0];
    return `${k.name}${set ? ` (${set.name}, ${set.parts} pieces)` : ""}: ${k.description}`;
  }
  const d = k.levelDescriptions?.[level - 1];
  return `${k.name} ${level}${d ? `: ${d}` : ""}`;
}

function threatInfo(kind, value) {
  const t = MONSTER_THREATS[kind];
  const lv = t.levels[value];
  if (!lv) return null;
  return { ...lv, label: t.label, tip: [`${lv.text} ${t.label.toLowerCase()}`, lv.note, counterText(lv.counter)].filter(Boolean).join("\n") };
}

const resistText = (a) => (a.resist ? `${a.resist.note} ${counterText(a.resist.counter)}` : "");

function ailmentTip(a) {
  return [a.label, a.effect, counterText(a.counter), resistText(a)].filter(Boolean).join("\n");
}

function elementStarsHtml(m, e) {
  const n = m.element[e];
  const alt = m.alt?.element[e];
  const label = ELEMENT_META[e].label;
  if (alt == null || alt === n) return `<span class="mon-el" title="${label} ${starText(n)}">${monsterStarsHtml(n)}</span>`;
  const tip = `${label}\n${m.alt.baseLabel || "Normal"}: ${starText(n)}\n${m.alt.label}: ${starText(alt)}`;
  return `<span class="mon-el has-alt" title="${escapeHtml(tip)}">${monsterStarsHtml(n)}<span class="mon-alt">${alt > n ? "▲" : "▼"}${starText(alt)}</span></span>`;
}

function weakCellHtml(m, i) {
  const s = MONSTER_STATUSES[i];
  return `<span class="mon-cell mon-pair">${elementStarsHtml(m, MONSTER_ELEMENTS[i])}<span class="mon-st" title="${STATUS_META[s].label} ${starText(m.status[s])}">${monsterStarsHtml(m.status[s])}</span></span>`;
}

function threatCellHtml(m, kind) {
  const info = threatInfo(kind, m[kind]);
  if (!info) return `<span class="mon-cell mon-none">—</span>`;
  return `<span class="mon-cell mon-threat lv-${m[kind]}" title="${escapeHtml(info.tip)}"><span class="mon-lbl">${info.label}</span>${info.text}</span>`;
}

function ailmentChipsHtml(m) {
  if (!m.ailments.length) return `<span class="mon-none">—</span>`;
  return m.ailments
    .map((k) => MONSTER_AILMENTS[k])
    .filter(Boolean)
    .map((a) => `<span class="mon-ail" title="${escapeHtml(ailmentTip(a))}">${escapeHtml(a.label)}</span>`)
    .join("");
}

function monsterMatches(m, q) {
  if (!q) return true;
  const ailments = m.ailments.map((k) => MONSTER_AILMENTS[k]?.label || k);
  return [m.name, m.ecology, m.alt?.label, ...ailments].some((t) => String(t || "").toLowerCase().includes(q));
}

async function renderMonstersModal(q, cats, pane, extra, seq) {
  let data;
  try {
    data = await monstersData();
  } catch (err) {
    pane.innerHTML = `<p class="hint error">${escapeHtml(err.message)}</p>`;
    return;
  }
  if (seq !== modalRenderSeq) return;
  const all = data.monsters || [];
  if (!all.length) {
    pane.innerHTML = `<p class="hint">Monster data isn't installed. Run <code>python tools/dump/build_monsters.py</code> and restart.</p>`;
    return;
  }
  const m = state.modal;
  if (q !== m.lastQ) {
    m.monster = null;
    m.lastQ = q;
  }

  const classes = MONSTER_CLASSES.filter((c) => all.some((x) => x.ecology === c));
  const tabs = [ALL_TAB, ...classes, ...new Set(all.map((x) => x.ecology).filter((c) => !classes.includes(c)))];
  if (!tabs.includes(m.category)) m.category = ALL_TAB;
  for (const t of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cat-btn" + (t === m.category ? " active" : "");
    btn.textContent = t === ALL_TAB ? "All monsters" : t;
    btn.onclick = () => {
      m.monster = null;
      setModalCategory(t);
    };
    cats.appendChild(btn);
  }

  const selected = all.find((x) => x.name === m.monster);
  if (selected) {
    renderMonsterDetail(pane, selected);
    return;
  }

  extra.innerHTML = `<span class="hint">Hover a cell for details · click a weakness header to sort · click a monster for more</span>`;
  let list = all.filter((x) => (m.category === ALL_TAB || x.ecology === m.category) && monsterMatches(x, q));
  if (m.sort) {
    const base = (x) => x.element[m.sort] ?? x.status[m.sort] ?? 0;
    const best = (x) => Math.max(base(x), x.alt?.element[m.sort] ?? 0);
    list = [...list].sort((a, b) => best(b) - best(a) || base(b) - base(a));
  }
  if (!list.length) {
    pane.innerHTML = `<p class="hint">No monster matches “${escapeHtml($("modalSearch").value.trim())}”.</p>`;
    return;
  }

  const sortBtn = (k, label, icon) =>
    `<button type="button" class="mon-sort${m.sort === k ? " active" : ""}" data-sort="${k}" title="Sort by ${label.toLowerCase()} weakness">${icon}</button>`;
  const head = document.createElement("div");
  head.className = "mon-row mon-head";
  head.innerHTML = `
    <span class="mon-name-col">Monster</span>
    ${MONSTER_ELEMENTS.map((e, i) => {
      const s = MONSTER_STATUSES[i];
      return `<span class="mon-pair">${sortBtn(e, ELEMENT_META[e].label, elementIcon(e, { size: 18 }))}${sortBtn(s, STATUS_META[s].label, statusIcon(s, { size: 18 }))}</span>`;
    }).join("")}
    <span class="mon-extra"><span title="Earplugs">Roar</span><span title="Windproof">Wind</span><span title="Tremor Resistance">Tremor</span><span>Inflicts</span></span>`;
  head.onclick = (e) => {
    const btn = e.target.closest("[data-sort]");
    if (!btn) return;
    m.sort = m.sort === btn.dataset.sort ? null : btn.dataset.sort;
    renderModal();
  };
  pane.appendChild(head);

  for (const x of list) {
    const row = document.createElement("div");
    row.className = "mon-row";
    row.tabIndex = 0;
    row.innerHTML = `
      <span class="mon-name-col">
        ${monsterIconHtml(x, 30)}
        <span class="mon-title"><strong>${escapeHtml(x.name)}</strong><span class="sub">${escapeHtml(x.ecology)}</span></span>
      </span>
      ${MONSTER_ELEMENTS.map((_, i) => weakCellHtml(x, i)).join("")}
      <span class="mon-extra">${threatCellHtml(x, "roar")}${threatCellHtml(x, "wind")}${threatCellHtml(x, "tremor")}<span class="mon-ails">${ailmentChipsHtml(x)}</span></span>`;
    const open = () => {
      m.monster = x.name;
      renderModal();
    };
    row.onclick = open;
    row.onkeydown = (e) => {
      if (e.key === "Enter") open();
    };
    pane.appendChild(row);
  }
}

function monsterIconHtml(m, size) {
  return m.icon
    ? `<img class="mon-icon" src="/icons/monsters/${encodeURIComponent(m.icon)}" width="${size}" height="${size}" alt="" loading="lazy" />`
    : `<span class="mon-icon" style="width:${size}px;height:${size}px"></span>`;
}

/** Button that adds a counter to the wanted skills at the level that negates the threat. */
function counterButtonHtml(c) {
  const found = counterSkill(c);
  if (!found) return "";
  const { k, level } = found;
  const have = state.wanted.find((w) => w.id === k.id)?.level || 0;
  if (have >= level) return `<span class="pick-badge wanted">In your skills</span>`;
  return `<button type="button" class="btn small ghost" data-add-skill="${k.id}" data-level="${level}">Add ${escapeHtml(k.name)}${k.setEffect ? "" : ` ${level}`}</button>`;
}

function renderMonsterDetail(pane, m) {
  const section = (title, body) => (body ? `<section class="mat-section"><h4>${title}</h4>${body}</section>` : "");
  const starRow = (label, stars, keys) => `
    <div class="mon-weak-row"><span class="mon-weak-label">${escapeHtml(label)}</span>${keys.map((k) => `<span class="mon-cell">${monsterStarsHtml(stars[k])}</span>`).join("")}</div>`;

  const weakness = `
    <div class="mon-weak">
      <div class="mon-weak-row mon-weak-head"><span></span>${MONSTER_ELEMENTS.map((e) => `<span title="${ELEMENT_META[e].label}">${elementIcon(e, { size: 20 })}</span>`).join("")}</div>
      ${starRow(m.alt?.baseLabel || "Normal", m.element, MONSTER_ELEMENTS)}
      ${m.alt ? starRow(m.alt.label, m.alt.element, MONSTER_ELEMENTS) : ""}
      <div class="mon-weak-row mon-weak-head mon-st-head"><span></span>${MONSTER_STATUSES.map((s) => `<span title="${STATUS_META[s].label}">${statusIcon(s, { size: 20 })}</span>`).join("")}</div>
      ${starRow("Status", m.status, MONSTER_STATUSES)}
    </div>`;

  const threats = Object.keys(MONSTER_THREATS).map((kind) => {
    const info = threatInfo(kind, m[kind]);
    const t = MONSTER_THREATS[kind];
    if (!info) return `<div class="mon-line"><span><strong>${t.label}</strong> <span class="mon-none">none</span></span></div>`;
    return `
      <div class="mon-line">
        <span><strong>${t.label}</strong> <span class="mon-threat lv-${m[kind]}">${info.text}</span>
          ${info.note ? `<span class="mon-line-sub">${escapeHtml(info.note)}</span>` : ""}
          <span class="mon-line-sub">${escapeHtml(counterText(info.counter))}</span></span>
        ${counterButtonHtml(info.counter)}
      </div>`;
  }).join("");

  const ailments = m.ailments.map((k) => MONSTER_AILMENTS[k]).filter(Boolean).map((a) => `
    <div class="mon-line">
      <span><strong>${escapeHtml(a.label)}</strong> <span class="mon-line-sub">${escapeHtml(a.effect)}</span>
        ${a.counter ? `<span class="mon-line-sub">${escapeHtml(counterText(a.counter))}</span>` : ""}
        ${a.resist ? `<span class="mon-line-sub">${escapeHtml(resistText(a))}</span>` : ""}</span>
      <span class="mon-line-btns">${counterButtonHtml(a.counter)}${a.resist ? counterButtonHtml(a.resist.counter) : ""}</span>
    </div>`).join("");

  const tips = [m.tip, ...(m.notes || [])].filter(Boolean).map((t, i) =>
    `<p class="mon-tip">${i === 0 && m.tip ? `<span class="mon-tip-src">In-game tip</span>` : ""}${escapeHtml(t)}</p>`).join("");
  const traps = m.traps.pitfall || m.traps.shock
    ? ["pitfall", "shock"].map((t) => `<span class="mon-trap${m.traps[t] ? "" : " off"}">${t === "pitfall" ? "Pitfall Trap" : "Shock Trap"} ${m.traps[t] ? "works" : "doesn't work"}</span>`).join("")
    : `<span class="mon-trap off">Can't be trapped</span>`;

  pane.innerHTML = `
    <button type="button" class="btn small ghost mat-back">← All monsters</button>
    <div class="mat-detail-head">
      ${monsterIconHtml(m, 56)}
      <div>
        <h3>${escapeHtml(m.name)}</h3>
        <div class="sub">${escapeHtml(m.ecology)}${m.habitats.length ? ` · ${escapeHtml(m.habitats.join(", "))}` : ""}</div>
      </div>
    </div>
    ${m.description ? `<p class="mat-desc">${escapeHtml(m.description)}</p>` : ""}
    ${section("Weakness", weakness)}
    ${section("Roar, wind and tremor", threats)}
    ${section("Inflicts", ailments || `<p class="hint">No ailments.</p>`)}
    ${section("Tips", tips)}
    ${section("Traps", `<div class="mon-traps">${traps}</div>`)}
    ${section("Drops", `<div class="mon-drops"><p class="hint">Loading drops…</p></div>`)}`;
  fillMonsterDrops(pane.querySelector(".mon-drops"), m);
  pane.querySelector(".mat-back").onclick = () => {
    state.modal.monster = null;
    renderModal();
  };
  for (const btn of pane.querySelectorAll("[data-add-skill]")) {
    btn.onclick = () => {
      const k = pickerSkill(Number(btn.dataset.addSkill));
      if (!k) return;
      setWantedLevel(k, Number(btn.dataset.level));
      renderWanted();
      renderModal();
    };
  }
  pane.scrollTop = 0;
}

/** Drop table per rank; the chosen rank sticks while browsing other monsters (defaults to the highest). */
async function fillMonsterDrops(box, m) {
  let ranks;
  try {
    ranks = (await monsterDrops(m.name)).ranks || [];
  } catch (err) {
    box.innerHTML = `<p class="hint error">${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!box.isConnected) return;
  if (!ranks.length) {
    box.innerHTML = `<p class="hint">No drop data for this monster.</p>`;
    return;
  }
  const itemHtml = (it) => `
    <div class="mat-src">
      <div class="mat-src-head">${itemIcon(it.icon, it.color, { size: 22 })}<strong style="color:${rarityColor(it.rarity)}">${escapeHtml(it.name)}</strong></div>
      <div class="mat-drops">${it.drops.map(([cond, pct, n]) => `<span class="mat-drop">${escapeHtml(cond)}${n > 1 ? ` ×${n}` : ""} <span class="mat-pct">${pct}%</span></span>`).join("")}</div>
    </div>`;
  const draw = () => {
    const sel = ranks.find((r) => r.rank === state.modal.dropRank) || ranks[ranks.length - 1];
    box.innerHTML = `
      <div class="toggle-group mon-rank-tabs">${ranks.map((r) => `<button type="button" class="toggle${r === sel ? " on" : ""}" data-rank="${r.rank}">${RANK_NAMES[r.rank] || r.rank}</button>`).join("")}</div>
      ${sel.items.map(itemHtml).join("")}`;
    for (const btn of box.querySelectorAll("[data-rank]")) {
      btn.onclick = () => {
        state.modal.dropRank = btn.dataset.rank;
        draw();
      };
    }
  };
  draw();
}
