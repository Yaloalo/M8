/** Modulation: LFO shapes and oscillators, envelopes, and a mod's value at note start. */
import type { Mod, LfoShape } from '../core/types';
import { tickTime } from './mappings';
import { byte } from './safety';
import type { EnvHandle } from './voice';
import { cycleToWave } from './waves';

/** TRIG source: 00–7F an instrument anywhere, 80–87 anything on that track. */
export const trigMatches = (src: number, e: { instId: number; track: number }) =>
  src < 0x80 ? e.instId === src : e.track === src - 0x80;
/**
 * LFO rate, tempo-synced as on the M8: one cycle lasts 2^((255 − freq)/32) steps of six
 * ticks, so FF is one step, DF two, BF four, and 00 about 250.
 */
export const lfoHz = (v: number, tickDur: number) => 1 / (2 ** ((255 - v) / 32) * 6 * tickDur);
/** RANDOM and DRUNK draw 16 values per cycle of their wave, one per LFO period. */
const stepped = (shape: LfoShape) => shape === 'RANDOM' || shape === 'DRUNK';
export const oscHz = (shape: LfoShape, hz: number) => (stepped(shape) ? hz / RANDOM_STEPS.length : hz);

/** One cycle of an LFO shape at phase p (0–1), −1…1. `rnd` gives the RANDOM steps. */
export function lfoAt(shape: LfoShape, p: number, rnd: number[]): number {
  const e4 = Math.exp(-4);
  switch (shape) {
    case 'TRI':
      return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
    case 'SIN':
      return Math.sin(2 * Math.PI * p);
    case 'SQR':
      return p < 0.5 ? 1 : -1;
    case 'SAW':
      return 2 * p - 1;
    case 'RAMP':
      return 1 - 2 * p;
    case 'EXP DN':
      return 2 * ((Math.exp(-4 * p) - e4) / (1 - e4)) - 1;
    case 'EXP UP':
      return 2 * ((Math.exp(-4 * (1 - p)) - e4) / (1 - e4)) - 1;
    case 'SQU UP':
      return p < 0.5 ? 1 : 0;
    case 'SQU DN':
      return p < 0.5 ? -1 : 0;
    case 'RANDOM':
      return rnd[Math.min(rnd.length - 1, Math.floor(p * rnd.length))];
    case 'DRUNK': {
      // A random walk, eased between its points so the wander is smooth.
      const x = p * DRUNK_STEPS.length;
      const i = Math.floor(x) % DRUNK_STEPS.length;
      const f = x - Math.floor(x);
      const w = (1 - Math.cos(Math.PI * f)) / 2;
      return DRUNK_STEPS[i] * (1 - w) + DRUNK_STEPS[(i + 1) % DRUNK_STEPS.length] * w;
    }
  }
}

/** Sixteen fixed random steps: RANDOM is a sample-and-hold that repeats every 16 steps. */
export const RANDOM_STEPS = (() => {
  let s = 0x1234567;
  return Array.from({ length: 16 }, () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  });
})();

/** Sixteen points of a random walk, made cyclic and scaled to −1…1. */
const DRUNK_STEPS = (() => {
  let s = 0x2545f491;
  const walk = [0];
  for (let i = 1; i < 16; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    walk.push(walk[i - 1] + (((s >>> 0) / 4294967296) * 2 - 1) * 0.6);
  }
  // Remove the drift so the last point leads smoothly back to the first.
  const slope = walk[15] / 16;
  const flat = walk.map((v, i) => v - slope * i);
  const peak = Math.max(...flat.map(Math.abs)) || 1;
  return flat.map((v) => v / peak);
})();

/** Shapes the built-in oscillator types cover; the rest use periodic waves. */
export const LFO_TYPE: Partial<Record<LfoShape, OscillatorType>> = {
  TRI: 'triangle',
  SIN: 'sine',
  SQR: 'square',
  SAW: 'sawtooth',
  RAMP: 'sawtooth',
};

