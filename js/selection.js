// Pure selection logic (no DOM): which steps a choice in the UI means, and in what order they run.
//
// The selection itself is a flat list of part ids. The UI works with coarser ideas:
//   region  head, torso, arms, legs
//   node    one area of a limb: shoulder, upperArm, elbow, forearm, wrist, hand | thigh, knee, shin, calf, ankle, foot
//   scope   a limb's "limb" part (shoulder to wrist, thigh to ankle) or its "detail" part (the hand or foot)
//   mode    for each scope (arms, legs, hands, feet): 'together' (both sides in one step) or 'separate' (left, then right)
//   level   how finely a hand or foot is walked through:
//             'whole'     one step
//             'parts'     palm, back of hand, fingers | heel, sole, top, toes
//             'named'     palm, back of hand and every finger by name | heel, sole, top and every toe by name
//             'detailed'  the same steps as 'named', chosen as one item
//           'named' and 'detailed' need hands or feet one side at a time (individual fingers and toes exist per side).
import { PART_BY_ID, AREAS, partId, scopeOf } from './content.js';

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

export const DEFAULT_CONFIG = {
  armMode: 'together', legMode: 'together', handMode: 'together', footMode: 'together',
  handLevel: 'whole', footLevel: 'whole', firstSide: 'L',
};

export const nodeScope = (limb, node) => (node === DETAIL_NODE[limb] ? 'detail' : 'limb');
const MODE_KEY = { arm: { limb: 'armMode', detail: 'handMode' }, leg: { limb: 'legMode', detail: 'footMode' } };
export const modeKey = (limb, scope) => MODE_KEY[limb][scope];
const modeFor = (cfg, limb, scope) => cfg[MODE_KEY[limb][scope]];
const levelOf = (cfg, limb) => (limb === 'arm' ? cfg.handLevel : cfg.footLevel);
// The sets a scope of a limb is scanned as, in scan order.
export const setsFor = (cfg, limb, scope = 'limb') =>
  (modeFor(cfg, limb, scope) === 'together' ? ['B'] : cfg.firstSide === 'R' ? ['R', 'L'] : ['L', 'R']);
export const setsForNode = (cfg, limb, node) => setsFor(cfg, limb, nodeScope(limb, node));
// Individual fingers and toes only exist per side, so "both together" falls back to the group.
export const effectiveLevel = (level, set) => (set === 'B' && (level === 'named' || level === 'detailed') ? 'parts' : level);

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
const allNodeIds = (limb, cfg, nodes = NODES[limb]) =>
  nodes.flatMap((node) => setsForNode(cfg, limb, node).flatMap((set) => nodeLeaves(limb, set, node, levelOf(cfg, limb))));
