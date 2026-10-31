// Web Audio engine: narration clips, synthesized chimes and background sounds.
// Two channels with their own gain: voice (narration) and sound (background + chimes).
// Volume runs through GainNodes because iOS ignores <audio>.volume.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map(); // "narrator/id" -> AudioBuffer
    this.pending = new Map();
    this.scheduled = new Set();
    this.preview = null;
    this.ambience = null;
    this.onstatechange = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'playback' });
    this.voice = this.ctx.createGain();
    this.sound = this.ctx.createGain();
    this.voice.connect(this.ctx.destination);
    this.sound.connect(this.ctx.destination);
    this.ctx.onstatechange = () => this.onstatechange?.(this.ctx.state);
    return this.ctx;
  }

  // Call synchronously inside a tap handler: iOS only starts audio from a user gesture.
  unlock() {
    const ctx = this.ensure();
    // Play through the ringer/silent switch like other meditation apps (iOS 17+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
    return ctx.state === 'running' ? Promise.resolve() : ctx.resume();
  }

  setLevels({ voiceVolume, voiceMuted, soundVolume, soundMuted }) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.voice.gain.setTargetAtTime(voiceMuted ? 0 : voiceVolume, now, 0.05);
    this.sound.gain.setTargetAtTime(soundMuted ? 0 : soundVolume, now, 0.05);
  }

  loadClip(narrator, id) {
    const key = `${narrator}/${id}`;
    if (this.buffers.has(key)) return Promise.resolve(this.buffers.get(key));
    if (this.pending.has(key)) return this.pending.get(key);
    const ctx = this.ensure();
    const p = fetch(`audio/${narrator}/${id}.mp3`)
      .then((r) => { if (!r.ok) throw new Error(`${key}: ${r.status}`); return r.arrayBuffer(); })
      .then((data) => new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject)))
      .then((buf) => { this.buffers.set(key, buf); this.pending.delete(key); return buf; })
      .catch((err) => { this.pending.delete(key); throw err; });
    this.pending.set(key, p);
    return p;
  }

  async loadClips(narrator, ids, onProgress) {
    let done = 0;
    await Promise.all(ids.map((id) => this.loadClip(narrator, id).then(() => onProgress?.(++done, ids.length))));
  }

  // ---- Preview -------------------------------------------------------------
  async playPreview(narrator, onEnd) {
    this.stopPreview();
    await this.unlock();
    const buf = await this.loadClip(narrator, 'preview');
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.voice);
    src.onended = () => { if (this.preview === src) { this.preview = null; onEnd?.(); } };
    this.preview = src;
    src.start();
  }

  async previewAmbience(kind, seconds = 8) {
    this.stopPreview();
    await this.unlock();
    const t = this.ctx.currentTime;
    if (kind === 'none') { this.chime(t + 0.05, 'soft'); return; }
    const amb = this.createAmbience(kind);
    amb.fadeIn(t, 1.5);
    amb.stop(t + seconds, 2);
    this.preview = { stop: () => amb.stop(this.ctx.currentTime, 0.3) };
  }

  stopPreview() {
    if (!this.preview) return;
    const p = this.preview;
    this.preview = null;
    try { p.stop(); } catch { /* already stopped */ }
  }

  // ---- Session scheduling -------------------------------------------------
  // Schedule plan events with session time 0 at ctx time `origin`, from session time `from`.
  schedule(events, narrator, origin, from) {
    for (const ev of events) {
      if (ev.at < from - 0.01) continue;
      const when = origin + ev.at;
      if (ev.type === 'chime') { this.chime(when, ev.kind); continue; }
      const buf = this.buffers.get(`${narrator}/${ev.id}`);
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voice);
      src.start(when);
      this.track(src);
    }
  }

  track(node) {
    this.scheduled.add(node);
    node.onended = () => this.scheduled.delete(node);
  }

  clearScheduled() {
    for (const node of this.scheduled) {
      try { node.stop(); node.disconnect(); } catch { /* not started */ }
    }
    this.scheduled.clear();
  }

  // Singing-bowl style bell built from decaying partials.
  chime(when, kind = 'soft') {
    const ctx = this.ctx;
    const base = kind === 'close' ? 196 : kind === 'open' ? 262 : 330;
    const peak = kind === 'soft' ? 0.16 : 0.22;
    const out = ctx.createGain();
    out.gain.value = peak;
    out.connect(this.sound);
    const partials = [[1, 1, 5.5], [2.76, 0.45, 3.2], [5.4, 0.22, 1.8], [8.93, 0.08, 0.9]];
    for (const [ratio, amp, decay] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = base * ratio;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(amp, when + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      osc.connect(g).connect(out);
      osc.start(when);
      osc.stop(when + decay + 0.05);
      this.track(osc);
    }
  }

  // ---- Background sound ---------------------------------------------------
  noise(type) {
    this.noiseBuffers ??= {};
    if (this.noiseBuffers[type]) return this.noiseBuffers[type];
    const ctx = this.ctx;
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'brown') {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        } else { // pink (Paul Kellet)
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
      }
      // crossfade the loop seam
      const fade = Math.floor(ctx.sampleRate * 0.25);
      for (let i = 0; i < fade; i++) {
        const a = i / fade;
        d[i] = d[i] * a + d[len - fade + i] * (1 - a);
      }
    }
    this.noiseBuffers[type] = buf;
    return buf;
  }

  createAmbience(kind) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.sound);
    const nodes = [];
    const loop = (type) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise(type);
      s.loop = true;
      nodes.push(s);
      return s;
    };
    const osc = (freq, type = 'sine') => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      nodes.push(o);
      return o;
    };
    let level = 0.5;
    if (kind === 'rain') {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
      loop('pink').connect(hp).connect(lp).connect(out);
      level = 0.55;
    } else if (kind === 'ocean') {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const swell = ctx.createGain(); swell.gain.value = 0.55;
      const lfo = osc(0.085); const depth = ctx.createGain(); depth.gain.value = 0.45;
      lfo.connect(depth).connect(swell.gain);
      loop('brown').connect(lp).connect(swell).connect(out);
      level = 0.7;
    } else if (kind === 'drone') {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const mix = ctx.createGain(); mix.gain.value = 0.7;
      const breathe = osc(0.05); const depth = ctx.createGain(); depth.gain.value = 0.25;
      breathe.connect(depth).connect(mix.gain);
      [[110, 0.22], [164.8, 0.12], [220.4, 0.1], [329.6, 0.035]].forEach(([f, a]) => {
        const g = ctx.createGain(); g.gain.value = a;
        osc(f).connect(g).connect(lp);
      });
      lp.connect(mix).connect(out);
      level = 0.5;
    }
    nodes.forEach((n) => n.start());
    let stopped = false;
    return {
      fadeIn(when, secs) {
        out.gain.cancelScheduledValues(when);
        out.gain.setValueAtTime(0, when);
        out.gain.linearRampToValueAtTime(level, when + secs);
      },
      fadeOutAt(when, secs) {
        const from = Math.max(ctx.currentTime, when - secs);
        out.gain.cancelScheduledValues(from);
        out.gain.setValueAtTime(level, from);
        out.gain.linearRampToValueAtTime(0, when);
      },
      stop(when, secs = 0.3) {
        if (stopped) return;
        stopped = true;
        const t = Math.max(when, ctx.currentTime);
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + secs);
        nodes.forEach((n) => { try { n.stop(t + secs + 0.05); } catch { /* ignore */ } });
      },
    };
  }

  startAmbience(kind, when, endAt) {
    this.stopAmbience();
    if (kind === 'none') return;
    this.ambience = this.createAmbience(kind);
    this.ambience.fadeIn(when, 4);
    this.ambience.fadeOutAt(endAt, 6);
  }

  retimeAmbienceEnd(endAt) {
    this.ambience?.fadeOutAt(endAt, Math.min(6, Math.max(0.5, endAt - this.ctx.currentTime)));
  }

  stopAmbience(secs = 0.4) {
    this.ambience?.stop(this.ctx.currentTime, secs);
    this.ambience = null;
  }
}
