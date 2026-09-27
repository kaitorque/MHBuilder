const state = {
  skills: [],
  skillCategories: [],
  weaponTypes: [],
  wanted: [],
  excludedSkills: [],
  build: loadBuild(),
  buildEval: null,
  lastSearchBody: null,
  more: null, // { key, loading, levels: Map<id, {level, maybeMore}>, error }
  weaponId: null,
  weaponName: null,
  weaponType: null,
  weaponRarity: null,
  weaponSlots: [],
  gender: "female",
  armorRarities: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  exclude: [],
  decoQty: {},
  decorations: [],
  unlimitedDecos: true,
  modal: null, // { kind, category }
};

const WEAPON_LABELS = {
  "great-sword": "Great Sword",
  "long-sword": "Long Sword",
  "sword-and-shield": "Sword & Shield",
  "dual-blades": "Dual Blades",
  hammer: "Hammer",
  "hunting-horn": "Hunting Horn",
  lance: "Lance",
  gunlance: "Gunlance",
  "switch-axe": "Switch Axe",
  "charge-blade": "Charge Blade",
  "insect-glaive": "Insect Glaive",
  bow: "Bow",
  "light-bowgun": "Light Bowgun",
  "heavy-bowgun": "Heavy Bowgun",
};

const $ = (id) => document.getElementById(id);

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function slotsLabel(slots) {
  if (!slots || !slots.length) return "—";
  return slots.join("-");
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const isWantedSkill = (id) => state.wanted.some((x) => x.id === id);
const isExcludedSkill = (id) => state.excludedSkills.some((x) => x.id === id);

/**
 * Level boxes [x]-[x]-[ ]; boxes past the soft cap need a Secret.
 * `avail` ({ level, maybeMore }) marks levels past what still fits as blocked (or unverified).
 */
function levelPipsHtml(s, level, avail = null) {
  if (s.setEffect) {
    return `<span class="lvl-pips"><span class="lvl-label">${level ? "On" : ""}</span><button type="button" class="pip${level ? " on" : ""}" data-level="1" title="${level ? "On" : "Off"}"></button></span>`;
  }
  const soft = s.baseMaxLevel ?? s.maxLevel;
  let html = `<span class="lvl-pips"><span class="lvl-label">${level ? `Lv ${level}` : ""}</span>`;
  for (let n = 1; n <= s.maxLevel; n++) {
    const secret = n > soft;
    const over = avail && n > avail.level && n > level;
    const cls = `pip${n <= level ? " on" : ""}${secret ? " secret" : ""}${over ? (avail.maybeMore ? " unverified" : " blocked") : ""}`;
    const tip = `Lv ${n}${secret ? " (needs Secret)" : ""}${over ? (avail.maybeMore ? " · not confirmed" : " · doesn't fit") : ""}`;
    html += `<button type="button" class="${cls}" data-level="${n}" title="${tip}"${over && !avail.maybeMore ? " disabled" : ""}></button>`;
  }
  return html + `</span>`;
}

async function openMoreSkills() {
  if (!state.lastSearchBody) return;
  const key = JSON.stringify(state.lastSearchBody);
  if (state.more?.key !== key || state.more.error) state.more = { key, loading: true };
  openModal("more", "More skills that fit");
  if (!state.more.loading) return;
  try {
    const data = await api("/api/search/more", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: key,
    });
    if (state.more?.key !== key) return;
    state.more = {
      key,
      loading: false,
      exhausted: data.budgetExhausted,
      levels: new Map(data.skills.map((s) => [s.id, { level: s.level, maybeMore: s.maybeMore }])),
    };
  } catch (err) {
    if (state.more?.key !== key) return;
    state.more = { key, loading: false, error: err.message };
  }
  if (state.modal?.kind === "more") renderModal();
}

function setWantedLevel(s, level) {
  state.excludedSkills = state.excludedSkills.filter((x) => x.id !== s.id);
  if (level <= 0) {
    state.wanted = state.wanted.filter((x) => x.id !== s.id);
    return;
  }
  const existing = state.wanted.find((x) => x.id === s.id);
  if (existing) {
    existing.level = Math.min(s.maxLevel, level);
    return;
  }
  state.wanted.push({
    id: s.id,
    name: s.name,
    level: Math.min(s.maxLevel, level),
    maxLevel: s.maxLevel,
    baseMaxLevel: s.baseMaxLevel ?? s.maxLevel,
    setEffect: !!s.setEffect,
  });
}

function toggleExcludedSkill(s) {
  if (isExcludedSkill(s.id)) {
    state.excludedSkills = state.excludedSkills.filter((x) => x.id !== s.id);
    return;
  }
  state.wanted = state.wanted.filter((x) => x.id !== s.id);
  state.excludedSkills.push({ id: s.id, name: s.name });
}

const SKILLS_STORAGE_KEY = "mhbuilder.skills.v1";

/** Wanted skills (with levels) and excluded skills, kept between visits. */
function loadSkillPrefs() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SKILLS_STORAGE_KEY) || "null");
  } catch {
    /* corrupt storage: keep defaults */
  }
  if (!saved) return;
  for (const w of Array.isArray(saved.wanted) ? saved.wanted : []) {
    const s = pickerSkill(w?.id);
    if (s && Number(w.level) > 0) setWantedLevel(s, Number(w.level));
  }
  for (const id of Array.isArray(saved.excluded) ? saved.excluded : []) {
    const s = pickerSkill(id);
    if (s && !isExcludedSkill(s.id)) toggleExcludedSkill(s);
  }
}

function saveSkillPrefs() {
  localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify({
    wanted: state.wanted.map(({ id, level }) => ({ id, level })),
    excluded: state.excludedSkills.map((s) => s.id),
  }));
}

function renderWanted() {
  saveSkillPrefs();
  const ul = $("wantedSkills");
  ul.innerHTML = "";
  for (const s of state.wanted) {
    const li = document.createElement("li");
    li.className = "chip chip-skill" + (s.setEffect ? " chip-set" : "");
    li.title = withDescription(
      s.setEffect
        ? `From any listed set (searcher picks a valid source)`
        : s.baseMaxLevel && s.baseMaxLevel < s.maxLevel
          ? `Soft cap ${s.baseMaxLevel}; ${s.maxLevel} needs Secret`
          : `Max ${s.maxLevel}`,
      pickerSkill(s.id),
      s.setEffect ? 0 : s.level
    );
    li.innerHTML = `<strong>${escapeHtml(s.name)}</strong>${levelPipsHtml(s, s.level)}
      <button type="button" class="chip-remove" aria-label="Remove">×</button>`;
    li.onclick = (e) => {
      const pip = e.target.closest(".pip");
      if (pip) {
        const lvl = Number(pip.dataset.level);
        setWantedLevel(s, s.level === lvl ? 0 : lvl);
      } else if (e.target.closest(".chip-remove")) {
        setWantedLevel(s, 0);
      } else {
        return;
      }
      renderWanted();
    };
    ul.appendChild(li);
  }

  const ex = $("excludedSkills");
  ex.innerHTML = "";
  for (const s of state.excludedSkills) {
    const li = document.createElement("li");
    li.className = "chip chip-excluded";
    li.title = "Excluded: results will not have this skill";
    li.innerHTML = `<span class="ex-mark" aria-hidden="true">⊘</span><strong>${escapeHtml(s.name)}</strong>
      <button type="button" aria-label="Stop excluding">×</button>`;
    li.querySelector("button").onclick = () => {
      toggleExcludedSkill(s);
      renderWanted();
    };
    ex.appendChild(li);
  }
  $("skillsClear").classList.toggle("hidden", !state.wanted.length && !state.excludedSkills.length);
  syncSkillAddables();
  scheduleBuildEvaluate();
}

async function clearSkills() {
  const wanted = state.wanted.length;
  const excluded = state.excludedSkills.length;
  if (!wanted && !excluded) return;
  const parts = [
    wanted ? `${wanted} wanted skill${wanted > 1 ? "s" : ""}` : "",
    excluded ? `${excluded} excluded skill${excluded > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  const ok = await confirmDialog({
    title: "Clear skills?",
    message: `This removes your ${parts.join(" and ")}. It can't be undone.`,
    confirmLabel: "Clear skills",
    danger: true,
  });
  if (!ok) return;
  state.wanted = [];
  state.excludedSkills = [];
  renderWanted();
  if (state.modal?.kind === "skill") renderModal();
}

/** Shown only on .addable pills. */
const ADD_ICON = materialIcon("add", 14, "add-ico");

function setBonusesHtml(list) {
  if (!list || !list.length) return `<span class="muted-dash">—</span>`;
  return list
    .map((g) => {
      const effects = (g.effects || [])
        .map((e) => {
          const cls = e.wanted ? " wanted" : " extra";
          const target = e.skillId
            ? `data-skill-id="${e.skillId}" data-skill-level="${e.level}" data-tip="${escapeHtml(withDescription(`${g.name} ${e.parts}pc: ${e.effect}`, pickerSkill(e.skillId)))}"`
            : `data-effect="${escapeHtml(e.effect)}"`;
          return `<span class="set-bonus-effect${cls}" ${target}><span class="set-bonus-parts">${e.parts}</span><span class="set-bonus-fx">${escapeHtml(e.effect)}</span>${ADD_ICON}</span>`;
        })
        .join("");
      const cardCls = g.wanted ? " wanted" : " extra";
      return `<div class="set-bonus-card${cardCls}">
        <div class="set-bonus-head">
          <span class="set-bonus-name">${escapeHtml(g.name)}</span>
          <span class="set-bonus-pc">${g.pieces}pc</span>
        </div>
        <div class="set-bonus-effects">${effects}</div>
      </div>`;
    })
    .join("");
}

