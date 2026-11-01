import {
  PART_BY_ID, AREA_BY_KEY, REGION_LABEL, NARRATORS, STYLES, AMBIENCES, TRANSITIONS, describe, expandParts,
} from './content.js';
import {
  DEFAULT_CONFIG, LEVELS, NODES, REGIONS, modeKey, nodeScope, setsFor, nodeLeaves, nodeStatus, status, toggleNode, toggleId, toggleSet, setIds,
  regionIds, regionStatus, toggleRegion, wholeBody, changeMode, changeLevel, inferConfig,
  canonicalOrder, mergeOrder, migrateSelected, migrateDirection,
} from './selection.js';
import { planSession } from './timing.js';
import { AudioEngine } from './audio.js';
import { Session } from './session.js';
import { createBodyDiagram } from './body.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'bodyscan.v1';
const PRESETS = [5, 10, 15, 20, 30, 45];
const MIN_MINUTES = 1;
const MAX_MINUTES = 90;
const MAX_PROFILES = 12;

const DEFAULTS = {
  schema: 2,
  minutes: 10,
  ...DEFAULT_CONFIG,           // armMode, legMode, handMode, footMode, handLevel, footLevel, firstSide
  selected: wholeBody(DEFAULT_CONFIG),
  direction: 'down',           // 'down' head to toe, 'up' toe to head, 'custom' uses `order`
  order: canonicalOrder('down', DEFAULT_CONFIG),
  style: 'guided',
  narrator: 'ava',
  voiceVolume: 0.9,
  voiceMuted: false,
  soundVolume: 0.5,
  soundMuted: false,
  ambience: 'none',
  transition: 'chime',
  theme: 'system',
  countIntro: true,
  countOutro: true,
  partsView: 'diagram',
  recent: [],
  profiles: [],            // saved favourites: { id, name, data }
  activeProfile: null,       // id of the profile last loaded or saved
};

// ---------------------------------------------------------------- state
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    const s = fromSaved(saved);
    // Version 1 saved fewer, coarser parts and a full order list; translate them.
    if (saved.schema !== 2 && Array.isArray(saved.selected)) {
      s.selected = migrateSelected(saved.selected);
      s.direction = migrateDirection(saved.order);
      s.order = Array.isArray(saved.order) ? saved.order : [];
      Object.assign(s, inferConfig(s.selected, DEFAULT_CONFIG));
    }
    return normalize(s, saved.schema !== 2);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

// Defaults plus whatever was saved. Older saves had no setting for hands and feet (they followed the arms and legs),
// and "both hands in detail" no longer exists as one step (it is palms, backs of hands and fingers).
function fromSaved(data) {
  const s = { ...structuredClone(DEFAULTS), ...structuredClone(data) };
  if (!('handMode' in data)) s.handMode = s.armMode;
  if (!('footMode' in data)) s.footMode = s.legMode;
  const swap = { handsDetail: ['palms', 'backHands', 'fingers'], feetDetail: ['heels', 'soles', 'tops', 'toes'] };
  for (const k of ['selected', 'order']) {
    if (Array.isArray(s[k])) s[k] = s[k].flatMap((id) => swap[id] ?? [id]);
  }
  if (Array.isArray(s.recent)) {
    s.recent = s.recent.map((r) => (r && Array.isArray(r.parts) ? { ...r, parts: r.parts.flatMap((id) => swap[id] ?? [id]) } : r));
  }
  return s;
}

// Guard against stale, edited or damaged data (also used for saved profiles).
function normalize(s, migrate = false) {
  s.schema = 2;
  s.selected = [...new Set((Array.isArray(s.selected) ? s.selected : []).filter((id) => PART_BY_ID[id]))];
  if (!['together', 'separate'].includes(s.armMode)) s.armMode = DEFAULT_CONFIG.armMode;
  if (!['together', 'separate'].includes(s.legMode)) s.legMode = DEFAULT_CONFIG.legMode;
  if (!['together', 'separate'].includes(s.handMode)) s.handMode = s.armMode;
  if (!['together', 'separate'].includes(s.footMode)) s.footMode = s.legMode;
  if (!LEVELS.includes(s.handLevel)) s.handLevel = DEFAULT_CONFIG.handLevel;
  if (!LEVELS.includes(s.footLevel)) s.footLevel = DEFAULT_CONFIG.footLevel;
  if (!['L', 'R'].includes(s.firstSide)) s.firstSide = DEFAULT_CONFIG.firstSide;
  if (!['down', 'up', 'custom'].includes(s.direction)) s.direction = 'down';
  // Choices that only make sense together (e.g. named fingers need one arm at a time); drop limb ids the UI can't show.
  Object.assign(s, inferConfig([], s));
  s.selected = s.selected.filter((id) => {
    const p = PART_BY_ID[id];
    if (!p?.limb) return true;
    if (!setsFor(s, p.limb, p.scope).includes(p.set)) return false;
    // hand and foot steps must belong to the chosen level (not e.g. both "in detail" and "palm")
    return p.scope !== 'detail' || nodeLeaves(p.limb, p.set, p.limb === 'arm' ? 'hand' : 'foot', p.limb === 'arm' ? s.handLevel : s.footLevel).includes(id);
  });
  s.order = mergeOrder(Array.isArray(s.order) ? s.order : [], canonicalOrder('down', s));
  if (!['system', 'light', 'dark'].includes(s.theme)) s.theme = DEFAULTS.theme;
  for (const k of ['voiceVolume', 'soundVolume']) s[k] = Number.isFinite(s[k]) ? Math.min(1, Math.max(0, s[k])) : DEFAULTS[k];
  s.recent = (Array.isArray(s.recent) ? s.recent : [])
    .filter((r) => r && Array.isArray(r.parts) && Number.isFinite(r.minutes))
    .map((r) => ({ ...r, parts: migrate ? migrateSelected(r.parts) : r.parts.filter((id) => PART_BY_ID[id]) }))
    .filter((r) => r.parts.length)
    .slice(0, 3);
  s.profiles = (Array.isArray(s.profiles) ? s.profiles : [])
    .filter((p) => p && typeof p.id === 'string' && /^[a-z0-9]{1,24}$/.test(p.id) && typeof p.name === 'string' && p.name.trim() && p.data && typeof p.data === 'object')
    .slice(0, MAX_PROFILES);
  if (!s.profiles.some((p) => p.id === s.activeProfile)) s.activeProfile = null;
  if (!NARRATORS.some((n) => n.id === s.narrator)) s.narrator = DEFAULTS.narrator;
  if (!STYLES[s.style]) s.style = DEFAULTS.style;
  if (!AMBIENCES[s.ambience]) s.ambience = DEFAULTS.ambience;
  if (!TRANSITIONS[s.transition]) s.transition = DEFAULTS.transition;
  s.minutes = clampMinutes(s.minutes);
  return s;
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

const state = load();
const engine = new AudioEngine();
let durations = null; // narrator -> clip id -> seconds
let session = null;
let wakeLock = null;

function clampMinutes(m) { return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(Number(m) || 10))); }
// Every part in the current order, selected or not. Head to toe and toe to head are computed;
// a custom order (after moving a part) is kept as saved.
function fullOrder() {
  const canonical = canonicalOrder(state.direction === 'up' ? 'up' : 'down', state);
  return state.direction === 'custom' ? mergeOrder(state.order, canonical) : canonical;
}
const scanOrder = () => fullOrder().filter((id) => state.selected.includes(id));
// The steps that are really played: items chosen "in detail" expand into their parts, each with its own share of the time.
const planParts = () => expandParts(scanOrder());

