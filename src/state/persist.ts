/**
 * Autosave to IndexedDB. The project is one JSON document; user samples are stored as the
 * original file bytes so they decode at the device's sample rate on the next visit.
 */
import { defaultGroove, defaultInstrument, flatEq, newProject } from '../core/factory';
import { FX_CODES } from '../core/fx';
import { ALL_SCALES } from '../core/format';
import {
  FILTER_TYPES,
  filterFor,
  FM_ALGOS,
  FX_SLOTS,
  INSTRUMENT_TYPES,
  LFO_SHAPES,
  LFO_TRIGS,
  LIMITER_TYPES,
  MOD_DESTS,
  MOD_TYPES,
  NOTE_OFF,
  OP_SHAPES,
  ROWS,
  SAMPLE_PLAYS,
  TRACK_SOURCES,
  WAVE_SHAPES,
  EQ_MODES,
  EQ_SLOTS,
  EQ_TYPES,
  type Eq,
  type FxSlot,
  type Instrument,
  type Project,
} from '../core/types';

const DB = 'eight-tracker';
const STORES = ['project', 'samples'] as const;

let dbp: Promise<IDBDatabase> | null = null;

/** One database handle for the whole visit, so a save on page hide can start at once. */
function open(): Promise<IDBDatabase> {
  dbp ??= openDb().catch((e) => {
    dbp = null;
    throw e;
  });
  return dbp;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: (typeof STORES)[number], mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const PENDING = 'eight:pending';
const SAVED_AT = 'eight:savedAt';

export async function loadProject(): Promise<Project | null> {
  // A save that was still pending when the page went away was mirrored to localStorage;
  // it wins when it is newer than the last completed database write.
  try {
    const pending = localStorage.getItem(PENDING);
    if (pending) {
      const { at, json } = JSON.parse(pending) as { at: number; json: string };
      localStorage.removeItem(PENDING);
      if (at > Number(localStorage.getItem(SAVED_AT) ?? 0)) {
        const p = migrate(JSON.parse(json));
        write(p);
        return p;
      }
    }
  } catch {
    /* No localStorage: fall back to the database copy. */
  }
  try {
    const raw = await tx<string | undefined>('project', 'readonly', (s) => s.get('current'));
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let paused = false;
/** Set while the UI is showing an error, so a broken state is never saved. */
export function pauseAutosave(on: boolean) {
  paused = on;
  if (on) clearTimeout(timer);
}
let pending: Project | null = null;

// Two tabs on the same project: each save is announced, so the other tab can pick it up
// instead of silently overwriting it with its own older copy on its next edit.
const TAB = Math.random().toString(36).slice(2);
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('eight:project') : null;
/** A project taken over from another tab: already saved, so not written back. */
let adopted: Project | null = null;
/** The version this tab last saved or took over: the common ancestor for a merge. */
let base: Project | null = null;
export const hasPendingSave = () => pending != null;
export const savedBase = () => base;
export function setSavedBase(p: Project) {
  base = p;
}
export function adoptWithoutSaving(p: Project) {
  adopted = p;
  base = p;
}
export function onOtherTabSave(cb: () => void) {
  channel?.addEventListener('message', (e: MessageEvent) => {
    if ((e.data as { tab?: string } | null)?.tab !== TAB) cb();
  });
}

function write(p: Project) {
  const at = Date.now();
  base = p;
  // Something else is on disk now: the adopted project is no longer "already saved".
  adopted = null;
  tx('project', 'readwrite', (st) => st.put(JSON.stringify(p), 'current'))
    .then(() => {
      try {
        localStorage.setItem(SAVED_AT, String(at));
      } catch {
        /* Only the reload race needs this. */
      }
      channel?.postMessage({ tab: TAB, at });
    })
    .catch(() => {
      /* Private windows can refuse storage; the session still works. */
    });
}

export function saveProjectSoon(p: Project) {
  clearTimeout(timer);
  if (p === adopted) {
    // Back to exactly what the other tab saved (and nothing written since): the disk already
    // holds it, and a pending save of an older state must not overwrite it.
    pending = null;
    return;
  }
  if (paused) return;
  pending = p;
  timer = setTimeout(() => {
    pending = null;
    write(p);
  }, 400);
}

/** Write a pending save now: the tab is closing, or the app is being swiped away. */
export function flushSave() {
  if (!pending || paused) return;
  clearTimeout(timer);
  const p = pending;
  pending = null;
  // IndexedDB may not finish before the page is gone; localStorage is synchronous.
  try {
    localStorage.setItem(PENDING, JSON.stringify({ at: Date.now(), json: JSON.stringify(p) }));
  } catch {
    /* Too big or blocked: the database write below is the only chance. */
  }
  write(p);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}

export async function saveSample(id: string, data: ArrayBuffer) {
  await tx('samples', 'readwrite', (s) => s.put(data, id));
}

export async function loadSamples(): Promise<Map<string, ArrayBuffer>> {
  const out = new Map<string, ArrayBuffer>();
  try {
    const keys = await tx<IDBValidKey[]>('samples', 'readonly', (s) => s.getAllKeys());
    for (const k of keys) {
      const data = await tx<ArrayBuffer>('samples', 'readonly', (s) => s.get(k));
      if (data) out.set(String(k), data);
    }
  } catch {
    /* No storage: built-in samples still work. */
  }
  return out;
}

/** Values `migrate` had to change: shown after an import, so repairs are never silent. */
let repairs = 0;
export const lastRepairs = () => repairs;

function int(v: unknown, lo: number, hi: number, fallback: number) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const c = Math.max(lo, Math.min(hi, Math.round(v)));
    if (c !== v) repairs++;
    return c;
  }
  if (v != null) repairs++;
  return fallback;
}
/** An optional value: missing stays empty; garbage that is not a number becomes empty too. */
function intOrNull(v: unknown, lo: number, hi: number) {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    repairs++;
    return null;
  }
  return int(v, lo, hi, lo);
}
/** A reference (chain, phrase, instrument): anything but a whole number in range is empty,
 *  never a clamped 00 that would point at a real chain. */
