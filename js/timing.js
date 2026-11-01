// Pure session planning: equal segment allocation and the narration timeline.
// No DOM or audio here, so it runs in Node tests too.
import { SEQUENCES, PROMPTS, partClip, entryClip } from './content.js';

export const INTRO_LEAD = 3;        // opening bell rings, then narration starts
export const INTRO_SETTLE = 2;      // quiet after the intro before the first part
export const OUTRO_LEAD = 1.5;      // quiet at the start of the closing section
export const BELL_TAIL = 7;         // closing bell rings in the final seconds
export const SEG_LEAD = 1;          // narration delay at the start of a part
export const CHIME_LEAD = 2.5;      // narration delay after a transition chime
export const ENTRY_GAP = 1.5;       // pause between "now, your left arm only" and the first part of that arm
export const SEG_TAIL_QUIET = 5;    // last seconds of every part stay quiet
export const PROMPT_SPACING = 26;   // guided prompts need at least this much room each
export const MAX_PROMPTS = 4;
export const FULL_MIN_SEG = { guided: 45, cues: 20 }; // per-part seconds needed for the long intro/outro

// Split bodySeconds into n integer segments that differ by at most one second.
// The extra seconds go to the first segments, so the split is always the same.
export function allocateSegments(bodySeconds, n) {
  if (n <= 0) return [];
  const base = Math.floor(bodySeconds / n);
  const extra = bodySeconds - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

function sequenceLength(seq, dur) {
  return seq.reduce((sum, x) => sum + (typeof x === 'number' ? x : dur(x)), 0);
}

function layoutSequence(seq, start, dur, events, section) {
  let t = start;
  for (const x of seq) {
    if (typeof x === 'number') { t += x; continue; }
    events.push({ at: t, type: 'clip', id: x, end: t + dur(x), section });
    t += dur(x);
  }
  return t;
}

function introSeconds(kind, seqs, dur) {
  if (kind === 'none') return 0;
  return Math.ceil(INTRO_LEAD + sequenceLength(seqs[kind === 'full' ? 'introFull' : 'introShort'], dur) + INTRO_SETTLE);
}

function outroSeconds(kind, seqs, dur) {
  if (kind === 'bell') return BELL_TAIL;
  return Math.ceil(OUTRO_LEAD + sequenceLength(seqs[kind === 'full' ? 'outroFull' : 'outroShort'], dur) + 1.5 + BELL_TAIL);
}

// Narration that comes before a part's own clip: the "left arm only" line, when there is one.
function entryLength(parts, i, dur) {
  const entry = entryClip(parts, i);
  return entry ? dur(entry) + ENTRY_GAP : 0;
}

// Shortest part length that still leaves room for the part's narration.
export function minSegmentSeconds(parts, style, transition, dur) {
  const lead = transition === 'chime' ? CHIME_LEAD : SEG_LEAD;
  const longest = Math.max(...parts.map((p, i) => entryLength(parts, i, dur) + dur(partClip(style, p))));
  return Math.ceil(lead + longest + SEG_TAIL_QUIET);
}

/**
 * Build a session plan.
 * @param {object} o
 * @param {number} o.totalSeconds  chosen session length
 * @param {string[]} o.parts        selected body part ids, in scan order
 * @param {'guided'|'cues'} o.style
 * @param {'silence'|'chime'} o.transition
 * @param {Record<string, number>} o.durations clip id -> seconds for the chosen narrator
 * @param {boolean} [o.countIntro] opening is part of the chosen length (else added on top)
 * @param {boolean} [o.countOutro] closing is part of the chosen length (else added on top)
 */
export function planSession({ totalSeconds: chosenSeconds, parts, style, transition, durations, countIntro = true, countOutro = true }) {
  const n = parts.length;
  if (n === 0) return { ok: false, reason: 'no-parts' };
  const dur = (id) => durations[id] ?? 4;
  const seqs = SEQUENCES[style];
  const minSeg = minSegmentSeconds(parts, style, transition, dur);

  const options = [
    { intro: 'full', outro: 'full', minBase: Math.max(minSeg, FULL_MIN_SEG[style]) },
    { intro: 'short', outro: 'short', minBase: minSeg },
    { intro: 'none', outro: 'bell', minBase: minSeg },
  ];
  let chosen = null;
  for (const opt of options) {
    const introSec = introSeconds(opt.intro, seqs, dur);
    const outroSec = outroSeconds(opt.outro, seqs, dur);
    const body = chosenSeconds - (countIntro ? introSec : 0) - (countOutro ? outroSec : 0);
    if (Math.floor(body / n) >= opt.minBase) { chosen = { ...opt, introSec, outroSec, body }; break; }
  }
  if (!chosen) {
    const minMinutes = Math.ceil((minSeg * n + (countOutro ? BELL_TAIL : 0)) / 60);
    return { ok: false, reason: 'too-short', minMinutes, minSeg };
  }
  // Actual session length: equals the chosen length unless opening/closing are added on top.
  const totalSeconds = chosen.introSec + chosen.body + chosen.outroSec;

  const events = [];
  // Opening
  if (chosen.intro !== 'none') {
    events.push({ at: 0, type: 'chime', kind: 'open', section: 'intro' });
    layoutSequence(seqs[chosen.intro === 'full' ? 'introFull' : 'introShort'], INTRO_LEAD, dur, events, 'intro');
  }

  // Body parts
  const lengths = allocateSegments(chosen.body, n);
  const segments = [];
  let t = chosen.introSec;
  parts.forEach((partId, i) => {
    const seg = { index: i, partId, start: t, duration: lengths[i], end: t + lengths[i] };
    segments.push(seg);
    let lead = SEG_LEAD;
    if (transition === 'chime') {
      events.push({ at: t, type: 'chime', kind: 'soft', seg: i });
      lead = CHIME_LEAD;
    }
    const clip = partClip(style, partId);
    const entry = entryClip(parts, i);
    if (entry) events.push({ at: t + lead, type: 'clip', id: entry, end: t + lead + dur(entry), seg: i });
    const clipStart = t + lead + entryLength(parts, i, dur);
    events.push({ at: clipStart, type: 'clip', id: clip, end: clipStart + dur(clip), seg: i });

    if (style === 'guided') {
      const quietFrom = seg.end - SEG_TAIL_QUIET;
      const free = quietFrom - (clipStart + dur(clip));
      const count = Math.min(MAX_PROMPTS, Math.floor(free / PROMPT_SPACING));
      for (let k = 0; k < count; k++) {
        const id = PROMPTS[(i * 3 + k) % PROMPTS.length];
        const slot = clipStart + dur(clip) + (free * (k + 1)) / (count + 1);
        const at = Math.min(slot, quietFrom - dur(id));
        events.push({ at, type: 'clip', id, end: at + dur(id), seg: i });
      }
    }
    t += lengths[i];
  });

  // Closing
  if (chosen.outro !== 'bell') {
    layoutSequence(seqs[chosen.outro === 'full' ? 'outroFull' : 'outroShort'], t + OUTRO_LEAD, dur, events, 'outro');
  }
  const bellAt = totalSeconds - BELL_TAIL;
  events.push({ at: bellAt, type: 'chime', kind: 'close', section: 'outro' });
  events.push({ at: bellAt + 2.5, type: 'chime', kind: 'close', section: 'outro' });

  events.sort((a, b) => a.at - b.at);
  return {
    ok: true,
    totalSeconds,
    chosenSeconds,
    countIntro,
    countOutro,
    style,
    intro: chosen.intro,
    outro: chosen.outro,
    introSec: chosen.introSec,
    outroSec: chosen.outroSec,
    segments,
    perPart: { min: Math.min(...lengths), max: Math.max(...lengths) },
    events,
  };
}

// Which segment (or intro/outro) is active at session time t.
export function locate(plan, t) {
  if (t < plan.introSec) return { section: 'intro' };
  for (const seg of plan.segments) if (t < seg.end) return { section: 'part', seg };
  return { section: 'outro' };
}