function currentPlan() {
  if (!durations) return null;
  return planSession({
    totalSeconds: state.minutes * 60,
    parts: planParts(),
    style: state.style,
    transition: state.transition,
    durations: durations[state.narrator],
    countIntro: state.countIntro,
    countOutro: state.countOutro,
  });
}

// ---------------------------------------------------------------- formatting
const nf = new Intl.NumberFormat('de-DE'); // EU style: 1.785
function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fmtDuration(sec) {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return `${r} s`;
  return r ? `${nf.format(m)} min ${r} s` : `${nf.format(m)} min`;
}

// ---------------------------------------------------------------- theme
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  const dark = state.theme === 'dark' || (state.theme === 'system' && darkQuery.matches);
  $('theme-color').setAttribute('content', dark ? '#11181a' : '#f5f3ee');
  $('status-style').setAttribute('content', dark ? 'black-translucent' : 'default');
}
darkQuery.addEventListener?.('change', applyTheme);

// ---------------------------------------------------------------- radio chips
function renderRadios(container, name, options, value, onChange, extra) {
  container.replaceChildren(...Object.entries(options).map(([val, label]) => {
    const wrap = document.createElement('label');
    wrap.className = 'chip';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = val;
    input.checked = String(val) === String(value);
    input.addEventListener('change', () => onChange(val));
    const span = document.createElement('span');
    span.textContent = label;
    wrap.append(input, span);
    extra?.(wrap, val);
    return wrap;
  }));
}

// ---------------------------------------------------------------- duration
function renderDuration() {
  renderRadios($('duration-presets'), 'duration',
    Object.fromEntries(PRESETS.map((m) => [m, `${m} min`])), state.minutes,
    (m) => { state.minutes = Number(m); changed(); });
  $('dur-value').textContent = `${nf.format(state.minutes)} min`;
  $('dur-minus').disabled = state.minutes <= MIN_MINUTES;
  $('dur-plus').disabled = state.minutes >= MAX_MINUTES;
}
$('dur-minus').addEventListener('click', () => { state.minutes = clampMinutes(state.minutes - 1); changed(); });
$('dur-plus').addEventListener('click', () => { state.minutes = clampMinutes(state.minutes + 1); changed(); });

function renderHint() {
  const plan = currentPlan();
  const hint = $('dur-hint');
  hint.classList.remove('warn');
  if (!plan) { hint.textContent = ''; return; }
  if (plan.ok) {
    const { min, max } = plan.perPart;
    hint.textContent = min === max
      ? `Each body part gets ${fmtDuration(min)}.`
      : `Each body part gets ${fmtDuration(min)} to ${fmtDuration(max)}.`;
    if (plan.totalSeconds > plan.chosenSeconds) {
      hint.textContent += ` With the ${addedOnTop(plan)} added, the session lasts ${fmtDuration(plan.totalSeconds)}.`;
    }
  } else if (plan.reason === 'too-short') {
    hint.classList.add('warn');
    hint.textContent = `Too short for ${planParts().length} body parts. Choose at least ${plan.minMinutes} min, or fewer body parts.`;
  } else {
    hint.textContent = '';
  }
}

// "opening", "closing" or "opening and closing": the parts added on top of the chosen length.
function addedOnTop(plan) {
  return [!plan.countIntro && plan.introSec && 'opening', !plan.countOutro && 'closing'].filter(Boolean).join(' and ');
}

// ---------------------------------------------------------------- body parts
const modeOf = (limb, node) => state[modeKey(limb, nodeScope(limb, node))];
const levelOf = (limb) => (limb === 'arm' ? state.handLevel : state.footLevel);
// Which set a tap on one side means: in "together" either side is the pair.
const setOf = (limb, side, node) => (modeOf(limb, node) === 'together' ? 'B' : side);

const diagram = createBodyDiagram($('body-diagram'), {
  coreStatus: (id) => (state.selected.includes(id) ? 'on' : 'off'),
  limbStatus: (limb, side, node) => nodeStatus(state.selected, limb, setOf(limb, side, node), node, state),
  isTogether: (limb, node) => modeOf(limb, node) === 'together',
  label: (limb, side, node) => describe(limb, AREA_BY_KEY[limb][node], setOf(limb, side, node)).title,
  toggleCore: (id) => togglePart(id),
  toggleLimb: (limb, side, node) => { state.selected = toggleNode(state.selected, limb, setOf(limb, side, node), node, state); changed(); },
});

function togglePart(id, on = !state.selected.includes(id)) {
  state.selected = on ? [...state.selected.filter((x) => x !== id), id] : state.selected.filter((x) => x !== id);
  changed();
}

// --- region chips: Head and neck / Torso / Arms / Legs, the quickest way to start
function renderRegions() {
  const box = $('region-chips');
  if (!box.childElementCount) {
    for (const region of REGIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'region-chip';
      b.dataset.region = region;
      b.addEventListener('click', () => { state.selected = toggleRegion(state.selected, region, state); changed(); });
      box.append(b);
    }
  }
  for (const b of box.children) {
    const region = b.dataset.region;
    const st = regionStatus(state.selected, region, state);
    b.textContent = REGION_LABEL[region];
    b.dataset.state = st;
    b.setAttribute('aria-pressed', st === 'on' ? 'true' : st === 'partial' ? 'mixed' : 'false');
  }
}

// --- list: head, torso, arms and legs as groups you can open
const openGroups = new Set(); // everything starts closed: each group's checkbox and count already give the overview
let filterText = '';

function partMatches(id) {
  if (!filterText) return true;
  const p = PART_BY_ID[id];
  return `${p.name} ${p.keywords}`.toLowerCase().includes(filterText);
}

function checkRow(key, label, st, onChange) {
  const li = document.createElement('li');
  const row = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = st === 'on';
  input.indeterminate = st === 'partial';
  input.dataset.key = key;
  input.addEventListener('change', onChange);
  const name = document.createElement('span');
  name.textContent = label;
  row.append(input, name);
  li.append(row);
  return li;
}