/**
 * Schedule AHD/ADSR on `param` as base + peak·shape; returns when an AHD settles. An ADSR
 * joins `adsr` to wait for its note-off.
 */
export function scheduleEnvelope(
  param: AudioParam,
  mod: Mod,
  t: number,
  base: number,
  peak: number,
  td: number,
  adsr: EnvHandle[],
) {
  const top = base + peak;
  if (mod.type === 'DRUM') {
    // Drum envelope: a hit to the full amount, a fast dip by PEAK (the transient), BODY
    // ticks held there, then DECAY back to rest — the classic kick pitch drop.
    const dip = byte(mod.attack, 0) / 255;
    const peakTime = (1 + byte(mod.attack, 0) / 32) * td;
    const body = base + peak * (1 - dip * 0.85);
    const h = byte(mod.hold, 0) * td;
    const d = Math.max(td, byte(mod.decay, 0) * td);
    param.setValueAtTime(base, t);
    param.linearRampToValueAtTime(top, t + 0.001);
    param.setTargetAtTime(body, t + 0.001, peakTime / 3);
    param.setTargetAtTime(base, t + 0.001 + peakTime + h, d / 5);
    return t + peakTime + h + d + 0.02;
  }
  const a = mod.attack ? tickTime(mod.attack, td) : 0.001;
  param.setValueAtTime(base, t);
  param.linearRampToValueAtTime(top, t + a);
  if (mod.type === 'AHD' || mod.type === 'TRIG') {
    const h = mod.hold ? tickTime(mod.hold, td) : 0;
    const d = tickTime(mod.decay, td);
    param.setValueAtTime(top, t + a + h);
    param.setTargetAtTime(base, t + a + h, d / 5);
    return t + a + h + d + 0.02;
  }
  const s = base + peak * (mod.sustain / 255);
  param.setTargetAtTime(s, t + a, tickTime(mod.decay, td) / 5);
  adsr.push({ param, base, release: tickTime(mod.release, td) });
  return Infinity;
}

/** HOLD and ONCE: one cycle as an automation curve, starting at `phase` (0–1). */
export function lfoCurve(param: AudioParam, mod: Mod, t: number, td: number, phase: number) {
  const period = Math.min(60, 1 / oscHz(mod.lfoShape, lfoHz(mod.freq, td)));
  const curve = new Float32Array(256);
  for (let n = 0; n < curve.length; n++) {
    curve[n] = lfoAt(mod.lfoShape, (phase + n / (curve.length - 1)) % 1.000001, RANDOM_STEPS);
  }
  // HOLD stays on the last value; ONCE returns to where the cycle began.
  param.setValueCurveAtTime(curve, t, period);
  if (mod.lfoTrig === 'ONCE') param.setValueAtTime(curve[0], t + period + 0.001);
}

/** LFO oscillators for one context, with their rotated periodic waves cached. */
export class LfoOscillators {
  private waves = new Map<string, PeriodicWave>();

  constructor(private ctx: BaseAudioContext) {}

  /** The shape as a periodic wave, optionally rotated to start at `phase` (0–1). */
  wave(shape: LfoShape, phase = 0): PeriodicWave {
    const key = `${shape}:${Math.round(phase * 255)}`;
    let w = this.waves.get(key);
    if (!w) {
      const cycle = new Float32Array(256);
      for (let n = 0; n < cycle.length; n++) cycle[n] = lfoAt(shape, (n / cycle.length + phase) % 1, RANDOM_STEPS);
      w = cycleToWave(this.ctx, cycle);
      this.waves.set(key, w);
    }
    return w;
  }

