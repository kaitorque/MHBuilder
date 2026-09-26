/* Saved set builds: named snapshots of the builder (armor, charm, jewels, weapon) kept in localStorage. */

const SAVED_SETS_KEY = "mhbuilder.savedSets.v1";
const SETS_EXPORT_KIND = "mhbuilder.sets";

const isSavedSet = (s) => !!s && typeof s.name === "string" && !!s.build && typeof s.build.pieces === "object";

function loadSavedSets() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_SETS_KEY) || "[]");
    return Array.isArray(list) ? list.filter(isSavedSet) : [];
  } catch {
    return [];
  }
}

function storeSavedSets(list) {
  localStorage.setItem(SAVED_SETS_KEY, JSON.stringify(list));
}

const newSetId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** "Fatalis β+ build" from the set most pieces belong to. */
function defaultBuildName() {
  const counts = new Map();
  for (const k of BUILD_ARMOR) {
    const set = state.build.pieces[k]?.set;
    if (set) counts.set(set, (counts.get(set) || 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]} build` : "My build";
}

/** "Fatalis β+ ×3 · Velkhana ×2 · Challenger Charm V" */
function savedSetSummary(s) {
  const counts = new Map();
  for (const k of BUILD_ARMOR) {
    const p = s.build.pieces?.[k];
    if (!p) continue;
    const label = p.set || p.name;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const parts = [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label));
  if (s.build.charm?.name) parts.push(s.build.charm.name);
  const jewels = Object.values(s.build.decos || {}).flat().filter(Boolean).length;
  if (jewels) parts.push(`${jewels} jewel${jewels > 1 ? "s" : ""}`);
  return parts.join(" · ") || "Empty build";
}

function savedSetGearHtml(s) {
  const icons = [];
  if (s.weapon?.id) icons.push(weaponIcon(s.weapon.type, s.weapon.rarity, { size: 20, title: s.weapon.name }));
  for (const k of BUILD_ARMOR) {
    const p = s.build.pieces?.[k];
    icons.push(p
      ? `<span title="${escapeHtml(p.name)}">${armorIcon(k, p.rarity, { size: 20 })}</span>`
      : `<span class="saved-empty" title="No ${BUILD_LABELS[k].toLowerCase()}">${armorIcon(k, 1, { size: 20 })}</span>`);
  }
  if (s.build.charm) icons.push(`<span title="${escapeHtml(s.build.charm.name)}">${armorIcon("charm", s.build.charm.rarity, { size: 20 })}</span>`);
  return icons.join("");
}

async function saveCurrentBuild(rawName) {
  const name = rawName.trim() || defaultBuildName();
  const list = loadSavedSets();
  const existing = list.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    const ok = await confirmDialog({
      title: "Replace saved build?",
      message: `“${existing.name}” already exists. Replace it with the current builder?`,
      confirmLabel: "Replace",
    });
    if (!ok) return false;
  }
  const entry = {
    id: existing?.id ?? newSetId(),
    name,
    savedAt: new Date().toISOString(),
    build: structuredClone(state.build),
    weapon: weaponSnapshot(),
    manualSlots: state.weaponId ? [] : parseManualSlots(),
  };
  storeSavedSets(existing ? list.map((s) => (s.id === existing.id ? entry : s)) : [entry, ...list]);
  return true;
}

async function loadSavedSet(s) {
  if (!buildIsEmpty()) {
    const ok = await confirmDialog({
      title: `Load “${s.name}”?`,
      message: "This replaces the builder's armor, charm, jewels, pins and weapon.",
      confirmLabel: "Load build",
    });
    if (!ok) return;
  }
  const blank = emptyBuild();
  const saved = structuredClone(s.build);
  state.build = {
    pieces: { ...blank.pieces, ...saved.pieces },
    charm: saved.charm || null,
    decos: { ...blank.decos, ...saved.decos },
    pinned: { ...blank.pinned, ...saved.pinned },
  };
  setWeapon(s.weapon?.id ? s.weapon : null, s.manualSlots || []);
  savePrefs();
  closeModal();
  renderWeaponSelected();
  $("builder").scrollIntoView({ behavior: "smooth", block: "start" });
}

function exportSavedSets(sets, filename) {
  downloadJson(filename, { kind: SETS_EXPORT_KIND, version: 1, exportedAt: new Date().toISOString(), sets });
}

async function importSavedSets() {
  let data;
  try {
    data = await pickJsonFile();
  } catch (err) {
    await noticeDialog("Can't import builds", err.message);
    return;
  }
  if (!data) return;
  const incoming = data.kind === SETS_EXPORT_KIND && Array.isArray(data.sets) ? data.sets.filter(isSavedSet) : [];
  if (!incoming.length) {
    await noticeDialog("Can't import builds", "That file isn't an MHBuilder saved-builds export.");
    return;
  }
  const list = loadSavedSets();
  let replaced = 0;
  for (const s of incoming) {
    const entry = { ...s, id: s.id || newSetId(), savedAt: s.savedAt || new Date().toISOString() };
    const i = list.findIndex((x) => x.id === entry.id);
    if (i >= 0) {
      list[i] = entry;
      replaced++;
      continue;
    }
    let name = entry.name;
    for (let n = 2; list.some((x) => x.name.toLowerCase() === name.toLowerCase()); n++) name = `${entry.name} (${n})`;
    list.unshift({ ...entry, name });
  }
  storeSavedSets(list);
  renderModal();
  const added = incoming.length - replaced;
  await noticeDialog(
    "Builds imported",
    `Added ${added} build${added === 1 ? "" : "s"}` + (replaced ? `, updated ${replaced} you already had.` : ".")
  );
}

function renderSavedSetsModal(q, cats, pane, extra) {
  const m = state.modal;
  const all = loadSavedSets();
  const list = all.filter((s) => !q || s.name.toLowerCase().includes(q) || savedSetSummary(s).toLowerCase().includes(q));

  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "cat-btn active";
  tab.textContent = `Saved (${all.length})`;
  cats.appendChild(tab);

  const empty = buildIsEmpty() && !state.weaponId;
  extra.innerHTML = `
    <input type="text" id="savedSetName" class="saved-name-input" maxlength="60" placeholder="${escapeHtml(defaultBuildName())}" value="${escapeHtml(m.draftName || "")}" />
    <button type="button" class="btn small primary" id="savedSetSave" ${empty ? "disabled" : ""} title="${empty ? "The builder is empty" : "Save the builder under this name"}">Save current</button>
    <button type="button" class="btn small ghost" id="savedSetImport" title="Add builds from a JSON file">Import</button>
    <button type="button" class="btn small ghost" id="savedSetExportAll" ${all.length ? "" : "disabled"} title="Download every saved build as JSON">Export all</button>`;
  const nameInput = $("savedSetName");
  nameInput.oninput = () => {
    m.draftName = nameInput.value;
  };
  const save = async () => {
    if (empty) return;
    if (await saveCurrentBuild(nameInput.value)) {
      m.draftName = "";
      renderModal();
    }
  };
  $("savedSetSave").onclick = save;
  nameInput.onkeydown = (e) => {
    if (e.key === "Enter") save();
  };
  $("savedSetImport").onclick = importSavedSets;
  $("savedSetExportAll").onclick = () => exportSavedSets(all, "mhbuilder-builds.json");

  if (!all.length) {
    pane.innerHTML = `<p class="hint">No saved builds yet. Fill the builder, give it a name above and press Save current.</p>`;
    return;
  }
  if (!list.length) {
    pane.innerHTML = `<p class="hint">No saved build matches “${escapeHtml($("modalSearch").value.trim())}”.</p>`;
    return;
  }
  for (const s of list) {
    const row = document.createElement("div");
    row.className = "pick-row saved-row";
    const when = new Date(s.savedAt);
    row.innerHTML = `
      <div class="saved-main">
        <div class="saved-title"><strong>${escapeHtml(s.name)}</strong>${Number.isNaN(when.getTime()) ? "" : `<span class="sub">${escapeHtml(when.toLocaleString())}</span>`}</div>
        <div class="saved-gear">${savedSetGearHtml(s)}</div>
        <div class="sub saved-summary">${escapeHtml(savedSetSummary(s))}${s.weapon?.name ? ` · ${escapeHtml(s.weapon.name)}` : ""}</div>
      </div>
      <div class="saved-actions">
        <button type="button" class="btn small primary" data-act="load">Load</button>
        <button type="button" class="btn small ghost" data-act="export" title="Download this build as JSON">Export</button>
        <button type="button" class="icon-btn" data-act="delete" title="Delete this saved build">${materialIcon("close")}</button>
      </div>`;
    row.onclick = async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "load") loadSavedSet(s);
      else if (act === "export") exportSavedSets([s], `mhbuilder-build-${fileSlug(s.name)}.json`);
      else if (act === "delete") {
        const ok = await confirmDialog({
          title: "Delete saved build?",
          message: `“${s.name}” will be removed from this browser. Export it first if you want a copy.`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        storeSavedSets(loadSavedSets().filter((x) => x.id !== s.id));
        renderModal();
      }
    };
    pane.appendChild(row);
  }
}
