/** Sampler: play modes, derived buffers, and building a note's source. */
import type { Instrument } from '../core/types';

/** The note that plays slice 0 (C-1, MIDI 24), as on the M8. */
export const SLICE_BASE = 24;
import type { SourceKit } from './voice';

/** Sixteenth steps of the default groove: six ticks (M8: 24 ticks per beat). */
const TICKS_PER_STEP = 6;

/**
 * DETUNE in semitones. M8: 80 is the centre, the first digit counts semitones and the
 * second 1/16 semitone, so 90 = +1, 70 = −1, 88 = +0.5 and 7F = −1/16: (v − 80) / 16.
 */
export const detuneSemitones = (v: number) => (Math.round(v) - 0x80) / 16;

/**
 * REPITCH playback rate: the whole sample (`seconds` long) lasts `steps` sixteenths at the
 * tempo the tick length comes from (sixteenth = 6 ticks, whatever the groove). A 1 s sample
 * with STEPS 10 (16 steps) plays at 0.5 at 120 BPM (2 s) and 0.625 at 150 BPM (1.6 s).
 */
export const repitchRate = (seconds: number, steps: number, tickDur: number) =>
  seconds / (Math.max(1, Math.round(steps)) * TICKS_PER_STEP * tickDur);

/** Tick length at a tempo, as the sequencer counts it. */
export const tickAt = (bpm: number) => 60 / (Math.max(1, bpm) * 24);

/**
 * DEGRADE as a hold length in samples of the sample's own rate: 00 = 1 (untouched), then
 * exponential, 40 ≈ 3 (≈ 14.5 kHz from 44.1 kHz), 80 ≈ 9 (≈ 4.8 kHz), FF ≈ 83 (≈ 530 Hz).
 */
export const degradeHold = (v: number) => (v > 0 ? 2 ** (Math.min(255, Math.round(v)) / 40) : 1);

/** Buffers derived from samples (reversed, ping-pong, wavetable frames, grain clouds), cached. */
export class SampleBuffers {
  private reversed = new WeakMap<AudioBuffer, AudioBuffer>();
  private pingPongs = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();
  private degraded = new WeakMap<AudioBuffer, Map<number, AudioBuffer>>();

  constructor(private ctx: BaseAudioContext) {}

