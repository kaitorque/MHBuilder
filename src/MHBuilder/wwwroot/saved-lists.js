/* Saved exclude lists and deco lists: named snapshots kept in localStorage. Entries are { id, name, savedAt, data }. */

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const SAVED_LIST_TYPES = {
  exclude: {
    storageKey: "mhbuilder.savedExcludeLists.v1",
    exportKind: "mhbuilder.excludeLists",
    get singleKind() {
      return EXCLUDE_EXPORT_KIND;
    },
    noun: "exclude list",
    title: "Saved exclude lists",
    back: () => openModal("exclude", "Exclude armor & charms"),
    backLabel: "Back to exclude list",
    isEmpty: () => !state.exclude.length,
    snapshot: () => ({ exclude: state.exclude.map(({ id, level, name, slot }) => ({ id, level, name, slot })) }),
    valid: (d) => Array.isArray(d?.exclude),
    summary(d) {
      const charms = d.exclude.filter((x) => x.slot === "charm").length;
      const armor = d.exclude.length - charms;
      const names = d.exclude.map((x) => x.name).filter(Boolean);
      const shown = names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4} more` : "");
      const counts = [armor ? plural(armor, "armor piece") : "", charms ? plural(charms, "charm") : ""].filter(Boolean).join(" · ");
      return [counts || "Nothing excluded", shown].filter(Boolean).join(" · ");
    },
    async apply(d) {
      const { entries, unknown } = await excludeEntriesFrom(d.exclude);
      applyExcludeList(entries);
      return unknown;
    },
  },
  deco: {
    storageKey: "mhbuilder.savedDecoLists.v1",
    exportKind: "mhbuilder.decoLists",
    get singleKind() {
      return DECO_EXPORT_KIND;
    },
    noun: "deco list",
    title: "Saved deco lists",
    back: () => openModal("deco", "Decoration list"),
    backLabel: "Back to deco list",
    isEmpty: () => !ownedDecoList().length && state.unlimitedDecos,
    snapshot: () => ({ unlimited: state.unlimitedDecos, decorations: decoEntries(state.decoQty) }),
    valid: (d) => Array.isArray(d?.decorations),
    summary(d) {
      const total = d.decorations.reduce((a, x) => a + (Number(x.count) || 0), 0);
      return [`${plural(total, "jewel")} (${plural(d.decorations.length, "type")})`, d.unlimited ? "Unlimited on" : ""].filter(Boolean).join(" · ");
    },
    async apply(d) {
      const { qty, unknown } = decoQtyFrom(d.decorations);
      applyDecoList(qty, d.unlimited === true);
      return unknown;
    },
  },
};

function loadSavedLists(type) {
  const t = SAVED_LIST_TYPES[type];
  try {
    const list = JSON.parse(localStorage.getItem(t.storageKey) || "[]");
    return Array.isArray(list) ? list.filter((s) => s && typeof s.name === "string" && t.valid(s.data)) : [];
  } catch {
    return [];
  }
}

function storeSavedLists(type, list) {
  localStorage.setItem(SAVED_LIST_TYPES[type].storageKey, JSON.stringify(list));
}

function openSavedLists(type) {
  openModal("savedlists", SAVED_LIST_TYPES[type].title, { listType: type, draftName: "" });
}

const defaultListName = (type) => {
  const noun = SAVED_LIST_TYPES[type].noun;
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${loadSavedLists(type).length + 1}`;
};

async function saveCurrentList(type, rawName) {
  const name = rawName.trim() || defaultListName(type);
  const list = loadSavedLists(type);
  const existing = list.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    const ok = await confirmDialog({
      title: `Replace saved ${SAVED_LIST_TYPES[type].noun}?`,
      message: `“${existing.name}” already exists. Replace it with your current ${SAVED_LIST_TYPES[type].noun}?`,
      confirmLabel: "Replace",
    });
    if (!ok) return false;
  }
  const entry = { id: existing?.id ?? newSetId(), name, savedAt: new Date().toISOString(), data: SAVED_LIST_TYPES[type].snapshot() };
  storeSavedLists(type, existing ? list.map((s) => (s.id === existing.id ? entry : s)) : [entry, ...list]);
  return true;
}

async function loadSavedList(type, s) {
  const t = SAVED_LIST_TYPES[type];
  if (!t.isEmpty()) {
    const ok = await confirmDialog({
      title: `Load “${s.name}”?`,
      message: `This replaces your current ${t.noun}.`,
      confirmLabel: "Load",
    });
    if (!ok) return;
  }
  const unknown = await t.apply(s.data);
  t.back();
  if (unknown) {
    await noticeDialog(`Loaded “${s.name}”`, unknown === 1
      ? "1 entry isn't in the current data and was skipped."
      : `${unknown} entries aren't in the current data and were skipped.`);
  }
}

function exportSavedList(type, s) {
  const t = SAVED_LIST_TYPES[type];
  downloadJson(`mhbuilder-${t.noun.replace(" ", "-")}-${fileSlug(s.name)}.json`, {
    kind: t.singleKind,
    version: 1,
    exportedAt: new Date().toISOString(),
    name: s.name,
    ...s.data,
  });
}

function exportAllSavedLists(type, lists) {
  const t = SAVED_LIST_TYPES[type];
  downloadJson(`mhbuilder-${t.noun.replace(" ", "-")}s.json`, { kind: t.exportKind, version: 1, exportedAt: new Date().toISOString(), lists });
}

