import {
  BODY_PARTS, PART_BY_ID, DEFAULT_ORDER, NARRATORS, STYLES, AMBIENCES, TRANSITIONS,
} from './content.js';
import { planSession } from './timing.js';
import { AudioEngine } from './audio.js';
import { Session } from './session.js';
import { createBodyDiagram } from './body.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'bodyscan.v1';
const PRESETS = [5, 10, 15, 20, 30, 45];
const MIN_MINUTES = 1;
const MAX_MINUTES = 90;

const DEFAULTS = {
  minutes: 10,
  selected: [...DEFAULT_ORDER],
  order: [...DEFAULT_ORDER],
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
};

// ---------------------------------------------------------------- state
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    const s = { ...DEFAULTS, ...saved };
    // Guard against stale or edited data
    s.order = [...s.order.filter((id) => PART_BY_ID[id]), ...DEFAULT_ORDER.filter((id) => !s.order.includes(id))];
    s.selected = s.selected.filter((id) => PART_BY_ID[id]);
    if (!NARRATORS.some((n) => n.id === s.narrator)) s.narrator = DEFAULTS.narrator;
    if (!STYLES[s.style]) s.style = DEFAULTS.style;
    if (!AMBIENCES[s.ambience]) s.ambience = DEFAULTS.ambience;
    if (!TRANSITIONS[s.transition]) s.transition = DEFAULTS.transition;
    s.minutes = clampMinutes(s.minutes);
    return s;
  } catch {
    return structuredClone(DEFAULTS);
  }
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
const scanOrder = () => state.order.filter((id) => state.selected.includes(id));

function currentPlan() {
  if (!durations) return null;
  return planSession({
    totalSeconds: state.minutes * 60,
    parts: scanOrder(),
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
    hint.textContent = `Too short for ${scanOrder().length} body parts. Choose at least ${plan.minMinutes} min, or fewer body parts.`;
  } else {
    hint.textContent = '';
  }
}

// "opening", "closing" or "opening and closing": the parts added on top of the chosen length.
function addedOnTop(plan) {
  return [!plan.countIntro && plan.introSec && 'opening', !plan.countOutro && 'closing'].filter(Boolean).join(' and ');
}

// ---------------------------------------------------------------- body parts
const diagram = createBodyDiagram($('body-diagram'), {
  isSelected: (id) => state.selected.includes(id),
  toggle: (id) => togglePart(id),
});

function togglePart(id, on = !state.selected.includes(id)) {
  state.selected = on ? [...state.selected, id] : state.selected.filter((x) => x !== id);
  changed();
}

function renderPartList() {
  const list = $('part-list');
  if (!list.childElementCount) {
    for (const p of BODY_PARTS) {
      const li = document.createElement('li');
      li.dataset.part = p.id;
      li.dataset.search = `${p.name} ${p.keywords}`.toLowerCase();
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.addEventListener('change', () => togglePart(p.id, input.checked));
      const name = document.createElement('span');
      name.textContent = p.name;
      label.append(input, name);
      li.append(label);
      list.append(li);
    }
  }
  for (const li of list.children) li.querySelector('input').checked = state.selected.includes(li.dataset.part);
}

$('part-filter').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  let shown = 0;
  for (const li of $('part-list').children) {
    const match = !q || li.dataset.search.includes(q);
    li.hidden = !match;
    shown += match;
  }
  $('filter-empty').hidden = shown > 0;
});

$('select-all').addEventListener('click', () => { state.selected = [...DEFAULT_ORDER]; changed(); });
$('select-none').addEventListener('click', () => { state.selected = []; changed(); });

function renderSelectionSummary() {
  const n = state.selected.length;
  $('selection-summary').textContent = `${n} of ${BODY_PARTS.length} body parts selected`;
  $('selection-error').hidden = n > 0;
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
  const defaultSeq = DEFAULT_ORDER.filter((id) => parts.includes(id));
  const kind = parts.join() === defaultSeq.join() ? 'Head to toe'
    : parts.join() === [...defaultSeq].reverse().join() ? 'Toe to head' : 'Custom order';
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
  // swap the two parts' positions in the full order
  const a = state.order.indexOf(parts[i]);
  const b = state.order.indexOf(parts[j]);
  [state.order[a], state.order[b]] = [state.order[b], state.order[a]];
  changed({ skipOrder: true });
  renderOrder(id, act);
  $('order-status').textContent = `${PART_BY_ID[id].name} moved to position ${j + 1} of ${parts.length}.`;
});
$('order-down').addEventListener('click', () => { state.order = [...DEFAULT_ORDER]; changed(); $('order-status').textContent = 'Order set to head to toe.'; });
$('order-up').addEventListener('click', () => { state.order = [...DEFAULT_ORDER].reverse(); changed(); $('order-status').textContent = 'Order set to toe to head.'; });

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

// ---------------------------------------------------------------- recent
function recentLabel(r) {
  const full = r.parts.length === DEFAULT_ORDER.length;
  return `${r.minutes} min · ${full ? 'Full body' : `${r.parts.length} part${r.parts.length > 1 ? 's' : ''}`} · ${STYLES[r.style]?.name ?? ''}`;
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
      state.order = [...r.parts, ...DEFAULT_ORDER.filter((id) => !r.parts.includes(id))];
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
  diagram.refresh();
  renderPartList();
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
  const parts = scanOrder();
  const rows = [
    ['Length', fmtDuration(state.minutes * 60)],
    ['Body parts', `${parts.length}`],
  ];
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
  } catch {
    $('loading-text').textContent = 'Some audio could not be loaded. Check your connection and try again.';
    $('begin-btn').disabled = false;
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
    step = `Body part ${i + 1} of ${total}`;
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
  Object.assign(state, structuredClone(DEFAULTS));
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