function skillPillsHtml(skills) {
  if (!skills || !skills.length) return "";
  return skills
    .map((s) => {
      const soft = s.baseMaxLevel && s.baseMaxLevel < s.maxLevel && s.level > s.baseMaxLevel;
      const capped = s.maxLevel && s.level >= s.maxLevel ? " max" : "";
      const role = s.wanted ? " wanted" : " extra";
      const max = s.maxLevel ? `/${s.maxLevel}` : "";
      const levelHtml =
        s.wanted && s.bonusLevel > 0
          ? `<span class="skill-level">${s.wantedLevel}<span class="skill-bonus">+${s.bonusLevel}</span>${max}</span>`
          : `<span class="skill-level">${s.level}${max}</span>`;
      const status = s.wanted && s.bonusLevel > 0
        ? `${s.name}: wanted ${s.wantedLevel}, got ${s.level} (+${s.bonusLevel})`
        : s.wanted
          ? `${s.name}: wanted ${s.wantedLevel}`
          : `${s.name}: bonus / not requested`;
      const tip = withDescription(status, pickerSkill(s.id), s.level);
      return `<span class="skill-pill${role}${capped}" data-skill-id="${s.id}" data-skill-level="${s.level}" data-tip="${escapeHtml(tip)}" title="${escapeHtml(tip)}"><span class="skill-name">${escapeHtml(s.name)}</span>${levelHtml}${soft ? "<span class=\"skill-star\">★</span>" : ""}${ADD_ICON}</span>`;
    })
    .join("");
}

const pickerSkill = (id) => state.skills.find((k) => k.id === id);
const setEffectSkill = (name) => state.skills.find((k) => k.setEffect && k.name === name);

/** What the skill does, plus what `level` gives (level 0: every level). */
function skillDescription(k, level = 0) {
  if (!k) return "";
  const levels = k.levelDescriptions || [];
  const lines = k.description ? [k.description] : [];
  if (level > 0) {
    if (levels[level - 1]) lines.push(`Lv ${level}: ${levels[level - 1]}`);
  } else {
    levels.forEach((d, i) => d && lines.push(`Lv ${i + 1}: ${d}`));
  }
  return lines.join("\n");
}

const withDescription = (text, k, level) => [text, skillDescription(k, level)].filter(Boolean).join("\n\n");

/** Wanted-skill entries a set would give: its skills at their levels plus its active set effects. */
function skillsFromSet(skills, setBonuses) {
  const out = [];
  for (const s of skills || []) {
    const k = pickerSkill(s.id);
    if (k) out.push({ skill: k, level: Math.min(s.level, k.maxLevel) });
  }
  for (const e of (setBonuses || []).flatMap((g) => g.effects || [])) {
    const k = setEffectSkill(e.effect);
    if (k && !out.some((x) => x.skill.id === k.id)) out.push({ skill: k, level: 1 });
  }
  return out;
}

/** Mark skill pills / set effects that would add or raise a wanted skill as clickable. */
function syncSkillAddables() {
  for (const el of document.querySelectorAll("[data-skill-id]")) {
    const level = Number(el.dataset.skillLevel);
    const k = pickerSkill(Number(el.dataset.skillId));
    const have = state.wanted.find((w) => w.id === k?.id)?.level ?? 0;
    const addable = !!k && have < Math.min(level, k.maxLevel);
    el.classList.toggle("addable", addable);
    el.classList.toggle("wanted", have > 0);
    el.classList.toggle("extra", have === 0);
    el.title = addable
      ? withDescription(`${k.name}: click to ${have ? `raise wanted to Lv ${Math.min(level, k.maxLevel)}` : `add Lv ${Math.min(level, k.maxLevel)} to wanted skills`}`, k, level)
      : el.dataset.tip;
    el.tabIndex = addable ? 0 : -1;
    el.setAttribute("role", addable ? "button" : "none");
  }
  for (const el of document.querySelectorAll("[data-effect]")) {
    const k = setEffectSkill(el.dataset.effect);
    const addable = !!k && !isWantedSkill(k.id);
    el.classList.toggle("addable", addable);
    if (k) {
      el.classList.toggle("wanted", !addable);
      el.classList.toggle("extra", addable);
    }
    el.title = addable ? withDescription(`${k.name}: click to add to wanted skills`, k) : skillDescription(k);
    el.tabIndex = addable ? 0 : -1;
    el.setAttribute("role", addable ? "button" : "none");
  }
}

/** Click on an addable skill pill / set effect: add it (or raise it) in the wanted list. Returns true if handled. */
function onSkillAddClick(e) {
  const el = e.target.closest(".addable[data-skill-id], .addable[data-effect]");
  if (!el) return false;
  if (el.dataset.skillId) {
    const k = pickerSkill(Number(el.dataset.skillId));
    if (k) setWantedLevel(k, Math.min(Number(el.dataset.skillLevel), k.maxLevel));
  } else {
    const k = setEffectSkill(el.dataset.effect);
    if (k) setWantedLevel(k, 1);
  }
  renderWanted();
  return true;
}

function onSkillAddKey(e) {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".addable")) {
    e.preventDefault();
    onSkillAddClick(e);
  }
}

/** Replace the wanted list with a set's skills, confirming first when that would drop or change current picks. */
async function importSetSkills(skills, setBonuses, source) {
  const list = skillsFromSet(skills, setBonuses);
  if (!list.length) return;
  const unchanged = list.length === state.wanted.length
    && list.every(({ skill, level }) => state.wanted.find((w) => w.id === skill.id)?.level === level);
  if (unchanged) return;
  if (state.wanted.length) {
    const names = list.map(({ skill, level }) => (skill.setEffect ? skill.name : `${skill.name} ${level}`));
    const shown = names.length > 10 ? `${names.slice(0, 10).join(", ")} +${names.length - 10} more` : names.join(", ");
    const ok = await confirmDialog({
      title: "Replace wanted skills?",
      message: `Your ${state.wanted.length} wanted skill${state.wanted.length > 1 ? "s" : ""} will be replaced with the ${list.length} from ${source}: ${shown}.`,
      confirmLabel: "Replace skills",
      danger: true,
    });
    if (!ok) return;
  }
  state.wanted = [];
  for (const { skill, level } of list) setWantedLevel(skill, level);
  renderWanted();
}

/** Exclude-list entries are armor ({ key: "a:ID", id, slot }) or charm ranks ({ key: "c:ID:LEVEL", id, level, slot: "charm" }). */
const armorExcludeEntry = (a, slot = a.slot) => ({ key: `a:${a.id}`, id: a.id, name: a.name, slot });
const charmExcludeEntry = (c) => ({ key: `c:${c.id}:${c.level}`, id: c.id, level: c.level, name: c.name, slot: "charm" });
const isExcludedKey = (key) => state.exclude.some((x) => x.key === key);

function addExclude(entry) {
  if (!isExcludedKey(entry.key)) state.exclude.push(entry);
  savePrefs();
}

function removeExclude(key) {
  state.exclude = state.exclude.filter((x) => x.key !== key);
  savePrefs();
}

function resultExcludeEntry(loc, r) {
  if (loc === "charm") return r.charmInfo?.id ? charmExcludeEntry(r.charmInfo) : null;
  return r[loc]?.id ? armorExcludeEntry(r[loc], loc) : null;
}

let excludeSummarySeq = 0;
/** Sidebar summary: sets whose every piece is excluded count as one full set; the rest are tallied per slot. */
async function renderExclude() {
  syncResultActions();
  const seq = ++excludeSummarySeq;
  const el = $("excludeList");
  if (!state.exclude.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }

  const setPieces = new Map();
  try {
    const lists = await Promise.all(BUILD_ARMOR.map(armorForSlot));
    if (seq !== excludeSummarySeq) return;
    for (const a of lists.flat()) {
      if (!a.set || (a.gender && a.gender !== state.gender)) continue;
      if (!setPieces.has(a.set)) setPieces.set(a.set, []);
      setPieces.get(a.set).push(a.id);
    }
  } catch {
    /* armor list unavailable: fall back to per-slot counts only */
  }

  const armor = state.exclude.filter((x) => x.slot !== "charm");
  const excludedIds = new Set(armor.map((x) => x.id));
  const fullSets = [...setPieces].filter(([, ids]) => ids.length > 1 && ids.every((id) => excludedIds.has(id)));
  const inFullSet = new Set(fullSets.flatMap(([, ids]) => ids));
  const perSlot = Object.fromEntries(BUILD_ARMOR.map((k) => [k, 0]));
  for (const x of armor) {
    const k = String(x.slot).toLowerCase();
    if (!inFullSet.has(x.id) && k in perSlot) perSlot[k]++;
  }
  const charms = state.exclude.length - armor.length;

  const parts = [];
  if (fullSets.length) parts.push(`${fullSets.length} full set${fullSets.length > 1 ? "s" : ""}`);
  for (const k of BUILD_ARMOR) if (perSlot[k]) parts.push(`${BUILD_LABELS[k]} ${perSlot[k]}`);
  if (charms) parts.push(`Charm ${charms}`);

  const tip = [
    ...fullSets.map(([name]) => `${name} (full set)`),
    ...state.exclude.filter((x) => !inFullSet.has(x.id) || x.slot === "charm").map((x) => x.name),
  ].join("\n");
  el.classList.remove("hidden");
  el.title = tip;
  el.innerHTML = `<span class="exclude-summary-text">${materialIcon("block", 14)} Excluded: ${parts.map(escapeHtml).join(" · ")}</span>
    <button type="button" class="icon-btn" id="excludeClear" title="Clear all exclusions">${materialIcon("close", 16)}</button>`;
  $("excludeClear").onclick = async () => {
    const ok = await confirmDialog({
      title: "Clear exclusions?",
      message: `Allow all ${state.exclude.length} excluded armor pieces and charms in Auto Search again.`,
      confirmLabel: "Clear exclusions",
      danger: true,
    });
    if (!ok) return;
    state.exclude = [];
    savePrefs();
    renderExclude();
    if (state.modal?.kind === "exclude") renderModal();
  };
}

function toggleResultExclude(loc, r) {
  const entry = resultExcludeEntry(loc, r);
  if (!entry) return;
  if (isExcludedKey(entry.key)) {
    removeExclude(entry.key);
  } else {
    addExclude(entry);
    unpinExcluded(entry);
  }
  renderExclude();
}

function resultActionsHtml() {
  return `<button type="button" class="icon-btn pin" data-ract="pin"></button>`
    + `<button type="button" class="icon-btn exclude" data-ract="exclude">${materialIcon("block")}</button>`;
}

