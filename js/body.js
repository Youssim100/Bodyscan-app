// Interactive front/back body diagram. Each body area is a focusable checkbox;
// selection is shown with a striped fill, thick outline and check badge, not color alone.
//
// Head and torso areas are single shapes. Arm and leg areas come as a left and a right shape:
// when a limb is scanned "together" both shapes act as one; when scanned "one at a time" each
// side is its own checkbox. The page decides what that means through the callbacks.
import { PART_BY_ID } from './content.js';

const SVG = 'http://www.w3.org/2000/svg';

// Shapes per view, in a 200 x 400 box centred on x = 100.
const rect = (x, y, w, h, r) => ({ tag: 'rect', x, y, width: w, height: h, rx: r });
const ell = (cx, cy, rx, ry) => ({ tag: 'ellipse', cx, cy, rx, ry });
// [viewer's left shape, viewer's right shape]
const mirrorRect = (x, y, w, h, r) => [rect(x, y, w, h, r), rect(200 - x - w, y, w, h, r)];
const mirrorEll = (cx, cy, rx, ry) => [ell(cx, cy, rx, ry), ell(200 - cx, cy, rx, ry)];

const CORE = {
  head: { front: [{ ...rect(78, 14, 44, 19, 0), clip: 'head' }], back: [ell(100, 40, 21, 25)] },
  face: { front: [{ ...rect(78, 34, 44, 18, 0), clip: 'head' }] },
  jaw: { front: [{ ...rect(78, 53, 44, 14, 0), clip: 'head' }] },
  neck: { front: [rect(91, 67, 18, 12, 4)], back: [rect(91, 67, 18, 12, 4)] },
  chest: { front: [rect(72, 98, 56, 46, 6)] },
  abdomen: { front: [rect(74, 146, 52, 40, 6)] },
  hips: { front: [rect(72, 188, 56, 28, 9)], back: [rect(72, 188, 56, 28, 9)] },
  upperBack: { back: [rect(72, 98, 56, 52, 6)] },
  lowerBack: { back: [rect(74, 152, 52, 34, 6)] },
};

const LIMB_SHAPES = [
  { limb: 'arm', node: 'shoulder', shapes: mirrorRect(58, 81, 40, 15, 7) },
  { limb: 'arm', node: 'upperArm', shapes: mirrorRect(55, 98, 15, 50, 7) },
  { limb: 'arm', node: 'elbow', shapes: mirrorRect(54, 149, 16, 14, 5) },
  { limb: 'arm', node: 'forearm', shapes: mirrorRect(53, 164, 14, 32, 6) },
  { limb: 'arm', node: 'wrist', shapes: mirrorRect(54, 197, 12, 10, 4) },
  { limb: 'arm', node: 'hand', shapes: mirrorEll(60, 221, 8, 12) },
  { limb: 'leg', node: 'thigh', shapes: mirrorRect(74, 218, 24, 72, 10) },
  { limb: 'leg', node: 'knee', shapes: mirrorEll(86, 300, 11, 9) },
  { limb: 'leg', node: 'shin', shapes: mirrorRect(77, 311, 18, 53, 8), view: 'front' },
  { limb: 'leg', node: 'calf', shapes: mirrorRect(77, 311, 18, 53, 8), view: 'back' },
  { limb: 'leg', node: 'ankle', shapes: mirrorEll(86, 369, 8, 5) },
  { limb: 'leg', node: 'foot', shapes: mirrorEll(85, 382, 11, 7) },
];
// Which side of the person each shape belongs to: facing us, their left is on our right; from behind it is the reverse.
const SIDE_OF_SHAPE = { front: ['R', 'L'], back: ['L', 'R'] };
const BACK_ONLY = new Set(['upperBack', 'lowerBack', 'calf']);

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
}