// A group has its own checkbox (all / some / none), a count, and a button that opens it.
const seenGroups = new Set();
function groupRow(key, title, ids, onToggle, children, { nested = false, defaultOpen = false } = {}) {
  const items = children.filter(Boolean);
  if (!items.length) return null;
  if (defaultOpen && !seenGroups.has(key)) { seenGroups.add(key); openGroups.add(key); }
  const li = document.createElement('li');
  li.className = `tree-group${nested ? ' nested' : ''}`;
  const head = document.createElement('div');
  head.className = 'tree-head';
  const st = status(state.selected, ids);
  const n = ids.filter((id) => state.selected.includes(id)).length;
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = st === 'on';
  input.indeterminate = st === 'partial';
  input.dataset.key = `${key}:all`;
  input.addEventListener('change', onToggle);
  const name = document.createElement('span');
  name.textContent = title;
  label.append(input, name);
  const count = document.createElement('span');
  count.className = 'tree-count';
  count.textContent = `${n} of ${ids.length}`;
  const open = !!filterText || openGroups.has(key);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tree-toggle';
  toggle.dataset.key = `${key}:open`;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', `${title} details`);
  toggle.disabled = !!filterText; // while filtering, matching groups stay open
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  toggle.addEventListener('click', () => {
    if (openGroups.has(key)) openGroups.delete(key); else openGroups.add(key);
    renderPartTree(`${key}:open`);
  });
  head.append(label, count, toggle);
  const ul = document.createElement('ul');
  ul.className = 'tree-children';
  ul.hidden = !open;
  ul.append(...items);
  li.append(head, ul);
  return li;
}

function nodeRows(limb, set, nodes = NODES[limb], flat = false) {
  const level = levelOf(limb);
  return nodes.flatMap((node) => {
    const a = AREA_BY_KEY[limb][node];
    const ids = nodeLeaves(limb, set, node, level);
    const base = describe(limb, a, set);
    const detailNode = node === 'hand' || node === 'foot';
    if (!detailNode || level === 'whole' || level === 'detailed') {
      if (!partMatches(ids[0])) return [];
      return [checkRow(ids[0], PART_BY_ID[ids[0]].label ?? base.label, nodeStatus(state.selected, limb, set, node, state), () => {
        state.selected = toggleNode(state.selected, limb, set, node, state); changed();
      })];
    }
    // Hands and feet split into parts: the hand becomes a group of palm, back of hand, fingers.
    const leaves = ids.filter(partMatches).map((id) => {
      const p = PART_BY_ID[id];
      return checkRow(id, describe(limb, AREA_BY_KEY[limb][p.key], set).label, state.selected.includes(id) ? 'on' : 'off', () => {
        state.selected = toggleId(state.selected, id); changed();
      });
    });
    if (flat) return leaves; // already inside a group named for this hand or foot
    return [groupRow(`${limb}${set}:${node}`, base.label, ids,
      () => { state.selected = toggleNode(state.selected, limb, set, node, state); changed(); },
      leaves, { nested: true, defaultOpen: true })];
  });
}

// What sits under "Arms" or "Legs": the areas for both sides, or a group per side. Hands and feet follow
// their own setting, so with arms together and hands one at a time you get the areas, then "Left hand", "Right hand".
function limbChildren(limb) {
  const nodes = NODES[limb];
  const detailNode = nodes.at(-1);
  const limbSets = setsFor(state, limb, 'limb');
  const detailSets = setsFor(state, limb, 'detail');
  const runs = limbSets.join() === detailSets.join()
    ? [{ sets: limbSets, nodes, name: limb }]
    : [{ sets: limbSets, nodes: nodes.slice(0, -1), name: limb }, { sets: detailSets, nodes: [detailNode], name: limb === 'arm' ? 'hand' : 'foot' }];
  return runs.flatMap(({ sets, nodes: runNodes, name }) => (sets.length === 1
    ? nodeRows(limb, 'B', runNodes)
    : sets.map((set) => groupRow(`${limb}${set}:${name}`, `${set === 'L' ? 'Left' : 'Right'} ${name}`,
      setIds(limb, set, state),
      () => { state.selected = toggleSet(state.selected, limb, set, state); changed(); },
      nodeRows(limb, set, runNodes, runNodes.length === 1), { nested: true }))));
}

function renderPartTree(focusKey) {
  const tree = $('part-tree');
  const wanted = focusKey ?? (tree.contains(document.activeElement) ? document.activeElement.dataset.key : null);
  const rows = [];
  for (const region of ['head', 'torso']) {
    const ids = regionIds(region, state);
    rows.push(groupRow(region, REGION_LABEL[region], ids,
      () => { state.selected = toggleRegion(state.selected, region, state); changed(); },
      ids.filter(partMatches).map((id) => checkRow(id, PART_BY_ID[id].name, state.selected.includes(id) ? 'on' : 'off', () => togglePart(id)))));
  }
  for (const [region, limb] of [['arms', 'arm'], ['legs', 'leg']]) {
    rows.push(groupRow(region, REGION_LABEL[region], regionIds(region, state),
      () => { state.selected = toggleRegion(state.selected, region, state); changed(); }, limbChildren(limb)));
  }
  const shown = rows.filter(Boolean);
  tree.replaceChildren(...shown);
  $('filter-empty').hidden = shown.length > 0;
  if (wanted) tree.querySelector(`[data-key="${CSS.escape(wanted)}"]`)?.focus();
}

$('part-filter').addEventListener('input', (e) => {
  filterText = e.target.value.trim().toLowerCase();
  renderPartTree();
});

$('select-all').addEventListener('click', () => { state.selected = wholeBody(state); changed(); });
$('select-none').addEventListener('click', () => { state.selected = []; changed(); });

function renderSelectionSummary() {
  const n = state.selected.length;
  $('selection-summary').textContent = `${nf.format(n)} body part${n === 1 ? '' : 's'} selected`;
  $('selection-error').hidden = n > 0;
}

