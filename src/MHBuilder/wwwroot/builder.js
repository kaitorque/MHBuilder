// Builder: the hand-made set that searches can fill in and pins can lock.

const BUILD_ARMOR = ["head", "chest", "gloves", "waist", "legs"];
const BUILD_ROWS = ["weapon", ...BUILD_ARMOR, "charm"];
const BUILD_LABELS = {
  weapon: "Weapon",
  head: "Head",
  chest: "Chest",
  gloves: "Gloves",
  waist: "Waist",
  legs: "Legs",
  charm: "Charm",
};
const BUILD_STORAGE_KEY = "mhbuilder.build.v1";

/** In-page replacement for window.confirm; resolves true on confirm, false on cancel / Esc / backdrop. */
/** Resolves true / false, or with `choices` ([{value, label, detail}]) the picked choice's value (null on cancel). */
/** cancelLabel: null shows a one-button notice. */
function confirmDialog({ title = "Are you sure?", message = "", confirmLabel = "OK", cancelLabel = "Cancel", danger = false, choices = null } = {}) {
  const backdrop = $("confirmModal");
  const ok = $("confirmOk");
  const cancel = $("confirmCancel");
  const list = $("confirmChoices");
  $("confirmTitle").textContent = title;
  $("confirmMessage").textContent = message;
  list.innerHTML = (choices || [])
    .map((c, i) => `<label class="confirm-choice">
        <input type="radio" name="confirmChoice" value="${i}"${i === 0 ? " checked" : ""} />
        <span class="choice-label">${escapeHtml(c.label)}</span>
        ${c.detail ? `<span class="choice-detail">${escapeHtml(c.detail)}</span>` : ""}
      </label>`)
    .join("");
  list.classList.toggle("hidden", !choices);
  const result = (confirmed) => {
    if (!choices) return confirmed;
    return confirmed ? choices[Number(list.querySelector("input:checked")?.value ?? 0)].value : null;
  };
  ok.textContent = confirmLabel;
  cancel.textContent = cancelLabel ?? "";
  cancel.classList.toggle("hidden", cancelLabel == null);
  ok.classList.toggle("danger", danger);
  backdrop.classList.remove("hidden");
  ok.focus();

  return new Promise((resolve) => {
    const done = (confirmed) => {
      const value = result(confirmed);
      backdrop.classList.add("hidden");
      ok.onclick = cancel.onclick = backdrop.onclick = null;
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        done(document.activeElement !== cancel);
      }
    };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) done(false);
    };
    document.addEventListener("keydown", onKey, true);
  });
}

const noticeDialog = (title, message) => confirmDialog({ title, message, confirmLabel: "OK", cancelLabel: null });

function downloadJson(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MAX_JSON_BYTES = 5 * 1024 * 1024;

/** Ask for a .json file; resolves its parsed contents, null if the picker is cancelled, rejects on bad JSON. */
function pickJsonFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > MAX_JSON_BYTES) return reject(new Error(`${file.name} is too big to be an MHBuilder export.`));
      try {
        resolve(JSON.parse(await file.text()));
      } catch {
        reject(new Error(`${file.name} isn't valid JSON.`));
      }
    };
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

const fileSlug = (text) => String(text || "export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";

function emptyBuild() {
  return {
    pieces: { head: null, chest: null, gloves: null, waist: null, legs: null },
    charm: null,
    decos: { weapon: [], head: [], chest: [], gloves: [], waist: [], legs: [] },
    pinned: { head: false, chest: false, gloves: false, waist: false, legs: false, charm: false },
  };
}

function loadBuild() {
  try {
    const saved = JSON.parse(localStorage.getItem(BUILD_STORAGE_KEY) || "null");
    if (saved && saved.pieces && saved.decos && saved.pinned) return { ...emptyBuild(), ...saved };
  } catch {
    /* corrupt storage: start fresh */
  }
  return emptyBuild();
}

function saveBuild() {
  localStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify(state.build));
}