  /**
   * DEGRADE: the sample decimated with nearest-neighbour sample-and-hold (no interpolation
   * between the held values), so the steps and their aliasing stay in the sound. A playing
   * source cannot be re-filtered, so this is a buffer per (sample, value), a few per sample.
   */
  degrade(buf: AudioBuffer, v: number) {
    const h = degradeHold(v);
    if (h <= 1) return buf;
    let m = this.degraded.get(buf);
    if (!m) this.degraded.set(buf, (m = new Map()));
    const key = Math.round(v);
    let out = m.get(key);
    if (!out) {
      out = this.ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = out.getChannelData(ch);
        for (let i = 0, n = src.length; i < n; i++) dst[i] = src[Math.floor(Math.floor(i / h) * h)];
      }
      // Each one is a full copy of the sample: keep only a few values per sample.
      if (m.size >= 4) m.delete(m.keys().next().value!);
      m.set(key, out);
    }
    return out;
  }

  /** A buffer that plays [from, to) forward, then (to, loopStart] backward; loop the back part. */
  pingPong(buf: AudioBuffer, from: number, to: number, loopStart: number) {
    const sr = buf.sampleRate;
    const a = Math.max(0, Math.floor(from * sr));
    const b = Math.min(buf.length, Math.max(a + 2, Math.floor(to * sr)));
    const l = Math.max(a, Math.min(b - 2, Math.floor(loopStart * sr)));
    const key = `${a}:${b}:${l}`;
    let cache = this.pingPongs.get(buf);
    if (!cache) this.pingPongs.set(buf, (cache = new Map()));
    let out = cache.get(key);
    if (!out) {
      const back = Math.max(0, b - l - 2);
      out = this.ctx.createBuffer(buf.numberOfChannels, b - a + back, sr);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = out.getChannelData(ch);
        dst.set(src.subarray(a, b), 0);
        for (let i = 0; i < back; i++) dst[b - a + i] = src[b - 2 - i];
      }
      if (cache.size > 32) cache.clear();
      cache.set(key, out);
    }
    return { buffer: out, loopStart: (l - a) / sr };
  }

  private tables = new WeakMap<AudioBuffer, Map<number, PeriodicWave>>();

  /** One 2048-sample frame of a wavetable sample as a PeriodicWave (512 harmonics). */
  tableWave(buf: AudioBuffer, frame: number) {
    let m = this.tables.get(buf);
    if (!m) this.tables.set(buf, (m = new Map()));
    let w = m.get(frame);
    if (!w) {
      const N = 2048;
      const H = 512;
      const data = buf.getChannelData(0);
      const cycle = new Float32Array(N);
      for (let n = 0; n < N; n++) cycle[n] = data[frame * N + n] ?? 0;
      const real = new Float32Array(H);
      const imag = new Float32Array(H);
      for (let k = 1; k < H; k++) {
        let a = 0;
        let b = 0;
        const step = (2 * Math.PI * k) / N;
        for (let n = 0; n < N; n++) {
          a += cycle[n] * Math.cos(step * n);
          b += cycle[n] * Math.sin(step * n);
        }
        real[k] = (2 * a) / N;
        imag[k] = (2 * b) / N;
      }
      w = this.ctx.createPeriodicWave(real, imag);
      m.set(frame, w);
    }
    return w;
  }

  private clouds = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();

  /**
   * Granular (Polyend): a one-second loop of Hann-windowed grains around START, grain size
   * from LOOP ST (5–200 ms) and spray from LENGTH. Rendered once per setting and wrapped
   * circularly so the loop has no seam; one looping source per note keeps voices cheap.
   */
  grainCloud(buf: AudioBuffer, start: number, size: number, spread: number) {
    let m = this.clouds.get(buf);
    if (!m) this.clouds.set(buf, (m = new Map()));
    const key = `${start}:${size}:${spread}`;
    const hit = m.get(key);
    if (hit) return hit;
    const sr = buf.sampleRate;
    const len = sr;
    const ch = buf.numberOfChannels;
    const out = this.ctx.createBuffer(ch, len, sr);
    const grainSec = 0.005 + (size / 255) ** 2 * 0.195;
    const gl = Math.max(16, Math.round(grainSec * sr));
    const perSec = Math.min(400, Math.max(40, 3 / grainSec));
    const count = Math.round(perSec);
    const centre = (start / 255) * buf.length;
    const spray = (spread / 255) * 0.5 * buf.length;
    let seed = 0x2545f491 ^ (start * 131 + size * 7 + spread);
    const rnd = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 100000) / 100000;
    };
    const win = new Float32Array(gl);
    for (let i = 0; i < gl; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (gl - 1));
    for (let c = 0; c < ch; c++) {
      const src = buf.getChannelData(c);
      const dst = out.getChannelData(c);
      seed = 0x2545f491 ^ (start * 131 + size * 7 + spread);
      for (let k = 0; k < count; k++) {
        const at = Math.floor((k / count) * len);
        const from = Math.max(0, Math.min(buf.length - gl, Math.round(centre + (rnd() * 2 - 1) * spray)));
        for (let i = 0; i < gl; i++) dst[(at + i) % len] += (src[from + i] ?? 0) * win[i];
      }
    }
    // Overlapping grains add up coherently or not depending on size and spread, so scale
    // the cloud to the loudness of the part of the sample it reads from: every setting
    // then sits at the level the plain sampler would.
    const lo = Math.max(0, Math.floor(centre - spray - gl / 2));
    const hi = Math.min(buf.length, Math.ceil(centre + spray + gl));
    let srcE = 0;
    let srcN = 0;
    let outE = 0;
    let peak = 0;
    for (let c = 0; c < ch; c++) {
      const s = buf.getChannelData(c);
      for (let i = lo; i < hi; i++) srcE += s[i] * s[i];
      srcN += hi - lo;
      const d = out.getChannelData(c);
      for (let i = 0; i < len; i++) {
        outE += d[i] * d[i];
        peak = Math.max(peak, Math.abs(d[i]));
      }
    }
    const srcRms = Math.sqrt(srcE / Math.max(1, srcN));
    const outRms = Math.sqrt(outE / (len * ch));
    let norm = outRms > 1e-9 ? Math.max(srcRms, 0.05) / outRms : 1;
    if (peak * norm > 0.95) norm = 0.95 / peak;
    for (let c = 0; c < ch; c++) {
      const d = out.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] *= norm;
    }
    // START/LOOP/LENGTH mods can ask for a new cloud per note: keep only recent ones.
    if (m.size > 32) m.clear();
    m.set(key, out);
    return out;
  }

  reverse(buf: AudioBuffer) {
    let r = this.reversed.get(buf);
    if (!r) {
      r = this.ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = r.getChannelData(ch);
        for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
      }
      this.reversed.set(buf, r);
    }
    return r;
  }

  // ---------------------------------------------------------------- MIDI
}

