// Pure selection logic (no DOM): which steps a choice in the UI means, and in what order they run.
//
// The selection itself is a flat list of part ids. The UI works with coarser ideas:
//   region  head, torso, arms, legs
//   node    one area of a limb: shoulder, upperArm, elbow, forearm, wrist, hand | thigh, knee, shin, calf, ankle, foot
//   level   how finely a hand or foot is split: 'whole', 'detailed' (one step, narrated in detail), 'parts' (palm, back, fingers / heel, sole, top, toes)
//           or 'named' (every finger or toe by name; needs the sides scanned one at a time)
//   mode    arms and legs: 'together' (both sides in one step) or 'separate' (left, then right)
import { PART_BY_ID, AREAS, partId } from './content.js';

export const NODES = {
  arm: ['shoulder', 'upperArm', 'elbow', 'forearm', 'wrist', 'hand'],
  leg: ['thigh', 'knee', 'shin', 'calf', 'ankle', 'foot'],
};
const LEAVES = {
  hand: { whole: ['hand'], detailed: ['handDetail'], parts: ['palm', 'backHand', 'fingers'], named: ['palm', 'backHand', 'thumb', 'index', 'middle', 'ring', 'little'] },
  foot: { whole: ['foot'], detailed: ['footDetail'], parts: ['heel', 'sole', 'top', 'toes'], named: ['heel', 'sole', 'top', 'bigToe', 'secondToe', 'thirdToe', 'fourthToe', 'littleToe'] },
};
const DIGITS = {
  hand: { group: 'fingers', named: ['thumb', 'index', 'middle', 'ring', 'little'] },
  foot: { group: 'toes', named: ['bigToe', 'secondToe', 'thirdToe', 'fourthToe', 'littleToe'] },
};
const DETAIL_NODE = { arm: 'hand', leg: 'foot' };
export const LEVELS = ['whole', 'detailed', 'parts', 'named'];
export const REGIONS = ['head', 'torso', 'arms', 'legs'];
const REGION_LIMB = { arms: 'arm', legs: 'leg' };
const CORE_IDS = { head: ['head', 'face', 'jaw', 'neck'], torso: ['chest', 'upperBack', 'abdomen', 'lowerBack', 'hips'] };

export const DEFAULT_CONFIG = { armMode: 'together', legMode: 'together', handLevel: 'whole', footLevel: 'whole', firstSide: 'L' };

const modeOf = (cfg, limb) => (limb === 'arm' ? cfg.armMode : cfg.legMode);
const levelOf = (cfg, limb) => (limb === 'arm' ? cfg.handLevel : cfg.footLevel);
// The sets a limb is scanned as, in scan order.
export const setsFor = (cfg, limb) => (modeOf(cfg, limb) === 'together' ? ['B'] : cfg.firstSide === 'R' ? ['R', 'L'] : ['L', 'R']);
// Individual fingers and toes only exist per side, so "both together" falls back to the group.
export const effectiveLevel = (level, set) => (set === 'B' && level === 'named' ? 'parts' : level);

// ---------------------------------------------------------------- nodes
// Ids that make up one node at a level (a hand at 'parts' is palm + back of hand + fingers).
export function nodeLeaves(limb, set, node, level) {
  const detail = DETAIL_NODE[limb];
  const keys = node === detail ? LEAVES[detail][effectiveLevel(level, set)] : [node];
  return keys.map((k) => partId(limb, set, k)).filter(Boolean);
}
// Every id that can belong to a node at any level, used to clear it before re-adding.
function nodeAllLeaves(limb, set, node) {
  const detail = DETAIL_NODE[limb];
  const keys = node === detail ? new Set(LEVELS.flatMap((l) => LEAVES[detail][l])) : [node];
  return [...keys].map((k) => partId(limb, set, k)).filter(Boolean);
}
export function status(selected, ids) {
  if (!ids.length) return 'off';
  const n = ids.filter((id) => selected.includes(id)).length;
  return n === 0 ? 'off' : n === ids.length ? 'on' : 'partial';
}
export const nodeStatus = (selected, limb, set, node, cfg) => status(selected, nodeLeaves(limb, set, node, levelOf(cfg, limb)));
export const nodeAnySelected = (selected, limb, set, node) => nodeAllLeaves(limb, set, node).some((id) => selected.includes(id));

const without = (list, ids) => list.filter((id) => !ids.includes(id));
const withIds = (list, ids) => [...list, ...ids.filter((id) => !list.includes(id))];

