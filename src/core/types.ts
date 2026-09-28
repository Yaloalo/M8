/**
 * The saved project. Mirrors the M8 hierarchy: a song column per track points at chains,
 * a chain lists phrases, a phrase holds 16 steps. Chains, phrases, tables and instruments
 * are shared by all eight tracks and created lazily, so an id may have no entry yet —
 * readers treat a missing entry as empty.
 */

export const TRACKS = 8;
export const SONG_ROWS = 256;
export const ROWS = 16;
export const MAX_CHAINS = 255;
export const MAX_PHRASES = 255;
export const MAX_INSTRUMENTS = 128;
export const MAX_TABLES = 256;
export const MAX_GROOVES = 32;
export const FX_SLOTS = 3;
/** Stored in the note column; everything below it is a MIDI note number. */
export const NOTE_OFF = 128;
/** M8 counts 24 ticks per beat; the default groove of 6 ticks makes a sixteenth. */
export const TICKS_PER_BEAT = 24;

export interface FxSlot {
  cmd: string | null;
  val: number;
}

export interface PhraseStep {
  note: number | null;
  /** 00–7F. */
  vel: number | null;
  inst: number | null;
  fx: FxSlot[];
}

export interface Phrase {
  steps: PhraseStep[];
}

export interface ChainRow {
  phrase: number | null;
  /** Semitones as a two's-complement byte (FF = -1), like every signed cell. */
  tsp: number;
}

export interface Chain {
  rows: ChainRow[];
}

export interface TableRow {
  /** Semitones relative to the triggering note, two's-complement byte. */
  tsp: number;
  vel: number | null;
  fx: FxSlot[];
}

export interface Table {
  rows: TableRow[];
}

/** Ticks per step, looping over the non-empty entries. */
export interface Groove {
  steps: (number | null)[];
}

export type InstrumentType = 'NONE' | 'WAVSYNTH' | 'FMSYNTH' | 'SAMPLER' | 'HYPERSYNTH' | 'MIDIOUT';
export const INSTRUMENT_TYPES: InstrumentType[] = [
  'NONE',
  'WAVSYNTH',
  'FMSYNTH',
  'SAMPLER',
  'HYPERSYNTH',
  'MIDIOUT',
];

/**
 * The M8's filter types. The stored value is the M8's display label. LP>HP is a low-pass
 * whose RES sets a gentle high-pass instead of resonance; ZDF LP/HP are the steeper,
 * smoother-resonance pair; the WAV types (Wavsynth only) filter the single cycle itself.
 */
export type WavFilterType = 'WAV LP' | 'WAV HP' | 'WAV BP' | 'WAV BS';
export type FilterType = 'OFF' | 'LOWPASS' | 'HIGHPASS' | 'BANDPASS' | 'BANDSTOP' | 'LP>HP' | 'ZDF LP' | 'ZDF HP' | WavFilterType;
export const FILTER_TYPES: FilterType[] = [
  'OFF',
  'LOWPASS',
  'HIGHPASS',
  'BANDPASS',
  'BANDSTOP',
  'LP>HP',
  'ZDF LP',
  'ZDF HP',
  'WAV LP',
  'WAV HP',
  'WAV BP',
  'WAV BS',
];
/** Each WAV type's nearest ordinary filter, for instruments that are not Wavsynths. */
export const WAV_FILTER_NEAREST: Record<WavFilterType, FilterType> = {
  'WAV LP': 'LOWPASS',
  'WAV HP': 'HIGHPASS',
  'WAV BP': 'BANDPASS',
  'WAV BS': 'BANDSTOP',
};
export const isWavFilter = (f: FilterType): f is WavFilterType => f in WAV_FILTER_NEAREST;
/** The filter types an instrument type offers: the WAV ones only on the Wavsynth. */
export const filterTypesFor = (t: InstrumentType): FilterType[] =>
  t === 'WAVSYNTH' ? FILTER_TYPES : FILTER_TYPES.filter((f) => !isWavFilter(f));
/** A filter type the instrument type can play: a WAV type elsewhere becomes its nearest. */
export const filterFor = (t: InstrumentType, f: FilterType): FilterType =>
  isWavFilter(f) && t !== 'WAVSYNTH' ? WAV_FILTER_NEAREST[f] : f;

export type LimiterType = 'CLIP' | 'SIN' | 'FOLD' | 'WRAP';
export const LIMITER_TYPES: LimiterType[] = ['CLIP', 'SIN', 'FOLD', 'WRAP'];