// --- arms, legs, hands and feet: each is "together" or "one at a time", on its own
const UNITS = {
  arm: { limb: 'arm', scope: 'limb', plural: 'arms', single: 'arm', digit: null },
  leg: { limb: 'leg', scope: 'limb', plural: 'legs', single: 'leg', digit: null },
  hand: { limb: 'arm', scope: 'detail', plural: 'hands', single: 'hand', digit: 'finger' },
  foot: { limb: 'leg', scope: 'detail', plural: 'feet', single: 'foot', digit: 'toe' },
};
// The group's heading already says which part ("Hands"), so the options only say how.
const MODE_OPTIONS = { together: 'Both together', separate: 'One at a time' };
// From simplest to most detailed. [name, what it does, needs one side at a time]
const LEVEL_INFO = {
  hand: {
    whole: ['Whole hand', 'One step for the whole hand.'],
    detailed: ['Whole hand in detail', 'Palm, back of the hand, then each finger in turn, each with its own voice line and time.', true],
    parts: ['Palm, back, fingers', 'Three steps you can switch on or off.'],
    named: ['Each finger named', 'Palm, back of the hand and all five fingers as separate steps you can pick.', true],
  },
  foot: {
    whole: ['Whole foot', 'One step for the whole foot.'],
    detailed: ['Whole foot in detail', 'Heel, sole, top of the foot, then each toe in turn, each with its own voice line and time.', true],
    parts: ['Heel, sole, top, toes', 'Four steps you can switch on or off.'],
    named: ['Each toe named', 'Heel, sole, top of the foot and all five toes as separate steps you can pick.', true],
  },
};

// Radio rows with a title, a one-line description and a tag for options that need one side at a time.
function renderLevelRows(container, name, info, value, onChange) {
  container.replaceChildren(...Object.entries(info).map(([val, [title, text, sides]]) => {
    const label = document.createElement('label');
    label.className = 'choice';
    label.innerHTML = '<input type="radio"><span class="choice-text"><strong></strong><small></small></span>';
    const input = label.querySelector('input');
    input.name = name;
    input.value = val;
    input.checked = val === value;
    input.addEventListener('change', () => onChange(val));
    label.querySelector('strong').textContent = title;
    label.querySelector('small').textContent = text;
    if (sides) {
      const tag = document.createElement('span');
      tag.className = 'choice-tag';
      tag.textContent = 'One side at a time';
      label.querySelector('.choice-text').append(tag);
    }
    return label;
  }));
}
const FIRST_OPTIONS = { L: 'Left first', R: 'Right first' };
const HAND_OPTIONS = { whole: 'Whole hand', detailed: 'Whole hand in detail', parts: 'Palm, back, fingers', named: 'Each finger named' };
const FOOT_OPTIONS = { whole: 'Whole foot', detailed: 'Whole foot in detail', parts: 'Heel, sole, top, toes', named: 'Each toe named' };
const needsSides = (level) => level === 'named' || level === 'detailed';

function say(text) { $('detail-status').textContent = text; }

function setMode(unit, mode) {
  const u = UNITS[unit];
  const key = modeKey(u.limb, u.scope);
  if (state[key] === mode) return;
  state.selected = changeMode(state.selected, u.limb, u.scope, state[key], mode);
  state[key] = mode;
  const lvlKey = u.limb === 'arm' ? 'handLevel' : 'footLevel';
  if (u.scope === 'detail' && mode === 'together' && needsSides(state[lvlKey])) {
    state.selected = changeLevel(state.selected, u.limb, state[lvlKey], 'parts');
    state[lvlKey] = 'parts';
    say(`Both ${u.plural} together can't walk through single ${u.digit}s, so they are scanned in parts.`);
  } else {
    say(mode === 'together' ? `Both ${u.plural} are scanned in the same step.` : `Each ${u.single} is scanned on its own, one after the other.`);
  }
  changed();
}

function setLevel(limb, level) {
  const key = limb === 'arm' ? 'handLevel' : 'footLevel';
  if (state[key] === level) return;
  const u = UNITS[limb === 'arm' ? 'hand' : 'foot'];
  const mKey = modeKey(limb, 'detail');
  let message = '';
  if (needsSides(level) && state[mKey] === 'together') {
    state.selected = changeMode(state.selected, limb, 'detail', 'together', 'separate');
    state[mKey] = 'separate';
    message = `The ${u.plural} are now scanned one at a time so each ${u.digit} can have its own turn. `;
  }
  state.selected = changeLevel(state.selected, limb, state[key], level);
  state[key] = level;
  const opts = limb === 'arm' ? HAND_OPTIONS : FOOT_OPTIONS;
  const extra = level === 'detailed' ? ` Each part gets its own share of the time (${u.digit === 'finger' ? 'palm, back of hand and every finger' : 'heel, sole, top and every toe'}).` : '';
  say(`${message}${u.plural[0].toUpperCase()}${u.plural.slice(1)}: ${opts[level]}.${extra}`);
  changed();
}

function renderDetail() {
  for (const [unit, id, name] of [['arm', 'arm-mode', 'armMode'], ['leg', 'leg-mode', 'legMode'], ['hand', 'hand-mode', 'handMode'], ['foot', 'foot-mode', 'footMode']]) {
    renderRadios($(id), name, MODE_OPTIONS, state[name], (v) => setMode(unit, v));
  }
  renderRadios($('first-side'), 'firstSide', FIRST_OPTIONS, state.firstSide, (v) => { state.firstSide = v; changed(); });
  const anySeparate = ['armMode', 'legMode', 'handMode', 'footMode'].some((k) => state[k] === 'separate');
  $('side-fieldset').hidden = !anySeparate || state.direction === 'custom';
  renderLevelRows($('hand-level'), 'handLevel', LEVEL_INFO.hand, state.handLevel, (v) => setLevel('arm', v));
  renderLevelRows($('foot-level'), 'footLevel', LEVEL_INFO.foot, state.footLevel, (v) => setLevel('leg', v));
  const sep = [['armMode', 'arms'], ['legMode', 'legs'], ['handMode', 'hands'], ['footMode', 'feet']]
    .filter(([k]) => state[k] === 'separate').map(([, w]) => w);
  const list = sep.length > 1 ? `${sep.slice(0, -1).join(', ')} and ${sep.at(-1)}` : sep[0];
  $('diagram-side-note').textContent = sep.length
    ? `Your ${list} are scanned one at a time. Tap the left or right side separately. The front view shows your left on the right.`
    : '';
}

// Tabs: diagram / list
function setPartsView(view, focus = false) {
  state.partsView = view;
  for (const [tab, panel, v] of [['tab-diagram', 'panel-diagram', 'diagram'], ['tab-list', 'panel-list', 'list']]) {
    const on = v === view;
    $(tab).setAttribute('aria-selected', String(on));
    $(tab).tabIndex = on ? 0 : -1;
    $(panel).hidden = !on;
    if (on && focus) $(tab).focus();
  }
  save();
}
$('tab-diagram').addEventListener('click', () => setPartsView('diagram'));
$('tab-list').addEventListener('click', () => setPartsView('list'));
for (const id of ['tab-diagram', 'tab-list']) {
  $(id).addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      setPartsView(state.partsView === 'diagram' ? 'list' : 'diagram', true);
    }
  });
}

