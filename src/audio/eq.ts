/** EQ slots: value mappings, sanitising, and building a slot's chain of biquads. */
import { EQ_MODES, EQ_TYPES, type Eq, type EqBand, type EqType } from '../core/types';
import { byte, pick } from './safety';

/** EQ bands (M8): FREQ 20 Hz–20 kHz, GAIN ±18 dB around 80, Q 0.1–10, all log where it matters. */
export const eqHz = (v: number) => 20 * 1000 ** (Math.max(0, Math.min(255, v)) / 255);
export const eqDb = (v: number) => ((Math.max(0, Math.min(255, v)) - 128) / 128) * 18;
export const eqQ = (v: number) => 0.1 * 100 ** (Math.max(0, Math.min(255, v)) / 255);
export const EQ_NODE: Record<EqType, BiquadFilterType> = {
  LOWCUT: 'highpass',
  LOWSHELF: 'lowshelf',
  BELL: 'peaking',
  BANDPASS: 'bandpass',
  'HI.SHELF': 'highshelf',
  'HI.CUT': 'lowpass',
  ALLPASS: 'allpass',
};
/** Shelves and bells at 0 dB do nothing; cuts, band-pass and all-pass always act. */
export const bandNeutral = (b: EqBand) =>
  (b.type === 'LOWSHELF' || b.type === 'BELL' || b.type === 'HI.SHELF') && b.gain === 0x80;
export const eqActive = (eq: Eq | null | undefined): eq is Eq => !!eq && !eq.muted && eq.bands.some((b) => !bandNeutral(b));
/** Which nodes an EQ needs: when only values change, the running chain is retuned in place. */
export const eqShape = (eq: Eq | null) =>
  eqActive(eq) ? eq.bands.map((b) => (bandNeutral(b) ? '-' : `${b.type}/${b.mode}`)).join('|') : '';

/** A slot read from a project or file: every field checked, nothing non-finite. */
export function safeEq(raw: unknown): Eq {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Eq>;
  const bands = Array.isArray(r.bands) ? r.bands : [];
  const def: EqBand[] = [
    { type: 'LOWSHELF', freq: 0x42, gain: 0x80, q: 0x6c, mode: 'STEREO' },
    { type: 'BELL', freq: 0x90, gain: 0x80, q: 0x6c, mode: 'STEREO' },
    { type: 'HI.SHELF', freq: 0xd2, gain: 0x80, q: 0x6c, mode: 'STEREO' },
  ];
  return {
    muted: r.muted === true,
    bands: def.map((d, k) => {
      const b = (bands[k] && typeof bands[k] === 'object' ? bands[k] : {}) as Partial<EqBand>;
      return {
        type: pick(b.type, EQ_TYPES, d.type),
        freq: byte(b.freq, d.freq),
        gain: byte(b.gain, d.gain),
        q: byte(b.q, d.q),
        mode: pick(b.mode, EQ_MODES, d.mode),
      };
    }),
  };
}

/**
 * Build an EQ slot's chain: one biquad per active band, in series. A band in LEFT, RIGHT,
 * MID or SIDE mode runs on that part only (split / mid-side encode, filter, decode); the
 * extra nodes exist only for such bands.
 */
export function buildEq(c: BaseAudioContext, eq: Eq, nodes: AudioNode[]) {
  const input = c.createGain();
  nodes.push(input);
  let cur: AudioNode = input;
  const biquads: (BiquadFilterNode | null)[] = [];
  for (const b of eq.bands) {
    if (bandNeutral(b)) {
      biquads.push(null);
      continue;
    }
    const f = c.createBiquadFilter();
    f.type = EQ_NODE[b.type];
    f.frequency.value = Math.min(eqHz(b.freq), c.sampleRate / 2 - 100);
    f.Q.value = eqQ(b.q);
    f.gain.value = eqDb(b.gain);
    nodes.push(f);
    biquads.push(f);
    if (b.mode === 'STEREO') cur = cur.connect(f);
    else cur = channelBand(c, cur, f, b.mode, nodes);
  }
  return { input, output: cur, biquads, nodes };
}

/** One band on part of a stereo signal: left, right, mid (L+R) or side (L−R). */
function channelBand(c: BaseAudioContext, from: AudioNode, f: BiquadFilterNode, mode: EqBand['mode'], nodes: AudioNode[]) {
  const split = c.createChannelSplitter(2);
  const merge = c.createChannelMerger(2);
  nodes.push(split, merge);
  from.connect(split);
  if (mode === 'LEFT' || mode === 'RIGHT') {
    const ch = mode === 'LEFT' ? 0 : 1;
    split.connect(f, ch);
    f.connect(merge, 0, ch);
    split.connect(merge, 1 - ch, 1 - ch);
    return merge;
  }
  const g = (v: number) => {
    const n = c.createGain();
    n.gain.value = v;
    nodes.push(n);
    return n;
  };
  // Encode: M = (L + R) / 2, S = (L − R) / 2.
  const mid = g(0.5);
  const side = g(0.5);
  const invR = g(-1);
  split.connect(mid, 0);
  split.connect(mid, 1);
  split.connect(side, 0);
  split.connect(invR, 1);
  invR.connect(side);
  let m: AudioNode = mid;
  let sd: AudioNode = side;
  if (mode === 'MID') m = mid.connect(f);
  else sd = side.connect(f);
  // Decode: L = M + S, R = M − S.
  const invS = g(-1);
  m.connect(merge, 0, 0);
  sd.connect(merge, 0, 0);
  m.connect(merge, 0, 1);
  sd.connect(invS).connect(merge, 0, 1);
  return merge;
}