export type WaveShape =
  | 'PULSE12'
  | 'PULSE25'
  | 'PULSE50'
  | 'PULSE75'
  | 'SAW'
  | 'TRIANGLE'
  | 'SINE'
  | 'NOISE P'
  | 'NOISE'
  | 'WT01'
  | 'WT02'
  | 'WT03'
  | 'WT04'
  | 'WT05'
  | 'WT06'
  | 'WT07'
  | 'WT08';
export const WAVE_SHAPES: WaveShape[] = [
  'PULSE12',
  'PULSE25',
  'PULSE50',
  'PULSE75',
  'SAW',
  'TRIANGLE',
  'SINE',
  'NOISE P',
  'NOISE',
  // Wave tables: 64 waveforms each, morphed with SCAN (M8 WT shapes).
  'WT01',
  'WT02',
  'WT03',
  'WT04',
  'WT05',
  'WT06',
  'WT07',
  'WT08',
];

/** The M8's twelve operator shapes (SW2–SW6 are sine variations). */
export type OpShape = 'SIN' | 'SW2' | 'SW3' | 'SW4' | 'SW5' | 'SW6' | 'TRI' | 'SAW' | 'SQU' | 'PUL' | 'IMP' | 'NOISE';
export const OP_SHAPES: OpShape[] = ['SIN', 'SW2', 'SW3', 'SW4', 'SW5', 'SW6', 'TRI', 'SAW', 'SQU', 'PUL', 'IMP', 'NOISE'];

/**
 * The M8's twelve FM routings for operators A–D (manual p. 59): `>` modulates, `+` mixes.
 * The last one is "additive mode".
 */
export const FM_ALGOS = [
  'A>B>C>D',
  '[A+B]>C>D',
  '[A>B+C]>D',
  '[A>B+A>C]>D',
  '[A+B+C]>D',
  '[A>B>C]+D',
  '[A>B>C]+[A>B>D]',
  '[A>B]+[C>D]',
  '[A>B]+[A>C]+[A>D]',
  '[A>B]+[A>C]+D',
  '[A>B]+C+D',
  'A+B+C+D',
] as const;

/**
 * The M8's play modes, then two Polyend ones. The OSC modes loop the whole sample like an
 * oscillator, ignore START and carry on from where they are when retriggered (OSC forward,
 * OSC REV backward, OSC PP back and forth). REPITCH plays forward at the rate that fits
 * the whole sample into STEPS sixteenths at the current tempo.
 * WAVETABLE (Polyend) plays the sample as 2048-sample single cycles, START picks the cycle;
 * GRANULAR (Polyend) sprays grains: START = position, LOOP ST = grain size, LENGTH = spread.
 */
export type SamplePlay =
  | 'FWD'
  | 'REV'
  | 'FWDLOOP'
  | 'REVLOOP'
  | 'FWD PP'
  | 'REV PP'
  | 'OSC'
  | 'OSC REV'
  | 'OSC PP'
  | 'REPITCH'
  | 'WAVETABLE'
  | 'GRANULAR';
export const SAMPLE_PLAYS: SamplePlay[] = ['FWD', 'REV', 'FWDLOOP', 'REVLOOP', 'FWD PP', 'REV PP', 'OSC', 'OSC REV', 'OSC PP', 'REPITCH', 'WAVETABLE', 'GRANULAR'];

/**
 * TRACK = the M8's Tracking mod (note or velocity sets the destination per note).
 * DRUM = drum envelope: PEAK (attack field: transient duck amount/time), BODY (hold), DECAY.
 * TRIG = trig envelope: a bipolar AHD fired when another source plays (`src`).
 */
export type ModType = 'OFF' | 'AHD' | 'ADSR' | 'DRUM' | 'LFO' | 'TRIG' | 'TRACK';
export const MOD_TYPES: ModType[] = ['OFF', 'AHD', 'ADSR', 'DRUM', 'LFO', 'TRIG', 'TRACK'];
export type TrackSource = 'NOTE' | 'VEL';
export const TRACK_SOURCES: TrackSource[] = ['NOTE', 'VEL'];
/**
 * Mod destinations: the generic ones every sounding type has, the three sends, and per-type
 * ones (M8: each instrument type offers its own parameters as destinations).
 */
export type ModDest =
  | 'VOLUME'
  | 'PITCH'
  | 'CUTOFF'
  | 'RES'
  | 'PAN'
  | 'AMP'
  | 'CHO'
  | 'DEL'
  | 'REV'
  | 'SCAN'
  | 'WARP'
  | 'SIZE'
  | 'OP A'
  | 'OP B'
  | 'OP C'
  | 'OP D'
  | 'SWARM'
  | 'MULT'
  | 'START'
  | 'LOOP'
  | 'LENGTH';
