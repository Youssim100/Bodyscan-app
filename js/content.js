// Static content: body parts (default head-to-toe order), narrators, scripts.

export const BODY_PARTS = [
  { id: 'head', name: 'Top of head', keywords: 'scalp crown' },
  { id: 'face', name: 'Face', keywords: 'forehead eyes cheeks' },
  { id: 'jaw', name: 'Jaw & mouth', keywords: 'teeth lips tongue' },
  { id: 'neck', name: 'Neck & throat', keywords: '' },
  { id: 'shoulders', name: 'Shoulders', keywords: '' },
  { id: 'upperArms', name: 'Upper arms', keywords: 'biceps triceps' },
  { id: 'forearms', name: 'Elbows & forearms', keywords: 'wrists' },
  { id: 'hands', name: 'Hands & fingers', keywords: 'palms' },
  { id: 'chest', name: 'Chest', keywords: 'heart breath lungs' },
  { id: 'upperBack', name: 'Upper back', keywords: 'shoulder blades spine' },
  { id: 'abdomen', name: 'Belly', keywords: 'abdomen stomach' },
  { id: 'lowerBack', name: 'Lower back', keywords: 'spine lumbar' },
  { id: 'hips', name: 'Hips & pelvis', keywords: 'glutes seat' },
  { id: 'thighs', name: 'Thighs', keywords: 'legs quads hamstrings' },
  { id: 'knees', name: 'Knees', keywords: 'legs' },
  { id: 'calves', name: 'Lower legs', keywords: 'shins calves' },
  { id: 'feet', name: 'Ankles & feet', keywords: 'toes heels soles' },
];

export const PART_BY_ID = Object.fromEntries(BODY_PARTS.map((p) => [p.id, p]));
export const DEFAULT_ORDER = BODY_PARTS.map((p) => p.id);

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

// Every clip a narrator needs for any session.
export function allClipIds() {
  const ids = new Set(['preview', ...PROMPTS]);
  for (const style of Object.keys(SEQUENCES)) {
    for (const seq of Object.values(SEQUENCES[style])) seq.forEach((x) => typeof x === 'string' && ids.add(x));
    DEFAULT_ORDER.forEach((p) => ids.add(partClip(style, p)));
  }
  return [...ids];
}