// ---------------------------------------------------------------- order
function renderOrder(focusPart, focusAction) {
  const parts = scanOrder();
  const kind = { down: 'Head to toe', up: 'Toe to head', custom: 'Custom order' }[state.direction];
  $('order-summary').textContent = parts.length
    ? `${kind}: ${PART_BY_ID[parts[0]].name} first${parts.length > 1 ? `, ${PART_BY_ID[parts.at(-1)].name} last` : ''}`
    : 'No body parts selected';
  const ol = $('order-list');
  ol.replaceChildren(...parts.map((id, i) => {
    const name = PART_BY_ID[id].name;
    const li = document.createElement('li');
    li.innerHTML = `<span class="num" aria-hidden="true">${i + 1}</span><span class="order-name"></span>
      <button class="icon-btn small" data-act="up" aria-label="Move ${name} earlier" ${i === 0 ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>
      <button class="icon-btn small" data-act="down" aria-label="Move ${name} later" ${i === parts.length - 1 ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
      <button class="icon-btn small" data-act="remove" aria-label="Leave out ${name}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>`;
    li.querySelector('.order-name').textContent = name;
    li.dataset.part = id;
    return li;
  }));
  if (!parts.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No body parts selected yet.';
    ol.append(li);
  }
  if (focusPart) {
    const btn = ol.querySelector(`li[data-part="${focusPart}"] [data-act="${focusAction}"]`);
    (btn && !btn.disabled ? btn : ol.querySelector(`li[data-part="${focusPart}"] button:not([disabled])`))?.focus();
  }
}

$('order-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('li').dataset.part;
  const act = btn.dataset.act;
  if (act === 'remove') {
    const parts = scanOrder();
    const next = parts[parts.indexOf(id) + 1] ?? parts[parts.indexOf(id) - 1];
    togglePart(id, false);
    $('order-status').textContent = `${PART_BY_ID[id].name} left out.`;
    if (next) renderOrder(next, 'remove');
    return;
  }
  const parts = scanOrder();
  const i = parts.indexOf(id);
  const j = act === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= parts.length) return;
  // swap the two parts' positions in the full order, which then becomes the saved custom order
  const full = fullOrder();
  const a = full.indexOf(parts[i]);
  const b = full.indexOf(parts[j]);
  [full[a], full[b]] = [full[b], full[a]];
  state.order = full;
  state.direction = 'custom';
  changed({ skipOrder: true });
  renderOrder(id, act);
  $('order-status').textContent = `${PART_BY_ID[id].name} moved to position ${j + 1} of ${parts.length}.`;
});
$('order-down').addEventListener('click', () => { state.direction = 'down'; changed(); $('order-status').textContent = 'Order set to head to toe.'; });
$('order-up').addEventListener('click', () => { state.direction = 'up'; changed(); $('order-status').textContent = 'Order set to toe to head.'; });

// ---------------------------------------------------------------- guidance
function renderGuidance() {
  const styleList = $('style-list');
  styleList.replaceChildren(...Object.entries(STYLES).map(([id, s]) => {
    const label = document.createElement('label');
    label.className = 'choice';
    label.innerHTML = `<input type="radio" name="style" value="${id}"><span class="choice-text"><strong></strong><small></small></span>`;
    label.querySelector('strong').textContent = s.name;
    label.querySelector('small').textContent = s.description;
    const input = label.querySelector('input');
    input.checked = state.style === id;
    input.addEventListener('change', () => { state.style = id; changed(); });
    return label;
  }));

  const narratorList = $('narrator-list');
  narratorList.replaceChildren(...NARRATORS.map((n) => {
    const row = document.createElement('div');
    row.className = 'choice-row';
    row.innerHTML = `<label class="choice"><input type="radio" name="narrator" value="${n.id}"><span class="choice-text"><strong></strong><small></small></span></label>
      <button type="button" class="btn small preview" aria-label="Preview ${n.name}'s voice" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span>Preview</span></button>`;
    row.querySelector('strong').textContent = n.name;
    row.querySelector('small').textContent = n.description;
    const input = row.querySelector('input');
    input.checked = state.narrator === n.id;
    input.addEventListener('change', () => { state.narrator = n.id; changed(); });
    row.querySelector('.preview').addEventListener('click', (e) => togglePreview(n.id, e.currentTarget));
    return row;
  }));
}

let previewing = null;
function resetPreviewButtons() {
  document.querySelectorAll('.preview[aria-pressed="true"]').forEach((b) => {
    b.setAttribute('aria-pressed', 'false');
    b.querySelector('span').textContent = 'Preview';
  });
}
async function togglePreview(narrator, btn) {
  const wasThis = previewing === narrator;
  engine.stopPreview();
  resetPreviewButtons();
  previewing = null;
  if (wasThis) return;
  previewing = narrator;
  btn.setAttribute('aria-pressed', 'true');
  btn.querySelector('span').textContent = 'Stop';
  engine.setLevels({ ...state, voiceMuted: false });
  try {
    await engine.playPreview(narrator, () => { previewing = null; resetPreviewButtons(); engine.setLevels(state); });
  } catch {
    previewing = null;
    resetPreviewButtons();
    btn.querySelector('span').textContent = 'Unavailable';
  }
}

// ---------------------------------------------------------------- sound
const ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>';

function renderSound() {
  for (const [key, prefix] of [['voice', 'voice'], ['sound', 'sound']]) {
    const vol = state[`${key}Volume`];
    const muted = state[`${key}Muted`];
    $(`${prefix}-volume`).value = Math.round(vol * 100);
    $(`${prefix}-volume`).setAttribute('aria-valuetext', muted ? `${Math.round(vol * 100)} percent, muted` : `${Math.round(vol * 100)} percent`);
    $(`${prefix}-volume-out`).textContent = muted ? 'Muted' : `${Math.round(vol * 100)} %`;
    const btn = $(`${prefix}-mute`);
    btn.setAttribute('aria-pressed', String(muted));
    btn.innerHTML = muted ? ICON_OFF : ICON_ON;
    $(`${prefix}-volume-row`).classList.toggle('muted', muted);
  }
  renderRadios($('ambience-list'), 'ambience', AMBIENCES, state.ambience, (v) => { state.ambience = v; changed(); });
  const listen = document.createElement('button');
  listen.type = 'button';
  listen.className = 'btn small preview-sound';
  listen.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span>Listen</span>';
  listen.setAttribute('aria-label', 'Listen to the selected background sound');
  listen.addEventListener('click', () => {
    engine.setLevels({ ...state, soundMuted: false });
    engine.previewAmbience(state.ambience).catch(() => {});
  });
  $('ambience-list').append(listen);
  renderRadios($('transition-list'), 'transition', TRANSITIONS, state.transition, (v) => { state.transition = v; changed(); });
  engine.setLevels(state);
}

for (const key of ['voice', 'sound']) {
  $(`${key}-volume`).addEventListener('input', (e) => {
    state[`${key}Volume`] = e.target.value / 100;
    state[`${key}Muted`] = false;
    renderSound();
    save();
  });
  $(`${key}-mute`).addEventListener('click', () => {
    state[`${key}Muted`] = !state[`${key}Muted`];
    renderSound();
    save();
  });
}