/** Refresh pin / exclude toggles on result rows after the builder or exclude list changes. */
function syncResultActions() {
  const results = state.results || [];
  for (const card of document.querySelectorAll("#results .result-card")) {
    const r = results[Number(card.dataset.idx)];
    if (!r) continue;
    for (const row of card.querySelectorAll(".piece-row[data-loc]")) {
      const loc = row.dataset.loc;
      const pinBtn = row.querySelector('[data-ract="pin"]');
      if (!pinBtn) continue;
      const pinned = isResultPiecePinned(loc, r);
      pinBtn.classList.toggle("on", pinned);
      pinBtn.setAttribute("aria-pressed", pinned);
      pinBtn.title = pinned ? "Pinned in builder · click to unpin" : "Pin in builder: Auto Search keeps this piece";
      pinBtn.innerHTML = pinIcon(pinned);
      const exBtn = row.querySelector('[data-ract="exclude"]');
      const entry = resultExcludeEntry(loc, r);
      const excluded = !!exBtn && !!entry && isExcludedKey(entry.key);
      if (exBtn) {
        exBtn.classList.toggle("on", excluded);
        exBtn.setAttribute("aria-pressed", excluded);
        exBtn.title = excluded ? "Excluded from Auto Search · click to allow" : "Exclude from Auto Search";
      }
      row.classList.toggle("is-excluded", excluded);
      row.classList.toggle("is-pinned", pinned);
    }
  }
}

function onResultsClick(e) {
  if (onSkillAddClick(e)) return;
  const btn = e.target.closest("[data-ract]");
  if (!btn) return;
  const r = (state.results || [])[Number(btn.closest(".result-card")?.dataset.idx)];
  if (r && btn.dataset.ract === "import-skills") {
    importSetSkills(r.skills, r.setBonuses, `result #${Number(btn.closest(".result-card").dataset.idx) + 1}`);
    return;
  }
  if (r && btn.dataset.ract === "skills") {
    openSetSkills(`Skills · result #${Number(btn.closest(".result-card").dataset.idx) + 1}`, r);
    return;
  }
  if (r && btn.dataset.ract === "materials") {
    openMaterials(`Materials · result #${Number(btn.closest(".result-card").dataset.idx) + 1}`, BUILD_ARMOR.map((k) => r[k]), r.charmInfo, r.weaponId);
    return;
  }
  const loc = btn.closest(".piece-row")?.dataset.loc;
  if (!r || !loc) return;
  if (btn.dataset.ract === "pin") toggleResultPin(loc, r);
  else toggleResultExclude(loc, r);
}

function selectWeapon(w) {
  setWeapon(w);
  savePrefs();
  renderWeaponSelected();
  closeModal();
}

function clearWeaponSelection() {
  setWeapon(null);
  savePrefs();
  renderWeaponSelected();
}

/** Weapon choice without rendering: w = { id, name, type, rarity, slots }, or null for the manual slot pickers. */
function setWeapon(w, manualSlots = null) {
  state.weaponId = w?.id ?? null;
  state.weaponName = w?.name ?? null;
  state.weaponType = w?.type ?? null;
  state.weaponRarity = w?.rarity ?? null;
  if (w) setManualSlots(w.slots);
  else if (manualSlots) setManualSlots(manualSlots);
  state.weaponSlots = w ? w.slots || [] : parseManualSlots();
}

const weaponSnapshot = () =>
  state.weaponId
    ? { id: state.weaponId, name: state.weaponName, type: state.weaponType, rarity: state.weaponRarity, slots: state.weaponSlots }
    : null;

const PREFS_STORAGE_KEY = "mhbuilder.prefs.v1";

/** Search settings kept between visits: armor rarities, exclusions, weapon (or manual slots), gender. */
function loadPrefs() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) || "null");
  } catch {
    /* corrupt storage: keep defaults */
  }
  if (!saved) return;
  if (Array.isArray(saved.armorRarities)) {
    state.armorRarities = new Set(saved.armorRarities.map(Number).filter((r) => r >= 1 && r <= 12));
  }
  if (Array.isArray(saved.exclude)) state.exclude = saved.exclude.filter((x) => x && typeof x.key === "string");
  if (saved.gender === "male" || saved.gender === "female") {
    state.gender = saved.gender;
    $("gender").value = saved.gender;
  }
  setWeapon(saved.weapon?.id ? saved.weapon : null, saved.manualSlots || []);
}

function savePrefs() {
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({
    armorRarities: [...state.armorRarities],
    exclude: state.exclude,
    gender: state.gender,
    weapon: weaponSnapshot(),
    manualSlots: parseManualSlots(),
  }));
}

function weaponPickRowHtml(w) {
  return `<span class="pick-with-ico">${weaponIcon(w.type, w.rarity, { size: 20, title: w.name })}<span>${escapeHtml(w.name)}</span></span><span class="sub">R${w.rarity} · [${slotsLabel(w.slots)}]</span>`;
}

function renderWeaponSelected() {
  if (state.weaponId) {
    $("weaponSelected").innerHTML = `<span class="pick-with-ico">${weaponIcon(state.weaponType, state.weaponRarity, { size: 22, title: state.weaponName })}<span>${escapeHtml(state.weaponName)}</span></span><span class="slot-row">${slotsIconsHtml(state.weaponSlots, { size: 18 })}</span>`;
  } else {
    $("weaponSelected").innerHTML = `<span class="pick-with-ico">${weaponIcon(DEFAULT_WEAPON_TYPE, 12, { size: 22, title: "Great Sword (default)" })}<span>No weapon — using the slots below</span></span>`;
  }
  $("weaponClear").classList.toggle("hidden", !state.weaponId && !parseManualSlots().length);
  buildChanged();
}

async function clearWeapon() {
  const jewels = (state.build.decos.weapon || []).filter(Boolean).length;
  const what = state.weaponId ? state.weaponName : "your manual weapon slots";
  const ok = await confirmDialog({
    title: "Clear weapon?",
    message: `This removes ${what}` + (jewels ? ` and the ${jewels} jewel${jewels > 1 ? "s" : ""} slotted in it in the builder.` : "."),
    confirmLabel: "Clear weapon",
    danger: true,
  });
  if (!ok) return;
  setWeapon(null, []);
  savePrefs();
  renderWeaponSelected();
}

const DECO_STORAGE_KEY = "mhbuilder.decos.v1";

function loadDecoPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(DECO_STORAGE_KEY) || "null");
    if (saved && typeof saved.qty === "object") {
      state.decoQty = saved.qty;
      state.unlimitedDecos = saved.unlimited !== false;
    }
  } catch {
    /* corrupt storage: keep defaults */
  }
  $("unlimitedDecos").checked = state.unlimitedDecos;
}

function saveDecoPrefs() {
  localStorage.setItem(DECO_STORAGE_KEY, JSON.stringify({ qty: state.decoQty, unlimited: state.unlimitedDecos }));
}

let skillsByIdCache = null;
/** Most copies of a jewel that can ever help: enough to max its highest-capped skill (Secret included). */
function decoCap(d) {
  skillsByIdCache ||= new Map(state.skills.map((s) => [s.id, s]));
  let cap = 1;
  for (const s of d.skills || []) {
    const max = skillsByIdCache.get(s.skillId)?.maxLevel ?? 1;
    cap = Math.max(cap, Math.ceil(max / Math.max(1, s.level)));
  }
  return cap;
}

function decoCount(d) {
  return Math.min(state.decoQty[d.id] ?? 0, decoCap(d));
}

function setDecoCount(d, n) {
  n = Math.max(0, Math.min(n, decoCap(d)));
  if (n <= 0) delete state.decoQty[d.id];
  else state.decoQty[d.id] = n;
  saveDecoPrefs();
  renderDecoSummary();
}

function ownedDecoList() {
  return state.decorations
    .map((d) => ({ id: d.id, count: decoCount(d) }))
    .filter((x) => x.count > 0);
}

function decoPipsHtml(d, count) {
  const cap = decoCap(d);
  let html = `<span class="lvl-pips"><span class="lvl-label">${count ? `×${count}` : ""}</span>`;
  for (let n = 1; n <= cap; n++) {
    html += `<button type="button" class="pip${n <= count ? " on" : ""}" data-count="${n}" title="Own ${n}${n === cap ? " (max useful)" : ""}"></button>`;
  }
  return html + `</span>`;
}

function renderDecoSummary() {
  const owned = ownedDecoList();
  const n = owned.reduce((a, x) => a + x.count, 0);
  const listText = `${owned.length} jewel types · ${n} owned`;
  $("decoSummary").textContent = state.unlimitedDecos
    ? `Unlimited${owned.length ? ` · list saved (${listText})` : ""}`
    : owned.length
      ? listText
      : "No jewels listed · search uses armor and charm skills only";
}

const MAX_SAVE_BYTES = 16 * 1024 * 1024;
let saveImportBusy = false;

function setSaveNote(text, isError = false) {
  const note = $("saveImportNote");
  note.textContent = text;
  note.classList.toggle("error", isError);
}

// The File System Access picker (Chromium, HTTPS or localhost only) reopens in the last folder and gives a
// handle that survives reloads, so the same save can be read again in one click.
const canRememberSave = typeof window.showOpenFilePicker === "function";
let rememberedSave = null;

function saveHandleStore(mode, run) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("mhbuilder", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction("handles", mode);
        const req = run(tx.objectStore("handles"));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      } catch (err) {
        db.close();
        reject(err);
      }
    };
  });
}

function renderSaveButtons() {
  $("importSaveLocal").classList.toggle("hidden", !state.localSaves.length);
  $("importSaveLast").classList.toggle("hidden", !rememberedSave);
  $("importSaveFile").classList.toggle("ghost", state.localSaves.length > 0 || !!rememberedSave);
}

async function rememberSave(handle) {
  rememberedSave = handle;
  renderSaveButtons();
  try {
    await saveHandleStore("readwrite", (s) => (handle ? s.put(handle, "save") : s.delete("save")));
  } catch {
    // Storage unavailable (e.g. private window): remembered for this page only.
  }
}

function importSaveFile(file) {
  importSaveDecorations(() => {
    if (file.size > MAX_SAVE_BYTES) throw new Error("That file is too big to be an Iceborne save.");
    return api("/api/save/decorations", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
  });
}

async function chooseSaveFile() {
  if (!canRememberSave) {
    $("saveFileInput").click();
    return;
  }
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({ id: "mhw-save", startIn: rememberedSave ?? undefined });
  } catch (err) {
    if (err.name !== "AbortError") setSaveNote("Couldn't open the file picker.", true);
    return;
  }
  const file = await handle.getFile();
  await rememberSave(handle);
  importSaveFile(file);
}

