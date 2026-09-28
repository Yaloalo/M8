/** Wavsynth: single-cycle shapes, wave tables, and the crossfade bank that moves them. */
import type { WavFilterType, WaveShape } from '../core/types';
import { bpMakeup } from './mappings';
import type { Voice } from './voice';

/** 7-bit LFSR pattern: one period of it per cycle makes "pitched" noise in tune with the note. */
const LFSR_CYCLE = (() => {
  const bits: number[] = [];
  let r = 0x7f;
  for (let i = 0; i < 127; i++) {
    const b = ((r >> 0) ^ (r >> 1)) & 1;
    r = (r >> 1) | (b << 6);
    bits.push(r & 1 ? 1 : -1);
  }
  return bits;
})();

/**
 * WT01–WT08: procedural wave tables of 64 single cycles each (the M8's WT shapes; SCAN
 * morphs through them). Frames are generated on first use and kept.
 */
const WT_N = 256;
const WT_FRAMES = 64;
const wtCache = new Map<string, Float32Array>();

function additive(amp: (k: number) => number, kmax = 48): Float32Array {
  const out = new Float32Array(WT_N);
  for (let k = 1; k <= kmax; k++) {
    const a = amp(k);
    if (!a) continue;
    for (let n = 0; n < WT_N; n++) out[n] += a * Math.sin((2 * Math.PI * k * n) / WT_N);
  }
  return out;
}

function timeDomain(fn: (p: number) => number): Float32Array {
  const out = new Float32Array(WT_N);
  let mean = 0;
  for (let n = 0; n < WT_N; n++) mean += out[n] = fn(n / WT_N);
  mean /= WT_N;
  for (let n = 0; n < WT_N; n++) out[n] -= mean;
  return out;
}

function wtFrame(table: number, f: number): Float32Array {
  const key = `${table}:${f}`;
  const hit = wtCache.get(key);
  if (hit) return hit;
  const x = f / (WT_FRAMES - 1);
  let y: Float32Array;
  switch (table) {
    case 0: // sine → saw
      y = additive((k) => (k === 1 ? 1 : x / k));
      break;
    case 1: // saw → square: the even harmonics fade out
      y = additive((k) => (k % 2 ? 1 : 1 - x) / k);
      break;
    case 2: {
      // Formant sweep: a resonant bump moving up the harmonic series (vowel-like).
      const c = 2 + 22 * x;
      y = additive((k) => (k === 1 ? 0.25 : 0) + Math.exp(-((k - c) ** 2) / (2 * 2.2 ** 2)));
      break;
    }
    case 3: {
      // Harmonic build-up: one partial after another joins in.
      const n = 1 + x * 31;
      y = additive((k) => (k <= Math.floor(n) ? 1 / k : k === Math.floor(n) + 1 ? (n % 1) / k : 0));
      break;
    }
    case 4: {
      // Pulse-width sweep, 50 % down to 5 %.
      const d = 0.5 - 0.45 * x;
      y = timeDomain((p) => (p < d ? 1 : -1));
      break;
    }
    case 5: {
      // Hard-sync sweep: a saw restarted by the fundamental, ratio 1 → 8.
      const r = 1 + 7 * x;
      y = timeDomain((p) => 2 * ((p * r) % 1) - 1);
      break;
    }
    case 6: {
      // FM: a sine phase-modulated by its second harmonic, index 0 → 6.
      const b = 6 * x;
      y = timeDomain((p) => Math.sin(2 * Math.PI * p + b * Math.sin(4 * Math.PI * p)));
      break;
    }
    default: {
      // Bell-like: sparse odd/prime partials whose weight spreads upward.
      const set = new Set([1, 2, 3, 5, 7, 9, 11, 13, 17, 19, 23]);
      y = additive((k) => (set.has(k) ? (k === 1 ? 1 : 0.7) * Math.exp(-(k - 1) / (1 + 15 * x)) * (k % 4 === 3 ? -1 : 1) : 0));
    }
  }
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let n = 0; n < WT_N; n++) y[n] /= peak;
  wtCache.set(key, y);
  return y;
}

