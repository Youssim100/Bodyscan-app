// Runs one planned session on the AudioEngine. The AudioContext clock is the
// master clock: suspending the context pauses timer, narration and sounds together.
import { locate } from './timing.js';

export class Session {
  constructor(engine, plan, { narrator, ambience }) {
    this.engine = engine;
    this.plan = plan;
    this.narrator = narrator;
    this.ambience = ambience;
    this.state = 'idle'; // idle | playing | paused | complete | ended
    this.origin = 0;     // ctx time at session time 0
    this.skipped = 0;
    this.onupdate = null;
    this.timer = null;
  }

  get ctx() { return this.engine.ctx; }

  elapsed() {
    if (this.state === 'idle') return 0;
    return Math.min(this.plan.totalSeconds, Math.max(0, this.ctx.currentTime - this.origin));
  }

  remaining() { return this.plan.totalSeconds - this.elapsed(); }

  where() { return locate(this.plan, this.elapsed()); }

  async start() {
    await this.engine.unlock();
    this.origin = this.ctx.currentTime + 0.3;
    this.engine.schedule(this.plan.events, this.narrator, this.origin, 0);
    this.engine.startAmbience(this.ambience, this.origin, this.origin + this.plan.totalSeconds);
    this.state = 'playing';
    this.timer = setInterval(() => this.tick(), 250);
    this.tick();
  }

  tick() {
    if (this.state === 'playing' && this.remaining() <= 0) this.finish('complete');
    this.onupdate?.(this);
  }

  // `reason` lets the UI say why it paused (user, interruption, background).
  async pause(reason = 'user') {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pauseReason = reason;
    this.engine.stopPreview();
    try { await this.ctx.suspend(); } catch { /* already suspended by the system */ }
    this.onupdate?.(this);
  }

  async resume() {
    if (this.state !== 'paused') return;
    await this.ctx.resume();
    if (this.ctx.state !== 'running') throw new Error('Audio could not resume');
    this.state = 'playing';
    this.pauseReason = null;
    this.onupdate?.(this);
  }

  // The system paused audio (phone call, Siri, another app took audio).
  interrupted() {
    if (this.state === 'playing' && this.ctx.state !== 'running') {
      this.state = 'paused';
      this.pauseReason = 'interrupted';
      this.onupdate?.(this);
    }
  }

  // Jump to the next body part (or the closing). The session ends earlier by the skipped time.
  skip() {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    const t = this.elapsed();
    const here = locate(this.plan, t);
    let target;
    if (here.section === 'intro') target = this.plan.segments[0].start;
    else if (here.section === 'part') target = here.seg.end;
    else { this.finish('complete'); return; }
    this.engine.clearScheduled();
    this.origin -= target - t;
    this.skipped += target - t;
    this.engine.schedule(this.plan.events, this.narrator, this.origin, target);
    this.engine.retimeAmbienceEnd(this.origin + this.plan.totalSeconds);
    this.onupdate?.(this);
  }

  async end() { await this.finish('ended'); }

  async finish(state) {
    if (this.state === 'complete' || this.state === 'ended') return;
    this.practiced = Math.max(0, this.elapsed() - this.skipped);
    this.state = state;
    clearInterval(this.timer);
    // On completion the closing bell is left to ring out.
    if (state === 'ended') this.engine.clearScheduled();
    this.engine.stopAmbience(state === 'complete' ? 1 : 0.4);
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { /* ignore */ } }
    this.onupdate?.(this);
  }
}