function buildIsEmpty() {
  const b = state.build;
  return BUILD_ARMOR.every((k) => !b.pieces[k]) && !b.charm && Object.values(b.decos).every((l) => !l.some(Boolean));
}

function weaponHostSlots() {
  return (state.weaponId ? state.weaponSlots : parseManualSlots()).filter((n) => n > 0);
}

function hostSlots(loc) {
  if (loc === "weapon") return weaponHostSlots();
  return (state.build.pieces[loc]?.slots || []).filter((n) => n > 0);
}

/** Drop jewels that no longer fit (e.g. after a weapon or armor change). */
function normalizeBuildDecos() {
  for (const loc of Object.keys(state.build.decos)) {
    const hosts = hostSlots(loc);
    const cur = state.build.decos[loc] || [];
    state.build.decos[loc] = hosts.map((h, i) => (cur[i] && cur[i].slotSize <= h ? cur[i] : null));
  }
}

function setBuildPiece(loc, piece) {
  if (loc === "charm") {
    state.build.charm = piece;
    if (!piece) state.build.pinned.charm = false;
  } else {
    state.build.pieces[loc] = piece;
    state.build.decos[loc] = [];
    if (!piece) state.build.pinned[loc] = false;
  }
  buildChanged();
}

function buildChanged() {
  normalizeBuildDecos();
  saveBuild();
  renderBuilder();
  scheduleBuildEvaluate();
}

function builderRowHtml(loc) {
  const label = BUILD_LABELS[loc];
  const hosts = hostSlots(loc);
  const decos = state.build.decos[loc] || [];
  const slotsHtml = hosts
    .map((h, i) => {
      const d = decos[i];
      const tip = d ? `${d.name} 【${d.slotSize}】${d.slotSize < h ? ` in 【${h}】` : ""} · click to change` : `Empty 【${h}】 slot · click to add a jewel`;
      const icon = d ? filledSlotIcon(h, d.slotSize, d.iconColor, { size: 28, title: tip }) : slotIcon(h, { size: 28 });
      return `<button type="button" class="bslot" data-act="deco" data-idx="${i}" title="${escapeHtml(tip)}">${icon}</button>`;
    })
    .join("");

  let icon, name, sub, filled, pinnable, skills;
  if (loc === "weapon") {
    filled = !!state.weaponId;
    icon = weaponIcon(state.weaponType || DEFAULT_WEAPON_TYPE, state.weaponRarity ?? 12, { size: 34 });
    name = state.weaponName || (hosts.length ? "Manual slots" : "No weapon");
    sub = filled ? `R${state.weaponRarity}` : "Choose a weapon or pick slots in the Weapon panel";
    pinnable = false;
  } else if (loc === "charm") {
    const c = state.build.charm;
    filled = !!c;
    icon = armorIcon("charm", c?.rarity ?? 1, { size: 34 });
    name = c ? c.name : "Pick charm…";
    sub = c ? `R${c.rarity}` : "";
    skills = c?.skills;
    pinnable = true;
  } else {
    const p = state.build.pieces[loc];
    filled = !!p;
    icon = armorIcon(loc, p?.rarity ?? 1, { size: 34 });
    name = p ? p.name : `Pick ${label.toLowerCase()}…`;
    sub = p ? [`R${p.rarity}`, p.set].filter(Boolean).map(escapeHtml).join(" · ") + armorNoteTag(p.set) : "";
    skills = p?.skills;
    pinnable = true;
  }
  const rarity = loc === "weapon" ? state.weaponRarity : loc === "charm" ? state.build.charm?.rarity : state.build.pieces[loc]?.rarity;
  const pinned = pinnable && filled && state.build.pinned[loc];
  const pinBtn = pinnable
    ? `<button type="button" class="icon-btn pin${pinned ? " on" : ""}" data-act="pin" ${filled ? "" : "disabled"} aria-pressed="${pinned}" title="${pinned ? "Pinned: Auto Search keeps this piece" : "Pin so Auto Search keeps this piece"}">${pinIcon(pinned)}</button>`
    : "";
  const clearBtn = filled
    ? `<button type="button" class="icon-btn" data-act="clear" title="Remove">${materialIcon("close")}</button>`
    : "";

  return `<div class="bgear-row${filled ? "" : " empty"}${pinned ? " pinned" : ""}" data-loc="${loc}">
    <span class="bgear-ico" style="opacity:${filled || loc === "weapon" ? 1 : 0.35}">${icon}</span>
    <span class="bgear-main">
      <span class="bgear-label">${label}</span>
      <button type="button" class="bgear-name" data-act="pick" title="Change ${label.toLowerCase()}">${escapeHtml(name)}</button>
      ${sub ? `<span class="bgear-sub" style="color:${filled ? rarityColor(rarity) : "var(--muted)"}">${sub}</span>` : ""}
      ${pieceSkillsHtml(skills, "piece-skills bgear-skills")}
    </span>
    <span class="bgear-slots">${slotsHtml}</span>
    <span class="bgear-actions">${pinBtn}${clearBtn}</span>
  </div>`;
}

