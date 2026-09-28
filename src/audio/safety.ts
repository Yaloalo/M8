/** The engine never throws: everything that reaches it is coerced to a playable value. */
import {
  EQ_SLOTS,
  FILTER_TYPES,
  filterFor,
  FM_ALGOS,
  INSTRUMENT_TYPES,
  LFO_SHAPES,
  LFO_TRIGS,
  LIMITER_TYPES,
  MOD_DESTS,
  MOD_TYPES,
  OP_SHAPES,
  SAMPLE_PLAYS,
  TRACK_SOURCES,
  WAVE_SHAPES,
  type Instrument,
} from '../core/types';

/** A finite number in range, or the default: nothing non-finite ever reaches an AudioParam. */
export const fin = (v: unknown, def: number, lo = -Infinity, hi = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
export const byte = (v: unknown, def: number) => Math.round(fin(v, def, 0, 255));
export const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : def;

const safeCache = new WeakMap<Instrument, Instrument>();

/**
 * Instruments reach the engine from saved files, imports and FX offsets. Anything
 * malformed is coerced to a playable value here, once per instrument object.
 */
export function safeInstrument(i: Instrument): Instrument {
  const hit = safeCache.get(i);
  if (hit) return hit;
  const r = (i ?? {}) as Partial<Instrument>;
  const mods = Array.isArray(r.mods) ? r.mods : [];
  const ops = Array.isArray(r.fm?.ops) ? r.fm.ops : [];
  const type = pick(r.type, INSTRUMENT_TYPES, 'NONE');
  const safe: Instrument = {
    ...(r as Instrument),
    type,
    tableTic: byte(r.tableTic, 1),
    fine: fin(r.fine, 0, -128, 127),
    // A WAV filter kept from a Wavsynth (type switched, or imported) plays as its nearest.
    filter: filterFor(type, pick(r.filter, FILTER_TYPES, 'OFF')),
    cutoff: byte(r.cutoff, 0xff),
    res: byte(r.res, 0),
    amp: byte(r.amp, 0x20),
    lim: pick(r.lim, LIMITER_TYPES, 'CLIP'),
    pan: byte(r.pan, 0x80),
    dry: byte(r.dry, 0xc0),
    cho: byte(r.cho, 0),
    del: byte(r.del, 0),
    rev: byte(r.rev, 0),
    mods: mods.slice(0, 4).map((m) => ({
      ...m,
      type: pick(m?.type, MOD_TYPES, 'OFF'),
      dest: pick(m?.dest, MOD_DESTS, 'VOLUME'),
      amt: Math.round(fin(m?.amt, 0, -128, 255)),
      attack: byte(m?.attack, 0),
      hold: byte(m?.hold, 0),
      decay: byte(m?.decay, 0x1a),
      sustain: byte(m?.sustain, 0x80),
      release: byte(m?.release, 0x08),
      lfoShape: pick(m?.lfoShape, LFO_SHAPES, 'TRI'),
      lfoTrig: pick(m?.lfoTrig, LFO_TRIGS, 'FREE'),
      freq: byte(m?.freq, 0xbf),
      source: pick(m?.source, TRACK_SOURCES, 'NOTE'),
      src: Math.min(0x87, byte(m?.src, 0x80)),
    })),
    eq: typeof r.eq === 'number' && Number.isFinite(r.eq) ? Math.round(fin(r.eq, 0, 0, EQ_SLOTS - 1)) : null,
    wav: {
      shape: pick(r.wav?.shape, WAVE_SHAPES, 'PULSE50'),
      size: byte(r.wav?.size, 0x80),
      mult: byte(r.wav?.mult, 0),
      warp: byte(r.wav?.warp, 0),
      scan: byte(r.wav?.scan, 0),
    },
    fm: {
      algo: Math.round(fin(r.fm?.algo, 0, 0, FM_ALGOS.length - 1)),
      ops: [0, 1, 2, 3].map((k) => ({
        // SQR was the square's name before the M8's twelve shapes.
        shape: pick((ops[k]?.shape as string) === 'SQR' ? 'SQU' : ops[k]?.shape, OP_SHAPES, 'SIN'),
        ratio: fin(ops[k]?.ratio, 100, 1, 3200),
        level: byte(ops[k]?.level, k === 3 ? 0xff : 0),
        decay: byte(ops[k]?.decay, 0),
        feedback: byte(ops[k]?.feedback, 0),
      })),
    },
    sampler: {
      sample: typeof r.sampler?.sample === 'string' ? r.sampler.sample : null,
      play: pick(r.sampler?.play, SAMPLE_PLAYS, 'FWD'),
      start: byte(r.sampler?.start, 0),
      loop: byte(r.sampler?.loop, 0),
      length: byte(r.sampler?.length, 0xff),
      slices: Math.round(fin(r.sampler?.slices, 0, 0, 128)),
      detune: byte(r.sampler?.detune, 0x80),
      degrade: byte(r.sampler?.degrade, 0),
      steps: Math.max(1, byte(r.sampler?.steps, 0x10)),
    },
    hyper: {
      chord: (Array.isArray(r.hyper?.chord) ? r.hyper.chord : [0]).map((x) => fin(x, -1, -1, 48)),
      swarm: byte(r.hyper?.swarm, 0x30),
      width: byte(r.hyper?.width, 0x80),
      shape: r.hyper?.shape === 'SQR' ? 'SQR' : 'SAW',
      shift: byte(r.hyper?.shift, 0x80),
      subosc: byte(r.hyper?.subosc, 0),
    },
    midi: {
      channel: Math.round(fin(r.midi?.channel, 0, 0, 15)),
      program: r.midi?.program == null ? null : Math.round(fin(r.midi.program, 0, 0, 127)),
    },
  };
  safeCache.set(i, safe);
  safeCache.set(safe, safe);
  return safe;
}

const warned = new Set<string>();
/** The engine is called from the scheduler: an error must never stop playback. */
export function guard(where: string, fn: () => void) {
  try {
    fn();
  } catch (err) {
    if (!warned.has(where)) {
      warned.add(where);
      console.warn(`audio engine: ${where} failed`, err);
    }
  }
}