// ---------------------------------------------------------------- profiles
// A profile is a saved session setup. Appearance, recent sessions and the other profiles are not part of it.
const PROFILE_FIELDS = [
  'minutes', 'selected', 'direction', 'armMode', 'legMode', 'handMode', 'footMode', 'handLevel', 'footLevel', 'firstSide',
  'style', 'narrator', 'voiceVolume', 'voiceMuted', 'soundVolume', 'soundMuted', 'ambience', 'transition',
  'countIntro', 'countOutro',
];
function profileSnapshot() {
  const data = {};
  for (const k of PROFILE_FIELDS) data[k] = structuredClone(state[k]);
  data.selected = scanOrder();           // saved in scan order
  if (state.direction === 'custom') data.order = fullOrder();
  return data;
}
// Does the current setup still match what the profile saved?
function profileMatches(p) {
  const loaded = fromSaved(p.data);
  normalize(loaded);
  const key = (s, order) => JSON.stringify([...PROFILE_FIELDS.filter((k) => k !== 'selected').map((k) => s[k]),
    s.selected.slice().sort(), s.direction === 'custom' ? order : null]);
  return key(loaded, loaded.order.filter((id) => loaded.selected.includes(id))) === key(state, scanOrder());
}
function profileSummary(p) {
  const d = fromSaved(p.data);
  normalize(d);
  const n = d.selected.length;
  return `${d.minutes} min · ${n} body part${n === 1 ? '' : 's'} · ${NARRATORS.find((x) => x.id === d.narrator).name} · ${STYLES[d.style].name}`;
}
function profileMessage(text) { $('profile-status').textContent = text; }

let pendingDelete = null;
let pendingTimer = 0;
function renderProfiles(focusKey) {
  const list = $('profile-list');
  const wanted = focusKey ?? (list.contains(document.activeElement) ? document.activeElement.dataset.key : null);
  list.replaceChildren(...state.profiles.map((p) => {
    const active = p.id === state.activeProfile;
    const li = document.createElement('li');
    li.className = 'profile-item';
    li.dataset.id = p.id;
    li.dataset.active = String(active);
    const tag = active ? (profileMatches(p) ? 'In use' : 'In use, changed') : '';
    li.innerHTML = `<button type="button" class="profile-use" data-act="use" data-key="${p.id}:use"><strong></strong><small></small></button>
      <button type="button" class="btn ghost small" data-act="update" data-key="${p.id}:update">Update</button>
      <button type="button" class="btn ghost small" data-act="delete" data-key="${p.id}:delete"></button>`;
    li.querySelector('strong').textContent = p.name;
    li.querySelector('small').textContent = `${profileSummary(p)}${tag ? ` · ${tag}` : ''}`;
    li.querySelector('[data-act="use"]').setAttribute('aria-label', `Use profile ${p.name}: ${profileSummary(p)}${tag ? `, ${tag}` : ''}`);
    li.querySelector('[data-act="update"]').setAttribute('aria-label', `Update ${p.name} with the current setup`);
    const del = li.querySelector('[data-act="delete"]');
    del.textContent = pendingDelete === p.id ? 'Tap again' : 'Delete';
    del.setAttribute('aria-label', pendingDelete === p.id ? `Confirm deleting ${p.name}` : `Delete ${p.name}`);
    return li;
  }));
  if (wanted) list.querySelector(`[data-key="${CSS.escape(wanted)}"]`)?.focus();
}

function applyProfile(p) {
  const loaded = fromSaved(p.data);
  normalize(loaded);
  for (const k of PROFILE_FIELDS) state[k] = loaded[k];
  state.order = loaded.order;
  state.activeProfile = p.id;
  profileMessage(`Loaded ${p.name}.`);
  changed();
}

$('profile-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const p = state.profiles.find((x) => x.id === btn.closest('li').dataset.id);
  if (!p) return;
  const act = btn.dataset.act;
  if (act !== 'delete') pendingDelete = null;
  if (act === 'use') applyProfile(p);
  else if (act === 'update') {
    p.data = profileSnapshot();
    state.activeProfile = p.id;
    profileMessage(`Updated ${p.name} with the current setup.`);
    changed();
  } else if (pendingDelete === p.id) {
    clearTimeout(pendingTimer);
    pendingDelete = null;
    state.profiles = state.profiles.filter((x) => x.id !== p.id);
    if (state.activeProfile === p.id) state.activeProfile = null;
    profileMessage(`Deleted ${p.name}.`);
    changed();
    $('profile-name').focus();
  } else {
    pendingDelete = p.id;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingDelete = null; renderProfiles(); }, 4000);
    profileMessage(`Tap Delete again to delete ${p.name}.`);
    renderProfiles();
  }
});

function saveProfile() {
  const name = $('profile-name').value.trim().replace(/\s+/g, ' ');
  if (!name) { profileMessage('Enter a name for this profile first.'); $('profile-name').focus(); return; }
  if (!state.selected.length) { profileMessage('Choose at least one body part before saving.'); return; }
  const existing = state.profiles.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.data = profileSnapshot();
    state.activeProfile = existing.id;
    profileMessage(`Updated ${existing.name} with the current setup.`);
  } else {
    if (state.profiles.length >= MAX_PROFILES) { profileMessage(`You can keep up to ${MAX_PROFILES} profiles. Delete one to make room.`); return; }
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    state.profiles.push({ id, name, data: profileSnapshot() });
    state.activeProfile = id;
    profileMessage(`Saved ${name}. Tap it any time to bring this setup back.`);
  }
  $('profile-name').value = '';
  changed();
}
$('profile-save').addEventListener('click', saveProfile);
$('profile-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveProfile(); } });

// ---------------------------------------------------------------- recent
function recentLabel(r) {
  return `${r.minutes} min · ${r.parts.length} body part${r.parts.length > 1 ? 's' : ''} · ${STYLES[r.style]?.name ?? ''}`;
}
function renderRecent() {
  const list = state.recent.filter((r) => r.parts?.every((id) => PART_BY_ID[id]));
  $('recent-card').hidden = !list.length;
  $('recent-list').replaceChildren(...list.map((r) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip-btn';
    b.textContent = recentLabel(r);
    b.setAttribute('aria-label', `Use recent session: ${recentLabel(r)}, ${r.parts.map((id) => PART_BY_ID[id].name).join(', ')}`);
    b.addEventListener('click', () => {
      state.minutes = r.minutes;
      state.selected = [...r.parts];
      Object.assign(state, inferConfig(state.selected, state));
      state.direction = 'custom';
      state.order = [...r.parts];
      if (STYLES[r.style]) state.style = r.style;
      changed();
    });
    return b;
  }));
}
function rememberRecent() {
  const entry = { minutes: state.minutes, parts: scanOrder(), style: state.style };
  const key = JSON.stringify(entry);
  state.recent = [entry, ...state.recent.filter((r) => JSON.stringify(r) !== key)].slice(0, 3);
}