export function toggleNode(selected, limb, set, node, cfg) {
  const on = nodeStatus(selected, limb, set, node, cfg) !== 'on';
  const cleared = without(selected, nodeAllLeaves(limb, set, node));
  return on ? withIds(cleared, nodeLeaves(limb, set, node, levelOf(cfg, limb))) : cleared;
}
export function toggleId(selected, id) {
  return selected.includes(id) ? without(selected, [id]) : [...selected, id];
}

// ---------------------------------------------------------------- regions
export function regionIds(region, cfg) {
  if (CORE_IDS[region]) return CORE_IDS[region];
  const limb = REGION_LIMB[region];
  return setsFor(cfg, limb).flatMap((set) => NODES[limb].flatMap((node) => nodeLeaves(limb, set, node, levelOf(cfg, limb))));
}
export function regionStatus(selected, region, cfg) {
  return status(selected, regionIds(region, cfg));
}
export function toggleRegion(selected, region, cfg) {
  const on = regionStatus(selected, region, cfg) !== 'on';
  let next = selected;
  if (CORE_IDS[region]) next = without(next, CORE_IDS[region]);
  else {
    const limb = REGION_LIMB[region];
    next = without(next, ['B', 'L', 'R'].flatMap((set) => NODES[limb].flatMap((node) => nodeAllLeaves(limb, set, node))));
  }
  return on ? withIds(next, regionIds(region, cfg)) : next;
}
export const wholeBody = (cfg) => REGIONS.flatMap((r) => regionIds(r, cfg));

// One side of a limb ("Left arm") as a unit.
export const setIds = (limb, set, cfg) => NODES[limb].flatMap((node) => nodeLeaves(limb, set, node, levelOf(cfg, limb)));
export function toggleSet(selected, limb, set, cfg) {
  const on = status(selected, setIds(limb, set, cfg)) !== 'on';
  const cleared = without(selected, NODES[limb].flatMap((node) => nodeAllLeaves(limb, set, node)));
  return on ? withIds(cleared, setIds(limb, set, cfg)) : cleared;
}

// ---------------------------------------------------------------- changing how arms/legs/hands/feet are split
// Switch a limb between "together" and "one at a time", carrying the chosen areas over.
export function changeMode(selected, limb, from, to) {
  if (from === to) return selected;
  const oldSets = from === 'together' ? ['B'] : ['L', 'R'];
  const newSets = to === 'together' ? ['B'] : ['L', 'R'];
  const keys = new Set();
  for (const id of selected) {
    const p = PART_BY_ID[id];
    if (p?.limb === limb && oldSets.includes(p.set)) keys.add(p.key);
  }
  let next = selected.filter((id) => !(PART_BY_ID[id]?.limb === limb && oldSets.includes(PART_BY_ID[id].set)));
  const group = DIGITS[DETAIL_NODE[limb]];
  for (const key of keys) {
    const k = to === 'together' && group.named.includes(key) ? group.group : key; // no named digits in "together"
    for (const set of newSets) next = withIds(next, [partId(limb, set, k)]);
  }
  return next;
}

// Change how finely hands or feet are split, keeping whatever was already chosen.
export function changeLevel(selected, limb, from, to) {
  if (from === to) return selected;
  const detail = DETAIL_NODE[limb];
  const digits = DIGITS[detail];
  let next = selected;
  for (const set of ['B', 'L', 'R']) {
    const all = nodeAllLeaves(limb, set, detail);
    const had = all.filter((id) => selected.includes(id));
    if (!had.length) continue;
    const oldKeys = had.map((id) => PART_BY_ID[id].key);
    let keys;
    if (to === 'whole') keys = [detail];
    else if (to === 'detailed') keys = [`${detail}Detail`];
    else if (oldKeys.includes(detail) || oldKeys.includes(`${detail}Detail`)) keys = LEAVES[detail][effectiveLevel(to, set)];
    else {
      keys = [];
      for (const k of oldKeys) {
        if (k === digits.group || digits.named.includes(k)) {
          keys.push(...(effectiveLevel(to, set) === 'named' ? digits.named : [digits.group]));
        } else keys.push(k);
      }
    }
    next = withIds(without(next, all), [...new Set(keys)].map((k) => partId(limb, set, k)).filter(Boolean));
  }
  return next;
}