export const MOD_DESTS: ModDest[] = ['VOLUME', 'PITCH', 'CUTOFF', 'RES', 'PAN', 'AMP', 'CHO', 'DEL', 'REV', 'SCAN', 'WARP', 'SIZE', 'OP A', 'OP B', 'OP C', 'OP D', 'SWARM', 'MULT', 'START', 'LOOP', 'LENGTH'];
/** Which destinations belong to which instrument type (the rest work for every type). */
export const MOD_DESTS_FOR: Partial<Record<ModDest, InstrumentType>> = {
  SCAN: 'WAVSYNTH',
  WARP: 'WAVSYNTH',
  SIZE: 'WAVSYNTH',
  'OP A': 'FMSYNTH',
  'OP B': 'FMSYNTH',
  'OP C': 'FMSYNTH',
  'OP D': 'FMSYNTH',
  SWARM: 'HYPERSYNTH',
  MULT: 'WAVSYNTH',
  // Sampler positions are read when the note starts (a sample can't be re-cued mid-note).
  START: 'SAMPLER',
  LOOP: 'SAMPLER',
  LENGTH: 'SAMPLER',
};
/** SAW ramps up, RAMP ramps down (M8 RAMP UP / RAMP DN); RANDOM is sample and hold. */
export type LfoShape =
  | 'TRI'
  | 'SIN'
  | 'SQR'
  | 'SAW'
  | 'RAMP'
  | 'EXP DN'
  | 'EXP UP'
  | 'SQU UP'
  | 'SQU DN'
  | 'RANDOM'
  | 'DRUNK';
export const LFO_SHAPES: LfoShape[] = ['TRI', 'SIN', 'SQR', 'SAW', 'RAMP', 'EXP DN', 'EXP UP', 'SQU UP', 'SQU DN', 'RANDOM', 'DRUNK'];
/** M8: FREE loops without reset, RETRIG resets per note, HOLD stops on the last value, ONCE plays one cycle and returns to the start. */
export type LfoTrig = 'FREE' | 'RETRIG' | 'HOLD' | 'ONCE';
export const LFO_TRIGS: LfoTrig[] = ['FREE', 'RETRIG', 'HOLD', 'ONCE'];

export interface Mod {
  type: ModType;
  dest: ModDest;
  /** Signed -128..127. */
  amt: number;
  /** Envelope times 0–255, roughly exponential from 0 to ~10 s. */
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
  lfoShape: LfoShape;
  lfoTrig: LfoTrig;
  /**
   * LFO rate, tempo-synced as on the M8: one cycle lasts 2^((255 − freq) / 32) steps, so
   * FF = 1 step, DF = 2 steps, BF = 4 steps … 00 = 250 steps.
   */
  freq: number;
  /** TRACK mods: what drives the destination. */
  source: TrackSource;
  /** TRIG mods: instrument 00–7F, or 80–87 for anything on tracks 1–8. */
  src: number;
}

export type EqType = 'LOWCUT' | 'LOWSHELF' | 'BELL' | 'BANDPASS' | 'HI.SHELF' | 'HI.CUT' | 'ALLPASS';
export const EQ_TYPES: EqType[] = ['LOWCUT', 'LOWSHELF', 'BELL', 'BANDPASS', 'HI.SHELF', 'HI.CUT', 'ALLPASS'];
export type EqMode = 'STEREO' | 'MID' | 'SIDE' | 'LEFT' | 'RIGHT';
export const EQ_MODES: EqMode[] = ['STEREO', 'MID', 'SIDE', 'LEFT', 'RIGHT'];

/**
 * One EQ band (M8): FREQ 00–FF = 20 Hz–20 kHz (log), GAIN 80 = 0 dB (±18 dB),
 * Q 00–FF = 0.1–10 (log).
 */
export interface EqBand {
  type: EqType;
  freq: number;
  gain: number;
  q: number;
  mode: EqMode;
}

/** An EQ slot: three identical bands, named LOW / MID / HIGH after their defaults. */
export interface Eq {
  bands: EqBand[];
  muted: boolean;
}

export const EQ_SLOTS = 128;

export interface FmOperator {
  shape: OpShape;
  /** Self-feedback 0–255 (M8 LEV/FB). */
  feedback: number;
  /** Frequency ratio ×100 (100 = 1.00). */
  ratio: number;
  level: number;
  /** Per-operator decay; 0 = sustain at level. */
  decay: number;
}