function renderBuilder() {
  normalizeBuildDecos();
  $("builderGear").innerHTML = BUILD_ROWS.map(builderRowHtml).join("");
  const pins = Object.entries(state.build.pinned).filter(([k, v]) => v && (k === "charm" ? state.build.charm : state.build.pieces[k])).length;
  $("builderPins").textContent = pins ? `${pins} pinned` : "";
  $("builderClear").disabled = buildIsEmpty();
  $("builderMaterials").disabled = !BUILD_ARMOR.some((k) => state.build.pieces[k]) && !state.build.charm && !state.weaponId;
  syncResultActions();
}

function renderBuilderSummary() {
  const ev = state.buildEval;
  const empty = buildIsEmpty();
  const def = $("builderDef");
  def.innerHTML = defChipHtml(ev ? ev.defense : 0);
  if (empty) {
    for (const a of ["data-min-stat", "data-min-value", "role", "tabindex"]) def.removeAttribute(a);
    def.classList.remove("is-min");
    def.title = "Defense";
  } else {
    Object.assign(def.dataset, { minStat: "defense", minValue: ev ? ev.defense : 0 });
    def.setAttribute("role", "button");
    def.tabIndex = 0;
  }
  $("builderResists").innerHTML = resistRowHtml(ev?.resistances, { clickable: !empty });
  $("builderSkills").innerHTML = empty || !ev?.skills?.length
    ? `<p class="hint">Pick armor on the left, or run Auto Search and apply a result.</p>`
    : skillPillsHtml(ev.skills);
  $("builderSets").innerHTML = setBonusesHtml(ev?.setBonuses);
  $("builderImportSkills").classList.toggle("hidden", empty || !skillsFromSet(ev?.skills, ev?.setBonuses).length);
  $("builderSkillInfo").disabled = empty || !(ev?.skills?.length || ev?.setBonuses?.length);
  syncSkillAddables();
  syncStatChips();

  const missing = state.wanted
    .filter((w) => !w.setEffect)
    .filter((w) => (ev?.skills?.find((s) => s.id === w.id)?.level ?? 0) < w.level);
  $("builderMissing").innerHTML = !empty && missing.length
    ? `Still missing: ${missing.map((w) => {
        const have = ev?.skills?.find((s) => s.id === w.id)?.level ?? 0;
        return `<span class="missing-skill">${escapeHtml(w.name)} ${have}/${w.level}</span>`;
      }).join(" ")}`
    : "";
}

let buildEvalTimer = null;
let buildEvalSeq = 0;
function scheduleBuildEvaluate() {
  clearTimeout(buildEvalTimer);
  buildEvalTimer = setTimeout(evaluateBuild, 120);
}