function refOrNull(v: unknown, hi: number) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= hi) return v;
  repairs++;
  return null;
}
const rows = <T>(arr: unknown, make: (r: unknown, i: number) => T): T[] =>
  Array.from({ length: ROWS }, (_, i) => make(Array.isArray(arr) ? arr[i] : undefined, i));
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const fx = (arr: unknown): FxSlot[] =>
  Array.from({ length: FX_SLOTS }, (_, i) => {
    const f = rec(Array.isArray(arr) ? arr[i] : undefined);
    const cmd = typeof f.cmd === 'string' && FX_CODES.includes(f.cmd) ? f.cmd : null;
    return { cmd, val: cmd ? int(f.val, 0, 255, 0) : 0 };
  });

/** Ids are numbers 0..max; anything else in a record is dropped. */
function byId<T>(v: unknown, max: number, make: (x: Record<string, unknown>) => T): Record<number, T> {
  const out: Record<number, T> = {};
  for (const [k, x] of Object.entries(rec(v))) {
    const id = Number(k);
    if (Number.isInteger(id) && id >= 0 && id < max) out[id] = make(rec(x));
  }
  return out;
}

function eqSlot(v: unknown): Eq {
  const r = rec(v);
  const d = flatEq();
  return {
    muted: typeof r.muted === 'boolean' ? r.muted : false,
    bands: d.bands.map((b, k) => {
      const x = rec(Array.isArray(r.bands) ? r.bands[k] : undefined);
      return {
        type: pick(x.type, EQ_TYPES, b.type),
        freq: int(x.freq, 0, 255, b.freq),
        gain: int(x.gain, 0, 255, b.gain),
        q: int(x.q, 0, 255, b.q),
        mode: pick(x.mode, EQ_MODES, b.mode),
      };
    }),
  };
}