// ---------------------------------------------------------------- render all
function changed({ skipOrder = false } = {}) {
  // Radio groups are rebuilt below; keep keyboard focus on the same option.
  const a = document.activeElement;
  const refocus = a?.type === 'radio' ? `input[name="${a.name}"][value="${a.value}"]` : null;
  renderDuration();
  renderProfiles();
  renderRegions();
  renderDetail();
  diagram.refresh();
  renderPartTree();
  renderSelectionSummary();
  if (!skipOrder) renderOrder();
  renderGuidance();
  renderSound();
  renderRecent();
  renderHint();
  save();
  if (refocus) document.querySelector(refocus)?.focus();
}

// ---------------------------------------------------------------- review
function openReview() {
  if (!state.selected.length) {
    $('selection-error').hidden = false;
    $('selection-error').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const plan = currentPlan();
  const parts = planParts();
  const rows = [
    ['Length', fmtDuration(state.minutes * 60)],
    ['Body parts', `${parts.length}`],
  ];
  const profile = state.profiles.find((p) => p.id === state.activeProfile);
  if (profile) rows.push(['Profile', profileMatches(profile) ? profile.name : `${profile.name} (changed)`]);
  const separate = [['armMode', 'arms'], ['legMode', 'legs'], ['handMode', 'hands'], ['footMode', 'feet']].filter(([k]) => state[k] === 'separate').map(([, w]) => w);
  if (separate.length) rows.push(['One at a time', `${separate.join(', ')}${state.direction === 'custom' ? '' : `, ${state.firstSide === 'L' ? 'left' : 'right'} first`}`]);
  if (plan?.ok) {
    const { min, max } = plan.perPart;
    rows.push(['Each body part', min === max ? fmtDuration(min) : `${fmtDuration(min)} – ${fmtDuration(max)}`]);
    const how = (counted) => (counted ? 'included' : 'added');
    rows.push(['Opening', plan.introSec ? `${fmtDuration(plan.introSec)} (${how(plan.countIntro)})` : 'Starts right away']);
    rows.push(['Closing', `${fmtDuration(plan.outroSec)} (${how(plan.countOutro)})`]);
    if (plan.totalSeconds !== plan.chosenSeconds) rows.push(['Total time', fmtDuration(plan.totalSeconds)]);
  }
  rows.push(['Guidance', STYLES[state.style].name]);
  rows.push(['Narrator', NARRATORS.find((n) => n.id === state.narrator).name]);
  rows.push(['Background', AMBIENCES[state.ambience]]);
  rows.push(['Between parts', TRANSITIONS[state.transition]]);
  $('review-summary').replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
  $('review-order').replaceChildren(...parts.map((id) => {
    const li = document.createElement('li'); li.textContent = PART_BY_ID[id].name; return li;
  }));
  const err = $('review-error');
  err.hidden = !!plan?.ok;
  if (!plan) err.textContent = 'Still loading. Please try again in a moment.';
  else if (!plan.ok) err.textContent = `This length is too short for ${parts.length} body parts. Choose at least ${plan.minMinutes} min, or fewer body parts.`;
  $('begin-btn').disabled = !plan?.ok;
  $('loading-text').textContent = '';
  $('review-dialog').showModal();
}
$('review-btn').addEventListener('click', openReview);

$('begin-btn').addEventListener('click', async (e) => {
  e.preventDefault();
  const plan = currentPlan();
  if (!plan?.ok) return;
  const unlocked = engine.unlock(); // must run inside the tap
  engine.stopPreview();
  resetPreviewButtons();
  $('begin-btn').disabled = true;
  $('loading-text').textContent = 'Preparing audio…';
  try {
    await unlocked;
    const ids = [...new Set(plan.events.filter((ev) => ev.type === 'clip').map((ev) => ev.id))];
    await engine.loadClips(state.narrator, ids, (done, total) => {
      $('loading-text').textContent = `Preparing audio… ${done} of ${total}`;
    });
  } catch (err) {
    const n = err?.failed?.length;
    const first = err?.failed?.[0]?.id;
    $('loading-text').textContent = `${n ? `${nf.format(n)} voice clip${n === 1 ? '' : 's'} could not be loaded${first ? ` (for example ${first})` : ''}. ` : 'Some audio could not be loaded. '}Check your connection and try again. If the app was just updated, close it completely and open it again once while online so the new voices download.`;
    $('begin-btn').disabled = false;
    // An out-of-date copy of the app can ask for clips that no longer exist: fetch the newest copy for the next start.
    navigator.serviceWorker?.getRegistration().then((reg) => reg?.update()).catch(() => {});
    return;
  }
  rememberRecent();
  save();
  $('review-dialog').close();
  startSession(plan);
});

// ---------------------------------------------------------------- player
function showScreen(name) {
  for (const s of ['setup', 'player', 'done']) $(`screen-${s}`).hidden = s !== name;
  document.body.dataset.screen = name;
  window.scrollTo(0, 0);
}

let lastAnnounced = null;
async function startSession(plan) {
  engine.setLevels(state);
  session = new Session(engine, plan, { narrator: state.narrator, ambience: state.ambience });
  session.onupdate = renderPlayer;
  lastAnnounced = null;
  buildPartTrack(plan);
  showScreen('player');
  $('player-part').focus();
  requestWakeLock();
  await session.start();
}

function buildPartTrack(plan) {
  $('part-track').replaceChildren(...plan.segments.map(() => document.createElement('span')));
}

function renderPlayer(s) {
  if (s.state === 'complete' || s.state === 'ended') { showDone(s); return; }
  const plan = s.plan;
  const where = s.where();
  const total = plan.segments.length;
  let step; let title; let next;
  if (where.section === 'intro') {
    step = 'Opening';
    title = 'Settling in';
    next = `First: ${PART_BY_ID[plan.segments[0].partId].name}`;
  } else if (where.section === 'part') {
    const i = where.seg.index;
    step = `Body part ${i + 1} of ${total} · ${PART_BY_ID[where.seg.partId].group}`;
    title = PART_BY_ID[where.seg.partId].name;
    next = i + 1 < total ? `Next: ${PART_BY_ID[plan.segments[i + 1].partId].name}` : 'Last body part';
  } else {
    step = 'Closing';
    title = 'Whole body';
    next = '';
  }
  $('player-step').textContent = step;
  $('player-part').textContent = title;
  $('player-next').textContent = next;
  $('player-remaining').textContent = fmtClock(s.remaining());
  const progress = s.elapsed() / plan.totalSeconds;
  const c = 2 * Math.PI * 52;
  $('ring-fill').style.strokeDasharray = `${c}`;
  $('ring-fill').style.strokeDashoffset = `${c * (1 - progress)}`;

  const current = where.section === 'part' ? where.seg.index : where.section === 'outro' ? total : -1;
  [...$('part-track').children].forEach((el, i) => {
    el.className = i < current ? 'done' : i === current ? 'current' : '';
  });

  const paused = s.state === 'paused';
  document.body.classList.toggle('is-paused', paused);
  $('pause-text').textContent = paused ? 'Resume' : 'Pause';
  $('ctl-pause').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  $('pause-icon').innerHTML = paused
    ? '<path d="M8 5v14l11-7z"/>'
    : '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>';
  $('ctl-skip').setAttribute('aria-label', where.section === 'outro' ? 'Skip the closing and finish' : where.section === 'intro' ? 'Skip the opening' : 'Skip to next body part');

  const status = $('player-status');
  const key = `${title}|${paused}|${s.pauseReason}`;
  if (key !== lastAnnounced) {
    lastAnnounced = key;
    if (paused) {
      status.textContent = {
        interrupted: 'Paused because another sound or call interrupted. Tap Resume when you are ready.',
        background: 'Paused while you were away. Tap Resume when you are ready.',
      }[s.pauseReason] ?? 'Paused. Tap Resume when you are ready.';
    } else {
      status.textContent = where.section === 'part' ? `Now: ${title}. ${step}.` : `${step}.`;
    }
  }
}

$('ctl-pause').addEventListener('click', async () => {
  if (!session) return;
  if (session.state === 'paused') {
    try { await session.resume(); requestWakeLock(); } catch {
      $('player-status').textContent = 'Audio is still busy elsewhere. Tap Resume again in a moment.';
    }
  } else {
    session.pause('user');
  }
});
$('ctl-skip').addEventListener('click', () => session?.skip());
$('ctl-end').addEventListener('click', () => session?.end());

document.addEventListener('keydown', (e) => {
  if (document.body.dataset.screen !== 'player' || e.target.closest('button, input')) return;
  if (e.key === ' ') { e.preventDefault(); $('ctl-pause').click(); }
});

engine.onstatechange = () => session?.interrupted();
document.addEventListener('visibilitychange', () => {
  if (!session) return;
  if (document.hidden) session.pause('background');
  else if (session.state === 'playing' || session.state === 'paused') requestWakeLock();
});

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !document.hidden) {
      wakeLock?.release().catch(() => {});
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* not supported or denied: screen may dim */ }
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// ---------------------------------------------------------------- done
function showDone(s) {
  releaseWakeLock();
  document.body.classList.remove('is-paused');
  const done = s.state === 'complete';
  $('done-title').textContent = done ? 'Session complete' : 'Session ended';
  const parts = s.plan.segments.length;
  $('done-text').textContent = done
    ? `You rested your attention on ${parts} body part${parts > 1 ? 's' : ''} for ${fmtDuration(s.practiced)}. Take a moment before moving on.`
    : `You practiced for ${fmtDuration(s.practiced)}. Come back whenever you like.`;
  session = null;
  showScreen('done');
  $('done-title').focus();
}
$('done-again').addEventListener('click', () => { showScreen('setup'); openReview(); });
$('done-close').addEventListener('click', () => { showScreen('setup'); $('review-btn').focus(); });