async function evaluateBuild() {
  const seq = ++buildEvalSeq;
  const b = state.build;
  const body = {
    skills: state.wanted.map((s) => ({ id: s.id, level: s.level })),
    weaponSlots: weaponHostSlots(),
    armor: Object.fromEntries(BUILD_ARMOR.filter((k) => b.pieces[k]).map((k) => [k, b.pieces[k].id])),
    charm: b.charm ? { id: b.charm.id, level: b.charm.level } : null,
    decorationIds: Object.values(b.decos).flat().filter(Boolean).map((d) => d.id),
  };
  try {
    const ev = await api("/api/build/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (seq !== buildEvalSeq) return;
    state.buildEval = ev;
    fillBuildSkills(ev);
  } catch {
    if (seq !== buildEvalSeq) return;
    state.buildEval = null;
  }
  renderBuilderSummary();
}

/** Builds saved before pieces and charms kept their skills: copy them from the evaluated build. */
function fillBuildSkills(ev) {
  const b = state.build;
  let changed = false;
  for (const k of BUILD_ARMOR) {
    const p = b.pieces[k];
    if (p && !p.skills && ev[k]?.id === p.id) {
      p.skills = ev[k].skills;
      changed = true;
    }
  }
  const c = b.charm;
  if (c && !c.skills && ev.charmInfo?.id === c.id && ev.charmInfo.level === c.level) {
    c.skills = ev.charmInfo.skills;
    changed = true;
  }
  if (changed) {
    saveBuild();
    renderBuilder();
  }
}

/** Pins sent with Auto Search. */
function buildPinsForSearch() {
  const b = state.build;
  const pinnedArmor = Object.fromEntries(
    BUILD_ARMOR.filter((k) => b.pinned[k] && b.pieces[k]).map((k) => [k, b.pieces[k].id])
  );
  const pinnedCharm = b.pinned.charm && b.charm ? { id: b.charm.id, level: b.charm.level } : null;
  return { pinnedArmor, pinnedCharm };
}

async function applyResultToBuild(r) {
  if (!buildIsEmpty()) {
    const ok = await confirmDialog({
      title: "Replace build?",
      message: "Applying this result will replace your current build (armor, charm and jewels). Pins stay where they are.",
      confirmLabel: "Replace build",
    });
    if (!ok) return;
  }
  const b = state.build;
  for (const k of BUILD_ARMOR) {
    const p = r[k];
    b.pieces[k] = p && p.id ? { ...p, slot: k } : null;
  }
  b.charm = r.charmInfo && r.charmInfo.id ? charmRef(r.charmInfo) : null;

  const locKey = { Head: "head", Chest: "chest", Gloves: "gloves", Waist: "waist", Legs: "legs", Weapon: "weapon" };
  b.decos = { weapon: [], head: [], chest: [], gloves: [], waist: [], legs: [] };
  for (const loc of Object.keys(b.decos)) b.decos[loc] = hostSlots(loc).map(() => null);
  for (const p of r.decorationPlacements || []) {
    const loc = locKey[p.location];
    if (!loc) continue;
    const hosts = hostSlots(loc);
    const idx = hosts.findIndex((h, i) => h === p.slotSize && !b.decos[loc][i]);
    if (idx < 0) continue;
    b.decos[loc][idx] = { id: p.id, name: p.name, slotSize: p.decoSlotSize, iconColor: p.iconColor };
  }
  for (const k of Object.keys(b.pinned)) {
    if (b.pinned[k] && !(k === "charm" ? b.charm : b.pieces[k])) b.pinned[k] = false;
  }
  buildChanged();
  $("builder").scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Is this search-result piece the one pinned in the builder? */
function isResultPiecePinned(loc, r) {
  const b = state.build;
  if (!b.pinned[loc]) return false;
  if (loc === "charm") {
    const c = r.charmInfo;
    return !!(c?.id && b.charm && b.charm.id === c.id && b.charm.level === c.level);
  }
  return !!(r[loc]?.id && b.pieces[loc]?.id === r[loc].id);
}

/** Pin toggle on a result row: puts that piece into the builder slot and pins it, or unpins it. */
function toggleResultPin(loc, r) {
  const b = state.build;
  if (isResultPiecePinned(loc, r)) {
    b.pinned[loc] = false;
    saveBuild();
    renderBuilder();
    return;
  }
  if (loc === "charm") {
    const c = r.charmInfo;
    if (!c?.id) return;
    if (!(b.charm && b.charm.id === c.id && b.charm.level === c.level)) {
      setBuildPiece("charm", charmRef(c));
    }
  } else {
    const p = r[loc];
    if (!p?.id) return;
    if (b.pieces[loc]?.id !== p.id) setBuildPiece(loc, { ...p, slot: loc });
  }
  const entry = resultExcludeEntry(loc, r);
  if (entry && isExcludedKey(entry.key)) {
    removeExclude(entry.key);
    renderExclude();
  }
  b.pinned[loc] = true;
  saveBuild();
  renderBuilder();
}

function onBuilderClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const row = btn.closest(".bgear-row");
  const loc = row?.dataset.loc;
  if (!loc) return;
  const act = btn.dataset.act;

  if (act === "pick") {
    if (loc === "weapon") openModal("weapon", "Choose weapon");
    else if (loc === "charm") openBuilderPicker("bcharm", loc, "Choose charm");
    else openBuilderPicker("barmor", loc, `Choose ${BUILD_LABELS[loc].toLowerCase()}`);
  } else if (act === "pin") {
    state.build.pinned[loc] = !state.build.pinned[loc];
    saveBuild();
    renderBuilder();
  } else if (act === "clear") {
    if (loc === "weapon") {
      clearWeaponSelection();
      return;
    }
    setBuildPiece(loc, null);
  } else if (act === "deco") {
    const idx = Number(btn.dataset.idx);
    const host = hostSlots(loc)[idx];
    if (!host) return;
    openBuilderPicker("bdeco", loc, `Jewel for ${BUILD_LABELS[loc]} slot 【${host}】`, { idx, host });
  }
}

function openBuilderPicker(kind, loc, title, extra = {}) {
  openModal(kind, title, { loc, ...extra });
}

/** Bumped on every modal render so async renders that finish late can bail out. */
let modalRenderSeq = 0;
const BUILDER_PICKERS = new Set(["barmor", "bcharm", "bdeco"]);

const armorListCache = {};
async function armorForSlot(loc) {
  if (!armorListCache[loc]) {
    armorListCache[loc] = api(`/api/armor?${new URLSearchParams({ slot: loc, limit: "1000" })}`);
  }
  return armorListCache[loc];
}

let charmListCache = null;
function charmList() {
  charmListCache ||= api("/api/charms");
  return charmListCache;
}

const charmRef = (c) => ({ id: c.id, level: c.level, name: c.name, rarity: c.rarity, skills: c.skills });

function builderPickRow(html, active, onPick) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "pick-row" + (active ? " active" : "");
  row.innerHTML = html;
  row.onclick = onPick;
  return row;
}