export function createBodyDiagram(container, api) {
  const svg = el('svg', { viewBox: '43 6 234 414', class: 'body-svg', role: 'group', 'aria-label': 'Body diagram. Select body parts to include.' });
  const defs = el('defs', {}, svg);
  const pattern = el('pattern', { id: 'sel-stripes', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('rect', { width: 6, height: 6, class: 'stripe-bg' }, pattern);
  el('rect', { width: 2.5, height: 6, class: 'stripe-fg' }, pattern);
  for (const view of ['front', 'back']) {
    const cp = el('clipPath', { id: `clip-head-${view}` }, defs);
    el('ellipse', { cx: 100, cy: 40, rx: 21, ry: 25 }, cp);
  }

  const regions = [];
  function addRegion(g, view, data, shapes, onToggle, focusable) {
    const region = el('g', { class: 'region' }, g);
    const title = el('title', {}, region);
    for (const s of shapes) {
      const { tag, clip, ...attrs } = s;
      const shape = el(tag, { ...attrs, class: 'shape' }, region);
      if (clip) shape.setAttribute('clip-path', `url(#clip-head-${view})`);
    }
    const first = shapes[0];
    const bx = first.tag === 'ellipse' ? first.cx : first.x + first.width / 2;
    const by = first.tag === 'ellipse' ? first.cy : first.y + first.height / 2;
    // Small shapes (wrists, ankles) get a smaller badge so it doesn't cover them.
    const w = first.tag === 'ellipse' ? first.rx * 2 : first.width;
    const h = first.tag === 'ellipse' ? first.ry * 2 : first.height;
    const scale = Math.min(1, Math.min(w, h) / 16).toFixed(2);
    const badge = el('g', { class: 'badge', transform: `translate(${bx} ${by}) scale(${scale})`, 'aria-hidden': 'true' }, region);
    el('circle', { r: 6.5 }, badge);
    el('path', { d: 'M-3 0.2 L-0.8 2.6 L3.4 -2.4', class: 'tick' }, badge);
    el('path', { d: 'M-3 0 L3 0', class: 'dash' }, badge);
    region.addEventListener('click', onToggle);
    region.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); }
    });
    regions.push({ region, title, focusable, ...data });
  }

  [['front', 0], ['back', 125]].forEach(([view, dx]) => {
    const g = el('g', { transform: `translate(${dx} 0)` }, svg);
    el('text', { x: 100, y: 412, class: 'body-label', 'text-anchor': 'middle', 'aria-hidden': 'true' }, g).textContent = view === 'front' ? 'Front' : 'Back';
    for (const [id, views] of Object.entries(CORE)) {
      const shapes = views[view];
      if (!shapes) continue;
      const focusable = view === 'front' ? !BACK_ONLY.has(id) : BACK_ONLY.has(id);
      addRegion(g, view, { kind: 'core', id }, shapes, () => api.toggleCore(id), focusable);
    }
    for (const spec of LIMB_SHAPES) {
      if (spec.view && spec.view !== view) continue;
      const focusable = view === 'front' ? !BACK_ONLY.has(spec.node) : BACK_ONLY.has(spec.node);
      spec.shapes.forEach((shape, i) => {
        const side = SIDE_OF_SHAPE[view][i];
        addRegion(g, view, { kind: 'limb', limb: spec.limb, node: spec.node, side }, [shape], () => api.toggleLimb(spec.limb, side, spec.node), focusable);
      });
    }
  });
  container.replaceChildren(svg);

  return {
    refresh() {
      for (const r of regions) {
        let st; let label; let focusable = r.focusable;
        if (r.kind === 'core') {
          st = api.coreStatus(r.id);
          label = PART_BY_ID[r.id].name;
        } else {
          st = api.limbStatus(r.limb, r.side, r.node);
          label = api.label(r.limb, r.side, r.node);
          // "Together": left and right act as one, so only one of the pair takes keyboard focus.
          if (api.isTogether(r.limb) && r.side !== 'L') focusable = false;
        }
        r.region.classList.toggle('selected', st === 'on');
        r.region.classList.toggle('partial', st === 'partial');
        r.title.textContent = label;
        if (focusable) {
          r.region.setAttribute('role', 'checkbox');
          r.region.setAttribute('tabindex', '0');
          r.region.setAttribute('aria-label', label);
          r.region.setAttribute('aria-checked', st === 'on' ? 'true' : st === 'partial' ? 'mixed' : 'false');
          r.region.removeAttribute('aria-hidden');
        } else {
          for (const a of ['role', 'tabindex', 'aria-label', 'aria-checked']) r.region.removeAttribute(a);
          r.region.setAttribute('aria-hidden', 'true');
        }
      }
    },
  };
}
