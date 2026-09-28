/** The voice filter: the M8's node filter types built from biquads. */
import { FILTER_NODE, bpMakeup, cutoffHz, hpHz, resQ, zdfQ, type NodeFilterType } from './mappings';

export interface FilterHandle {
  type: NodeFilterType;
  input: AudioNode;
  output: AudioNode;
  /** Biquads tuned to CUTOFF (both stages of a ZDF type). */
  cut: BiquadFilterNode[];
  /** The biquad whose Q is RES; LP>HP has none. */
  res: BiquadFilterNode | null;
  /** LP>HP: the low-pass inside the high-pass, tuned by RES (see `buildFilter`). */
  hp: BiquadFilterNode | null;
  /** BANDPASS make-up gain, set from RES. */
  makeup: GainNode | null;
}

/** 4-pole Butterworth: the fixed ZDF stage's Q (0.541) in dB, as lowpass/highpass read it. */
const ZDF_FIXED_Q = 20 * Math.log10(0.541);
/**
 * LP>HP's high-pass is `x − LP(x)` with LP an overdamped biquad (Q 0.25, in dB): poles at
 * −w(2 ± √3), zero at −4w, so x − LP(x) = s(s + 4w) / ((s + 3.73w)(s + 0.268w)), a one-pole
 * high-pass at 0.268w with a +0.6 dB shelf above it. LP sits at the corner / 0.268.
 */
const HP_Q = 20 * Math.log10(0.25);
const HP_RATIO = 1 / (2 - Math.sqrt(3));

/** RES as the Q of the resonant biquad (lowpass/highpass read it in dB, the others linear). */
const resValue = (type: NodeFilterType, v: number) => (type === 'ZDF LP' || type === 'ZDF HP' ? zdfQ(v) : resQ(v));

/**
 * Build the filter for a voice, its nodes added to `nodes`.
 * - LOWPASS … BANDSTOP: one biquad; BANDPASS adds a make-up gain.
 * - LP>HP: a low-pass at CUTOFF with no resonance (the LOWPASS RES 00 curve), then a
 *   one-pole (6 dB/oct) high-pass whose corner is RES. WebAudio has no modulatable
 *   one-pole (an IIRFilterNode's coefficients are fixed, a highpass biquad is 12 dB/oct),
 *   so it is built as `x − LP(x)` (see HP_Q); that LP's frequency and detune are what RES
 *   and a RES mod move.
 * - ZDF LP / ZDF HP: two biquads at CUTOFF, a fixed Butterworth stage and a resonant one:
 *   24 dB/oct and a gentler resonance. (No worklet: a true zero-delay-feedback filter would
 *   need one; this keeps the slope and a stable resonance at any RES.)
 */
export function buildFilter(c: BaseAudioContext, type: NodeFilterType, cutoff: number, res: number, nodes: AudioNode[]): FilterHandle {
  const biquad = (t: BiquadFilterType, hz: number, q: number) => {
    const f = c.createBiquadFilter();
    f.type = t;
    f.frequency.value = Math.min(hz, c.sampleRate / 2);
    f.Q.value = q;
    nodes.push(f);
    return f;
  };
  const hz = cutoffHz(cutoff);
  switch (type) {
    case 'LP>HP': {
      const lp = biquad('lowpass', hz, resQ(0));
      const hpLp = biquad('lowpass', HP_RATIO * hpHz(res), HP_Q);
      const inv = c.createGain();
      inv.gain.value = -1;
      const sum = c.createGain();
      nodes.push(inv, sum);
      lp.connect(sum);
      lp.connect(hpLp).connect(inv).connect(sum);
      return { type, input: lp, output: sum, cut: [lp], res: null, hp: hpLp, makeup: null };
    }
    case 'ZDF LP':
    case 'ZDF HP': {
      const t = type === 'ZDF LP' ? 'lowpass' : 'highpass';
      const a = biquad(t, hz, ZDF_FIXED_Q);
      const b = biquad(t, hz, zdfQ(res));
      a.connect(b);
      return { type, input: a, output: b, cut: [a, b], res: b, hp: null, makeup: null };
    }
    case 'BANDPASS': {
      const f = biquad('bandpass', hz, resQ(res));
      const g = c.createGain();
      g.gain.value = bpMakeup(resQ(res));
      nodes.push(g);
      f.connect(g);
      return { type, input: f, output: g, cut: [f], res: f, hp: null, makeup: g };
    }
    default: {
      const f = biquad(FILTER_NODE[type], hz, resQ(res));
      return { type, input: f, output: f, cut: [f], res: f, hp: null, makeup: null };
    }
  }
}

/** CUT: an absolute CUTOFF byte from a command. */
export function setCutoff(h: FilterHandle, v: number, time: number) {
  for (const f of h.cut) f.frequency.setValueAtTime(cutoffHz(v), time);
}

/** RES: an absolute RES byte from a command (the high-pass corner on LP>HP). */
export function setRes(h: FilterHandle, v: number, time: number) {
  if (h.hp) h.hp.frequency.setValueAtTime(HP_RATIO * hpHz(v), time);
  h.res?.Q.setValueAtTime(resValue(h.type, v), time);
  h.makeup?.gain.setValueAtTime(bpMakeup(resQ(v)), time);
}

/** Mod targets for CUTOFF: full amount is ±6 octaves on every CUTOFF biquad. */
export const cutoffTargets = (h: FilterHandle, amt: number): [AudioParam, number][] =>
  h.cut.map((f) => [f.detune, amt * 7200]);

/**
 * Mod targets for RES: ±10 of Q, or on LP>HP ±6 octaves of the high-pass corner. The
 * BANDPASS make-up stays at the instrument's RES (a gain following Q would need a curve).
 */
export const resTargets = (h: FilterHandle, amt: number): [AudioParam, number][] =>
  h.hp ? [[h.hp.detune, amt * 7200]] : h.res ? [[h.res.Q, amt * 10]] : [];
