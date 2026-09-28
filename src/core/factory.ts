import {
  EQ_SLOTS,
  FX_SLOTS,
  ROWS,
  SONG_ROWS,
  TRACKS,
  type Chain,
  type Eq,
  type UserScale,
  type FxSlot,
  type Groove,
  type Instrument,
  type Mod,
  type Phrase,
  type PhraseStep,
  type Project,
  type Table,
  type TableRow,
} from './types';

export const emptyFx = (): FxSlot => ({ cmd: null, val: 0 });
const fxRow = () => Array.from({ length: FX_SLOTS }, emptyFx);

export const emptyStep = (): PhraseStep => ({ note: null, vel: null, inst: null, fx: fxRow() });
export const emptyPhrase = (): Phrase => ({ steps: Array.from({ length: ROWS }, emptyStep) });
export const emptyChain = (): Chain => ({
  rows: Array.from({ length: ROWS }, () => ({ phrase: null, tsp: 0 })),
});
export const emptyTableRow = (): TableRow => ({ tsp: 0, vel: null, fx: fxRow() });
export const emptyTable = (): Table => ({ rows: Array.from({ length: ROWS }, emptyTableRow) });
export const defaultGroove = (): Groove => ({
  steps: [6, 6, ...Array.from({ length: ROWS - 2 }, () => null)],
});

export const defaultUserScale = (i: number): UserScale => ({
  name: `USER ${i.toString(16).toUpperCase()}`,
  notes: Array.from({ length: 12 }, () => true),
  tune: Array.from({ length: 12 }, () => 0),
});

/** Defaults: LOW shelf at 120 Hz, MID bell at 1 kHz, HIGH shelf at 6 kHz, all at 0 dB. */
export const flatEq = (): Eq => ({
  muted: false,
  bands: [
    { type: 'LOWSHELF', freq: 0x42, gain: 0x80, q: 0x6c, mode: 'STEREO' },
    { type: 'BELL', freq: 0x90, gain: 0x80, q: 0x6c, mode: 'STEREO' },
    { type: 'HI.SHELF', freq: 0xd2, gain: 0x80, q: 0x6c, mode: 'STEREO' },
  ],
});

export function defaultMod(index: number): Mod {
  return {
    // Slot one starts as the volume envelope, as on the M8.
    type: index === 0 ? 'AHD' : 'OFF',
    dest: index === 0 ? 'VOLUME' : index === 1 ? 'CUTOFF' : index === 2 ? 'PITCH' : 'PAN',
    amt: index === 0 ? 127 : 0,
    attack: 0,
    hold: 0,
    decay: 0x1a,
    sustain: 0x80,
    release: 0x08,
    lfoShape: 'TRI',
    lfoTrig: 'FREE',
    freq: 0xbf,
    source: 'NOTE',
    src: 0x80,
  };
}

export function defaultInstrument(): Instrument {
  return {
    type: 'NONE',
    name: '',
    transpose: true,
    tableTic: 1,
    fine: 0,
    filter: 'OFF',
    cutoff: 0xff,
    res: 0,
    amp: 0x20,
    lim: 'CLIP',
    pan: 0x80,
    dry: 0xc0,
    cho: 0,
    del: 0,
    rev: 0,
    eq: null,
    mods: [0, 1, 2, 3].map(defaultMod),
    wav: { shape: 'PULSE50', size: 0x80, mult: 0, warp: 0, scan: 0 },
    fm: {
      algo: 0,
      ops: [
        { shape: 'SIN', ratio: 100, level: 0x00, decay: 0, feedback: 0 },
        { shape: 'SIN', ratio: 100, level: 0x00, decay: 0, feedback: 0 },
        { shape: 'SIN', ratio: 200, level: 0x40, decay: 0x08, feedback: 0 },
        { shape: 'SIN', ratio: 100, level: 0xff, decay: 0, feedback: 0 },
      ],
    },
    sampler: { sample: null, play: 'FWD', start: 0, loop: 0, length: 0xff, slices: 0, detune: 0x80, degrade: 0, steps: 0x10 },
    hyper: { chord: [0, 7, 12], swarm: 0x30, width: 0x80, shape: 'SAW', shift: 0x80, subosc: 0 },
    midi: { channel: 0, program: null },
  };
}