/**
 * The first EQ model was three gains stored inline ({ low, mid, midFreq, high }); turn one
 * into a slot of the bank, or null when it was flat.
 */
function legacyEq(v: unknown): Eq | null {
  const r = rec(v);
  if (typeof r.low !== 'number' && typeof r.mid !== 'number' && typeof r.high !== 'number') return null;
  const g = (x: unknown) => Math.round(0x80 + (((int(x, 0, 255, 0x80) - 0x80) / 0x80) * 12 * 0x80) / 18);
  if ([r.low, r.mid, r.high].every((x) => x == null || x === 0x80)) return null;
  const eq = flatEq();
  eq.bands[0].gain = g(r.low);
  eq.bands[1].gain = g(r.mid);
  // Old MID FREQ spanned 100 Hz–8 kHz; the band FREQ spans 20 Hz–20 kHz.
  const hz = 100 * 80 ** (int(r.midFreq, 0, 255, 0x80) / 255);
  eq.bands[1].freq = Math.round((Math.log(hz / 20) / Math.log(1000)) * 255);
  eq.bands[2].gain = g(r.high);
  return eq;
}

function pick<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  if (options.includes(v as T)) return v as T;
  if (v != null) repairs++;
  return fallback;
}

/** Version ≤ 2 had six FM routings; where each one sits among the M8's twelve. */
const OLD_ALGO = [0, 1, 7, 5, 8, 11];
let oldAlgo = false;