/** The cycle at SCAN position `scan` of wave table `shape`, crossfading neighbouring frames. */
function wtCycle(shape: WaveShape, scan: number): Float32Array {
  const table = Math.max(0, Math.min(7, Number(shape.slice(2)) - 1));
  const pos = (Math.max(0, Math.min(255, scan)) / 255) * (WT_FRAMES - 1);
  const a = wtFrame(table, Math.floor(pos));
  const b = wtFrame(table, Math.min(WT_FRAMES - 1, Math.floor(pos) + 1));
  const t = pos % 1;
  const out = new Float32Array(WT_N);
  for (let n = 0; n < WT_N; n++) out[n] = a[n] * (1 - t) + b[n] * t;
  return out;
}

export function waveCycle(shape: WaveShape, size: number, mult: number, warp: number, scan = 0): Float32Array {
  const N = 256;
  const wt = shape.startsWith('WT') ? wtCycle(shape, scan) : null;
  if (shape === 'NOISE P') {
    const out = new Float32Array(254);
    for (let n = 0; n < 254; n++) out[n] = LFSR_CYCLE[n >> 1];
    return out;
  }
  const duty = { PULSE12: 0.125, PULSE25: 0.25, PULSE50: 0.5, PULSE75: 0.75 } as Record<string, number>;
  const base = (p: number) => {
    if (wt) {
      // Linear interpolation into the wave-table cycle.
      const x = p * WT_N;
      const i = Math.floor(x) % WT_N;
      return wt[i] + (wt[(i + 1) % WT_N] - wt[i]) * (x - Math.floor(x));
    }
    if (shape in duty) return p < duty[shape] ? 1 : -1;
    if (shape === 'SAW') return 2 * p - 1;
    if (shape === 'TRIANGLE') return 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5);
    return Math.sin(2 * Math.PI * p);
  };
  const width = size <= 0x80 ? Math.max(1 / 32, size / 0x80) : 1;
  const sync = size > 0x80 ? 1 + (size - 0x80) / 64 : 1;
  const exponent = 2 ** ((warp / 255) * 3);
  const fold = 1 + mult / 32;
  const out = new Float32Array(N);
  // SCAN moves the cycle's midpoint (the "mirror"): on PULSE 50% that is pulse-width
  // modulation. 00 leaves the shape alone.
  // On WT shapes SCAN is the morph position instead, so the cycle is not mirrored.
  const mid = scan && !wt ? 0.02 + (0.96 * scan) / 255 : 0.5;
  for (let n = 0; n < N; n++) {
    let p = n / N;
    p = p < mid ? (p / mid) * 0.5 : 0.5 + ((p - mid) / (1 - mid)) * 0.5;
    p = p ** exponent;
    p = (p * sync) % 1;
    let y = p < width ? base(p / width) : 0;
    if (mult) y = 1 - 4 * Math.abs(((((y * fold + 1) / 4) % 1) + 1) % 1 - 0.5);
    out[n] = y;
  }
  return out;
}

/** A WAV filter type with the CUTOFF and RES it is applied at. */
export interface WavFilter {
  type: WavFilterType;
  cutoff: number;
  res: number;
}

const clampByte = (v: number) => Math.max(0, Math.min(255, v));
/** WAV types: CUTOFF as a harmonic number, 00 half the fundamental to FF the 128th (8 octaves). */
export const wavCutoff = (v: number) => 0.5 * 2 ** ((clampByte(v) / 255) * 8);
/** WAV types: RES as Q, 0.707 (no peak) to 16. */
export const wavQ = (v: number) => 0.707 + (clampByte(v) / 255) ** 2 * 15.3;

/**
 * The gain a WAV filter gives harmonic `k`: the magnitude of a 2-pole analog prototype at
 * k / cutoff-harmonic. Only magnitudes change (the cycle keeps its phases), so anchors of a
 * crossfade bank add up without cancelling. BP gets the BANDPASS make-up gain.
 */
export function wavFilterGain(f: WavFilter, k: number): number {
  const r = k / wavCutoff(f.cutoff);
  const q = wavQ(f.res);
  const den = Math.hypot(1 - r * r, r / q);
  switch (f.type) {
    case 'WAV LP':
      return 1 / den;
    case 'WAV HP':
      return (r * r) / den;
    case 'WAV BP':
      return (bpMakeup(q) * (r / q)) / den;
    case 'WAV BS':
      return Math.abs(1 - r * r) / den;
  }
}