function skillsText(list) {
  return (list || []).map((s) => `${s.name} ${s.level}`).join(", ");
}

/** Modal branches for the builder pickers (kinds in BUILDER_PICKERS). */
async function renderBuilderModal(kind, q, cats, pane, extra, seq) {
  const { loc } = state.modal;
  const addCats = (list, counts) => {
    const tabs = [ALL_TAB, ...list];
    if (!tabs.includes(state.modal.category)) state.modal.category = ALL_TAB;
    const total = counts ? list.reduce((sum, c) => sum + (counts[c] || 0), 0) : 0;
    for (const c of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-btn" + (c === state.modal.category ? " active" : "");
      btn.textContent = counts ? `${c} (${c === ALL_TAB ? total : counts[c]})` : c;
      btn.onclick = () => setModalCategory(c);
      cats.appendChild(btn);
    }
  };
  const matches = (name, skills, set = "") =>
    !q || name.toLowerCase().includes(q) || set.toLowerCase().includes(q) ||
    (skills || []).some((s) => String(s.name).toLowerCase().includes(q));

  if (kind === "barmor") {
    const all = (await armorForSlot(loc)).filter(
      (a) => (!a.gender || a.gender === state.gender) && matches(a.name, a.skills, a.set || "")
    );
    if (seq !== modalRenderSeq) return true;
    const rankOf = (a) => (a.rank === "master" ? "Master" : a.rank === "high" ? "High" : "Low");
    const ranks = ["Master", "High", "Low"];
    const counts = Object.fromEntries(ranks.map((r) => [r, all.filter((a) => rankOf(a) === r).length]));
    addCats(ranks.filter((r) => counts[r] > 0 || !q), counts);
    const current = state.build.pieces[loc];
    for (const a of all.filter((x) => state.modal.category === ALL_TAB || rankOf(x) === state.modal.category)) {
      const html = `<span class="pick-with-ico">${armorIcon(a.slot, a.rarity, { size: 20 })}<span>${escapeHtml(a.name)}${armorNoteTag(a.set)}<span class="sub"> ${escapeHtml(skillsText(a.skills))}</span></span></span>
        <span class="sub bpick-meta"><span class="piece-slots">${slotsIconsHtml(a.slots, { size: 16 })}</span><span style="color:${rarityColor(a.rarity)}">R${a.rarity}</span></span>`;
      pane.appendChild(builderPickRow(html, current?.id === a.id, () => {
        setBuildPiece(loc, { ...a, slot: loc });
        closeModal();
      }));
    }
    if (!pane.children.length) pane.innerHTML = `<p class="hint">No armor matches.</p>`;
    return true;
  }

  if (kind === "bcharm") {
    const all = (await charmList()).filter((c) => matches(c.name, c.skills));
    if (seq !== modalRenderSeq) return true;
    const current = state.build.charm;
    for (const c of all) {
      const html = `<span class="pick-with-ico">${armorIcon("charm", c.rarity, { size: 20 })}<span>${escapeHtml(c.name)}<span class="sub"> ${escapeHtml(skillsText(c.skills))}</span></span></span>
        <span class="sub" style="color:${rarityColor(c.rarity)}">R${c.rarity}</span>`;
      pane.appendChild(builderPickRow(html, current?.id === c.id && current?.level === c.level, () => {
        setBuildPiece("charm", charmRef(c));
        closeModal();
      }));
    }
    if (!all.length) pane.innerHTML = `<p class="hint">No charms match.</p>`;
    return true;
  }

  if (kind === "bdeco") {
    const { idx, host } = state.modal;
    const current = state.build.decos[loc]?.[idx];
    if (current) {
      extra.innerHTML = `<button type="button" class="btn small" id="bdecoRemove">Remove ${escapeHtml(current.name)}</button>`;
      $("bdecoRemove").onclick = () => {
        state.build.decos[loc][idx] = null;
        buildChanged();
        closeModal();
      };
    }
    const fits = state.decorations.filter((d) => d.slotSize <= host && matches(d.name, d.skills));
    const sizes = [];
    for (let s = host; s >= 1; s--) sizes.push(`Size ${s}`);
    const counts = Object.fromEntries(sizes.map((c) => [c, fits.filter((d) => `Size ${d.slotSize}` === c).length]));
    addCats(sizes.filter((c) => counts[c] > 0), counts);
    for (const d of fits.filter((x) => state.modal.category === ALL_TAB || `Size ${x.slotSize}` === state.modal.category)) {
      const html = `<span class="pick-with-ico">${decoIcon(d.slotSize, d.iconColor, { size: 22 })}<span>${escapeHtml(d.name)}<span class="sub"> ${escapeHtml(skillsText(d.skills))}</span></span></span>`;
      pane.appendChild(builderPickRow(html, current?.id === d.id, () => {
        state.build.decos[loc][idx] = { id: d.id, name: d.name, slotSize: d.slotSize, iconColor: d.iconColor };
        buildChanged();
        closeModal();
      }));
    }
    if (!fits.length) pane.innerHTML = `<p class="hint">No jewels match.</p>`;
    return true;
  }
  return false;
}