export function newProject(): Project {
  return {
    version: 3,
    name: 'UNTITLED',
    tempo: 120,
    transpose: 0,
    song: Array.from({ length: SONG_ROWS }, () => Array.from({ length: TRACKS }, () => null)),
    chains: {},
    phrases: {},
    instruments: {},
    tables: {},
    grooves: { 0: defaultGroove() },
    mixer: {
      tracks: Array.from({ length: TRACKS }, () => 0xe0),
      mute: Array.from({ length: TRACKS }, () => false),
      solo: Array.from({ length: TRACKS }, () => false),
      cho: 0xc0,
      del: 0xc0,
      rev: 0xc0,
      master: 0xe0,
      djf: 0x80,
      djfRes: 0x30,
      djType: 0,
      limit: 0x40,
      eq: null,
    },
    effects: {
      chorus: { depth: 0x60, rate: 0x40, width: 0xff, rev: 0 },
      delay: { timeL: 0x12, timeR: 0x18, feedback: 0x70, width: 0xff, rev: 0x20 },
      reverb: { size: 0xa0, damp: 0x80, width: 0xff, modDepth: 0, modFreq: 0x40 },
    },
    settings: { hex: true, scale: 'CHROMATIC', scaleRoot: 0, stepJump: 1, octave: 4, midiOut: null, liveQuant: 'CHAIN' },
    samples: {},
    bookmarks: [],
    scales: Array.from({ length: 16 }, (_, i) => defaultUserScale(i)),
    eqs: Array.from({ length: EQ_SLOTS }, flatEq),
  };
}

// Readers never allocate: a missing chain/phrase/table plays as empty.
const EMPTY_CHAIN = emptyChain();
const EMPTY_PHRASE = emptyPhrase();
const EMPTY_TABLE = emptyTable();
const DEFAULT_INSTRUMENT = defaultInstrument();

export const getChain = (p: Project, id: number | null) =>
  (id == null ? undefined : p.chains[id]) ?? EMPTY_CHAIN;
export const getPhrase = (p: Project, id: number | null) =>
  (id == null ? undefined : p.phrases[id]) ?? EMPTY_PHRASE;
export const getTable = (p: Project, id: number | null) =>
  (id == null ? undefined : p.tables[id]) ?? EMPTY_TABLE;
export const getInstrument = (p: Project, id: number | null) =>
  (id == null ? undefined : p.instruments[id]) ?? DEFAULT_INSTRUMENT;
export const getGroove = (p: Project, id: number) => p.grooves[id] ?? p.grooves[0] ?? defaultGroove();

export const isChainEmpty = (c: Chain | undefined) => !c || c.rows.every((r) => r.phrase == null);
export const isPhraseEmpty = (ph: Phrase | undefined) =>
  !ph ||
  ph.steps.every(
    (s) => s.note == null && s.vel == null && s.inst == null && s.fx.every((f) => f.cmd == null),
  );

/** First id not referenced anywhere and holding no data — what EDIT EDIT picks. */
export function unusedChain(p: Project): number | null {
  const used = new Set<number>();
  for (const row of p.song) for (const c of row) if (c != null) used.add(c);
  for (let i = 0; i < 255; i++) if (!used.has(i) && isChainEmpty(p.chains[i])) return i;
  return null;
}

export function unusedPhrase(p: Project): number | null {
  const used = new Set<number>();
  for (const c of Object.values(p.chains)) for (const r of c.rows) if (r.phrase != null) used.add(r.phrase);
  for (let i = 0; i < 255; i++) if (!used.has(i) && isPhraseEmpty(p.phrases[i])) return i;
  return null;
}

export function unusedInstrument(p: Project): number | null {
  for (let i = 0; i < 128; i++) if (!p.instruments[i] || p.instruments[i].type === 'NONE') return i;
  return null;
}