/** Numbers clamped, enums checked, arrays sized: whatever the file held. */
function mergeInstrument(x: Record<string, unknown>): Instrument {
  const d = defaultInstrument();
  const w = rec(x.wav);
  const sp = rec(x.sampler);
  const hy = rec(x.hyper);
  const mi = rec(x.midi);
  const fm = rec(x.fm);
  const byte = (v: unknown, fallback: number) => int(v, 0, 255, fallback);
  const type = pick(x.type, INSTRUMENT_TYPES, 'NONE');
  const filter = pick(x.filter, FILTER_TYPES, d.filter);
  // WAV filters are Wavsynth-only: elsewhere they become the nearest ordinary type.
  const playable = filterFor(type, filter);
  if (playable !== filter) repairs++;
  return {
    type,
    name: typeof x.name === 'string' ? x.name.slice(0, 16) : '',
    transpose: typeof x.transpose === 'boolean' ? x.transpose : d.transpose,
    tableTic: byte(x.tableTic, d.tableTic),
    fine: int(x.fine, -128, 127, 0),
    filter: playable,
    cutoff: byte(x.cutoff, d.cutoff),
    res: byte(x.res, d.res),
    amp: byte(x.amp, d.amp),
    lim: pick(x.lim, LIMITER_TYPES, d.lim),
    pan: byte(x.pan, d.pan),
    dry: byte(x.dry, d.dry),
    cho: byte(x.cho, d.cho),
    del: byte(x.del, d.del),
    rev: byte(x.rev, d.rev),
    eq: typeof x.eq === 'number' ? int(x.eq, 0, EQ_SLOTS - 1, 0) : null,
    mods: d.mods.map((m, k) => {
      const r = rec(Array.isArray(x.mods) ? x.mods[k] : undefined);
      return {
        type: pick(r.type, MOD_TYPES, m.type),
        dest: pick(r.dest, MOD_DESTS, m.dest),
        amt: int(r.amt, -128, 127, m.amt),
        attack: byte(r.attack, m.attack),
        hold: byte(r.hold, m.hold),
        decay: byte(r.decay, m.decay),
        sustain: byte(r.sustain, m.sustain),
        release: byte(r.release, m.release),
        lfoShape: pick(r.lfoShape, LFO_SHAPES, m.lfoShape),
        lfoTrig: pick(r.lfoTrig, LFO_TRIGS, m.lfoTrig),
        freq: byte(r.freq, m.freq),
        source: pick(r.source, TRACK_SOURCES, m.source),
        src: int(r.src, 0, 0x87, m.src),
      };
    }),
    wav: {
      shape: pick(w.shape, WAVE_SHAPES, d.wav.shape),
      size: byte(w.size, d.wav.size),
      mult: byte(w.mult, d.wav.mult),
      warp: byte(w.warp, d.wav.warp),
      scan: byte(w.scan, 0),
    },
    fm: {
      algo: oldAlgo ? (OLD_ALGO[int(fm.algo, 0, 5, 0)] ?? 0) : int(fm.algo, 0, FM_ALGOS.length - 1, 0),
      ops: d.fm.ops.map((op, k) => {
        const r = rec(Array.isArray(fm.ops) ? fm.ops[k] : undefined);
        return {
          shape: pick(r.shape === 'SQR' ? 'SQU' : r.shape, OP_SHAPES, op.shape),
          feedback: byte(r.feedback, 0),
          ratio: int(r.ratio, 25, 1600, op.ratio),
          level: byte(r.level, op.level),
          decay: byte(r.decay, op.decay),
        };
      }),
    },
    sampler: {
      sample: typeof sp.sample === 'string' ? sp.sample : null,
      play: pick(sp.play, SAMPLE_PLAYS, d.sampler.play),
      start: byte(sp.start, d.sampler.start),
      loop: byte(sp.loop, d.sampler.loop),
      length: byte(sp.length, d.sampler.length),
      slices: int(sp.slices, 0, 64, 0),
      // Older files lack these: the defaults (in tune, clean, 16 steps) sound the same.
      detune: byte(sp.detune, d.sampler.detune),
      degrade: byte(sp.degrade, d.sampler.degrade),
      steps: int(sp.steps, 1, 255, d.sampler.steps),
    },
    hyper: {
      chord: Array.isArray(hy.chord) ? hy.chord.slice(0, 6).map((n) => int(n, -1, 24, -1)) : d.hyper.chord,
      swarm: byte(hy.swarm, d.hyper.swarm),
      width: byte(hy.width, d.hyper.width),
      shape: pick(hy.shape, ['SAW', 'SQR'] as const, d.hyper.shape),
      // SHIFT 80 plays every note at full and SUBOSC 00 is off: older files sound the same.
      shift: byte(hy.shift, d.hyper.shift),
      subosc: byte(hy.subosc, d.hyper.subosc),
    },
    midi: { channel: int(mi.channel, 0, 15, 0), program: intOrNull(mi.program, 0, 127) },
  };
}

/** Version 1 envelope times were exponential seconds; version 2 counts ticks, like the M8. */
const OLD_TIME: [number, number][] = [
  [0x00, 0], [0x0f, 1], [0x20, 1], [0x30, 3], [0x38, 5], [0x40, 8], [0x48, 0x0b], [0x50, 0x0f],
  [0x58, 0x14], [0x60, 0x1a], [0x70, 0x29], [0x80, 0x3d], [0x90, 0x56], [0xa0, 0x77], [0xb0, 0x9e],
  [0xc0, 0xcd], [0xff, 0xff],
];
function toTicks(v: number) {
  if (!v) return 0;
  for (let k = 1; k < OLD_TIME.length; k++) {
    const [a, x] = OLD_TIME[k - 1];
    const [b, y] = OLD_TIME[k];
    if (v <= b) return Math.max(1, Math.round(x + ((y - x) * (v - a)) / (b - a)));
  }
  return v;
}
function ticksFromSeconds(i: Instrument) {
  for (const m of i.mods) for (const k of ['attack', 'hold', 'decay', 'release'] as const) m[k] = toTicks(m[k]);
  for (const op of i.fm.ops) op.decay = toTicks(op.decay);
}