/** Peak of the band-limited cycle the coefficients describe (sampled at 1024 points). */
function peakOf(real: Float32Array, imag: Float32Array): number {
  const M = 1024;
  let peak = 0;
  for (let n = 0; n < M; n++) {
    let y = 0;
    for (let k = 1; k < real.length; k++) {
      const i = (k * n) % M;
      y += real[k] * COS[i] + imag[k] * SIN[i];
    }
    peak = Math.max(peak, Math.abs(y));
  }
  return peak;
}
const COS = Float32Array.from({ length: 1024 }, (_, i) => Math.cos((2 * Math.PI * i) / 1024));
const SIN = Float32Array.from({ length: 1024 }, (_, i) => Math.sin((2 * Math.PI * i) / 1024));

/**
 * A cycle as a PeriodicWave. Plain cycles are normalised by the browser (peak 1). With a
 * WAV filter the harmonics are weighted first and the wave scaled by the unfiltered
 * cycle's normalisation, so the filter changes the level as a filter would; resonance can
 * raise it up to full scale, never beyond.
 */
export function cycleToWave(ctx: BaseAudioContext, cycle: Float32Array, filter?: WavFilter): PeriodicWave {
  const N = cycle.length;
  const H = N / 2;
  const real = new Float32Array(H);
  const imag = new Float32Array(H);
  for (let k = 1; k < H; k++) {
    let a = 0;
    let b = 0;
    for (let n = 0; n < N; n++) {
      const w = (2 * Math.PI * k * n) / N;
      a += cycle[n] * Math.cos(w);
      b += cycle[n] * Math.sin(w);
    }
    real[k] = (2 * a) / N;
    imag[k] = (2 * b) / N;
  }
  if (!filter) return ctx.createPeriodicWave(real, imag);
  const plain = peakOf(real, imag);
  for (let k = 1; k < H; k++) {
    const g = wavFilterGain(filter, k);
    real[k] *= g;
    imag[k] *= g;
  }
  const peak = peakOf(real, imag);
  const scale = plain > 0 && peak > 0 ? Math.min(1 / plain, 1 / peak) : 0;
  for (let k = 1; k < H; k++) {
    real[k] *= scale;
    imag[k] *= scale;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

/** PeriodicWaves by key for one context, built from a cycle on first use. */
export class WaveCache {
  private waves = new Map<string, PeriodicWave>();

  constructor(private ctx: BaseAudioContext) {}

  get(key: string, cycle: () => Float32Array, filter?: WavFilter): PeriodicWave {
    let w = this.waves.get(key);
    if (!w) {
      w = cycleToWave(this.ctx, cycle(), filter);
      this.waves.set(key, w);
    }
    return w;
  }
}

/** The Wavsynth values a cycle is built from (CUTOFF and RES only matter with a WAV filter). */
export interface WavVals {
  scan: number;
  warp: number;
  size: number;
  mult: number;
  cutoff: number;
  res: number;
}

/** The Wavsynth cycle for `v` as a PeriodicWave, WAV filter applied; cached by all of it. */
export function wavWave(waves: WaveCache, shape: WaveShape, v: WavVals, filter: WavFilterType | null): PeriodicWave {
  const key = `${shape}:${v.size}:${v.mult}:${v.warp}:${v.scan}` + (filter ? `:${filter}:${v.cutoff}:${v.res}` : '');
  return waves.get(
    key,
    () => waveCycle(shape, v.size, v.mult, v.warp, v.scan),
    filter ? { type: filter, cutoff: v.cutoff, res: v.res } : undefined,
  );
}

/** Crossfade-bank axes: the shape parameters, and CUTOFF / RES when a WAV filter is on. */
export type WavAxis = 'SCAN' | 'WARP' | 'SIZE' | 'MULT' | 'CUTOFF' | 'RES';

/**
 * Wavsynth shape parameters are not AudioParams. To move them within a note, the voice
 * plays a bank of oscillators with the parameter at fixed anchor values and crossfades
 * between them. The position is an audio signal (a ConstantSource that mods and commands
 * add to), turned into per-layer gains by triangular WaveShaper windows, so it follows any
 * envelope or LFO sample-accurately, online and offline alike.
 */
export interface WavHandle {
  /** The plain oscillator's output gain. */
  plain: GainNode;
  /** Where the voice's tone goes (the voice mix). */
  dest: AudioNode;
  f0: number;
  /** Last absolute values set on the playing note (instrument values, then commands). */
  vals: WavVals;
  /** The WAV filter applied to the cycle, if any: CUTOFF and RES then move the bank. */
  filter: WavFilterType | null;
  bank: { axis: WavAxis; pos: ConstantSourceNode; out: GainNode; srcs: AudioScheduledSourceNode[] } | null;
}

export const AXIS_KEY: Record<WavAxis, keyof WavVals> = {
  SCAN: 'scan',
  WARP: 'warp',
  SIZE: 'size',
  MULT: 'mult',
  CUTOFF: 'cutoff',
  RES: 'res',
};
/** A shape axis (every Wavsynth voice has these). */
export const isAxis = (d: string): d is WavAxis => d === 'SCAN' || d === 'WARP' || d === 'SIZE' || d === 'MULT';
/** A filter axis: a bank axis only on a voice with a WAV filter. */
export const isFilterAxis = (d: string): d is 'CUTOFF' | 'RES' => d === 'CUTOFF' || d === 'RES';

/** Anchor layers in a crossfade bank: 9 gives smooth sweeps at a modest node count. */
const BANK_LAYERS = 9;

const bankCurves: Float32Array<ArrayBuffer>[] = [];

/** Layer i's weight over the bank position 0–1: a triangle peaking at its anchor. */
function layerCurve(i: number) {
  let cv = bankCurves[i];
  if (!cv) {
    cv = new Float32Array(1025);
    for (let k = 0; k < cv.length; k++) {
      // The shaper reads −1…1; positions below 0 clamp to layer 0's weight.
      const x = Math.max(0, -1 + (2 * k) / (cv.length - 1));
      cv[k] = Math.max(0, 1 - Math.abs(x * (BANK_LAYERS - 1) - i));
    }
    bankCurves[i] = cv;
  }
  return cv;
}

/**
 * Build (or return) the voice's crossfade bank for one Wavsynth axis, starting at `time`.
 * Anchors are the axis at BANK_LAYERS evenly spaced values, the other axes at their current
 * values; a bank on another axis (or the plain oscillator) fades out as this one fades in.
 */
export function wavBank(c: BaseAudioContext, waves: WaveCache, v: Voice, axis: WavAxis, time: number) {
  const h = v.wav;
  if (!h) return null;
  if (h.bank?.axis === axis) return h.bank;
  const w = v.inst.wav;
  const key = AXIS_KEY[axis];
  const out = c.createGain();
  out.gain.setValueAtTime(0, time);
  out.gain.setTargetAtTime(0.6, time, 0.003);
  out.connect(h.dest);
  const pos = c.createConstantSource();
  pos.offset.setValueAtTime(h.vals[key] / 255, time);
  pos.start(time);
  const srcs: AudioScheduledSourceNode[] = [pos];
  v.nodes.push(out, pos);
  const detune = v.cents + v.fine + v.noteCents;
  for (let i = 0; i < BANK_LAYERS; i++) {
    const vals = { ...h.vals, [key]: Math.round((i * 255) / (BANK_LAYERS - 1)) };
    const wave = wavWave(waves, w.shape, vals, h.filter);
    const o = c.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.value = Math.min(h.f0, c.sampleRate / 2);
    o.detune.setValueAtTime(detune, time);
    // Built with the note: follow its portamento like the plain oscillator does.
    const tr = v.trig;
    if (time === v.start && tr.glideFrom != null && tr.glideTime > 0) {
      o.detune.setValueAtTime((tr.glideFrom - tr.note) * 100 + detune, time);
      o.detune.linearRampToValueAtTime(detune, time + tr.glideTime);
    }
    if (v.vib) v.vib.gain.connect(o.detune);
    const lg = c.createGain();
    lg.gain.value = 0;
    const sh = c.createWaveShaper();
    sh.curve = layerCurve(i);
    pos.connect(sh).connect(lg.gain);
    o.connect(lg).connect(out);
    o.start(time);
    srcs.push(o);
    v.detunes.push(o.detune);
    v.nodes.push(o, lg, sh);
  }
  const prev = h.bank;
  (prev ? prev.out : h.plain).gain.setTargetAtTime(0, time, 0.003);
  if (prev) for (const s of prev.srcs) s.stop(time + 0.05);
  for (const s of srcs) {
    v.sources.push(s);
    if (Number.isFinite(v.end) && v.end > time) s.stop(v.end);
  }
  h.bank = { axis, pos, out, srcs };
  return h.bank;
}