export interface Instrument {
  type: InstrumentType;
  name: string;
  /** Follow the project transpose. */
  transpose: boolean;
  /** Ticks per table row, 1 = every tick. */
  tableTic: number;
  /** Signed cents. */
  fine: number;
  filter: FilterType;
  cutoff: number;
  res: number;
  amp: number;
  lim: LimiterType;
  pan: number;
  dry: number;
  cho: number;
  del: number;
  rev: number;
  /** EQ slot (00–7F) shared through the project's EQ bank, or null for none. */
  eq: number | null;
  mods: Mod[];
  /** SCAN mirrors the cycle at a position, 0–200% (M8). */
  wav: { shape: WaveShape; size: number; mult: number; warp: number; scan: number };
  fm: { algo: number; ops: FmOperator[] };
  /**
   * DETUNE 80 = in tune, (v − 80) sixteenths of a semitone (first digit semitones, second
   * 1/16). DEGRADE 00 = clean, higher = lower sample rate. STEPS (REPITCH) = the whole
   * sample's length in sixteenth steps, 01–FF.
   */
  sampler: {
    sample: string | null;
    play: SamplePlay;
    start: number;
    loop: number;
    length: number;
    slices: number;
    detune: number;
    degrade: number;
    steps: number;
  };
  /**
   * Up to six chord notes. SHIFT cross-fades notes 1–3 (00) against 4–6 (FF), 80 = both at
   * full. SUBOSC: 00 off, 01–7F a square two octaves below, 80–FF one octave below, louder
   * towards the top of each half.
   */
  hyper: { chord: number[]; swarm: number; width: number; shape: 'SAW' | 'SQR'; shift: number; subosc: number };
  midi: { channel: number; program: number | null };
}

export interface Mixer {
  tracks: number[];
  mute: boolean[];
  solo: boolean[];
  cho: number;
  del: number;
  rev: number;
  master: number;
  /** 0x80 is off, lower is low-pass, higher is high-pass. */
  djf: number;
  djfRes: number;
  /** 0 low-pass/high-pass, 1 low-pass/band-stop, 2 band-stop/high-pass. */
  djType: number;
  limit: number;
  /** Main mix EQ slot, before the limiter, or null. */
  eq: number | null;
}

export interface Effects {
  chorus: { depth: number; rate: number; width: number; rev: number };
  /** Reverb modulation (XRM depth, XRF frequency) lives with the reverb settings. */
  /** Delay times are in ticks, so they follow the tempo. */
  delay: { timeL: number; timeR: number; feedback: number; width: number; rev: number };
  reverb: { size: number; damp: number; width: number; modDepth: number; modFreq: number };
}

export type ScaleName =
  | 'CHROMATIC'
  | 'MAJOR'
  | 'MINOR'
  | 'DORIAN'
  | 'PHRYGIAN'
  | 'MIXOLYDIAN'
  | 'HARM MINOR'
  | 'PENTA MAJ'
  | 'PENTA MIN'
  | 'BLUES';

/** A built-in scale, or one of the 16 user scales ("USER 0" … "USER F"). */
export type ScaleRef = ScaleName | `USER ${string}`;

/** M8 Scale view: which of the 12 notes are in, and a tuning offset per note in cents. */
export interface UserScale {
  name: string;
  notes: boolean[];
  /** Signed cents, −100…+100, per note of the octave from the root. */
  tune: number[];
}

export interface Settings {
  /** Polyend shows decimal, M8 shows hex. */
  hex: boolean;
  scale: ScaleRef;
  scaleRoot: number;
  /** Rows the cursor moves after a note is entered (Polyend "step jump"). */
  stepJump: number;
  /** Octave for the computer-keyboard piano. */
  octave: number;
  midiOut: string | null;
  /** Live mode: when a cued chain takes over. */
  liveQuant: 'CHAIN' | 'BAR' | 'BEAT';
}

export interface SampleMeta {
  name: string;
  builtin: boolean;
}

export interface Project {
  /** 2: velocities 00–7F (M8). 3: the M8's twelve FM algorithms. */
  version: 3;
  name: string;
  tempo: number;
  /** Signed semitones applied to instruments with `transpose` on. */
  transpose: number;
  song: (number | null)[][];
  chains: Record<number, Chain>;
  phrases: Record<number, Phrase>;
  instruments: Record<number, Instrument>;
  tables: Record<number, Table>;
  grooves: Record<number, Groove>;
  mixer: Mixer;
  effects: Effects;
  settings: Settings;
  samples: Record<string, SampleMeta>;
  /** Song-screen bookmarks: chain numbers marked with OPTION × 3. */
  bookmarks: number[];
  /** The Scale view's 16 user scales. */
  scales: UserScale[];
  /** 128 EQ slots, assigned to instruments and the main mix by number (M8). */
  eqs: Eq[];
}