/**
 * Bring any saved or imported project into shape: fill in what an older build lacks and
 * clamp everything else, so a damaged file cannot crash a screen.
 */
export function migrate(input: unknown): Project {
  repairs = 0;
  const raw = rec(input);
  const base = newProject();
  const oldVel = int(raw.version, 0, 99, 1) < 2;
  oldAlgo = int(raw.version, 0, 99, 1) < 3;
  const vel = (v: unknown) => {
    const n = intOrNull(v, 0, 255);
    return n == null ? null : oldVel ? n >> 1 : Math.min(0x7f, n);
  };
  const song = Array.isArray(raw.song) ? raw.song : [];
  const instruments = byId(raw.instruments, 128, mergeInstrument);
  if (oldVel) for (const i of Object.values(instruments)) ticksFromSeconds(i);
  const p: Project = {
    ...base,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 16) : base.name,
    tempo: int(raw.tempo, 20, 300, base.tempo),
    transpose: int(raw.transpose, -48, 48, 0),
    song: base.song.map((row, r) =>
      row.map((_, t) => refOrNull(Array.isArray(song[r]) ? song[r][t] : null, 0xfe)),
    ),
    chains: byId(raw.chains, 255, (c) => ({
      rows: rows(c.rows, (r) => ({ phrase: refOrNull(rec(r).phrase, 0xfe), tsp: int(rec(r).tsp, 0, 255, 0) })),
    })),
    phrases: byId(raw.phrases, 255, (ph) => ({
      steps: rows(ph.steps, (st) => {
        const s = rec(st);
        return {
          note: intOrNull(s.note, 0, NOTE_OFF),
          vel: vel(s.vel),
          inst: refOrNull(s.inst, 0x7f),
          fx: fx(s.fx),
        };
      }),
    })),
    tables: byId(raw.tables, 256, (tb) => ({
      rows: rows(tb.rows, (r) => ({ tsp: int(rec(r).tsp, 0, 255, 0), vel: vel(rec(r).vel), fx: fx(rec(r).fx) })),
    })),
    grooves: {
      0: defaultGroove(),
      ...byId(raw.grooves, 32, (g) => ({ steps: rows(g.steps, (v) => intOrNull(v, 0, 255)) })),
    },
    instruments,
    samples: Object.fromEntries(
      Object.entries(rec(raw.samples)).map(([id, m]) => [
        id,
        { name: String(rec(m).name ?? id).slice(0, 16), builtin: !!rec(m).builtin },
      ]),
    ),
  };
  const mixer = rec(raw.mixer);
  const eight = (v: unknown, d: number[]) => d.map((x, i) => int(Array.isArray(v) ? v[i] : undefined, 0, 255, x));
  const flags = (v: unknown) => base.mixer.mute.map((_, i) => !!(Array.isArray(v) && v[i]));
  p.mixer = {
    ...base.mixer,
    ...Object.fromEntries(Object.entries(base.mixer).filter(([k]) => typeof mixer[k] === 'number').map(([k]) => [k, int(mixer[k], 0, 255, 0)])),
    tracks: eight(mixer.tracks, base.mixer.tracks),
    mute: flags(mixer.mute),
    solo: flags(mixer.solo),
  };
  const fxs = rec(raw.effects);
  const bytes = <T extends object>(src: unknown, d: T): T =>
    Object.fromEntries(Object.entries(d).map(([k, v]) => [k, int(rec(src)[k], 0, 255, v as number)])) as T;
  p.effects = {
    chorus: bytes(fxs.chorus, base.effects.chorus),
    delay: bytes(fxs.delay, base.effects.delay),
    reverb: bytes(fxs.reverb, base.effects.reverb),
  };
  p.mixer.djType = Math.min(2, p.mixer.djType);
  p.eqs = base.eqs.map((d, k) => (Array.isArray(raw.eqs) && raw.eqs[k] ? eqSlot(raw.eqs[k]) : d));
  // Inline EQs from the first EQ model move into free slots from the top of the bank.
  let free = EQ_SLOTS - 1;
  const place = (legacy: Eq | null) => {
    if (!legacy || free < 0) return null;
    p.eqs[free] = legacy;
    return free--;
  };
  p.mixer.eq = typeof mixer.eq === 'number' ? int(mixer.eq, 0, EQ_SLOTS - 1, 0) : place(legacyEq(mixer.eq));
  for (const [k, i] of Object.entries(p.instruments)) {
    const old = rec(rec(raw.instruments)[k]).eq;
    if (old && typeof old === 'object') i.eq = place(legacyEq(old));
  }
  p.effects.delay.timeL ||= 1;
  p.effects.delay.timeR ||= 1;
  const st = rec(raw.settings);
  p.settings = {
    hex: typeof st.hex === 'boolean' ? st.hex : base.settings.hex,
    scale: pick(st.scale, ALL_SCALES, base.settings.scale),
    scaleRoot: int(st.scaleRoot, 0, 11, 0),
    stepJump: int(st.stepJump, 0, 16, base.settings.stepJump),
    octave: int(st.octave, 0, 8, base.settings.octave),
    midiOut: typeof st.midiOut === 'string' ? st.midiOut : null,
    liveQuant: pick(st.liveQuant, ['CHAIN', 'BAR', 'BEAT'] as const, 'CHAIN'),
  };
  p.scales = base.scales.map((d, i) => {
    const u = rec(Array.isArray(raw.scales) ? raw.scales[i] : undefined);
    return {
      name: typeof u.name === 'string' ? u.name.slice(0, 12) : d.name,
      notes: d.notes.map((on, k) => (Array.isArray(u.notes) && typeof u.notes[k] === 'boolean' ? (u.notes[k] as boolean) : on)),
      tune: d.tune.map((c, k) => int(Array.isArray(u.tune) ? u.tune[k] : undefined, -100, 100, c)),
    };
  });
  p.bookmarks = Array.isArray(raw.bookmarks) ? [...new Set(raw.bookmarks.map((b) => int(b, 0, 0xfe, 0)))] : [];
  return p;
}