// Work out modes and levels from a list of ids (for saved sessions and old data).
export function inferConfig(selected, cfg = DEFAULT_CONFIG) {
  const out = { ...cfg };
  for (const limb of ['arm', 'leg']) {
    const parts = selected.map((id) => PART_BY_ID[id]).filter((p) => p?.limb === limb);
    if (parts.some((p) => p.set !== 'B')) out[limb === 'arm' ? 'armMode' : 'legMode'] = 'separate';
    else if (parts.length) out[limb === 'arm' ? 'armMode' : 'legMode'] = 'together';
    const detail = DETAIL_NODE[limb];
    const keys = new Set(parts.map((p) => p.key));
    const group = DIGITS[detail];
    const lvl = group.named.some((k) => keys.has(k)) ? 'named'
      : [...LEAVES[detail].parts].some((k) => keys.has(k)) ? 'parts'
        : keys.has(detail) ? 'whole' : keys.has(`${detail}Detail`) ? 'detailed' : null;
    if (lvl) out[limb === 'arm' ? 'handLevel' : 'footLevel'] = lvl;
  }
  // Individual fingers and toes need one side at a time.
  if (out.armMode === 'together' && out.handLevel === 'named') out.handLevel = 'parts';
  if (out.legMode === 'together' && out.footLevel === 'named') out.footLevel = 'parts';
  const firstR = selected.findIndex((id) => PART_BY_ID[id]?.set === 'R');
  const firstL = selected.findIndex((id) => PART_BY_ID[id]?.set === 'L');
  if (firstR >= 0 && firstL >= 0) out.firstSide = firstR < firstL ? 'R' : 'L';
  else if (firstR >= 0) out.firstSide = 'R';
  return out;
}

// ---------------------------------------------------------------- order
const ARM_KEYS = AREAS.arm.map((a) => a.key);
const LEG_KEYS = AREAS.leg.map((a) => a.key);
function limbBlock(limb, cfg, direction) {
  const keys = limb === 'arm' ? ARM_KEYS : LEG_KEYS;
  const sets = cfg.firstSide === 'R' ? ['B', 'R', 'L'] : ['B', 'L', 'R'];
  return sets.flatMap((set) => {
    const ids = keys.map((k) => partId(limb, set, k)).filter(Boolean);
    return direction === 'up' ? ids.reverse() : ids;
  });
}
// Every part id in scan order. Head to toe puts each arm and leg together, one after the other;
// toe to head reverses the order within each limb but still starts with the same side.
export function canonicalOrder(direction, cfg) {
  const { head, torso } = CORE_IDS;
  if (direction === 'up') {
    return [...limbBlock('leg', cfg, 'up'), ...[...torso].reverse(), ...limbBlock('arm', cfg, 'up'), ...[...head].reverse()];
  }
  return [...head, ...limbBlock('arm', cfg, 'down'), ...torso, ...limbBlock('leg', cfg, 'down')];
}

// Keep a saved custom order, slotting any part it doesn't know yet in after its usual neighbour.
export function mergeOrder(order, canonical) {
  const known = new Set(canonical);
  const result = [...new Set(order)].filter((id) => known.has(id));
  const have = new Set(result);
  canonical.forEach((id, i) => {
    if (have.has(id)) return;
    const prev = canonical.slice(0, i).reverse().find((x) => have.has(x));
    result.splice(prev ? result.indexOf(prev) + 1 : 0, 0, id);
    have.add(id);
  });
  return result;
}

// ---------------------------------------------------------------- old saved data
const OLD_ORDER = ['head', 'face', 'jaw', 'neck', 'shoulders', 'upperArms', 'forearms', 'hands', 'chest', 'upperBack', 'abdomen', 'lowerBack', 'hips', 'thighs', 'knees', 'calves', 'feet'];
// Version 1 had one "Elbows & forearms", "Lower legs" and "Ankles & feet" part each; they are split now.
export function migrateSelected(selected) {
  const out = selected.filter((id) => PART_BY_ID[id]);
  if (selected.includes('forearms')) out.push('elbows');
  if (selected.includes('calves')) out.push('shins');
  if (selected.includes('feet')) out.push('ankles');
  return [...new Set(out)];
}
export function migrateDirection(order) {
  if (!Array.isArray(order)) return 'down';
  const old = order.filter((id) => OLD_ORDER.includes(id));
  if (old.join() === OLD_ORDER.join()) return 'down';
  if (old.join() === [...OLD_ORDER].reverse().join()) return 'up';
  return 'custom';
}
