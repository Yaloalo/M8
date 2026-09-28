/** FM synth: operator shapes with feedback, the twelve algorithms, and building a voice. */
import { noteFrequency } from '../core/format';
import type { Instrument, OpShape } from '../core/types';
import { tickTime } from './mappings';
import type { SourceKit } from './voice';
import type { WaveCache } from './waves';

/** Operator shapes the browser has built in; the rest are PeriodicWaves (see opCycle). */
const OSC_TYPE: Partial<Record<OpShape, OscillatorType>> = {
  SIN: 'sine',
  TRI: 'triangle',
  SAW: 'sawtooth',
  SQU: 'square',
};

/**
 * [modulator, carrier] pairs and the carriers of the M8's twelve algorithms (manual p. 59),
 * in FM_ALGOS order. A = 0 … D = 3.
 */
const FM_ROUTES: { mods: [number, number][]; out: number[] }[] = [
  { mods: [[0, 1], [1, 2], [2, 3]], out: [3] }, // 00 A>B>C>D
  { mods: [[0, 2], [1, 2], [2, 3]], out: [3] }, // 01 [A+B]>C>D
  { mods: [[0, 1], [1, 3], [2, 3]], out: [3] }, // 02 [A>B+C]>D
  { mods: [[0, 1], [0, 2], [1, 3], [2, 3]], out: [3] }, // 03 [A>B+A>C]>D
  { mods: [[0, 3], [1, 3], [2, 3]], out: [3] }, // 04 [A+B+C]>D
  { mods: [[0, 1], [1, 2]], out: [2, 3] }, // 05 [A>B>C]+D
  { mods: [[0, 1], [1, 2], [1, 3]], out: [2, 3] }, // 06 [A>B>C]+[A>B>D]
  { mods: [[0, 1], [2, 3]], out: [1, 3] }, // 07 [A>B]+[C>D]
  { mods: [[0, 1], [0, 2], [0, 3]], out: [1, 2, 3] }, // 08 [A>B]+[A>C]+[A>D]
  { mods: [[0, 1], [0, 2]], out: [1, 2, 3] }, // 09 [A>B]+[A>C]+D
  { mods: [[0, 1]], out: [1, 2, 3] }, // 0A [A>B]+C+D
  { mods: [], out: [0, 1, 2, 3] }, // 0B A+B+C+D (additive)
];

/** One cycle of an operator shape at phase p (0–1). */
function opShapeAt(shape: OpShape, p: number): number {
  const s = Math.sin(2 * Math.PI * p);
  switch (shape) {
    case 'SW2':
      return Math.max(0, s) * 2 - 0.64; // half-rectified sine, re-centred
    case 'SW3':
      return Math.abs(s) * 2 - 1.27; // full-rectified sine
    case 'SW4':
      return (p % 0.5) < 0.25 ? Math.abs(s) * 2 - 0.64 : -0.64; // quarter (pulsed) sine
    case 'SW5':
      return (s + 0.5 * Math.sin(4 * Math.PI * p)) / 1.3; // with the 2nd harmonic
    case 'SW6':
      return (s + 0.4 * Math.sin(6 * Math.PI * p)) / 1.2; // with the 3rd harmonic
    case 'TRI':
      return 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5);
    case 'SAW':
      return 2 * p - 1;
    case 'SQU':
      return p < 0.5 ? 1 : -1;
    case 'PUL':
      return p < 0.25 ? 1.5 : -0.5; // 25% pulse, DC-free
    case 'IMP':
      return p < 1 / 32 ? 31 / 8 : -1 / 8; // narrow impulse train, DC-free
    default:
      return s;
  }
}

/**
 * An operator's cycle with self-feedback. WebAudio cannot feed an oscillator back into
 * itself sample by sample, so the steady state of y(φ) = shape(φ + β·y) is solved per
 * phase and baked into the wave: the familiar sine → saw brightening as β rises.
 */
function opCycle(shape: OpShape, feedback: number): Float32Array {
  const N = 256;
  const beta = (feedback / 255) * 1.6;
  const out = new Float32Array(N);
  let y = 0;
  // Two passes so the running state is settled when the kept pass starts.
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < N; n++) {
      const p = n / N;
      // Averaging with the previous output (as FM chips do) keeps high β stable.
      const target = opShapeAt(shape, (((p + (beta * y) / (2 * Math.PI)) % 1) + 1) % 1);
      y = beta > 1 ? (y + target) / 2 : target;
      if (pass === 1) out[n] = y;
    }
  }
  return out;
}

/** An operator shape with self-feedback as a PeriodicWave, cached per shape and β. */
function opWave(waves: WaveCache, shape: OpShape, feedback: number) {
  const fb = Math.round(feedback / 4) * 4;
  return waves.get(`op:${shape}:${fb}`, () => opCycle(shape, fb));
}

/**
 * The four operators of an FM voice, routed by the algorithm. Returns each operator's gain
 * and the gain a level of FF means for it (modulator index or carrier level).
 */
export function fmSources(k: SourceKit, fm: Instrument['fm'], tickDur: number, waves: WaveCache): { g: GainNode; full: number }[] {
  const route = FM_ROUTES[fm.algo] ?? FM_ROUTES[0];
  const ops = fm.ops.map((op) => {
    const freq = k.f0 * (op.ratio / 100);
    const g = k.c.createGain();
    k.nodes.push(g);
    if (op.shape === 'NOISE') {
      // A noise operator: pitched by rate, modulated through its frequency-like
      // playback rate so the routing still works.
      const src = k.c.createBufferSource();
      src.buffer = k.noise;
      src.loop = true;
      src.playbackRate.value = Math.max(0.05, Math.min(16, freq / noteFrequency(60)));
      src.start(k.t);
      k.sources.push(src);
      k.detunes.push(src.detune);
      k.nodes.push(src);
      src.connect(g);
      return { o: null, g, op, freq };
    }
    const builtIn = op.feedback === 0 ? OSC_TYPE[op.shape] : undefined;
    const o = k.osc(builtIn ?? opWave(waves, op.shape, op.feedback), freq);
    o.connect(g);
    return { o, g, op, freq };
  });
  const isCarrier = (i: number) => route.out.includes(i);
  ops.forEach(({ g, op, freq }, i) => {
    const peak = isCarrier(i)
      ? ((op.level / 255) * 0.7) / Math.sqrt(route.out.length)
      : (op.level / 255) * 8 * freq;
    g.gain.setValueAtTime(peak, k.t);
    if (op.decay) g.gain.setTargetAtTime(0, k.t, tickTime(op.decay, tickDur) / 5);
  });
  const full = ops.map(({ g, freq }, i) => ({ g, full: isCarrier(i) ? 0.7 / Math.sqrt(route.out.length) : 8 * freq }));
  for (const [from, to] of route.mods) {
    const target = ops[to].o;
    if (target) ops[from].g.connect(target.frequency);
  }
  for (const i of route.out) ops[i].g.connect(k.mix);
  return full;
}
