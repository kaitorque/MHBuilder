/* Builder attack panel: weapon attack and affinity with the build's skills, conditional ones toggled by hand. */

const ATTACK_STORAGE_KEY = "mhbuilder.attack.v1";

/** Display attack = true attack × this, per weapon type. */
const WEAPON_BLOAT = {
  "great-sword": 4.8, "long-sword": 3.3, "sword-and-shield": 1.4, "dual-blades": 1.4, hammer: 5.2, "hunting-horn": 4.2,
  lance: 2.3, gunlance: 2.3, "switch-axe": 3.5, "charge-blade": 3.6, "insect-glaive": 3.1,
  bow: 1.2, "light-bowgun": 1.3, "heavy-bowgun": 1.5,
};

/**
 * Per-level values from the game's skill text. raw: flat true attack; mult: % of the total attack; aff: affinity %.
 * when: the condition, toggled by hand (no when = always on). options: a choice of conditions instead of a toggle.
 */
const ATTACK_SKILLS = [
  { name: "Attack Boost", raw: [3, 6, 9, 12, 15, 18, 21], aff: [0, 0, 0, 5, 5, 5, 5] },
  { name: "Critical Eye", aff: [5, 10, 15, 20, 25, 30, 40] },
  { name: "Agitator", when: "Monster enraged", raw: [4, 8, 12, 16, 20, 24, 28], aff: [5, 5, 7, 7, 10, 15, 20] },
  { name: "Peak Performance", when: "Health full", raw: [5, 10, 20] },
  { name: "Resentment", when: "Red health", raw: [5, 10, 15, 20, 25] },
  { name: "Coalescence", when: "After recovering from a blight", raw: [12, 15, 18] },
  { name: "Heroics", when: "Health 35% or lower", mult: [0, 5, 5, 10, 15, 25, 40] },
  { name: "Offensive Guard", when: "After a perfect guard", mult: [5, 10, 15] },
  { name: "Fortify", options: [{ label: "After 1 faint", mult: [10] }, { label: "After 2 faints", mult: [20] }] },
  {
    name: "Weakness Exploit",
    options: [{ label: "Weak spot", aff: [10, 15, 30] }, { label: "Wounded weak spot", aff: [15, 30, 50] }],
  },
  { name: "Latent Power", when: "Triggered", aff: [10, 20, 30, 40, 50, 50, 60] },
  { name: "Maximum Might", when: "Stamina full", aff: [10, 20, 30, 40, 40] },
  { name: "Critical Draw", when: "Draw attacks", aff: [30, 60, 100] },
  { name: "Affinity Sliding", when: "After sliding", aff: [30] },
];

const ATTACK_ITEMS = [
  { key: "powercharm", label: "Powercharm", raw: 6, on: true },
  { key: "powertalon", label: "Powertalon", raw: 9, on: true },
  { key: "demondrug", label: "Mega Demondrug", raw: 7 },
  { key: "mightseed", label: "Might Seed", raw: 10, group: "might" },
  { key: "demonpowder", label: "Demon Powder", raw: 10 },
  { key: "mightpill", label: "Might Pill", raw: 25, group: "might" },
];

const CRIT_BOOST = [1.3, 1.35, 1.4];
const SHARPNESS = [
  { name: "Red", raw: 0.5, color: "#d4483b" },
  { name: "Orange", raw: 0.75, color: "#e0873a" },
  { name: "Yellow", raw: 1, color: "#e2c43c" },
  { name: "Green", raw: 1.05, color: "#7cc04a" },
  { name: "Blue", raw: 1.2, color: "#3f8fe0" },
  { name: "White", raw: 1.32, color: "#eeeeee" },
  { name: "Purple", raw: 1.39, color: "#a865e8" },
];
const FREE_ELEMENT = [0.33, 0.66, 1];

const weaponDetailCache = new Map();
function weaponDetail(id) {
  if (!weaponDetailCache.has(id)) {
    weaponDetailCache.set(id, api(`/api/weapons/${id}`).catch((err) => {
      weaponDetailCache.delete(id);
      throw err;
    }));
  }
  return weaponDetailCache.get(id);
}

