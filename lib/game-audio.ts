import type { GameMode, Outcome } from './roulette';

export type SoundEvent = { time: number; strength: number; variant: number };
type Point = { offset: number; angles: number[]; easing: string };
const CURVES: Record<string, number[]> = {
  'ease-in': [.42, 0, 1, 1], 'ease-out': [0, 0, .58, 1],
};
const bezier = (u: number, a: number, b: number) => 3 * (1-u)**2 * u * a + 3 * (1-u) * u*u * b + u**3;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Invert the exact per-keyframe easing, without changing the visual animation. */
export function inverseEase(value: number, easing: string): number {
  const y = clamp(value, 0, 1);
  if (easing === 'linear' || y === 0 || y === 1) return y;
  const curve = CURVES[easing] ?? easing.match(/cubic-bezier\(([^)]+)\)/)?.[1].split(',').map(Number);
  if (!curve || curve.length !== 4 || curve.some(n => !Number.isFinite(n))) return y;
  let lo = 0, hi = 1;
  for (let i = 0; i < 32; i++) {
    const u = (lo + hi) / 2;
    if (bezier(u, curve[1], curve[3]) < y) lo = u; else hi = u;
  }
  return bezier((lo + hi) / 2, curve[0], curve[2]);
}

function points(frames: Keyframe[]): Point[] {
  return frames.map(frame => ({
    offset: Number(frame.offset), easing: String(frame.easing ?? 'linear'),
    angles: [...String(frame.transform).matchAll(/rotate(?:X|Y|Z)?\((-?[\d.]+)deg\)/g)].map(m => Number(m[1])),
  }));
}

export function motionSounds(mode: GameMode, frames: Keyframe[], seconds: number): SoundEvent[] {
  const p = points(frames), events: SoundEvent[] = [];
  let travelled = 0, nextDistance = 90;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i+1];
    const at = (fraction: number) => (a.offset + (b.offset-a.offset) * inverseEase(fraction, a.easing)) * seconds;
    if (mode === 'wheel') {
      const from = a.angles[0], to = b.angles[0];
      for (let boundary = 30 + 60 * (Math.floor((from-30)/60) + 1); boundary <= to; boundary += 60) {
        const time = at((boundary-from)/(to-from));
        if (time < seconds) events.push({time, strength: .7, variant: events.length % 3});
      }
    } else {
      const distance = Math.hypot(...a.angles.map((n, j) => b.angles[j] - n));
      while (nextDistance <= travelled + distance) {
        const time = at((nextDistance-travelled)/distance);
        if (time < seconds * .92) events.push({time, strength: .6, variant: events.length % 3});
        nextDistance += 90;
      }
      travelled += distance;
    }
  }
  if (mode === 'dice') {
    // The final wobble has little angular travel, so give its settling phase a soft contact.
    const settle = seconds * .92;
    while (events.length && events.at(-1)!.time > settle - .07) events.pop();
    events.push({time: settle, strength: .26, variant: 2});
  }
  return events.map((event, i) => {
    if (mode === 'dice' && event.time >= seconds * .92) return event;
    const gap = i ? event.time - events[i-1].time : event.time;
    const speed = (mode === 'wheel' ? 60 : 90) / Math.max(.01, gap);
    return {...event, strength: clamp(.38 + speed / (mode === 'wheel' ? 4500 : 1500), .38, .86)};
  });
}

/** Original, short mono samples. No downloaded audio, decoding or external playback. */
export function soundSamples(kind: GameMode | 'bell', variant: number, sampleRate: number, frequency = 523.25): Float32Array {
  const duration = kind === 'wheel' ? .018 : kind === 'dice' ? .085 : .38;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  let seed = 73 + variant * 137, previousNoise = 0, lowNoise = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1, highNoise = (noise-previousNoise) * .5;
    previousNoise = noise; lowNoise += .32 * (noise-lowNoise);
    const pitch = 1 + (variant-1) * .035;
    let sample: number;
    if (kind === 'wheel') {
      sample = .65*highNoise*Math.exp(-t/.0022) + .28*Math.sin(2*Math.PI*2100*pitch*t)*Math.exp(-t/.0042)
        + .12*Math.sin(2*Math.PI*3700*pitch*t)*Math.exp(-t/.0015);
    } else if (kind === 'dice') {
      sample = .32*lowNoise*Math.exp(-t/.012) + .45*Math.sin(2*Math.PI*190*pitch*t)*Math.exp(-t/.020)
        + .23*Math.sin(2*Math.PI*760*pitch*t)*Math.exp(-t/.011);
    } else {
      sample = .58*Math.sin(2*Math.PI*frequency*t)*Math.exp(-t/ .15)
        + .20*Math.sin(2*Math.PI*frequency*2*t)*Math.exp(-t/.065)
        + .08*Math.sin(2*Math.PI*frequency*3*t)*Math.exp(-t/.032);
    }
    sample *= Math.min(1, t/(kind === 'bell' ? .008 : .0004)) * Math.min(1, (duration-t)/.004);
    samples[i] = sample; peak = Math.max(peak, Math.abs(sample));
  }
  for (let i = 0; i < samples.length; i++) samples[i] *= .85 / Math.max(.001, peak);
  samples[0] = 0; samples[samples.length-1] = 0;
  return samples;
}

