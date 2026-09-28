/** Byte → sound mappings shared by voices, the mixer and the send effects. */
import type { FilterType, LimiterType } from '../core/types';

export const volGain = (v: number) => (Math.max(0, Math.min(255, v)) / 255) ** 2;
export const cutoffHz = (v: number) => 20 * 1000 ** (Math.max(0, Math.min(255, v)) / 255);
export const resQ = (v: number) => 0.7 + (Math.max(0, Math.min(255, v)) / 255) ** 2 * 19.3;
/** Envelope and operator-decay times are in ticks, as on the M8, so they follow the tempo. */
export const tickTime = (v: number, tickDur: number) => Math.max(0.001, v * tickDur);
/** Reverb modulation: a few ms of delay swung by an LFO, 0.1–5 Hz. */
export const revModBase = (v: number) => (v > 0 ? 0.008 : 0);
export const revModDepth = (v: number) => (v / 255) * 0.006;
export const revModHz = (v: number) => 0.1 * 50 ** (v / 255);
/** 0x20 is unity; the shaper sees the signal scaled by 1/8 so FOLD and WRAP have headroom. */
export const driveGain = (v: number) => 2 ** ((v - 0x20) / 48) / 8;
export const panValue = (v: number) => Math.max(-1, Math.min(1, (v - 128) / 127));
export const send = (v: number) => Math.max(0, Math.min(255, v)) / 255;

/** The filter types that are one plain biquad. */
export type BiquadType = 'LOWPASS' | 'HIGHPASS' | 'BANDPASS' | 'BANDSTOP';
export const FILTER_NODE: Record<BiquadType, BiquadFilterType> = {
  LOWPASS: 'lowpass',
  HIGHPASS: 'highpass',
  BANDPASS: 'bandpass',
  BANDSTOP: 'notch',
};
/** Filter types the voice builds as nodes (the WAV types are applied to the cycle instead). */
export type NodeFilterType = Exclude<FilterType, 'OFF' | 'WAV LP' | 'WAV HP' | 'WAV BP' | 'WAV BS'>;
/**
 * BANDPASS make-up gain for a (linear) Q. The biquad band-pass peaks at 0 dB, so its level
 * falls as the band narrows; Q^0.85 brings typical settings to within a few dB of LOWPASS
 * at the same CUTOFF/RES, and at max RES (+22 dB) stays near the low-pass's own resonant
 * peak (+20 dB). Below Q 1 (RES 00–1A) the band is wide enough to need none.
 */
export const bpMakeup = (q: number) => Math.max(1, q) ** 0.85;
/** LP>HP: RES as the high-pass corner, exponential from 00 = 20 Hz (open) to FF = 5 kHz. */
export const hpHz = (v: number) => 20 * 250 ** (Math.max(0, Math.min(255, v)) / 255);
/**
 * ZDF LP/HP: the resonant stage's Q in dB. RES 00 gives a 4-pole Butterworth (2.3 dB,
 * with the fixed stage's −5.3 dB), FF a peak of about +15 dB overall: smoother than the
 * 2-pole types, which reach +20 dB.
 */
export const zdfQ = (v: number) => 2.33 + (Math.max(0, Math.min(255, v)) / 255) ** 2 * 17.7;

const CURVE_POINTS = 2048;
export const LIMIT_CURVES: Record<LimiterType, Float32Array<ArrayBuffer>> = (() => {
  const make = (f: (x: number) => number) => {
    const c = new Float32Array(CURVE_POINTS);
    for (let i = 0; i < CURVE_POINTS; i++) c[i] = f(((i / (CURVE_POINTS - 1)) * 2 - 1) * 8);
    return c;
  };
  return {
    CLIP: make((x) => Math.max(-1, Math.min(1, x))),
    SIN: make((x) => Math.sin((x * Math.PI) / 2)),
    FOLD: make((x) => 1 - 4 * Math.abs((((((x + 1) / 4) % 1) + 1) % 1) - 0.5)),
    WRAP: make((x) => ((((x + 1) % 2) + 2) % 2) - 1),
  };
})();

/** cancelAndHoldAtTime is missing in some engines; the fallback may step but never throws. */
export function hold(p: AudioParam, t: number) {
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(t);
  else p.cancelScheduledValues(t);
}
