// Interactive front/back body diagram. Each body part is a focusable checkbox;
// selection is shown with a striped fill, thick outline and check badge, not color alone.
import { PART_BY_ID } from './content.js';

const SVG = 'http://www.w3.org/2000/svg';

// Shapes per view, in a 200 x 400 box centred on x = 100.
const pair = (fn) => [fn(-1), fn(1)];
const rect = (x, y, w, h, r) => ({ tag: 'rect', x, y, width: w, height: h, rx: r });
const ell = (cx, cy, rx, ry) => ({ tag: 'ellipse', cx, cy, rx, ry });
const mirrorRect = (x, y, w, h, r) => pair((s) => rect(s < 0 ? x : 200 - x - w, y, w, h, r));
const mirrorEll = (cx, cy, rx, ry) => pair((s) => ell(s < 0 ? cx : 200 - cx, cy, rx, ry));

const COMMON = {
  neck: [rect(91, 67, 18, 12, 4)],
  shoulders: mirrorRect(58, 81, 40, 15, 7),
  upperArms: mirrorRect(55, 98, 15, 54, 7),
  forearms: mirrorRect(53, 154, 14, 54, 7),
  hands: mirrorEll(60, 222, 8, 12),
  hips: [rect(72, 188, 56, 28, 9)],
  thighs: mirrorRect(74, 218, 24, 72, 10),
  knees: mirrorEll(86, 300, 11, 9),
  calves: mirrorRect(77, 311, 18, 62, 8),
  feet: mirrorEll(85, 382, 11, 7),
};

const FRONT = {
  head: [{ ...rect(78, 14, 44, 19, 0), clip: 'head' }],
  face: [{ ...rect(78, 34, 44, 18, 0), clip: 'head' }],
  jaw: [{ ...rect(78, 53, 44, 14, 0), clip: 'head' }],
  ...COMMON,
  chest: [rect(72, 98, 56, 46, 6)],
  abdomen: [rect(74, 146, 52, 40, 6)],
};

const BACK = {
  head: [ell(100, 40, 21, 25)],
  ...COMMON,
  upperBack: [rect(72, 98, 56, 52, 6)],
  lowerBack: [rect(74, 152, 52, 34, 6)],
};

const BACK_ONLY = new Set(['upperBack', 'lowerBack']);

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
}

export function createBodyDiagram(container, { isSelected, toggle }) {
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
  [['front', FRONT, 0], ['back', BACK, 125]].forEach(([view, shapes, dx]) => {
    const g = el('g', { transform: `translate(${dx} 0)` }, svg);
    el('text', { x: 100, y: 412, class: 'body-label', 'text-anchor': 'middle', 'aria-hidden': 'true' }, g).textContent = view === 'front' ? 'Front' : 'Back';
    for (const [id, list] of Object.entries(shapes)) {
      const focusable = view === 'front' ? !BACK_ONLY.has(id) : BACK_ONLY.has(id);
      const region = el('g', { class: 'region', 'data-part': id }, g);
      if (focusable) {
        region.setAttribute('role', 'checkbox');
        region.setAttribute('tabindex', '0');
        region.setAttribute('aria-label', PART_BY_ID[id].name);
      } else {
        region.setAttribute('aria-hidden', 'true');
      }
      el('title', {}, region).textContent = PART_BY_ID[id].name;
      for (const s of list) {
        const { tag, clip, ...attrs } = s;
        const shape = el(tag, { ...attrs, class: 'shape' }, region);
        if (clip) shape.setAttribute('clip-path', `url(#clip-head-${view})`);
      }
      // check badge on the first shape's area, visible when selected
      const first = list[0];
      const bx = first.tag === 'ellipse' ? first.cx : first.x + first.width / 2;
      const by = first.tag === 'ellipse' ? first.cy : first.y + first.height / 2;
      const badge = el('g', { class: 'badge', transform: `translate(${bx} ${by})`, 'aria-hidden': 'true' }, region);
      el('circle', { r: 6.5 }, badge);
      el('path', { d: 'M-3 0.2 L-0.8 2.6 L3.4 -2.4' }, badge);
      region.addEventListener('click', () => toggle(id));
      region.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(id); }
      });
      regions.push(region);
    }
  });
  container.replaceChildren(svg);

  return {
    refresh() {
      for (const r of regions) {
        const on = isSelected(r.dataset.part);
        r.classList.toggle('selected', on);
        if (r.hasAttribute('role')) r.setAttribute('aria-checked', String(on));
      }
    },
  };
}