/** Takes an export of every saved list, or a single list (the exclude / deco modal's own Export). */
async function importSavedLists(type) {
  const t = SAVED_LIST_TYPES[type];
  let data;
  try {
    data = await pickJsonFile();
  } catch (err) {
    await noticeDialog(`Can't import ${t.noun}s`, err.message);
    return;
  }
  if (!data) return;
  let incoming = [];
  if (data.kind === t.exportKind && Array.isArray(data.lists)) {
    incoming = data.lists.filter((s) => s && typeof s.name === "string" && t.valid(s.data));
  } else if (data.kind === t.singleKind && t.valid(data)) {
    const { kind, version, exportedAt, name, ...rest } = data;
    incoming = [{ name: typeof name === "string" && name.trim() ? name.trim() : `Imported ${t.noun}`, data: rest }];
  }
  if (!incoming.length) {
    await noticeDialog(`Can't import ${t.noun}s`, `That file isn't an MHBuilder ${t.noun} export.`);
    return;
  }
  const list = loadSavedLists(type);
  let replaced = 0;
  for (const s of incoming) {
    const entry = { id: s.id || newSetId(), name: s.name, savedAt: s.savedAt || new Date().toISOString(), data: s.data };
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
  storeSavedLists(type, list);
  renderModal();
  const added = incoming.length - replaced;
  await noticeDialog(
    `${t.noun.charAt(0).toUpperCase()}${t.noun.slice(1)}s imported`,
    `Added ${plural(added, t.noun)}` + (replaced ? `, updated ${replaced} you already had.` : ".")
  );
}

function renderSavedListsModal(q, cats, pane, extra) {
  const m = state.modal;
  const type = m.listType;
  const t = SAVED_LIST_TYPES[type];
  const all = loadSavedLists(type);
  const list = all.filter((s) => !q || s.name.toLowerCase().includes(q) || t.summary(s.data).toLowerCase().includes(q));

  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "cat-btn active";
  tab.textContent = `Saved (${all.length})`;
  cats.appendChild(tab);

  const empty = t.isEmpty();
  extra.innerHTML = `
    <button type="button" class="btn small ghost" id="savedListBack">${escapeHtml(t.backLabel)}</button>
    <input type="text" id="savedListName" class="saved-name-input" maxlength="60" placeholder="${escapeHtml(defaultListName(type))}" value="${escapeHtml(m.draftName || "")}" />
    <button type="button" class="btn small primary" id="savedListSave" ${empty ? "disabled" : ""} title="${empty ? `Your ${t.noun} is empty` : `Save your current ${t.noun} under this name`}">Save current</button>
    <button type="button" class="btn small ghost" id="savedListImport" title="Add ${t.noun}s from a JSON file">Import</button>
    <button type="button" class="btn small ghost" id="savedListExportAll" ${all.length ? "" : "disabled"} title="Download every saved ${t.noun} as JSON">Export all</button>`;
  $("savedListBack").onclick = t.back;
  const nameInput = $("savedListName");
  nameInput.oninput = () => {
    m.draftName = nameInput.value;
  };
  const save = async () => {
    if (empty) return;
    if (await saveCurrentList(type, nameInput.value)) {
      m.draftName = "";
      renderModal();
    }
  };
  $("savedListSave").onclick = save;
  nameInput.onkeydown = (e) => {
    if (e.key === "Enter") save();
  };
  $("savedListImport").onclick = () => importSavedLists(type);
  $("savedListExportAll").onclick = () => exportAllSavedLists(type, all);

  if (!all.length) {
    pane.innerHTML = `<p class="hint">No saved ${t.noun}s yet. Give your current one a name above and press Save current.</p>`;
    return;
  }
  if (!list.length) {
    pane.innerHTML = `<p class="hint">No saved ${t.noun} matches “${escapeHtml($("modalSearch").value.trim())}”.</p>`;
    return;
  }
  for (const s of list) {
    const row = document.createElement("div");
    row.className = "pick-row saved-row";
    const when = new Date(s.savedAt);
    row.innerHTML = `
      <div class="saved-main">
        <div class="saved-title"><strong>${escapeHtml(s.name)}</strong>${Number.isNaN(when.getTime()) ? "" : `<span class="sub">${escapeHtml(when.toLocaleString())}</span>`}</div>
        <div class="sub saved-summary">${escapeHtml(t.summary(s.data))}</div>
      </div>
      <div class="saved-actions">
        <button type="button" class="btn small primary" data-act="load">Load</button>
        <button type="button" class="btn small ghost" data-act="export" title="Download this ${t.noun} as JSON">Export</button>
        <button type="button" class="icon-btn" data-act="delete" title="Delete this saved ${t.noun}">${materialIcon("close")}</button>
      </div>`;
    row.onclick = async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "load") loadSavedList(type, s);
      else if (act === "export") exportSavedList(type, s);
      else if (act === "delete") {
        const ok = await confirmDialog({
          title: `Delete saved ${t.noun}?`,
          message: `“${s.name}” will be removed from this browser. Export it first if you want a copy.`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        storeSavedLists(type, loadSavedLists(type).filter((x) => x.id !== s.id));
        renderModal();
      }
    };
    pane.appendChild(row);
  }
}