async function importLastSave() {
  const handle = rememberedSave;
  if (!handle) return;
  try {
    if ((await handle.queryPermission({ mode: "read" })) !== "granted" &&
        (await handle.requestPermission({ mode: "read" })) !== "granted") return;
    importSaveFile(await handle.getFile());
  } catch {
    await rememberSave(null);
    setSaveNote("The last save file couldn't be opened anymore. Choose it again.", true);
  }
}

function initSaveDrop() {
  const zone = $("saveDropZone");
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  let depth = 0;
  const clear = () => {
    depth = 0;
    zone.classList.remove("drop-over");
  };
  // Stop a file dropped next to the zone from navigating away from the page.
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = zone.contains(e.target) ? "copy" : "none";
  });
  window.addEventListener("drop", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  zone.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    zone.classList.add("drop-over");
  });
  zone.addEventListener("dragleave", () => {
    if (--depth <= 0) clear();
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    clear();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    // getAsFileSystemHandle must be called during the drop event itself.
    const item = [...e.dataTransfer.items].find((i) => i.kind === "file");
    const handle = canRememberSave ? item?.getAsFileSystemHandle?.() : null;
    handle?.then((h) => h?.kind === "file" && rememberSave(h)).catch(() => {});
    importSaveFile(file);
  });
}

async function copySaveFolder() {
  const path = $("saveFolderPath");
  const button = $("copySaveFolder");
  try {
    await navigator.clipboard.writeText(path.textContent);
    button.textContent = "Copied";
  } catch {
    // Clipboard API is unavailable on plain http: select the text for Ctrl+C instead.
    getSelection().selectAllChildren(path);
    button.textContent = "Ctrl+C";
  }
  setTimeout(() => (button.textContent = "Copy"), 1500);
}

async function initSaveImport() {
  state.localSaves = [];
  const input = $("saveFileInput");
  $("importSaveFile").onclick = chooseSaveFile;
  $("importSaveLast").onclick = importLastSave;
  $("importSaveLocal").onclick = importLocalSave;
  input.onchange = () => {
    const file = input.files[0];
    input.value = "";
    if (file) importSaveFile(file);
  };
  initSaveDrop();
  $("copySaveFolder").onclick = copySaveFolder;
  if (canRememberSave) {
    try {
      rememberedSave = (await saveHandleStore("readonly", (s) => s.get("save"))) ?? null;
    } catch {
      rememberedSave = null;
    }
  }
  try {
    state.localSaves = await api("/api/save/local");
  } catch {
    state.localSaves = [];
  }
  renderSaveButtons();
}

async function importLocalSave() {
  const saves = state.localSaves;
  if (!saves.length) return;
  let save = saves[0];
  if (saves.length > 1) {
    save = await confirmDialog({
      title: "Which Steam account?",
      message: "More than one Steam account on this PC has an Iceborne save.",
      confirmLabel: "Next",
      choices: saves.map((s) => ({ value: s, label: `Steam user ${s.userId}`, detail: `Saved ${new Date(s.modified).toLocaleString()}` })),
    });
    if (!save) return;
  }
  importSaveDecorations(() => api(`/api/save/local/${encodeURIComponent(save.userId)}/decorations`, { method: "POST" }));
}

async function importSaveDecorations(readSave) {
  if (saveImportBusy) return;
  saveImportBusy = true;
  const buttons = [$("importSaveLocal"), $("importSaveLast"), $("importSaveFile")];
  for (const b of buttons) b.disabled = true;
  setSaveNote("Reading save…");
  let slots;
  try {
    slots = (await readSave()).slots;
  } catch (err) {
    setSaveNote(err.message, true);
    return;
  } finally {
    saveImportBusy = false;
    for (const b of buttons) b.disabled = false;
  }

  const jewels = (s) => s.inBox + s.slotted;
  const hunter = (s) => s.name || `Slot ${s.slot}`;
  const details = (s) =>
    `HR ${s.hunterRank} · MR ${s.masterRank} · ${Math.floor(s.playtime / 3600)} h · ${jewels(s)} jewels`;
  const listed = ownedDecoList().length;
  const effect =
    (listed ? `This replaces your deco list (${listed} jewel types)` : "This fills your deco list") +
    (state.unlimitedDecos ? " and turns off Unlimited decorations." : ".");
  const single = slots.length === 1;
  const picked = await confirmDialog({
    title: "Import decorations",
    message: single
      ? `${hunter(slots[0])}: ${details(slots[0])}. ${effect}`
      : `Pick a hunter. ${effect}`,
    confirmLabel: "Import",
    choices: single ? null : slots.map((s) => ({ value: s, label: hunter(s), detail: details(s) })),
  });
  const slot = single ? (picked ? slots[0] : null) : picked;
  if (!slot) {
    setSaveNote("");
    return;
  }
  applySaveDecorations(slot, hunter(slot));
}

function applySaveDecorations(slot, hunterName) {
  const known = new Set(state.decorations.map((d) => d.id));
  state.decoQty = {};
  for (const { id, count } of slot.decorations) {
    if (known.has(id) && count > 0) state.decoQty[id] = count;
  }
  state.unlimitedDecos = false;
  $("unlimitedDecos").checked = false;
  saveDecoPrefs();
  renderDecoSummary();
  if (state.modal?.kind === "deco") renderModal();
  const total = slot.inBox + slot.slotted;
  const usable = ownedDecoList().reduce((a, x) => a + x.count, 0);
  const spare = total - usable;
  setSaveNote(
    `Imported ${hunterName}'s ${total} jewels (${slot.slotted} slotted in gear)` +
      (spare > 0 ? ` · ${spare} spares past a skill's max level don't count` : "") +
      (slot.unknown ? ` · ${slot.unknown} unrecognised skipped` : "") +
      "."
  );
}

const DECO_EXPORT_KIND = "mhbuilder.decorations";

