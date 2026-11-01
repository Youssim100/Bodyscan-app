// Static content: body parts, narrators, scripts.
//
// A "body part" is one step of the scan, and every step has its own narration clip.
// Head and torso parts are single ids. Arms and legs come in three sets:
//   'B' both sides together (ids like "shoulders"), 'L' left and 'R' right (ids like "armL_shoulder").

export const SIDE_WORD = { L: 'left', R: 'right', B: 'both' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- head and torso
const CORE = [
  { id: 'head', name: 'Top of head', keywords: 'scalp crown', region: 'head' },
  { id: 'face', name: 'Face', keywords: 'forehead eyes cheeks', region: 'head' },
  { id: 'jaw', name: 'Jaw & mouth', keywords: 'teeth lips tongue', region: 'head' },
  { id: 'neck', name: 'Neck & throat', keywords: '', region: 'head' },
  { id: 'chest', name: 'Chest', keywords: 'heart breath lungs', region: 'torso' },
  { id: 'upperBack', name: 'Upper back', keywords: 'shoulder blades spine', region: 'torso' },
  { id: 'abdomen', name: 'Belly', keywords: 'abdomen stomach', region: 'torso' },
  { id: 'lowerBack', name: 'Lower back', keywords: 'spine lumbar', region: 'torso' },
  { id: 'hips', name: 'Hips & pelvis', keywords: 'glutes seat', region: 'torso' },
];
export const REGION_LABEL = { head: 'Head and neck', torso: 'Torso', arms: 'Arms', legs: 'Legs' };

// ---------------------------------------------------------------- limb areas
// area(key, singular, plural, hint for one side, hint for both sides, id when both sides are together, search words, custom wording)
// Custom wording: { one(w), npBoth, titleOne(w), titleBoth, label, labelPl }
const area = (key, sg, pl, hintOne, hintBoth, bothId, kw = '', custom = {}) =>
  ({ key, sg, pl, hintOne, hintBoth, bothId, kw, ...custom });

export const AREAS = {
  arm: [
    area('shoulder', 'shoulder', 'shoulders', 'Notice its weight, and let it drop a little lower.', 'Notice their weight, and let them drop a little lower.', 'shoulders'),
    area('upperArm', 'upper arm', 'upper arms', 'Notice how it rests, heavy and supported.', 'Notice how they rest, heavy and supported.', 'upperArms', 'biceps triceps'),
    area('elbow', 'elbow', 'elbows', 'Notice the inside of the joint, and the outside.', 'Notice the inside of each joint, and the outside.', 'elbows'),
    area('forearm', 'forearm', 'forearms', 'Simply notice whatever is here.', 'Simply notice whatever is here.', 'forearms'),
    area('wrist', 'wrist', 'wrists', 'Notice any warmth, or tingling.', 'Notice any warmth, or tingling.', 'wrists'),
    area('hand', 'hand', 'hands', 'The palm, the back of the hand, and each finger.', 'The palms, the backs of the hands, and each finger.', 'hands', 'palm fingers'),
    // "In detail" is one item in the selection that expands into palm, back of hand and every finger, each its own timed step.
    area('handDetail', 'hand in detail', 'hands in detail', '', '', null, 'palm fingers thumb', {
      one: (w) => `your ${w} hand, in detail`, titleOne: (w) => `${cap(w)} hand in detail`, label: 'Hand in detail',
      expandsTo: ['palm', 'backHand', 'thumb', 'index', 'middle', 'ring', 'little'],
    }),
    area('palm', 'palm', 'palms', 'Feel what it rests on.', 'Feel what they rest on.', 'palms', 'hand'),
    area('backHand', 'back of the hand', 'backs of the hands', 'Notice the skin, and the air around it.', 'Notice the skin, and the air around it.', 'backHands', 'hand', {
      one: (w) => `the back of your ${w} hand`, npBoth: 'the backs of both hands',
      titleOne: (w) => `Back of ${w} hand`, titleBoth: 'Backs of both hands', label: 'Back of hand', labelPl: 'Backs of hands',
    }),
    area('fingers', 'fingers', 'fingers', 'Notice each one, and any tingling.', 'Notice each one, and any tingling.', 'fingers', 'hand', {
      one: (w) => `the fingers of your ${w} hand`, npBoth: 'the fingers of both hands',
      titleOne: (w) => `Fingers of ${w} hand`, titleBoth: 'Fingers of both hands', label: 'Fingers together', labelPl: 'Fingers together',
    }),
    area('thumb', 'thumb', 'thumbs', 'Simply notice it.', '', null, 'hand finger'),
    area('index', 'index finger', 'index fingers', 'Notice it, and whatever is here.', '', null, 'hand finger pointer'),
    area('middle', 'middle finger', 'middle fingers', 'Notice its length, and its warmth.', '', null, 'hand finger'),
    area('ring', 'ring finger', 'ring fingers', 'Notice it resting.', '', null, 'hand finger'),
    area('little', 'little finger', 'little fingers', 'Notice the smallest finger, and any tingling.', '', null, 'hand finger pinky'),
  ],
  leg: [
    area('thigh', 'thigh', 'thighs', 'Notice the large muscles, and let them release.', 'Notice the large muscles, and let them release.', 'thighs', 'quads hamstrings'),
    area('knee', 'knee', 'knees', 'The front of the knee, and the back.', 'The front of the knees, and the backs.', 'knees'),
    area('shin', 'shin', 'shins', 'Notice the bone beneath the skin.', 'Notice the bone beneath the skin.', 'shins', 'lower leg'),
    area('calf', 'calf', 'calves', 'Let it grow heavy.', 'Let them grow heavy.', 'calves', 'lower leg'),
    area('ankle', 'ankle', 'ankles', 'Notice the joint, loose and supported.', 'Notice the joints, loose and supported.', 'ankles'),
    area('foot', 'foot', 'feet', 'The heel, the sole, the top, and each toe.', 'The heels, the soles, the tops, and each toe.', 'feet', 'heel sole toes'),
    area('footDetail', 'foot in detail', 'feet in detail', '', '', null, 'heel sole toes', {
      one: (w) => `your ${w} foot, in detail`, titleOne: (w) => `${cap(w)} foot in detail`, label: 'Foot in detail',
      expandsTo: ['heel', 'sole', 'top', 'bigToe', 'secondToe', 'thirdToe', 'fourthToe', 'littleToe'],
    }),
    area('heel', 'heel', 'heels', 'Notice where it touches the surface.', 'Notice where they touch the surface.', 'heels', 'foot'),
    area('sole', 'sole', 'soles', 'Notice the whole underside.', 'Notice the whole underside.', 'soles', 'foot', {
      one: (w) => `the sole of your ${w} foot`, npBoth: 'the soles of both feet',
      titleOne: (w) => `Sole of ${w} foot`, titleBoth: 'Soles of both feet',
    }),
    area('top', 'top of the foot', 'tops of the feet', 'Notice the skin, and the air on it.', 'Notice the skin, and the air on it.', 'tops', 'foot instep', {
      one: (w) => `the top of your ${w} foot`, npBoth: 'the tops of both feet',
      titleOne: (w) => `Top of ${w} foot`, titleBoth: 'Tops of both feet', label: 'Top of foot', labelPl: 'Tops of feet',
    }),
    area('toes', 'toes', 'toes', 'All the toes together. Notice any tingling.', 'All the toes together. Notice any tingling.', 'toes', 'foot', {
      one: (w) => `the toes of your ${w} foot`, npBoth: 'the toes of both feet',
      titleOne: (w) => `Toes of ${w} foot`, titleBoth: 'Toes of both feet', label: 'Toes together', labelPl: 'Toes together',
    }),
    area('bigToe', 'big toe', 'big toes', 'Simply notice it.', '', null, 'foot toe'),
    area('secondToe', 'second toe', 'second toes', 'Notice it, and the space beside it.', '', null, 'foot toe'),
    area('thirdToe', 'third toe', 'third toes', 'Notice it resting.', '', null, 'foot toe'),
    area('fourthToe', 'fourth toe', 'fourth toes', 'Notice it, and whatever is here.', '', null, 'foot toe'),
    area('littleToe', 'little toe', 'little toes', 'Notice the smallest toe, and any tingling.', '', null, 'foot toe pinky'),
  ],
};

export const AREA_BY_KEY = Object.fromEntries(
  Object.entries(AREAS).map(([limb, list]) => [limb, Object.fromEntries(list.map((a) => [a.key, a]))]));
export const LIMB_NAME = { arm: 'arm', leg: 'leg' };
export const LIMB_PLURAL = { arm: 'arms', leg: 'legs' };

// ---------------------------------------------------------------- ids and wording
// A limb splits into its "limb" part (shoulder to wrist, thigh to ankle) and its "detail" part (the hand or foot
// and everything inside it). Each can be scanned together or one side at a time, independently.
const DETAIL_FROM = { arm: 'hand', leg: 'foot' };
const DETAIL_KEYS = Object.fromEntries(Object.entries(AREAS).map(([limb, list]) =>
  [limb, new Set(list.slice(list.findIndex((a) => a.key === DETAIL_FROM[limb])).map((a) => a.key))]));
export const scopeOf = (limb, key) => (DETAIL_KEYS[limb].has(key) ? 'detail' : 'limb');
// What the narrator calls the unit that is scanned on its own: the arm, the leg, the hand or the foot.
const UNIT = { arm: { limb: 'arm', detail: 'hand' }, leg: { limb: 'leg', detail: 'foot' } };

// Id of an area on a set: 'B' uses the plural id ("shoulders"), 'L' and 'R' use "armL_shoulder".
// Returns null where no such step exists (individual fingers and toes have no "both" version).
export function partId(limb, set, key) {
  const a = AREA_BY_KEY[limb][key];
  if (set === 'B') return a.bothId;
  return `${limb}${set}_${key}`;
}

// Wording for one area on one set.
//   np:    the noun phrase used in narration ("your left shoulder", "both shoulders")
//   title: the name shown on screen ("Left shoulder", "Both shoulders")
//   label: the short name used inside a group ("Shoulder", "Shoulders")
export function describe(limb, a, set) {
  if (set === 'B') {
    return {
      np: a.npBoth ?? `both ${a.pl}`,
      title: a.titleBoth ?? `Both ${a.pl}`,
      label: a.labelPl ?? cap(a.pl),
      hint: a.hintBoth,
    };
  }
  const w = SIDE_WORD[set];
  return {
    np: a.one ? a.one(w) : `your ${w} ${a.sg}`,
    title: a.titleOne ? a.titleOne(w) : `${cap(w)} ${a.sg}`,
    label: a.label ?? cap(a.sg),
    hint: a.hintOne,
  };
}

const GROUP_LABEL = (limb, set, scope) => {
  const noun = scope === 'detail' ? { arm: 'hand', leg: 'foot' }[limb] : LIMB_NAME[limb];
  const plural = scope === 'detail' ? { arm: 'hands', leg: 'feet' }[limb] : LIMB_PLURAL[limb];
  return set === 'B' ? `Both ${plural}` : `${cap(SIDE_WORD[set])} ${noun}`;
};

// ---------------------------------------------------------------- the catalogue
export const BODY_PARTS = [];
export const PART_BY_ID = {};
function register(part) {
  BODY_PARTS.push(part);
  PART_BY_ID[part.id] = part;
}
for (const c of CORE) register({ ...c, group: REGION_LABEL[c.region] });
for (const limb of ['arm', 'leg']) {
  for (const set of ['B', 'L', 'R']) {
    for (const a of AREAS[limb]) {
      const id = partId(limb, set, a.key);
      if (!id) continue;
      const d = describe(limb, a, set);
      register({
        id,
        name: d.title,
        label: d.label,
        keywords: `${a.sg} ${a.pl} ${a.kw} ${LIMB_NAME[limb]} ${set === 'B' ? 'both' : SIDE_WORD[set]}`.toLowerCase(),
        region: LIMB_PLURAL[limb],
        group: GROUP_LABEL(limb, set, scopeOf(limb, a.key)),
        limb,
        set,
        key: a.key,
        scope: scopeOf(limb, a.key),
        unit: UNIT[limb][scopeOf(limb, a.key)],
        // "In detail" items have no narration of their own: they play as the steps listed here.
        expandsTo: a.expandsTo ? a.expandsTo.map((k) => partId(limb, set, k)) : null,
      });
    }
  }
}

// Keep in sync with NARRATORS in tools/generate_audio.py
export const NARRATORS = [
  { id: 'ava', name: 'Ava', description: 'Warm and caring · American' },
  { id: 'andrew', name: 'Andrew', description: 'Soft and steady · American' },
  { id: 'sonia', name: 'Sonia', description: 'Gentle and clear · British' },
  { id: 'ryan', name: 'Ryan', description: 'Calm and grounded · British' },
];

export const STYLES = {
  guided: { name: 'Guided reflection', description: 'Gentle prompts support your focus throughout each body part.' },
  cues: { name: 'Attention cues', description: 'A brief cue names each body part, followed by quiet.' },
};

export const AMBIENCES = {
  none: 'None (silence)',
  rain: 'Soft rain',
  ocean: 'Ocean waves',
  drone: 'Warm tone',
};

export const TRANSITIONS = {
  silence: 'Silence',
  chime: 'Soft chime',
};

// Intro/outro sequences: clip ids interleaved with pauses (seconds).
export const SEQUENCES = {
  guided: {
    introFull: ['intro_1', 2.5, 'intro_2', 4, 'intro_3', 2, 'intro_4'],
    introShort: ['intro_short'],
    outroFull: ['outro_1', 5, 'outro_2', 6, 'outro_3', 3, 'outro_4'],
    outroShort: ['outro_short'],
  },
  cues: {
    introFull: ['intro_cues'],
    introShort: ['intro_short'],
    outroFull: ['outro_1', 6, 'outro_4'],
    outroShort: ['outro_short'],
  },
};

export const PROMPTS = ['prompt_1', 'prompt_2', 'prompt_3', 'prompt_4', 'prompt_5', 'prompt_6', 'prompt_7', 'prompt_8'];

export function partClip(style, partId) {
  return (style === 'cues' ? 'cue_' : 'guide_') + partId;
}

// Items chosen as one thing that are walked through as several timed steps ("left hand in detail" becomes
// palm, back of hand, thumb, index finger, ...). Every step gets its own narration and an equal share of the time.
export function expandParts(parts) {
  return parts.flatMap((id) => PART_BY_ID[id]?.expandsTo ?? [id]);
}

// When one arm, leg, hand or foot is scanned on its own, its first step is preceded by a short line
// ("Now, bring your attention to your left arm only"). `parts` is the scan order, already expanded.
// No line when the step continues the same side of the same limb (the left hand right after the left wrist).
// The line is the "first" version unless the other side of the same kind already came earlier.
export function entryClip(parts, i) {
  const p = PART_BY_ID[parts[i]];
  if (!p?.limb || p.set === 'B') return null;
  const prev = PART_BY_ID[parts[i - 1]];
  if (i > 0 && prev?.limb === p.limb && prev.set === p.set) return null;
  // Name the widest thing this run covers: toe to head starts at the fingers but the run is the whole arm.
  let end = i;
  while (PART_BY_ID[parts[end + 1]]?.limb === p.limb && PART_BY_ID[parts[end + 1]].set === p.set) end++;
  const wide = parts.slice(i, end + 1).some((id) => PART_BY_ID[id].scope === 'limb');
  const unit = wide ? p.limb : p.unit;
  const other = parts.slice(0, i).some((id) => {
    const q = PART_BY_ID[id];
    return q?.unit === unit && q.set !== p.set && q.set !== 'B';
  });
  return `entry_${unit}${p.set}_${other ? 'second' : 'first'}`;
}

export const ENTRY_CLIPS = ['arm', 'leg', 'hand', 'foot'].flatMap((unit) =>
  ['L', 'R'].flatMap((set) => ['first', 'second'].map((v) => `entry_${unit}${set}_${v}`)));

// Every clip a narrator needs for any session.
export function allClipIds() {
  const ids = new Set(['preview', ...PROMPTS, ...ENTRY_CLIPS]);
  for (const style of Object.keys(SEQUENCES)) {
    for (const seq of Object.values(SEQUENCES[style])) seq.forEach((x) => typeof x === 'string' && ids.add(x));
    BODY_PARTS.filter((p) => !p.expandsTo).forEach((p) => ids.add(partClip(style, p.id)));
  }
  return [...ids];
}