  /**
   * A looping LFO oscillator. Basic shapes use the built-in types (RAMP is a saw whose gain
   * is inverted by the caller); EXP and RANDOM use periodic waves. RANDOM holds 16 steps per
   * cycle, so its oscillator runs 16 times slower than the step rate.
   */
  osc(shape: LfoShape, hz: number, t: number, phase = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    const type = phase ? undefined : LFO_TYPE[shape];
    if (type) o.type = type;
    // A phase offset (LT) needs a rotated wave. RAMP stays a rising saw that the caller
    // inverts, exactly as with the built-in type.
    else o.setPeriodicWave(this.wave(phase && shape === 'RAMP' ? 'SAW' : shape, phase));
    o.frequency.setValueAtTime(oscHz(shape, hz), t);
    return o;
  }
}

/** A periodic wave loses its DC and is scaled to a peak of 1: what that leaves of each shape. */
const waveNorm = new Map<LfoShape, { mean: number; peak: number }>();

function norm(shape: LfoShape) {
  let n = waveNorm.get(shape);
  if (!n) {
    const N = 256;
    let mean = 0;
    for (let i = 0; i < N; i++) mean += lfoAt(shape, i / N, RANDOM_STEPS) / N;
    let peak = 0;
    for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(lfoAt(shape, i / N, RANDOM_STEPS) - mean));
    n = { mean, peak: peak || 1 };
    waveNorm.set(shape, n);
  }
  return n;
}

/**
 * What an oscillator from `LfoOscillators.osc` feeds its targets at its own phase `q` (0–1),
 * `rot` being the rotation it was built with, RAMP's inversion by the caller included.
 */
export function lfoOscValue(shape: LfoShape, q: number, rot: number): number {
  const sign = shape === 'RAMP' ? -1 : 1;
  if (!rot && LFO_TYPE[shape]) {
    // The built-in saw starts at 0 and reaches its peak half a cycle later.
    const saw = shape === 'SAW' || shape === 'RAMP';
    return sign * lfoAt(saw ? 'SAW' : shape, saw ? (q + 0.5) % 1 : q, RANDOM_STEPS);
  }
  const s = rot && shape === 'RAMP' ? 'SAW' : shape;
  const n = norm(s);
  return (sign * (lfoAt(s, (((q + rot) % 1) + 1) % 1, RANDOM_STEPS) - n.mean)) / n.peak;
}

/**
 * The value a mod has at the moment its note starts, before its amount: −1…1, or 0…1 for
 * TRACK VEL. Sampler START / LOOP / LENGTH read their mods through this, once, at the
 * trigger, because a playing buffer source cannot be re-cued:
 * - TRACK: the note, (note − 60) / 64 clamped, or the velocity, vel / 255, as everywhere.
 * - AHD / ADSR / TRIG: the envelope's first value, 0, or its peak (1) when ATTACK is 00, as
 *   the rise then takes 1 ms. A TRIG envelope counts only when this note is its source.
 * - DRUM: its peak, which the hit reaches within 1 ms whatever PEAK is set to.
 * - LFO: FREE and RETRIG read the oscillator at its phase now (`lfoPhase`: the running phase
 *   for FREE, 0 for a fresh RETRIG oscillator; `lfoRot` its rotation); HOLD and ONCE the
 *   first point of their curve.
 */
export function startValue(
  mod: Mod,
  e: { note: number; vel: number; instId: number; track: number },
  lfoPhase = 0,
  lfoRot = 0,
): number {
  switch (mod.type) {
    case 'TRACK':
      return mod.source === 'VEL' ? e.vel / 255 : Math.max(-1, Math.min(1, (e.note - 60) / 64));
    case 'AHD':
    case 'ADSR':
      return mod.attack ? 0 : 1;
    case 'TRIG':
      return trigMatches(mod.src, e) && !mod.attack ? 1 : 0;
    case 'DRUM':
      return 1;
    case 'LFO':
      if (mod.lfoTrig === 'HOLD' || mod.lfoTrig === 'ONCE') return lfoAt(mod.lfoShape, 0, RANDOM_STEPS);
      return lfoOscValue(mod.lfoShape, lfoPhase, lfoRot);
    default:
      return 0;
  }
}