// ---------------------------------------------------------------- settings
function renderSettings() {
  renderRadios($('theme-list'), 'theme', { system: 'System', light: 'Light', dark: 'Dark' }, state.theme,
    (v) => { state.theme = v; applyTheme(); save(); });
  $('count-intro').checked = state.countIntro;
  $('count-outro').checked = state.countOutro;
}
for (const [id, key] of [['count-intro', 'countIntro'], ['count-outro', 'countOutro']]) {
  $(id).addEventListener('change', (e) => { state[key] = e.target.checked; changed(); });
}
$('open-settings').addEventListener('click', () => { renderSettings(); $('settings-dialog').showModal(); });
$('forget-prefs').addEventListener('click', () => {
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  const profiles = state.profiles; // saved profiles are favourites, not just "last choices"
  Object.assign(state, structuredClone(DEFAULTS));
  state.profiles = profiles;
  applyTheme();
  renderSettings();
  changed();
  save();
  $('forget-prefs').textContent = 'Choices cleared';
});

// ---------------------------------------------------------------- offline
// Shown in Settings and, until voices are fully downloaded, as a banner on the setup screen.
function showOfflineStatus(text, { banner = true, warn = false } = {}) {
  $('offline-status').textContent = text;
  const b = $('offline-banner');
  b.textContent = text;
  b.hidden = !banner;
  b.classList.toggle('warn', warn);
}

function onAudioProgress({ done, total, failed, finished, version, appFiles, appTotal }) {
  // Exact state for troubleshooting, e.g. "Offline check: v5 · app 15 of 15 · voices 216 of 216"
  $('offline-detail').textContent = `Offline check: ${String(version).replace('bodyscan-', '')} · app ${appFiles} of ${appTotal} · voices ${done} of ${total}`;
  if (finished && !failed) {
    showOfflineStatus('✓ Ready for offline use. All voices are stored on this device.', { banner: false });
  } else if (finished) {
    showOfflineStatus(`${nf.format(failed)} voice clips couldn't download yet. They'll retry next time you open the app online.`, { warn: true });
  } else {
    const pct = Math.floor((done / total) * 100);
    showOfflineStatus(`Downloading voices for offline use… ${pct} %. Keep the app open until this finishes.`);
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    showOfflineStatus('Offline use is not supported in this browser.', { banner: false });
    return;
  }
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'audio-progress') onAudioProgress(e.data);
  });
  const askForAudio = async () => (await navigator.serviceWorker.ready).active?.postMessage('cache-audio');
  try {
    await navigator.serviceWorker.register('sw.js');
    // Ask the browser not to clear stored voices when space runs low.
    navigator.storage?.persist?.().catch(() => {});
    await askForAudio();
    // Resume an interrupted download as soon as the connection comes back.
    window.addEventListener('online', askForAudio);
  } catch {
    showOfflineStatus('Offline storage is unavailable here (it needs HTTPS).', { banner: false });
  }
}

// ---------------------------------------------------------------- init
async function init() {
  applyTheme();
  setPartsView(state.partsView === 'list' ? 'list' : 'diagram');
  changed();
  try {
    durations = await fetch('data/durations.json').then((r) => r.json());
  } catch {
    $('dur-hint').textContent = 'Could not load session data. Please reload.';
  }
  renderHint();
  registerServiceWorker();
}
init();