export function regionIds(region, cfg) {
  if (CORE_IDS[region]) return CORE_IDS[region];
  return allNodeIds(REGION_LIMB[region], cfg);
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

// One side of a limb ("Left arm") as a unit: the nodes that are scanned per side for this set.
const nodesInSet = (limb, set, cfg) => NODES[limb].filter((node) => setsForNode(cfg, limb, node).includes(set));
export const setIds = (limb, set, cfg) =>
  nodesInSet(limb, set, cfg).flatMap((node) => nodeLeaves(limb, set, node, levelOf(cfg, limb)));
export function toggleSet(selected, limb, set, cfg) {
  const on = status(selected, setIds(limb, set, cfg)) !== 'on';
  const cleared = without(selected, nodesInSet(limb, set, cfg).flatMap((node) => nodeAllLeaves(limb, set, node)));
  return on ? withIds(cleared, setIds(limb, set, cfg)) : cleared;
}

// ---------------------------------------------------------------- changing how arms/legs/hands/feet are split
// Switch one scope of a limb (arms, legs, hands or feet) between "together" and "one at a time",
// carrying the chosen areas over.
export function changeMode(selected, limb, scope, from, to) {
  if (from === to) return selected;
  const oldSets = from === 'together' ? ['B'] : ['L', 'R'];
  const newSets = to === 'together' ? ['B'] : ['L', 'R'];
  const inScope = (id) => { const p = PART_BY_ID[id]; return p?.limb === limb && p.scope === scope && oldSets.includes(p.set); };
  const keys = new Set(selected.filter(inScope).map((id) => PART_BY_ID[id].key));
  let next = selected.filter((id) => !inScope(id));
  const group = DIGITS[DETAIL_NODE[limb]];
  for (const key of keys) {
    // No individual fingers or toes in "together": they fall back to the group (or the parts).
    let k = key;
    if (to === 'together' && group.named.includes(key)) k = group.group;
    if (to === 'together' && key === `${DETAIL_NODE[limb]}Detail`) k = DETAIL_NODE[limb];
    for (const set of newSets) next = withIds(next, [partId(limb, set, k)].filter(Boolean));
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
    const eff = effectiveLevel(to, set);
    let keys;
    if (eff === 'whole') keys = [detail];
    else if (eff === 'detailed') keys = [`${detail}Detail`];
    else if (oldKeys.includes(detail) || oldKeys.includes(`${detail}Detail`)) keys = LEAVES[detail][eff];
    else {
      keys = [];
      for (const k of oldKeys) {
        if (k === digits.group || digits.named.includes(k)) keys.push(...(eff === 'named' ? digits.named : [digits.group]));
        else keys.push(k);
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
    for (const scope of ['limb', 'detail']) {
      const inScope = parts.filter((p) => p.scope === scope);
      if (inScope.some((p) => p.set !== 'B')) out[modeKey(limb, scope)] = 'separate';
      else if (inScope.length) out[modeKey(limb, scope)] = 'together';
    }
    const detail = DETAIL_NODE[limb];
    const keys = new Set(parts.filter((p) => p.scope === 'detail').map((p) => p.key));
    const lvl = DIGITS[detail].named.some((k) => keys.has(k)) ? 'named'
      : keys.has(`${detail}Detail`) ? 'detailed'
        : LEAVES[detail].parts.some((k) => keys.has(k)) ? 'parts'
          : keys.has(detail) ? 'whole' : null;
    if (lvl) out[limb === 'arm' ? 'handLevel' : 'footLevel'] = lvl;
    // Individual fingers and toes need that hand or foot one side at a time.
    const lk = limb === 'arm' ? 'handLevel' : 'footLevel';
    if (out[modeKey(limb, 'detail')] === 'together' && (out[lk] === 'named' || out[lk] === 'detailed')) out[lk] = 'parts';
  }
  const firstR = selected.findIndex((id) => PART_BY_ID[id]?.set === 'R');
  const firstL = selected.findIndex((id) => PART_BY_ID[id]?.set === 'L');
  if (firstR >= 0 && firstL >= 0) out.firstSide = firstR < firstL ? 'R' : 'L';
  else if (firstR >= 0) out.firstSide = 'R';
  return out;
}

// ---------------------------------------------------------------- order
const KEYS = { arm: AREAS.arm.map((a) => a.key), leg: AREAS.leg.map((a) => a.key) };
// The runs one limb is scanned in: [{ set, keys }]. When arms and hands are split the same way,
// each side is one run ("left arm, hand included"); otherwise the hands get their own runs after the arms.
function limbRuns(limb, cfg) {
  const keys = KEYS[limb];
  const limbSets = setsFor(cfg, limb, 'limb');
  const detailSets = setsFor(cfg, limb, 'detail');
  if (limbSets.join() === detailSets.join()) return limbSets.map((set) => ({ set, keys }));
  const pick = (scope) => keys.filter((k) => scopeOf(limb, k) === scope);
  return [
    ...limbSets.map((set) => ({ set, keys: pick('limb') })),
    ...detailSets.map((set) => ({ set, keys: pick('detail') })),
  ];
}
function limbOrder(limb, cfg, direction) {
  const idsOf = (run) => run.keys.map((k) => partId(limb, run.set, k)).filter(Boolean);
  let runs = limbRuns(limb, cfg).map((run) => ({ run, ids: idsOf(run) }));
  if (direction === 'up') {
    runs = runs.map((r) => ({ ...r, ids: [...r.ids].reverse() }));
    // toe to head: when hands/feet have their own runs they come first
    runs.sort((a, b) => (scopeOf(limb, b.run.keys[0]) === 'detail') - (scopeOf(limb, a.run.keys[0]) === 'detail'));
  }
  const primary = runs.flatMap((r) => r.ids);
  // parts that belong to other modes (e.g. left/right ids while "together") still have a place in the full order
  const rest = ['B', 'L', 'R'].flatMap((set) => {
    const ids = KEYS[limb].map((k) => partId(limb, set, k)).filter((id) => id && !primary.includes(id));
    return direction === 'up' ? ids.reverse() : ids;
  });
  return [...primary, ...rest];
}
// Every part id in scan order. Head to toe puts each arm and leg together, one after the other;
// toe to head reverses the order within each limb but still starts with the same side.
export function canonicalOrder(direction, cfg) {
  const { head, torso } = CORE_IDS;
  if (direction === 'up') {
    return [...limbOrder('leg', cfg, 'up'), ...[...torso].reverse(), ...limbOrder('arm', cfg, 'up'), ...[...head].reverse()];
  }
  return [...head, ...limbOrder('arm', cfg, 'down'), ...torso, ...limbOrder('leg', cfg, 'down')];
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