/** Is this something this app wrote (a project file or a bare project)? */
export function looksLikeProject(json: unknown): boolean {
  const r = rec(json);
  const bare = (x: unknown) => Array.isArray(rec(x).song) && typeof rec(x).tempo === 'number';
  return r.format === 'eight-tracker' ? bare(r.project) : bare(r);
}

// ------------------------------------------------------------------- files

const toBase64 = (buf: ArrayBuffer) => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer;

/** A portable file: the project plus the bytes of every user sample it references. */
export async function exportProject(p: Project): Promise<Blob> {
  const stored = await loadSamples();
  const samples: Record<string, string> = {};
  for (const [id, meta] of Object.entries(p.samples)) {
    const data = stored.get(id);
    if (!meta.builtin && data) samples[id] = toBase64(data);
  }
  return new Blob([JSON.stringify({ format: 'eight-tracker', project: p, samples })], {
    type: 'application/json',
  });
}

export async function importProject(
  file: File,
): Promise<{ project: Project; samples: Map<string, ArrayBuffer>; repairs: number }> {
  const json = JSON.parse(await file.text());
  if (!looksLikeProject(json)) throw new Error('not a project');
  const project = migrate(json.project ?? json);
  let repairs = lastRepairs();
  // A damaged sample is skipped (and counted), never a reason to refuse the whole project;
  // samples are stored only once the project itself has been accepted.
  const samples = new Map<string, ArrayBuffer>();
  for (const [id, b64] of Object.entries(rec(json.samples))) {
    try {
      if (typeof b64 !== 'string') throw new Error('not base64');
      samples.set(id, fromBase64(b64));
    } catch {
      repairs++;
    }
  }
  for (const [id, data] of samples) await saveSample(id, data).catch(() => {});
  return { project, samples, repairs };
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