function attackToggles() {
  try {
    const saved = JSON.parse(localStorage.getItem(ATTACK_STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") return saved;
  } catch {
    /* corrupt storage: defaults */
  }
  return Object.fromEntries(ATTACK_ITEMS.filter((i) => i.on).map((i) => [i.key, true]));
}

const atAt = (table, level) => (table ? table[Math.min(level, table.length) - 1] ?? 0 : 0);
const signed = (n, unit = "") => `${n < 0 ? "−" : "+"}${Math.abs(n).toLocaleString("en-US")}${unit}`;
const fmt = (n) => Math.round(n).toLocaleString("en-US");

/** Sharpness color at the build's Handicraft level (the data is the Handicraft 5 bar; Handicraft 0 is 50 hits shorter). */
function topSharpness(w, handicraft) {
  if (!w.sharpness) return null;
  let left = w.sharpnessMaxed ? 400 : 350 + 10 * Math.min(handicraft, 5);
  let top = -1;
  const bar = w.sharpness.map((hits, i) => {
    const used = Math.max(0, Math.min(hits, left));
    left -= used;
    if (used > 0) top = i;
    return { hits, used };
  });
  return top < 0 ? null : { ...SHARPNESS[top], hits: bar[top].used, bar };
}

/** Element as shown in game; a hidden one counts only with Free Elem/Ammo Up (33 / 66 / 100%). */
function weaponElements(w, freeElem) {
  return (w.elements || []).map((e) => {
    const label = e.type.charAt(0).toUpperCase() + e.type.slice(1);
    if (!e.hidden) return { type: e.type, label, value: e.value, active: true };
    const value = freeElem ? Math.round(e.value * FREE_ELEMENT[Math.min(freeElem, 3) - 1]) : e.value;
    return { type: e.type, label, value, active: freeElem > 0, hidden: true };
  });
}

/** Rows and totals for the weapon with these skill levels and toggles. */
function attackModel(w, levels, toggles) {
  const bloat = WEAPON_BLOAT[w.type] || 1;
  const freeElem = levels["Free Elem/Ammo Up"] || 0;
  const elements = weaponElements(w, freeElem);
  const neb = levels["Non-elemental Boost"] > 0;
  const nebApplies = neb && !elements.some((e) => e.active);
  const weaponTrue = w.damage / bloat;

  const raw = [];
  const aff = [];
  raw.push({ label: "Weapon", always: true, display: w.damage });
  aff.push({ label: "Weapon", always: true, aff: w.affinity });
  if (neb) {
    raw.push(nebApplies
      ? { label: "Non-elemental Boost", always: true, mult: 5, base: true }
      : { label: "Non-elemental Boost", when: "No effect: the weapon has an element", always: true, inactive: true });
  }

  for (const s of ATTACK_SKILLS) {
    const level = levels[s.name] || 0;
    if (!level) continue;
    const name = `${s.name} ${level}`;
    const key = s.name;
    if (s.options) {
      const pick = Number(toggles[key]) || 0;
      const opt = s.options[pick - 1];
      const row = { label: name, key, options: s.options.map((o) => o.label), pick, on: !!opt };
      if (s.options[0].mult) raw.push({ ...row, mult: opt ? atAt(opt.mult, level) : atAt(s.options[0].mult, level) });
      else aff.push({ ...row, aff: opt ? atAt(opt.aff, level) : atAt(s.options[0].aff, level) });
      continue;
    }
    const on = !s.when || !!toggles[key];
    const base = { label: name, key, when: s.when, always: !s.when, on };
    if (s.raw) raw.push({ ...base, raw: atAt(s.raw, level) });
    if (s.mult && atAt(s.mult, level)) raw.push({ ...base, mult: atAt(s.mult, level) });
    if (s.aff && atAt(s.aff, level)) aff.push({ ...base, aff: atAt(s.aff, level) });
  }
  for (const it of ATTACK_ITEMS) {
    const others = it.group ? ATTACK_ITEMS.filter((o) => o.group === it.group && o !== it).map((o) => o.label) : [];
    raw.push({ label: it.label, key: it.key, item: true, on: !!toggles[it.key], raw: it.raw, note: others.length ? `Does not stack with ${others.join(" or ")}` : "" });
  }

  const total = (activeOnly) => {
    const use = (r) => !r.inactive && (r.always || (!activeOnly && r.on) || (activeOnly && r.item && r.on));
    let base = weaponTrue;
    let flat = 0;
    let mult = 1;
    for (const r of raw) {
      if (!use(r)) continue;
      if (r.base) base *= 1 + r.mult / 100;
      else if (r.mult) mult *= 1 + r.mult / 100;
      else if (r.raw) flat += r.raw;
    }
    const affinity = aff.filter((r) => !r.inactive && (r.always || (!activeOnly && r.on))).reduce((sum, r) => sum + r.aff, 0);
    return { trueAttack: (base + flat) * mult, affinity };
  };
  for (const r of raw) if (r.raw) r.display = r.raw * bloat;

  const now = total(false);
  const always = total(true);
  const affinity = Math.max(-100, Math.min(100, now.affinity));
  const critBoost = levels["Critical Boost"] || 0;
  const critMult = affinity < 0 ? 0.75 : critBoost ? CRIT_BOOST[Math.min(critBoost, 3) - 1] : 1.25;
  const avgCrit = 1 + (Math.abs(affinity) / 100) * (critMult - 1);
  const handicraft = levels.Handicraft || 0;
  const sharp = topSharpness(w, handicraft);
  return { bloat, elements, raw, aff, now, always, affinity, critBoost, critMult, avgCrit, sharp, handicraft };
}

function attackRowHtml(r, valueHtml) {
  let control = `<span class="atk-check"></span>`;
  let when = r.when ? `<span class="atk-when">${escapeHtml(r.when)}</span>` : "";
  if (r.options) {
    when = `<select class="atk-select" data-atk-pick="${escapeHtml(r.key)}">
      <option value="0">Not active</option>${r.options.map((o, i) => `<option value="${i + 1}"${r.pick === i + 1 ? " selected" : ""}>${escapeHtml(o)}</option>`).join("")}
    </select>`;
  } else if (!r.always) {
    control = `<input type="checkbox" data-atk="${escapeHtml(r.key)}"${r.on ? " checked" : ""} />`;
  }
  const cls = ["atk-row", r.always ? "" : "cond", r.on || r.always ? "on" : "", r.inactive ? "inactive" : ""].filter(Boolean).join(" ");
  const tag = r.options ? "div" : "label";
  return `<${tag} class="${cls}">${control}<span class="atk-name">${escapeHtml(r.label)}${when}</span><span class="atk-val">${valueHtml}</span></${tag}>`;
}

function rawValueHtml(r) {
  if (r.inactive) return "—";
  if (r.label === "Weapon") return fmt(r.display);
  if (r.mult != null) return `×${(1 + r.mult / 100).toFixed(2)}`;
  return `<span title="${r.raw} true attack">${signed(Math.round(r.display))}</span>`;
}

function attackWeaponHtml(w, m) {
  const els = m.elements.map((e) => {
    const icon = elementIcon(e.type, { size: 16 }) || statusIcon(e.type, { size: 16 });
    const tip = e.hidden ? (e.active ? "Hidden element unlocked by Free Elem/Ammo Up" : "Hidden: needs Free Elem/Ammo Up") : e.label;
    return `<span class="atk-el${e.active ? "" : " off"}" title="${tip}">${icon}${e.hidden ? `(${e.value})` : e.value}</span>`;
  }).join("");
  const sharp = m.sharp
    ? `<span class="atk-sharp" title="${m.sharp.name} sharpness at Handicraft ${m.handicraft}: ${m.sharp.hits} hits${w.sharpnessMaxed ? " (already full without Handicraft)" : ""}">
        <span class="atk-bar">${m.sharp.bar.map((s, i) => s.hits ? `<span style="flex:${s.hits};background:${SHARPNESS[i].color};opacity:${s.used ? 1 : 0.22}"></span>` : "").join("")}</span>
        ${m.sharp.name} ×${m.sharp.raw.toFixed(2)}</span>`
    : "";
  return `${weaponIcon(w.type, w.rarity, { size: 22, title: w.name })}<strong class="atk-weapon-name">${escapeHtml(w.name)}</strong>${els}${sharp}`;
}

function attackPanelHtml(w, m) {
  const affTotal = m.now.affinity;
  const capped = affTotal > 100 || affTotal < -100;
  const anyCond = m.raw.some((r) => !r.always && !r.item && r.on) || m.aff.some((r) => !r.always && r.on);
  const displayNow = m.now.trueAttack * m.bloat;
  const displayAlways = m.always.trueAttack * m.bloat;
  const effective = displayNow * m.avgCrit;
  const critLabel = m.affinity < 0 ? "Negative crits (×0.75)" : m.critBoost ? `Critical Boost ${m.critBoost}` : "Base crit damage";
  const sharpTip = m.sharp
    ? m.sharp.bar.map((s, i) => (s.used ? `${SHARPNESS[i].name} ×${SHARPNESS[i].raw.toFixed(2)}: ${fmt(effective * SHARPNESS[i].raw)}` : null))
        .filter(Boolean).reverse().join("&#10;")
    : "";

  return `
    <div class="atk-weapon">${attackWeaponHtml(w, m)}</div>
    <div class="atk-grid">
      <div class="atk-col">
        <div class="atk-head">Attack</div>
        ${m.raw.filter((r) => !r.item).map((r) => attackRowHtml(r, rawValueHtml(r))).join("")}
        <div class="atk-items">${m.raw.filter((r) => r.item).map((r) => `
          <label class="atk-item${r.on ? " on" : ""}" title="+${r.raw} true attack${r.note ? `. ${r.note}` : ""}"><input type="checkbox" data-atk="${r.key}"${r.on ? " checked" : ""} />${escapeHtml(r.label)} ${signed(Math.round(r.display))}</label>`).join("")}
        </div>
        <div class="atk-row atk-total"><span class="atk-check"></span><span class="atk-name">Total${anyCond ? `<span class="atk-when">Always on: ${fmt(displayAlways)}</span>` : ""}</span><span class="atk-val" title="${m.now.trueAttack.toFixed(1)} true attack">${fmt(displayNow)}</span></div>
      </div>
      <div class="atk-col">
        <div class="atk-head">Affinity</div>
        ${m.aff.map((r) => attackRowHtml(r, r.label === "Weapon" ? `${r.aff}%` : signed(r.aff, "%"))).join("")}
        <div class="atk-row atk-total"><span class="atk-check"></span><span class="atk-name">Total${capped ? `<span class="atk-when">${affTotal}% before the cap</span>` : anyCond ? `<span class="atk-when">Always on: ${Math.max(-100, Math.min(100, m.always.affinity))}%</span>` : ""}</span><span class="atk-val">${m.affinity}%</span></div>
      </div>
      <div class="atk-col">
        <div class="atk-head">Critical</div>
        <div class="atk-row on"><span class="atk-check"></span><span class="atk-name">Critical hit damage<span class="atk-when">${critLabel}</span></span><span class="atk-val">×${m.critMult.toFixed(2)}</span></div>
        <div class="atk-row on"><span class="atk-check"></span><span class="atk-name">Average per hit<span class="atk-when">${m.affinity}% affinity</span></span><span class="atk-val">×${m.avgCrit.toFixed(3)}</span></div>
        <div class="atk-row atk-total"><span class="atk-check"></span><span class="atk-name">Effective attack<span class="atk-when">Total × average crit</span></span><span class="atk-val" title="${(m.now.trueAttack * m.avgCrit).toFixed(1)} true attack">${fmt(effective)}</span></div>
        ${m.sharp ? `<div class="atk-row atk-total" title="${sharpTip}"><span class="atk-check"></span><span class="atk-name">With sharpness<span class="atk-when">${m.sharp.name} ×${m.sharp.raw.toFixed(2)}</span></span><span class="atk-val" title="${(m.now.trueAttack * m.avgCrit * m.sharp.raw).toFixed(1)} true attack&#10;&#10;${sharpTip}">${fmt(effective * m.sharp.raw)}</span></div>` : ""}
      </div>
    </div>
    <p class="hint atk-note">Display attack, as on the equipment screen. Hover a number for the true value. Heroics, Offensive Guard and Fortify multiply the total; Non-elemental Boost only the weapon's own attack.</p>`;
}

function attackSummaryHtml(w, m) {
  const displayNow = m.now.trueAttack * m.bloat;
  const effective = displayNow * m.avgCrit;
  const stat = (label, value, tip) => `<span class="atk-stat"${tip ? ` title="${tip}"` : ""}><span class="atk-stat-label">${label}</span>${value}</span>`;
  return `
    <div class="atk-weapon">${attackWeaponHtml(w, m)}</div>
    <div class="atk-summary">
      <span class="atk-stats">
        ${stat("Attack", fmt(displayNow), `Always on: ${fmt(m.always.trueAttack * m.bloat)}`)}
        ${stat("Affinity", `${m.affinity}%`)}
        ${stat("Effective", fmt(effective), "Attack × average crit")}
        ${m.sharp ? stat(m.sharp.name, fmt(effective * m.sharp.raw), `Effective attack × ${m.sharp.raw.toFixed(2)} sharpness`) : ""}
      </span>
      <button type="button" class="btn small" data-atk-open>Details…</button>
    </div>`;
}

let attackRenderSeq = 0;
async function renderAttackPanel() {
  const box = $("builderAttack");
  if (!box) return;
  const pane = state.modal?.kind === "damage" ? $("modalPane") : null;
  const seq = ++attackRenderSeq;
  const show = (html) => {
    box.innerHTML = html;
    if (pane) pane.innerHTML = html;
  };
  if (!state.weaponId) {
    show(`<p class="hint">Choose a weapon in the Weapon panel to see your attack, affinity and crit damage with this build's skills.</p>`);
    return;
  }
  let w;
  try {
    w = await weaponDetail(state.weaponId);
  } catch (err) {
    if (seq === attackRenderSeq) show(`<p class="hint error">${escapeHtml(err.message)}</p>`);
    return;
  }
  if (seq !== attackRenderSeq) return;
  const levels = Object.fromEntries((state.buildEval?.skills || []).map((s) => [s.name, s.level]));
  const m = attackModel(w, levels, attackToggles());
  box.innerHTML = attackSummaryHtml(w, m);
  if (pane) pane.innerHTML = `<div class="atk-panel">${attackPanelHtml(w, m)}</div>`;
}

function openDamageModal() {
  openModal("damage", "Weapon damage");
}

function initAttackPanel() {
  $("builderAttack").addEventListener("click", (e) => {
    if (e.target.closest("[data-atk-open]")) openDamageModal();
  });
  $("modalPane").addEventListener("change", (e) => {
    if (state.modal?.kind !== "damage") return;
    const t = e.target;
    const toggles = attackToggles();
    if (t.dataset.atk) {
      toggles[t.dataset.atk] = t.checked;
      const group = ATTACK_ITEMS.find((i) => i.key === t.dataset.atk)?.group;
      if (group && t.checked) {
        for (const i of ATTACK_ITEMS) if (i.group === group && i.key !== t.dataset.atk) toggles[i.key] = false;
      }
    } else if (t.dataset.atkPick) toggles[t.dataset.atkPick] = Number(t.value);
    else return;
    localStorage.setItem(ATTACK_STORAGE_KEY, JSON.stringify(toggles));
    renderAttackPanel();
  });
}