type Voice = { source: AudioBufferSourceNode; gain: GainNode; when: number };
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Set<Voice>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled = true;
  private volume = .6;
  private visible = true;
  private revision = 0;

  /** Call directly from a click/keyboard gesture; audio never delays the draw. */
  unlock(enabled: boolean, volume: number) {
    this.enabled = enabled; this.volume = clamp(volume, 0, 100) / 100;
    if (!enabled) { this.applyVolume(); return; }
    try {
      if (!this.context || this.context.state === 'closed') {
        const Audio = window.AudioContext || (window as Window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
        if (!Audio) return;
        this.context = new Audio({latencyHint: 'interactive'});
        this.master = this.context.createGain();
        this.master.gain.value = 0; this.master.connect(this.context.destination);
        const context = this.context;
        context.onstatechange = () => { if (this.context === context && context.state !== 'running') this.stopVoices(); };
        this.buffers.clear();
      }
      this.applyVolume();
      if (this.context.state !== 'running') void this.context.resume().catch(() => {});
    } catch { /* Sound remains optional on unsupported/restricted devices. */ }
  }

  setVisible(visible: boolean) { this.visible = visible; this.applyVolume(); if (!visible) this.stopVoices(); }

  private applyVolume() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.enabled && this.visible ? this.volume * .55 : 0, now, .003);
    if (!this.enabled || this.volume === 0) this.stopVoices();
  }

  private play(kind: GameMode | 'bell', when: number, strength: number, variant = 0, frequency?: number) {
    const ctx = this.context;
    if (!ctx || !this.master || ctx.state !== 'running' || !this.enabled || !this.visible || this.volume === 0 || this.voices.size >= 24) return;
    let voice: Voice | null = null;
    try {
      const key = `${kind}:${variant}:${frequency ?? 0}`;
      let buffer = this.buffers.get(key);
      if (!buffer) {
        const data = soundSamples(kind, variant, ctx.sampleRate, frequency);
        buffer = ctx.createBuffer(1, data.length, ctx.sampleRate); buffer.getChannelData(0).set(data);
        this.buffers.set(key, buffer);
      }
      const source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = buffer; gain.gain.value = strength * (kind === 'bell' ? .3 : kind === 'wheel' ? .21 : .38);
      source.connect(gain); gain.connect(this.master);
      const active = {source, gain, when: Math.max(ctx.currentTime, when)}; voice = active; this.voices.add(active);
      source.onended = () => { this.voices.delete(active); source.disconnect(); gain.disconnect(); };
      source.start(active.when);
    } catch {
      if (voice) { this.voices.delete(voice); voice.source.disconnect(); voice.gain.disconnect(); }
      /* An audio error must not affect animation or selection. */
    }
  }

  follow(mode: GameMode, frames: Keyframe[], seconds: number, elapsed: () => number) {
    this.stop();
    const events = motionSounds(mode, frames, seconds);
    let cursor = 0, revision = this.revision, wasAudible = false;
    const pump = () => {
      const time = elapsed(), ctx = this.context;
      if (!Number.isFinite(time)) return;
      const audible = Boolean(ctx?.state === 'running' && this.enabled && this.visible && this.volume > 0);
      if (revision !== this.revision || (audible && !wasAudible)) {
        cursor = events.findIndex(event => event.time >= time-.025);
        if (cursor < 0) cursor = events.length;
        revision = this.revision;
      }
      wasAudible = audible;
      // Skip old events after throttling/suspension; never play a backlog in a burst.
      while (cursor < events.length && events[cursor].time < time-.025) cursor++;
      let outputNow: number | null = null, horizon = .09;
      if (audible && ctx && typeof ctx.getOutputTimestamp === 'function') {
        try {
          const stamp = ctx.getOutputTimestamp(), now = performance.now();
          const contextTime = Number(stamp.contextTime), performanceTime = Number(stamp.performanceTime);
          if (Number.isFinite(contextTime) && Number.isFinite(performanceTime) && contextTime > 0 && performanceTime > 0 && Math.abs(now-performanceTime) < 500) {
            outputNow = contextTime + (now-performanceTime)/1000;
            // Schedule early enough for the output-device clock, within a small bounded queue.
            horizon = clamp(ctx.currentTime-outputNow+.075, .09, .35);
          }
        } catch { /* Older engines can use the normal context clock. */ }
      }
      while (cursor < events.length && events[cursor].time <= time+(audible ? horizon : 0)) {
        const event = events[cursor++];
        if (audible && ctx) this.play(mode, Math.max(ctx.currentTime+.002, (outputNow ?? ctx.currentTime) + event.time-time), event.strength, event.variant);
      }
      if (time >= seconds) { if (this.timer) clearInterval(this.timer); this.timer = null; }
    };
    pump(); this.timer = setInterval(pump, 25);
  }

  result(outcome: Outcome, mode: GameMode) {
    const now = this.context?.currentTime ?? 0;
    this.play(mode, now, mode === 'dice' ? .75 : .32, 1);
    const notes = outcome === 'super' ? [523.25,659.25,783.99,1046.5,1318.5]
      : outcome === 'brinde' ? [523.25,659.25,783.99]
      : outcome === 'retry' ? [659.25,783.99] : [440,392];
    notes.forEach((frequency, i) => this.play('bell', now+.085+i*.105, outcome === 'miss' ? .4 : .7, 0, frequency));
  }

  private stopVoices() {
    this.revision++;
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.voices) {
      try { voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setTargetAtTime(0, now, .002); voice.source.stop(this.context?.state !== 'running' || voice.when > now ? now : now+.008); } catch { /* Already ended. */ }
    }
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.stopVoices(); }
  dispose() {
    this.stop();
    for (const voice of this.voices) { voice.source.disconnect(); voice.gain.disconnect(); }
    this.voices.clear();
    if (this.context) { this.context.onstatechange = null; void this.context.close().catch(() => {}); }
    this.context = null; this.master = null; this.buffers.clear();
  }
}