function exportDecoList() {
  const byId = new Map(state.decorations.map((d) => [d.id, d]));
  const decorations = Object.entries(state.decoQty)
    .map(([id, count]) => ({ id: Number(id), name: byId.get(Number(id))?.name ?? null, count: Number(count) || 0 }))
    .filter((d) => d.count > 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  downloadJson("mhbuilder-decorations.json", {
    kind: DECO_EXPORT_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    unlimited: state.unlimitedDecos,
    decorations,
  });
}

async function importDecoList() {
  let data;
  try {
    data = await pickJsonFile();
  } catch (err) {
    await noticeDialog("Can't import deco list", err.message);
    return;
  }
  if (!data) return;
  if (data.kind !== DECO_EXPORT_KIND || !Array.isArray(data.decorations)) {
    await noticeDialog("Can't import deco list", "That file isn't an MHBuilder deco list export.");
    return;
  }
  const byId = new Map(state.decorations.map((d) => [d.id, d]));
  const byName = new Map(state.decorations.map((d) => [d.name.toLowerCase(), d]));
  const qty = {};
  let unknown = 0;
  for (const entry of data.decorations) {
    const d = byId.get(Number(entry?.id)) || byName.get(String(entry?.name || "").toLowerCase());
    const count = Math.min(999, Math.max(0, Math.floor(Number(entry?.count) || 0)));
    if (!d) unknown++;
    else if (count > 0) qty[d.id] = (qty[d.id] || 0) + count;
  }
  const types = Object.keys(qty).length;
  const total = Object.values(qty).reduce((a, b) => a + b, 0);
  const unlimited = data.unlimited === true;
  const ok = await confirmDialog({
    title: "Import deco list?",
    message:
      `Replace your deco list with ${total} jewels (${types} types) from this file.` +
      (unknown ? ` ${unknown} unrecognised entr${unknown === 1 ? "y is" : "ies are"} skipped.` : "") +
      (state.unlimitedDecos !== unlimited ? ` Unlimited decorations turns ${unlimited ? "on" : "off"}.` : ""),
    confirmLabel: "Import",
  });
  if (!ok) return;
  state.decoQty = qty;
  state.unlimitedDecos = unlimited;
  $("unlimitedDecos").checked = unlimited;
  saveDecoPrefs();
  renderDecoSummary();
  if (state.modal?.kind === "deco") renderModal();
}

function closeModal() {
  $("modal").classList.add("hidden");
  state.modal = null;
}

function openModal(kind, title, extra = {}) {
  state.modal = { kind, category: null, ...extra };
  $("modal").dataset.kind = kind;
  $("modalTitle").textContent = title;
  $("modalSearch").value = "";
  $("modal").classList.remove("hidden");
  $("modalSearch").focus();
  renderModal();
}

/** set: a search result or the evaluated builder ({ skills, setBonuses }). */
function openSetSkills(title, set) {
  if (!set) return;
  openModal("setskills", title, { skills: set.skills || [], setBonuses: set.setBonuses || [] });
}

function renderSetSkillsModal(q, pane, extra) {
  const { skills, setBonuses } = state.modal;
  const matches = (...texts) => !q || texts.some((t) => String(t || "").toLowerCase().includes(q));
  const infoHtml = (name, badges, description, levelsHtml, wanted) => `
    <div class="skill-info${wanted ? " is-wanted" : ""}">
      <div class="skill-info-head"><span class="skill-info-name">${escapeHtml(name)}</span>${badges}</div>
      ${description ? `<p class="skill-info-desc">${escapeHtml(description)}</p>` : ""}
      ${levelsHtml}
    </div>`;

  const rows = [];
  for (const s of skills) {
    const k = pickerSkill(s.id);
    const levels = k?.levelDescriptions || [];
    if (!matches(s.name, k?.description, ...levels)) continue;
    const secret = s.baseMaxLevel < s.maxLevel && s.level > s.baseMaxLevel;
    const levelItems = levels
      .map((d, i) => (d ? `<li class="${i + 1 === s.level ? "current" : i < s.level ? "reached" : ""}"><span class="lvl-no">Lv ${i + 1}</span><span>${escapeHtml(d)}</span></li>` : ""))
      .join("");
    const badges = (s.wanted ? `<span class="pick-badge wanted">Wanted</span>` : "")
      + `<span class="pick-badge${secret ? " secret" : ""}">Lv ${s.level}/${s.maxLevel}</span>`;
    rows.push(infoHtml(s.name, badges, k?.description, levelItems ? `<ol class="skill-info-levels">${levelItems}</ol>` : "", s.wanted));
  }
  // Effects that grant or uncap a skill are covered by that skill's row.
  const effects = setBonuses.flatMap((g) => (g.effects || []).filter((e) => !e.skillId).map((e) => ({ g, e, k: setEffectSkill(e.effect) })));
  for (const { g, e, k } of effects) {
    if (!matches(e.effect, g.name, k?.description)) continue;
    const badges = (e.wanted ? `<span class="pick-badge wanted">Wanted</span>` : "")
      + `<span class="pick-badge set">${escapeHtml(g.name)} ${e.parts}pc</span>`;
    rows.push(infoHtml(e.effect, badges, k?.description, "", e.wanted));
  }

  extra.innerHTML = `<span class="hint">${skills.length} skill${skills.length === 1 ? "" : "s"}${effects.length ? ` · ${effects.length} set effect${effects.length === 1 ? "" : "s"}` : ""} · the highlighted line is the level this set reaches</span>`;
  pane.innerHTML = rows.length
    ? `<div class="skill-info-list">${rows.join("")}</div>`
    : `<p class="hint">${q ? `No skills match “${escapeHtml($("modalSearch").value.trim())}”.` : "This set has no skills."}</p>`;
}

function setModalCategory(cat) {
  if (!state.modal) return;
  state.modal.category = cat;
  renderModal();
}

const weaponListCache = {};
function weaponList() {
  const raw = $("modalSearch").value.trim();
  const category = state.modal.category || ALL_TAB;
  const params = new URLSearchParams({ limit: "5000" });
  if (raw) params.set("q", raw);
  else if (category !== ALL_TAB) params.set("type", category);
  const key = params.toString();
  weaponListCache[key] ||= api(`/api/weapons?${key}`).catch((err) => {
    delete weaponListCache[key];
    throw err;
  });
  return weaponListCache[key];
}

const ALL_TAB = "All";

function modalData(kind) {
  if (kind === "weapon") return weaponList();
  if (kind === "exclude") return Promise.all([...BUILD_ARMOR.map(armorForSlot), charmList()]);
  if (kind === "barmor") return armorForSlot(state.modal.loc);
  if (kind === "bcharm") return charmList();
  if (kind === "materials") return materialsData().catch(() => null);
  return null;
}

async function renderModal() {
  if (!state.modal) return;
  const seq = ++modalRenderSeq;
  const { kind } = state.modal;
  const q = $("modalSearch").value.trim().toLowerCase();
  const cats = $("modalCats");
  const pane = $("modalPane");
  const extra = $("modalExtra");
  // Load before clearing so tab switches swap content in one frame instead of flashing empty.
  await modalData(kind);
  if (seq !== modalRenderSeq) return;
  cats.innerHTML = "";
  pane.innerHTML = "";
  extra.innerHTML = "";

  if (BUILDER_PICKERS.has(kind)) {
    await renderBuilderModal(kind, q, cats, pane, extra, seq);
    return;
  }
  if (kind === "materials") {
    await renderMaterialsModal(q, cats, pane, extra, seq);
    return;
  }
  if (kind === "saved") {
    renderSavedSetsModal(q, cats, pane, extra);
    return;
  }
  if (kind === "setskills") {
    renderSetSkillsModal(q, pane, extra);
    return;
  }

  const matchesQuery = (text) => !q || String(text || "").toLowerCase().includes(q);

  if (kind === "skill" || kind === "more") {
    const more = kind === "more" ? state.more : null;
    if (kind === "more") {
      if (!more || more.loading) {
        pane.innerHTML = `<p class="hint">Checking which skills still fit on top of your picks… this can take up to ~30 s.</p>`;
        return;
      }
      if (more.error) {
        pane.innerHTML = `<p class="hint">${escapeHtml(more.error)}</p>`;
        return;
      }
    }
    const availOf = (s) => (more ? more.levels.get(s.id) : null);
    const matchesSkill = (s) => {
      if (matchesQuery(s.name)) return true;
      if (matchesQuery(s.searchText)) return true;
      return (s.sets || []).some((x) => matchesQuery(x.name) || matchesQuery(x.effect));
    };
    const skillCats = (s) =>
      Array.isArray(s.categories) && s.categories.length ? s.categories : [s.category || "Other"];
    const inCat = (s, c) => skillCats(s).includes(c);

    const SELECTED = "Selected";
    const isPicked = (s) => isWantedSkill(s.id) || isExcludedSkill(s.id);
    const matched = state.skills.filter(matchesSkill);
    const listable = more ? matched.filter(availOf) : matched;
    const categories = [
      SELECTED,
      ALL_TAB,
      ...state.skillCategories.filter((c) => listable.some((s) => inCat(s, c))),
    ];
    if (!state.modal.category || !categories.includes(state.modal.category)) {
      state.modal.category = ALL_TAB;
    }
    const drawSkillCats = () => {
      cats.innerHTML = "";
      for (const c of categories) {
        const count = c === SELECTED
          ? matched.filter(isPicked).length
          : c === ALL_TAB ? listable.length : listable.filter((s) => inCat(s, c)).length;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cat-btn" + (c === state.modal.category ? " active" : "") + (c === SELECTED ? " cat-selected" : "");
        btn.textContent = `${c} (${count})`;
        btn.onclick = () => setModalCategory(c);
        cats.appendChild(btn);
      }
    };
    drawSkillCats();

    if (more) {
      extra.innerHTML = `<span class="hint">${more.levels.size} skills still fit · each checked on its own, so several at max may not all fit together${more.exhausted ? " · time ran out, some are partial" : ""}</span>
        <button type="button" class="btn small primary" id="moreSearchBtn">Search again</button>`;
      $("moreSearchBtn").onclick = () => {
        closeModal();
        runSearch();
      };
    } else {
      extra.innerHTML = `<span class="hint">Click a box to set the level, click it again to clear · ${materialIcon("block", 13)} excludes the skill</span>`;
    }

    const list = state.modal.category === SELECTED
      ? matched.filter(isPicked)
      : state.modal.category === ALL_TAB
        ? listable
        : listable.filter((s) => inCat(s, state.modal.category));
    if (more && !more.levels.size) {
      pane.innerHTML = `<p class="hint">Nothing else fits on top of the current picks.</p>`;
      return;
    }
    if (q && listable.length === 0) {
      pane.innerHTML = `<p class="hint">No skills match “${escapeHtml($("modalSearch").value.trim())}”.</p>`;
      return;
    }
    if (!list.length) {
      pane.innerHTML = `<p class="hint">${state.modal.category === SELECTED ? "No skills picked or excluded yet." : "Nothing here."}</p>`;
      return;
    }
    const buildRow = (s) => {
      const row = document.createElement("div");
      row.className = "pick-row pick-skill" + (s.setEffect || s.setSkill ? " pick-set" : "");
      const selected = state.wanted.find((x) => x.id === s.id);
      const excluded = isExcludedSkill(s.id);
      if (selected) row.classList.add("is-wanted");
      if (excluded) row.classList.add("is-excluded");

      const jewels = s.jewels || [];
      const charms = s.charms || [];
      const armor = s.armor || [];
      const sets = s.sets || [];
      const setLabels = [...new Set(sets.map((x) => `${x.name} (${x.parts})`))];
      const jewelLabels = jewels.map((j) => j.name);
      const charmLabels = charms.map((c) => c.name);
      const armorLabels = armor.map((a) => a.name);

      let iconHtml = "";
      if (jewels.length) {
        const j = jewels[0];
        const tip = jewelLabels.join(", ");
        iconHtml = decoIcon(j.slotSize, j.iconColor, { size: 22, title: tip });
      } else if (charms.length) {
        const c = charms[0];
        iconHtml = armorIcon("charm", c.rarity, { size: 22 });
      } else if (armor.length) {
        // Prefer the dominant piece type (e.g. legs for Speed Crawler).
        const counts = {};
        for (const a of armor) counts[a.slot] = (counts[a.slot] || 0) + 1;
        const preferred = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))[0];
        const piece = armor.find((a) => a.slot === preferred) || armor[0];
        iconHtml = armorIcon(piece.slot, piece.rarity, { size: 22 });
      } else if (s.setSkill || s.setEffect) {
        const topRarity = Math.max(1, ...sets.map((x) => x.rarity || 1));
        iconHtml = armorIcon("head", sets.length ? topRarity : 10, { size: 22 });
      }

      let maxBadge;
      if (s.setEffect) {
        maxBadge = `<span class="pick-badge" title="Set effect">Set</span>`;
      } else if (s.baseMaxLevel && s.baseMaxLevel < s.maxLevel) {
        maxBadge = `<span class="pick-badge secret" title="Soft cap ${s.baseMaxLevel}; ${s.maxLevel} with Secret">Lv ${s.baseMaxLevel}→${s.maxLevel}</span>`;
      } else {
        maxBadge = `<span class="pick-badge" title="Max level ${s.maxLevel}">Lv ${s.maxLevel}</span>`;
      }

      const setBadge = setLabels.length
        ? `<span class="pick-badge set" title="${escapeHtml(setLabels.join(" · "))}">${setLabels.length} set${setLabels.length > 1 ? "s" : ""}</span>`
        : "";
      const jewelBadge = jewels.length > 1
        ? `<span class="pick-badge jewel" title="${escapeHtml(jewelLabels.join(" · "))}">${jewels.length} jewels</span>`
        : jewels.length === 1
          ? "" // icon already shows the jewel
          : "";
      const charmBadge = !jewels.length && charms.length
        ? `<span class="pick-badge charm" title="${escapeHtml(charmLabels.join(" · "))}">Charm</span>`
        : "";
      const armorBadge = !jewels.length && !charms.length && armor.length
        ? `<span class="pick-badge armor" title="${escapeHtml(armorLabels.join(" · "))}">Armor</span>`
        : "";
      const avail = availOf(s);
      const availBadge = avail
        ? `<span class="pick-badge avail" title="${avail.maybeMore ? "Checked up to here; higher timed out, so it may still fit" : "Highest level that still fits with your picks"}">fits Lv ${avail.level}${avail.maybeMore ? "+" : ""}</span>`
        : "";
      const excludeBtn = s.setEffect
        ? ""
        : `<button type="button" class="icon-btn exclude skill-exclude${excluded ? " on" : ""}" aria-pressed="${excluded}" title="${excluded ? "Stop excluding" : "Exclude: results must not have this skill"}">${materialIcon("block")}</button>`;

      row.innerHTML = `
        <span class="pick-main">
          <span class="pick-ico">${iconHtml || `<span class="pick-ico-empty" aria-hidden="true"></span>`}</span>
          <span class="pick-text">
            <span class="pick-name">${escapeHtml(s.name)}</span>
            ${s.description ? `<span class="pick-desc">${escapeHtml(s.description)}</span>` : ""}
          </span>
        </span>
        <span class="pick-meta">${availBadge}${maxBadge}${setBadge}${jewelBadge}${charmBadge}${armorBadge}</span>
        <span class="pick-ctrl">${levelPipsHtml(s, selected ? selected.level : 0, avail)}</span>
        <span class="pick-ex">${excludeBtn}</span>`;
      row.title = [
        s.name,
        skillDescription(s),
        jewelLabels.length ? `Jewel: ${jewelLabels.join(", ")}` : "",
        charmLabels.length ? `Charm: ${charmLabels.join(", ")}` : "",
        armorLabels.length ? `Armor: ${armorLabels.join(", ")}` : "",
        setLabels.length ? `Set: ${setLabels.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      row.onclick = (e) => {
        const pip = e.target.closest(".pip");
        if (pip) {
          const lvl = Number(pip.dataset.level);
          setWantedLevel(s, selected && selected.level === lvl ? 0 : lvl);
        } else if (e.target.closest(".skill-exclude")) {
          toggleExcludedSkill(s);
        } else {
          setWantedLevel(s, selected ? 0 : s.setEffect ? 1 : avail ? avail.level : s.baseMaxLevel ?? s.maxLevel);
        }
        row.replaceWith(buildRow(s));
        renderWanted();
        drawSkillCats();
      };
      return row;
    };
    for (const s of list) pane.appendChild(buildRow(s));
    return;
  }

  if (kind === "weapon") {
    const types = state.weaponTypes;
    if (![ALL_TAB, ...types].includes(state.modal.category)) {
      state.modal.category = ALL_TAB;
    }
    const fetched = await weaponList();
    if (seq !== modalRenderSeq) return;
    let visibleTypes = types;
    let counts = null;
    if (q) {
      counts = Object.fromEntries(types.map((t) => [t, 0]));
      for (const w of fetched) {
        if (counts[w.type] != null) counts[w.type]++;
      }
      visibleTypes = types.filter((t) => counts[t] > 0);
      if (state.modal.category !== ALL_TAB && !visibleTypes.includes(state.modal.category)) {
        state.modal.category = ALL_TAB;
      }
    }
    for (const t of [ALL_TAB, ...visibleTypes]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-btn" + (t === state.modal.category ? " active" : "");
      const count = counts ? ` (${t === ALL_TAB ? fetched.length : counts[t]})` : "";
      btn.innerHTML = t === ALL_TAB ? `${ALL_TAB}${count}` : `${weaponIcon(t, 12, { size: 16 })} ${WEAPON_LABELS[t] || t}${count}`;
      btn.onclick = () => setModalCategory(t);
      cats.appendChild(btn);
    }
    if (q && fetched.length === 0) {
      pane.innerHTML = `<p class="hint">No weapons match “${escapeHtml($("modalSearch").value.trim())}”.</p>`;
      return;
    }
    const list = q && state.modal.category !== ALL_TAB ? fetched.filter((w) => w.type === state.modal.category) : fetched;
    for (const w of list) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "pick-row" + (state.weaponId === w.id ? " active" : "");
      row.innerHTML = weaponPickRowHtml(w);
      row.onclick = () => selectWeapon(w);
      pane.appendChild(row);
    }
    return;
  }

  if (kind === "deco") {
    const decoCats = [ALL_TAB, "Series", 4, 3, 2, 1];
    const decoMatch = (d) =>
      !q ||
      d.name.toLowerCase().includes(q) ||
      (d.skills || []).some((s) => String(s.name || "").toLowerCase().includes(q));
    const matched = state.decorations.filter(decoMatch);
    const inDecoCat = (d, cat) => cat === ALL_TAB || (cat === "Series" ? d.seriesSpecific : d.slotSize === cat);
    const countFor = (cat) => matched.filter((d) => inDecoCat(d, cat)).length;
    const visible = decoCats.filter((cat) => cat === ALL_TAB || !q || countFor(cat) > 0);
    if (!visible.includes(state.modal.category)) {
      state.modal.category = ALL_TAB;
    }
    for (const cat of visible) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-btn" + (cat === state.modal.category ? " active" : "");
      const count = countFor(cat);
      btn.textContent = "";
      if (cat === ALL_TAB || cat === "Series") {
        btn.textContent = `${cat} (${count})`;
      } else {
        btn.innerHTML = `${slotIcon(cat, { size: 14 })} Size ${cat} (${count})`;
      }
      btn.onclick = () => setModalCategory(cat);
      cats.appendChild(btn);
    }

    extra.innerHTML = `
      ${state.unlimitedDecos ? `<p class="hint">Unlimited is on, so search uses every jewel. This list applies once you untick it.</p>` : ""}
      <button type="button" class="btn small ghost" id="decoImport" title="Replace your deco list with one from a JSON file">Import</button>
      <button type="button" class="btn small ghost" id="decoExport" title="Download your deco list as JSON">Export</button>
      <button type="button" class="btn small" id="decoClearAll">Clear all</button>`;
    $("decoExport").onclick = exportDecoList;
    $("decoImport").onclick = importDecoList;
    $("decoClearAll").onclick = async () => {
      if (!ownedDecoList().length) return;
      const ok = await confirmDialog({
        title: "Clear deco list?",
        message: "Set every jewel count back to 0.",
        confirmLabel: "Clear all",
        danger: true,
      });
      if (!ok) return;
      state.decoQty = {};
      saveDecoPrefs();
      renderDecoSummary();
      renderModal();
    };

    const list = matched.filter((d) => inDecoCat(d, state.modal.category));
    if (q && matched.length === 0) {
      pane.innerHTML = `<p class="hint">No decorations match “${escapeHtml($("modalSearch").value.trim())}”.</p>`;
      return;
    }
    const decoRow = (d) => {
      const skills = (d.skills || []).map((s) => `${s.name} ${s.level}`).join(", ");
      const count = decoCount(d);
      const row = document.createElement("div");
      row.className = "pick-row deco-row" + (count ? " owned" : "");
      const seriesTag = d.seriesSpecific ? ' <em class="series-tag">series</em>' : "";
      row.innerHTML = `
        <div class="pick-with-ico">
          ${decoIcon(d.slotSize, d.iconColor, { size: 24, title: `${d.name} · ${d.iconColor || "Gray"}` })}
          <div>
            <div>${escapeHtml(d.name)}${seriesTag}</div>
            <div class="sub">${slotIcon(d.slotSize, { size: 14 })} ${escapeHtml(skills)}</div>
          </div>
        </div>
        ${decoPipsHtml(d, count)}`;
      row.onclick = (e) => {
        const pip = e.target.closest(".pip");
        if (!pip) return;
        const n = Number(pip.dataset.count);
        setDecoCount(d, n === count ? 0 : n);
        row.replaceWith(decoRow(d));
      };
      return row;
    };
    for (const d of list) pane.appendChild(decoRow(d));
    return;
  }

  if (kind === "exclude") {
    const slots = ["Head", "Chest", "Gloves", "Waist", "Legs", "Charm"];
    const [armorBySlot, charmsAll] = await Promise.all([Promise.all(BUILD_ARMOR.map(armorForSlot)), charmList()]);
    if (seq !== modalRenderSeq) return;
    const matchesArmor = (a) =>
      (!a.gender || a.gender === state.gender) && (!q || a.name.toLowerCase().includes(q) || String(a.set || "").toLowerCase().includes(q));
    const armor = armorBySlot.flat().filter(matchesArmor);
    const charms = charmsAll.filter((c) => !q || c.name.toLowerCase().includes(q));
    const all = [...armor, ...charms.map((c) => ({ ...c, slot: "charm", isCharm: true }))];
    const slotKey = (a) => {
      const s = String(a.slot || "");
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    };
    const EXCLUDED = "Excluded";
    const entryOf = (a) => (a.isCharm ? charmExcludeEntry(a) : armorExcludeEntry(a));
    const excludedItems = () => all.filter((a) => isExcludedKey(entryOf(a).key));
    const counts = Object.fromEntries(slots.map((s) => [s, 0]));
    for (const a of all) {
      const sk = slotKey(a);
      if (counts[sk] != null) counts[sk]++;
    }
    const visibleSlots = q ? slots.filter((s) => counts[s] > 0) : slots;
    const drawCats = () => {
      cats.innerHTML = "";
      const nExcluded = excludedItems().length;
      for (const tab of [EXCLUDED, ALL_TAB, ...visibleSlots]) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cat-btn" + (tab === state.modal.category ? " active" : "") + (tab === EXCLUDED ? " cat-selected" : "");
        btn.textContent = tab === EXCLUDED
          ? `${EXCLUDED} (${nExcluded})`
          : tab === ALL_TAB
            ? `${ALL_TAB} (${all.length})`
            : q ? `${tab} (${counts[tab]})` : tab;
        btn.onclick = () => setModalCategory(tab);
        cats.appendChild(btn);
      }
    };
    if (![EXCLUDED, ALL_TAB, ...visibleSlots].includes(state.modal.category)) {
      state.modal.category = ALL_TAB;
    }
    drawCats();
    extra.innerHTML = `<span class="hint">Click a piece to exclude it, click again to allow it</span>`;

    if (q && all.length === 0) {
      pane.innerHTML = `<p class="hint">No armor or charm matches “${escapeHtml($("modalSearch").value.trim())}”.</p>`;
      return;
    }
    const list = state.modal.category === EXCLUDED
      ? excludedItems()
      : state.modal.category === ALL_TAB
        ? all
        : all.filter((a) => slotKey(a) === state.modal.category);
    if (!list.length) {
      pane.innerHTML = `<p class="hint">${state.modal.category === EXCLUDED ? "Nothing excluded yet." : "Nothing here."}</p>`;
      return;
    }
    const excludeRow = (a) => {
      const entry = entryOf(a);
      const excluded = isExcludedKey(entry.key);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "pick-row exclude-row" + (excluded ? " is-excluded" : "");
      row.setAttribute("aria-pressed", excluded);
      const detail = a.isCharm
        ? `R${a.rarity} · ${escapeHtml(skillsText(a.skills))}`
        : `R${a.rarity} · ${escapeHtml(a.set || "—")} · [${slotsLabel(a.slots)}]`;
      row.innerHTML = `<span class="pick-with-ico">${armorIcon(a.slot, a.rarity, { size: 16 })}<span class="pick-name">${escapeHtml(a.name)}</span></span>
        <span class="exclude-row-end"><span class="sub" style="color:${rarityColor(a.rarity)}">${detail}</span>
        <span class="icon-btn exclude${excluded ? " on" : ""}" aria-hidden="true">${materialIcon("block")}</span></span>`;
      row.title = excluded ? "Excluded from Auto Search · click to allow" : "Click to exclude from Auto Search";
      row.onclick = () => {
        if (isExcludedKey(entry.key)) removeExclude(entry.key);
        else {
          addExclude(entry);
          unpinExcluded(entry);
        }
        renderExclude();
        row.replaceWith(excludeRow(a));
        drawCats();
      };
      return row;
    };
    for (const a of list) pane.appendChild(excludeRow(a));
  }
}

/** A piece excluded from search can't also stay pinned in the builder. */
function unpinExcluded(entry) {
  const b = state.build;
  let changed = false;
  if (entry.slot === "charm") {
    if (b.pinned.charm && b.charm?.id === entry.id && b.charm?.level === entry.level) {
      b.pinned.charm = false;
      changed = true;
    }
  } else {
    for (const loc of BUILD_ARMOR) {
      if (b.pinned[loc] && b.pieces[loc]?.id === entry.id) {
        b.pinned[loc] = false;
        changed = true;
      }
    }
  }
  if (changed) {
    saveBuild();
    renderBuilder();
  }
}

const ARMOR_RANKS = [
  { key: "low", label: "Low", rarities: [1, 2, 3, 4] },
  { key: "high", label: "High", rarities: [5, 6, 7, 8] },
  { key: "master", label: "Master", rarities: [9, 10, 11, 12] },
];

function renderArmorTierToggles() {
  const on = state.armorRarities;
  $("rankToggles").innerHTML = ARMOR_RANKS.map((rank) => {
    const count = rank.rarities.filter((r) => on.has(r)).length;
    const cls = count === rank.rarities.length ? "on" : count ? "partial" : "";
    return `<button type="button" class="toggle ${cls}" data-rank="${rank.key}" aria-pressed="${count === rank.rarities.length}">${rank.label}</button>`;
  }).join("");
  $("rarityToggles").innerHTML = ARMOR_RANKS.map((rank) =>
    `<div class="toggle-group">${rank.rarities.map((r) =>
      `<button type="button" class="toggle rarity ${on.has(r) ? "on" : ""}" data-rarity="${r}" style="--rar:${rarityColor(r)}" aria-pressed="${on.has(r)}" title="Rarity ${r}">${r}</button>`
    ).join("")}</div>`
  ).join("");
}

function onArmorTierClick(e) {
  const btn = e.target.closest("button.toggle");
  if (!btn) return;
  const on = state.armorRarities;
  if (btn.dataset.rank) {
    const rank = ARMOR_RANKS.find((x) => x.key === btn.dataset.rank);
    const allOn = rank.rarities.every((r) => on.has(r));
    for (const r of rank.rarities) allOn ? on.delete(r) : on.add(r);
  } else {
    const r = Number(btn.dataset.rarity);
    on.has(r) ? on.delete(r) : on.add(r);
  }
  savePrefs();
  renderArmorTierToggles();
}

const manualSlotSelects = () => [...$("manualSlots").querySelectorAll("select")];

function initManualSlots() {
  const options = [`<option value="0">None</option>`, ...[1, 2, 3, 4].map((n) => `<option value="${n}">Lv ${n}</option>`)].join("");
  for (const sel of manualSlotSelects()) {
    sel.innerHTML = options;
    sel.onchange = () => {
      renderManualSlotIcons();
      clearWeaponSelection();
    };
  }
  renderManualSlotIcons();
}

function renderManualSlotIcons() {
  for (const sel of manualSlotSelects()) {
    const n = Number(sel.value);
    sel.closest(".slot-select").querySelector(".slot-select-ico").innerHTML = n
      ? slotIcon(n, { size: 20 })
      : `<img class="ico mh-ico" src="${iconUrl("mh/icon_slot0.png")}" width="20" height="20" alt="No slot" />`;
  }
}

/** Show a weapon's slots in the manual pickers (largest first, padded with None). */
function setManualSlots(slots) {
  const sorted = (slots || []).filter((n) => n > 0).sort((a, b) => b - a);
  manualSlotSelects().forEach((sel, i) => {
    sel.value = String(Math.min(4, sorted[i] ?? 0));
  });
  renderManualSlotIcons();
}

function parseManualSlots() {
  return manualSlotSelects()
    .map((sel) => Number(sel.value))
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
}

const STAT_MIN_KEYS = ["defense", "fire", "water", "thunder", "ice", "dragon"];
const STAT_MIN_STORE = "mhbuilder.mins.v1";

function initStatMins() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STAT_MIN_STORE) || "{}") || {};
  } catch {
    saved = {};
  }
  $("statMins").innerHTML = STAT_MIN_KEYS.map((k) => {
    const label = k === "defense" ? "Defense" : ELEMENT_META[k].label;
    const icon = k === "defense" ? defenseIcon({ size: 18 }) : elementIcon(k, { size: 18 });
    const value = Number.isInteger(saved[k]) ? cleanStatMin(k, String(saved[k])) : "";
    // Resistances may be negative, so they keep the full keyboard (iOS numeric pads have no minus).
    const mode = k === "defense" ? "numeric" : "text";
    return `<label class="stat-min stat-min-${k}" title="Minimum ${label.toLowerCase()}${k === "defense" ? "" : " resistance"}">
      ${icon}<input type="text" inputmode="${mode}" autocomplete="off" spellcheck="false" data-stat="${k}" value="${value}" placeholder="–" aria-label="Minimum ${label}" />
    </label>`;
  }).join("");
  $("statMins").oninput = (e) => {
    const input = e.target.closest("input[data-stat]");
    if (!input) return;
    const clean = cleanStatMin(input.dataset.stat, input.value);
    if (clean !== input.value) {
      const caret = Math.max(0, (input.selectionStart ?? clean.length) - (input.value.length - clean.length));
      input.value = clean;
      input.setSelectionRange(caret, caret);
    }
    localStorage.setItem(STAT_MIN_STORE, JSON.stringify(readStatMins() || {}));
    syncStatChips();
  };
  $("statMins").addEventListener("focusout", (e) => {
    const input = e.target.closest("input[data-stat]");
    if (input && input.value === "-") input.value = "";
  });
}

const STAT_MIN_LABELS = { defense: "defense", fire: "fire res", water: "water res", thunder: "thunder res", ice: "ice res", dragon: "dragon res" };

/** Defense / resistance chip click: fill that minimum with the chip's value, or clear it if it already matches. */
function setStatMin(stat, value) {
  const input = $("statMins").querySelector(`input[data-stat="${stat}"]`);
  if (!input) return;
  const next = cleanStatMin(stat, String(value));
  input.value = input.value === next ? "" : next;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const box = input.closest(".stat-min");
  box.classList.remove("flash");
  void box.offsetWidth;
  box.classList.add("flash");
}

function syncStatChips() {
  const mins = readStatMins() || {};
  for (const chip of document.querySelectorAll("[data-min-stat]")) {
    const stat = chip.dataset.minStat;
    const value = Number(chip.dataset.minValue);
    const isMin = mins[stat] === value;
    chip.classList.toggle("is-min", isMin);
    chip.title = isMin
      ? `Minimum ${STAT_MIN_LABELS[stat]} is ${value} · click to clear`
      : `Click to set minimum ${STAT_MIN_LABELS[stat]} to ${value}`;
  }
}

function onStatChipClick(e) {
  const chip = e.target.closest("[data-min-stat]");
  if (!chip) return;
  if (e.type === "keydown") {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
  }
  setStatMin(chip.dataset.minStat, Number(chip.dataset.minValue));
}

const FREE_SLOT_STORE = "mhbuilder.freeslots.v1";

function initFreeSlotMins() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(FREE_SLOT_STORE) || "{}") || {};
  } catch {
    saved = {};
  }
  $("freeSlotMins").innerHTML = [4, 3, 2, 1].map((lv) => {
    const value = Number.isInteger(saved[lv]) && saved[lv] > 0 ? Math.min(9, saved[lv]) : "";
    return `<label class="stat-min" title="Keep at least this many empty slots of Lv ${lv} or bigger">
      ${slotIcon(lv, { size: 18 })}<input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" data-free-lv="${lv}" value="${value}" placeholder="–" aria-label="Minimum free Lv ${lv} slots" />
    </label>`;
  }).join("");
  $("freeSlotMins").oninput = (e) => {
    const input = e.target.closest("input[data-free-lv]");
    if (!input) return;
    const clean = input.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(-1);
    if (clean !== input.value) input.value = clean;
    const out = {};
    for (const el of $("freeSlotMins").querySelectorAll("input[data-free-lv]")) {
      if (Number(el.value) > 0) out[el.dataset.freeLv] = Number(el.value);
    }
    localStorage.setItem(FREE_SLOT_STORE, JSON.stringify(out));
  };
}

/** [Lv1, Lv2, Lv3, Lv4] free-slot minimums; null when all are blank / zero. */
function readMinFreeSlots() {
  const counts = [1, 2, 3, 4].map((lv) => Number($("freeSlotMins").querySelector(`input[data-free-lv="${lv}"]`)?.value) || 0);
  return counts.some((n) => n > 0) ? counts : null;
}

/** Digits only (defense up to 4, resistances up to 2 with an optional leading minus); anything else is dropped. */
function cleanStatMin(stat, raw) {
  const neg = stat !== "defense" && String(raw).trimStart().startsWith("-");
  const digits = String(raw).split(/[.,]/)[0].replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, stat === "defense" ? 4 : 2);
  return (neg ? "-" : "") + digits;
}

/** Minimums typed in the Armor panel; null when all are blank. */
function readStatMins() {
  const out = {};
  for (const input of $("statMins").querySelectorAll("input[data-stat]")) {
    if (!/^-?\d+$/.test(input.value)) continue;
    out[input.dataset.stat] = Number(input.value);
  }
  return Object.keys(out).length ? out : null;
}

async function runSearch() {
  const status = $("searchStatus");
  const results = $("results");
  const meta = $("resultMeta");
  if (!state.wanted.length) {
    status.textContent = "Add at least one skill.";
    return;
  }
  if (!state.armorRarities.size) {
    status.textContent = "Enable at least one armor rarity.";
    return;
  }
  status.textContent = "Searching…";
  results.innerHTML = "";
  $("moreSkillsBtn").classList.add("hidden");
  meta.textContent = "";

  const body = {
    skills: state.wanted.map((s) => ({ id: s.id, level: s.level })),
    weaponId: state.weaponId,
    weaponSlots: state.weaponId ? state.weaponSlots : parseManualSlots(),
    excludeArmorIds: state.exclude.filter((x) => x.slot !== "charm").map((x) => x.id),
    excludedCharms: state.exclude.filter((x) => x.slot === "charm").map((x) => ({ id: x.id, level: x.level })),
    unlimitedDecorations: state.unlimitedDecos,
    ownedDecorations: state.unlimitedDecos
      ? []
      : ownedDecoList(),
    armorRarities: [...state.armorRarities],
    excludedSkillIds: state.excludedSkills.map((s) => s.id),
    ...buildPinsForSearch(),
    minimums: readStatMins(),
    minFreeSlots: readMinFreeSlots(),
    gender: state.gender,
    maxResults: 100,
    timeLimitMs: 15000,
  };

  try {
    const data = await api("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    status.textContent = "";
    meta.textContent = `${data.count} sets · ${data.elapsedMs} ms`
      + (data.timedOut ? " · time limit hit, a longer search may find better sets" : "");
    state.lastSearchBody = data.results.length ? body : null;
    state.results = data.results;
    $("moreSkillsBtn").classList.toggle("hidden", !data.results.length);
    if (!data.results.length) {
      const minsNote = (body.minimums ? ", lower the defense/resistance minimums" : "")
        + (body.minFreeSlots ? ", ask for fewer free slots" : "");
      results.innerHTML = `<p class="hint">No sets found. Relax skills${minsNote}, add weapon slots, or enable unlimited decos.</p>`;
      return;
    }
    for (const [i, r] of data.results.entries()) {
      const card = document.createElement("article");
      card.className = "result-card";
      card.dataset.idx = i;
      const skillHtml = skillPillsHtml(r.skills);
      const placements = r.decorationPlacements || [];
      const decoHtml = (r.decorations || []).length
        ? (r.decorations || [])
            .map((d) => {
              if (typeof d === "string") return escapeHtml(d);
              const label = d.count > 1 ? `${d.name} ×${d.count}` : d.name;
              return `<span class="deco-chip">${decoIcon(d.slotSize, d.iconColor, { size: 22, title: label })}${escapeHtml(label)}</span>`;
            })
            .join(" ")
        : "—";
      const freeHtml = freeSlotsSummaryHtml(r.freeSlots, r.remainingSlots, { size: 20 });
      const weaponSlots = r.weaponSlots || [];
      const hasWeaponSlots = weaponSlots.some((n) => n > 0);
      const weaponPlaced = placements.some((p) => p.location === "Weapon");
      const weaponMeta = {
        type: r.weaponType || DEFAULT_WEAPON_TYPE,
        rarity: r.weaponRarity ?? 12,
      };
      const weaponRow =
        hasWeaponSlots || weaponPlaced
          ? pieceRowHtml(
              "Weapon",
              {
                name: r.weapon || "Weapon slots",
                rarity: weaponMeta.rarity,
                set: "",
                slots: weaponSlots,
              },
              "weapon",
              placements,
              weaponMeta
            )
          : "";
      card.innerHTML = `
        <div class="result-card-head">
          <div class="result-title-row">
            <h3>#${i + 1} <span class="def-chip" ${statChipAttrs("defense", r.defense)}>${defChipHtml(r.defense)}</span>${r.weapon ? ` · ${escapeHtml(r.weapon)}` : ""}</h3>
            <span class="result-head-actions">
              <button type="button" class="btn small ghost" data-ract="skills" title="What each skill in this set does">Skills</button>
              <button type="button" class="btn small ghost" data-ract="materials" title="Forging materials and where to get them">Materials</button>
              <button type="button" class="btn small primary apply-btn" title="Load this set into the builder">Apply to builder</button>
            </span>
          </div>
          <div class="resists">${resistRowHtml(r.resistances)}</div>
        </div>
        <div class="result-body">
          <div class="result-section">
            <div class="result-section-label">Equipment</div>
            <div class="pieces">
              ${BUILD_ARMOR.map((k) => pieceRowHtml(BUILD_LABELS[k], r[k], k, placements, null, r[k]?.id ? resultActionsHtml() : "")).join("")}
              ${pieceRowHtml("Charm", { name: r.charm, rarity: r.charmInfo?.rarity ?? 10, set: "", skills: r.charmInfo?.skills }, "charm", undefined, null, r.charmInfo?.id ? resultActionsHtml() : "")}
              ${weaponRow}
            </div>
          </div>
          <div class="result-section">
            <div class="result-section-label">Decorations</div>
            <div class="deco-line"><span class="deco-line-label">Used</span> <span class="deco-chips">${decoHtml}</span></div>
            <div class="deco-line"><span class="deco-line-label">Free</span> <span class="slot-row free-slots">${freeHtml}</span></div>
          </div>
          <div class="result-section set-bonuses-block">
            <div class="result-section-label">Set bonuses</div>
            <div class="set-bonuses">${setBonusesHtml(r.setBonuses)}</div>
          </div>
          <div class="result-section">
            <div class="result-section-label section-label-row">Skills
              <button type="button" class="btn small ghost" data-ract="import-skills" title="Replace your wanted skills with this set's skills">Use these skills</button>
            </div>
            <div class="skills">${skillHtml}</div>
          </div>
        </div>`;
      card.querySelector(".apply-btn").onclick = () => applyResultToBuild(r);
      results.appendChild(card);
    }
    syncResultActions();
    syncSkillAddables();
    syncStatChips();
  } catch (err) {
    status.textContent = err.message;
  }
}

async function init() {
  const [meta] = await Promise.all([api("/api/meta"), preloadTintedIcons()]);
  $("meta").textContent = `${meta.armor} armor · ${meta.weapons} weapons · ${meta.decorations} decos · ${meta.skills} skills`;

  state.skills = await api("/api/skills");
  state.skillCategories = await api("/api/skill-categories");
  state.weaponTypes = await api("/api/weapon-types");
  state.decorations = await api("/api/decorations");

  $("openSkillPicker").onclick = () => openModal("skill", "Add skill");
  $("skillsClear").onclick = clearSkills;
  $("weaponClear").onclick = clearWeapon;
  $("openWeaponPicker").onclick = () => openModal("weapon", "Choose weapon");
  $("openDecoPicker").onclick = () => openModal("deco", "Decoration list");
  $("openExcludePicker").onclick = () => openModal("exclude", "Exclude armor & charms");
  $("modalClose").onclick = closeModal;
  $("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
  $("modalSearch").oninput = debounce(() => {
    if (state.modal && !["Selected", "Excluded"].includes(state.modal.category)) state.modal.category = ALL_TAB;
    renderModal();
  }, 150);

  $("unlimitedDecos").onchange = () => {
    state.unlimitedDecos = $("unlimitedDecos").checked;
    saveDecoPrefs();
    renderDecoSummary();
    if (state.modal?.kind === "deco") renderModal();
  };
  $("searchBtn").onclick = runSearch;
  $("moreSkillsBtn").onclick = openMoreSkills;
  $("rankToggles").onclick = onArmorTierClick;
  $("rarityToggles").onclick = onArmorTierClick;
  $("gender").onchange = () => {
    state.gender = $("gender").value === "male" ? "male" : "female";
    savePrefs();
    renderExclude();
  };
  state.gender = $("gender").value === "male" ? "male" : "female";
  initManualSlots();
  loadPrefs();
  initStatMins();
  initFreeSlotMins();
  initSaveImport();
  $("builderGear").onclick = onBuilderClick;
  $("results").onclick = onResultsClick;
  for (const id of ["results", "builder"]) {
    $(id).addEventListener("click", onStatChipClick);
    $(id).addEventListener("keydown", onStatChipClick);
  }
  $("results").addEventListener("keydown", onSkillAddKey);
  for (const id of ["builderSkills", "builderSets"]) {
    $(id).onclick = onSkillAddClick;
    $(id).addEventListener("keydown", onSkillAddKey);
  }
  $("builderImportSkills").onclick = () => {
    const ev = state.buildEval;
    if (ev) importSetSkills(ev.skills, ev.setBonuses, "the builder");
  };
  $("builderSaved").onclick = () => openModal("saved", "Saved set builds", { draftName: "" });
  $("builderSkillInfo").onclick = () => openSetSkills("Skills · builder", state.buildEval);
  $("builderMaterials").onclick = () =>
    openMaterials("Materials · builder", BUILD_ARMOR.map((k) => state.build.pieces[k]), state.build.charm, state.weaponId);
  $("builderClear").onclick = async () => {
    const ok = await confirmDialog({
      title: "Clear build?",
      message: "This removes every armor piece, the charm, all jewels and pins from the builder.",
      confirmLabel: "Clear build",
      danger: true,
    });
    if (!ok) return;
    state.build = emptyBuild();
    buildChanged();
  };

  renderArmorTierToggles();
  loadSkillPrefs();
  renderWanted();
  renderExclude();
  renderWeaponSelected();
  loadDecoPrefs();
  renderDecoSummary();
}

init().catch((err) => {
  $("meta").textContent = err.message;
});