/** OSC play modes keep the sample's phase running across notes, per track. `buf` is the
 *  buffer actually looping (forward, reversed or ping-pong), so a mode change starts over. */
export type OscPhase = { buf: AudioBuffer; t0: number; off: number; rate: number } | null;

/**
 * The sampler's source for one note. `sp` holds the positions to play (START, LOOP, LENGTH
 * already offset by their mods). Returns when a one-shot ends by itself (Infinity if it
 * sustains), or null when there is nothing to play. `tickDur` is the tempo REPITCH follows,
 * read when the note starts.
 */
export function samplerSources(
  k: SourceKit,
  sp: Instrument['sampler'],
  note: number,
  track: number,
  samples: Map<string, AudioBuffer>,
  bufs: SampleBuffers,
  oscPhase: OscPhase[],
  tickDur: number,
): number | null {
  const raw = sp.sample ? samples.get(sp.sample) : undefined;
  if (!raw) return null;
  const dur = raw.duration;
  // DETUNE scales the playback rate (the OSC phase tracking then follows it too).
  const tune = 2 ** (detuneSemitones(sp.detune ?? 0x80) / 12);
  if (sp.play === 'WAVETABLE') {
    // The sample is a stack of 2048-sample single cycles; START picks one.
    const frames = Math.max(1, Math.floor(raw.length / 2048));
    const frame = Math.round((sp.start / 255) * (frames - 1));
    const g = k.c.createGain();
    g.gain.value = 0.6;
    k.nodes.push(g);
    k.osc(bufs.tableWave(raw, frame), k.f0 * tune).connect(g).connect(k.mix);
    return Infinity;
  }
  const buf = bufs.degrade(raw, sp.degrade ?? 0);
  if (sp.play === 'GRANULAR') {
    // A looping grain cloud rendered once per setting, pitched by the note.
    const src = k.c.createBufferSource();
    src.buffer = bufs.grainCloud(buf, sp.start, sp.loop, sp.length);
    src.loop = true;
    src.playbackRate.value = 2 ** ((note - 60) / 12) * tune;
    k.sources.push(src);
    k.detunes.push(src.detune);
    k.nodes.push(src);
    // The cloud sustains where a one-shot decays; +2.5 dB puts a held grain note
    // level with the plain sampler.
    const g = k.c.createGain();
    g.gain.value = 1.33;
    k.nodes.push(g);
    src.connect(g).connect(k.mix);
    src.start(k.t, Math.random() * src.buffer.duration * 0.5);
    return Infinity;
  }
  const oscMode = sp.play === 'OSC' || sp.play === 'OSC REV' || sp.play === 'OSC PP';
  const reverse = sp.play === 'REV' || sp.play === 'REVLOOP' || sp.play === 'REV PP';
  const pingpong = sp.play === 'FWD PP' || sp.play === 'REV PP';
  const loop = sp.play === 'FWDLOOP' || sp.play === 'REVLOOP' || pingpong;
  // REPITCH: the tempo sets the base rate; the note still transposes from C-4.
  // Clamped to ±5 octaves so an odd STEPS/sample pairing stays playable.
  const base = (sp.play === 'REPITCH' ? Math.min(32, Math.max(1 / 32, repitchRate(dur, sp.steps ?? 0x10, tickDur))) : 1) * tune;
  let from: number;
  let to: number;
  let rate: number;
  if (sp.slices > 0) {
    const n = sp.slices;
    // As on the M8: slice 0 is C-1 and each note up plays the next; notes past the last slice
    // stay on it, notes below C-1 on the first.
    const slice = Math.max(0, Math.min(n - 1, Math.round(note) - SLICE_BASE));
    from = (slice / n) * dur;
    to = ((slice + 1) / n) * dur;
    rate = base;
  } else {
    from = (sp.start / 255) * dur;
    to = from + (dur - from) * (sp.length / 255);
    rate = base * 2 ** ((note - 60) / 12);
  }
  if (oscMode) {
    // OSC modes ignore START and loop the whole sample like an oscillator: forward,
    // reversed, or forward-then-back (one ping-pong cycle is the loop).
    if (dur < 0.001) return null;
    const play =
      sp.play === 'OSC REV' ? bufs.reverse(buf) : sp.play === 'OSC PP' ? bufs.pingPong(buf, 0, dur, 0).buffer : buf;
    const period = play.duration;
    const src = k.c.createBufferSource();
    src.buffer = play;
    src.playbackRate.value = rate;
    k.sources.push(src);
    k.detunes.push(src.detune);
    k.nodes.push(src);
    src.connect(k.mix);
    // Retriggers carry on from where the previous note on this track would be now.
    const ph = oscPhase[track];
    const off = ph && ph.buf === play ? (ph.off + (k.t - ph.t0) * ph.rate) % period : 0;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = period;
    src.start(k.t, Math.max(0, Math.min(period - 0.0001, off)));
    oscPhase[track] = { buf: play, t0: k.t, off, rate };
    return Infinity;
  }
  // A START mod can push the start up to the end. A one-shot then has nothing to play; a
  // looping sample keeps a 1 ms loop just before the end instead of falling silent.
  if (to - from < 0.001 && (loop || pingpong) && dur >= 0.001) {
    to = Math.max(to, 0.001);
    from = Math.max(0, to - 0.001);
  }
  if (to - from < 0.001) return null;
  const loopStart = Math.min(to - 0.001, Math.max(from, (sp.loop / 255) * dur));
  const src = k.c.createBufferSource();
  // A source's buffer can be set only once, so pick the final one before assigning.
  let play = buf;
  if (reverse) {
    play = bufs.reverse(buf);
    [from, to] = [dur - to, dur - from];
  }
  const pp = pingpong ? bufs.pingPong(play, from, to, reverse ? from : loopStart) : null;
  src.buffer = pp ? pp.buffer : play;
  src.playbackRate.value = rate;
  k.sources.push(src);
  k.detunes.push(src.detune);
  k.nodes.push(src);
  src.connect(k.mix);
  if (pp) {
    // Forward to the end, then back and forth between loop start and end.
    src.loop = true;
    src.loopStart = pp.loopStart;
    src.loopEnd = pp.buffer.duration;
    src.start(k.t, 0);
  } else if (loop) {
    src.loop = true;
    src.loopStart = reverse ? from : loopStart;
    src.loopEnd = to;
    src.start(k.t, from);
  } else {
    src.start(k.t, from, to - from);
    return k.t + (to - from) / rate + 0.01;
  }
  return Infinity;
}
