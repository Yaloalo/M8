/**
 * The parameter screens (instrument, mods, mixer, effects, project) as lists of typed
 * fields. Same idea as grids.ts: one editor, many screens.
 */
import { defaultInstrument } from './factory';
import { ALL_SCALES, byte, signed, NOTE_NAMES } from './format';
import {
  filterFor,
  filterTypesFor,
  FM_ALGOS,
  INSTRUMENT_TYPES,
  LFO_SHAPES,
  LFO_TRIGS,
  LIMITER_TYPES,
  MOD_DESTS,
  MOD_DESTS_FOR,
  MOD_TYPES,
  OP_SHAPES,
  SAMPLE_PLAYS,
  TRACKS,
  TRACK_SOURCES,
  WAVE_SHAPES,
  EQ_MODES,
  EQ_SLOTS,
  EQ_TYPES,
  type Instrument,
  type InstrumentType,
  type Project,
} from './types';

export type FieldType = 'byte' | 'signed' | 'enum' | 'bool' | 'text' | 'number';
export type FieldValue = number | string | boolean;

export interface Field {
  key: string;
  label: string;
  group: string;
  type: FieldType;
  options?: readonly string[];
  min?: number;
  max?: number;
  /** Coarse step for EDIT + up/down. */
  coarse?: number;
  get(p: Project, id: number): FieldValue;
  set(p: Project, id: number, v: FieldValue): void;
  format?(v: FieldValue, hex: boolean): string;
}

export function formatField(f: Field, v: FieldValue, hex: boolean): string {
  if (f.format) return f.format(v, hex);
  switch (f.type) {
    case 'byte':
      return byte(v as number, hex);
    case 'signed':
      return signed(v as number, hex);
    case 'bool':
      return v ? 'ON' : 'OFF';
    default:
      return String(v);
  }
}

/** EDIT + left/right (fine) or up/down (coarse) on a field. */
export function nudgeField(f: Field, v: FieldValue, coarse: boolean, dir: 1 | -1): FieldValue {
  switch (f.type) {
    case 'enum': {
      const opts = f.options!;
      const i = opts.indexOf(v as string);
      return opts[Math.max(0, Math.min(opts.length - 1, i + dir))];
    }
    case 'bool':
      return !v;
    case 'text':
      return v;
    default: {
      const lo = f.min ?? (f.type === 'signed' ? -128 : 0);
      const hi = f.max ?? (f.type === 'signed' ? 127 : 255);
      const step = coarse ? (f.coarse ?? 16) : 1;
      return Math.max(lo, Math.min(hi, (v as number) + dir * step));
    }
  }
}

// ------------------------------------------------------------------- instrument

const inst = (p: Project, id: number): Instrument => p.instruments[id] ?? defaultInstrument();
const draftInst = (p: Project, id: number): Instrument => (p.instruments[id] ??= defaultInstrument());

type InstPath = (i: Instrument) => Record<string, unknown>;

function instField(
  group: string,
  label: string,
  path: InstPath,
  key: string,
  type: FieldType,
  extra: Partial<Field> = {},
): Field {
  return {
    key: `${group}.${key}`,
    label,
    group,
    type,
    get: (p, id) => path(inst(p, id))[key] as FieldValue,
    set: (p, id, v) => {
      path(draftInst(p, id))[key] = v;
    },
    ...extra,
  };
}

const top: InstPath = (i) => i as unknown as Record<string, unknown>;
const wav: InstPath = (i) => i.wav;
const smp: InstPath = (i) => i.sampler;
const hyp: InstPath = (i) => i.hyper;
const midi: InstPath = (i) => i.midi;
const fmp: InstPath = (i) => i.fm;
const op = (n: number): InstPath => (i) => i.fm.ops[n] as unknown as Record<string, unknown>;

const ratio = (v: FieldValue) => ((v as number) / 100).toFixed(2);
/** DETUNE as the M8 counts it: 80 in tune, (v − 80) sixteenths of a semitone. */
const detuneLabel = (v: FieldValue, hex: boolean) => {
  const st = ((v as number) - 0x80) / 16;
  return `${byte(v as number, hex)} ${st < 0 ? '-' : '+'}${Math.abs(st).toFixed(2)}`;
};
const stepsLabel = (v: FieldValue, hex: boolean) => (hex ? `${byte(v as number, true)} ${v} ST` : `${v} ST`);
const subLabel = (v: FieldValue, hex: boolean) =>
  (v as number) === 0 ? `${byte(0, hex)} OFF` : `${byte(v as number, hex)} ${(v as number) < 0x80 ? '-2' : '-1'} OCT`;
const noteLabel = (v: number) => NOTE_NAMES[v % 12].replace('-', '');

export function instrumentFields(p: Project, id: number, samples: string[]): Field[] {
  const i = inst(p, id);
  const common: Field[] = [
    instField('INSTRUMENT', 'TYPE', top, 'type', 'enum', { options: INSTRUMENT_TYPES }),
    instField('INSTRUMENT', 'NAME', top, 'name', 'text'),
    instField('INSTRUMENT', 'TRANSP', top, 'transpose', 'bool'),
    instField('INSTRUMENT', 'TBL TIC', top, 'tableTic', 'byte', { min: 1 }),
    instField('INSTRUMENT', 'FINE', top, 'fine', 'signed'),
  ];
  const specific: Field[] = [];
  switch (i.type) {
    case 'WAVSYNTH':
      specific.push(
        instField('WAVSYNTH', 'SHAPE', wav, 'shape', 'enum', { options: WAVE_SHAPES }),
        instField('WAVSYNTH', 'SIZE', wav, 'size', 'byte'),
        instField('WAVSYNTH', 'MULT', wav, 'mult', 'byte'),
        instField('WAVSYNTH', 'WARP', wav, 'warp', 'byte'),
        instField('WAVSYNTH', 'SCAN', wav, 'scan', 'byte'),
      );
      break;
    case 'FMSYNTH':
      specific.push({
        ...instField('FMSYNTH', 'ALGO', fmp, 'algo', 'number', { min: 0, max: FM_ALGOS.length - 1, coarse: 1 }),
        format: (v) => `${String(v).padStart(2, '0')} ${FM_ALGOS[v as number]}`,
      });
      for (let n = 0; n < 4; n++) {
        const g = `OPERATOR ${'ABCD'[n]}`;
        specific.push(
          instField(g, 'SHAPE', op(n), 'shape', 'enum', { options: OP_SHAPES, key: `op${n}.shape` }),
          instField(g, 'RATIO', op(n), 'ratio', 'number', { min: 25, max: 1600, coarse: 100, format: ratio, key: `op${n}.ratio` }),
          instField(g, 'LEVEL', op(n), 'level', 'byte', { key: `op${n}.level` }),
          instField(g, 'FEEDBACK', op(n), 'feedback', 'byte', { key: `op${n}.feedback` }),
          instField(g, 'DECAY', op(n), 'decay', 'byte', { key: `op${n}.decay` }),
        );
      }
      break;
    case 'SAMPLER':
      specific.push(
        {
          key: 'sampler.sample',
          label: 'SAMPLE',
          group: 'SAMPLER',
          type: 'enum',
          options: ['(NONE)', ...samples],
          get: (pp, iid) => inst(pp, iid).sampler.sample ?? '(NONE)',
          set: (pp, iid, v) => {
            draftInst(pp, iid).sampler.sample = v === '(NONE)' ? null : (v as string);
          },
          format: (v) => (v === '(NONE)' ? '(NONE)' : (p.samples[v as string]?.name ?? String(v))),
        },
        instField('SAMPLER', 'PLAY', smp, 'play', 'enum', { options: SAMPLE_PLAYS }),
        // REPITCH: the sample's length in steps sets its rate at the song tempo.
        ...(i.sampler.play === 'REPITCH' ? [instField('SAMPLER', 'STEPS', smp, 'steps', 'byte', { min: 1, format: stepsLabel })] : []),
        // WAVETABLE and GRANULAR (Polyend) reuse the three range fields under their own names.
        instField('SAMPLER', i.sampler.play === 'WAVETABLE' || i.sampler.play === 'GRANULAR' ? 'POSITION' : 'START', smp, 'start', 'byte'),
        ...(i.sampler.play === 'WAVETABLE'
          ? []
          : [
              instField('SAMPLER', i.sampler.play === 'GRANULAR' ? 'GRAIN' : 'LOOP ST', smp, 'loop', 'byte'),
              instField('SAMPLER', i.sampler.play === 'GRANULAR' ? 'SPREAD' : 'LENGTH', smp, 'length', 'byte'),
            ]),
        instField('SAMPLER', 'DETUNE', smp, 'detune', 'byte', { format: detuneLabel }),
        // A wavetable plays single cycles as an oscillator: there is no sample rate to drop.
        ...(i.sampler.play === 'WAVETABLE' ? [] : [instField('SAMPLER', 'DEGRADE', smp, 'degrade', 'byte')]),
        instField('SAMPLER', 'SLICES', smp, 'slices', 'byte', { max: 64 }),
      );
      break;
    case 'HYPERSYNTH':
      specific.push(
        instField('HYPERSYNTH', 'SHAPE', hyp, 'shape', 'enum', { options: ['SAW', 'SQR'] }),
        ...[0, 1, 2, 3, 4, 5].map(
          (n): Field => ({
            key: `hyper.chord${n}`,
            label: `NOTE ${n + 1}`,
            group: 'HYPERSYNTH',
            type: 'number',
            min: -1,
            max: 24,
            coarse: 12,
            get: (pp, iid) => inst(pp, iid).hyper.chord[n] ?? -1,
            set: (pp, iid, v) => {
              // -1 marks an unused slot, so the other notes keep their positions.
              const ch = [...draftInst(pp, iid).hyper.chord];
              while (ch.length <= n) ch.push(-1);
              ch[n] = v as number;
              draftInst(pp, iid).hyper.chord = ch;
            },
            format: (v) => ((v as number) < 0 ? '--' : `+${String(v).padStart(2, '0')}`),
          }),
        ),
        instField('HYPERSYNTH', 'SHIFT', hyp, 'shift', 'byte'),
        instField('HYPERSYNTH', 'SWARM', hyp, 'swarm', 'byte'),
        instField('HYPERSYNTH', 'WIDTH', hyp, 'width', 'byte'),
        instField('HYPERSYNTH', 'SUBOSC', hyp, 'subosc', 'byte', { format: subLabel }),
      );
      break;
    case 'MIDIOUT':
      specific.push(
        instField('MIDI OUT', 'CHANNEL', midi, 'channel', 'number', { min: 0, max: 15, coarse: 4, format: (v) => String((v as number) + 1).padStart(2, '0') }),
        {
          key: 'midi.program',
          label: 'PROGRAM',
          group: 'MIDI OUT',
          type: 'number',
          min: -1,
          max: 127,
          get: (pp, iid) => inst(pp, iid).midi.program ?? -1,
          set: (pp, iid, v) => {
            draftInst(pp, iid).midi.program = (v as number) < 0 ? null : (v as number);
          },
          format: (v, hex) => ((v as number) < 0 ? '--' : byte(v as number, hex)),
        },
      );
      break;
  }
  const sound: Field[] =
    i.type === 'MIDIOUT' || i.type === 'NONE'
      ? []
      : [
          // WAV LP/HP/BP/BS only on the Wavsynth; a WAV type kept from one shows (and
          // plays) as its nearest ordinary type.
          instField('FILTER', 'FILTER', top, 'filter', 'enum', {
            options: filterTypesFor(i.type),
            get: (pp, iid) => filterFor(inst(pp, iid).type, inst(pp, iid).filter),
          }),
          instField('FILTER', 'CUTOFF', top, 'cutoff', 'byte'),
          instField('FILTER', 'RES', top, 'res', 'byte'),
          instField('AMP', 'AMP', top, 'amp', 'byte'),
          instField('AMP', 'LIM', top, 'lim', 'enum', { options: LIMITER_TYPES }),
          instField('MIXER', 'PAN', top, 'pan', 'byte'),
          instField('MIXER', 'DRY', top, 'dry', 'byte'),
          instField('MIXER', 'CHO', top, 'cho', 'byte'),
          instField('MIXER', 'DEL', top, 'del', 'byte'),
          instField('MIXER', 'REV', top, 'rev', 'byte'),
          eqSlotField('EQ', (pp, iid) => inst(pp, iid).eq, (pp, iid, v) => {
            draftInst(pp, iid).eq = v;
          }),
        ];
  return [...common, ...specific, ...sound];
}

/** LFO rate as the M8 shows it: the length of one cycle in steps. */
const lfoSteps = (v: FieldValue) => {
  const steps = 2 ** ((255 - (v as number)) / 32);
  return `${byte(v as number, true)} ${steps < 10 ? steps.toFixed(2) : steps.toFixed(1)} ST`;
};
const ticks = (v: FieldValue, hex: boolean) => `${byte(v as number, hex)} ${v ? `${v} TIC` : 'NOW'}`;

/** Only the fields a slot's type uses, like the M8 mod screen. */
export function modFields(p?: Project, id = 0): Field[] {
  const fields = allModFields(p ? inst(p, id).type : 'NONE');
  if (!p) return fields;
  return fields
    .filter((f) => modFieldRelevant(p, id, f))
    .map((f) => {
      // The drum envelope names its stages PEAK and BODY on the M8.
      const drum = inst(p, id).mods[Number(f.key[3])].type === 'DRUM';
      if (drum && f.label === 'ATTACK') return { ...f, label: 'PEAK' };
      if (drum && f.label === 'HOLD') return { ...f, label: 'BODY' };
      return f;
    });
}

function allModFields(type: InstrumentType = 'NONE'): Field[] {
  const fields: Field[] = [];
  for (let n = 0; n < 4; n++) {
    const g = `MOD ${n + 1}`;
    const m: InstPath = (i) => i.mods[n] as unknown as Record<string, unknown>;
    const f = (label: string, key: string, type: FieldType, extra: Partial<Field> = {}) =>
      instField(g, label, m, key, type, { ...extra, key: `mod${n}.${key}` });
    fields.push(
      f('TYPE', 'type', 'enum', { options: MOD_TYPES }),
      f('DEST', 'dest', 'enum', { options: MOD_DESTS.filter((d) => !MOD_DESTS_FOR[d] || MOD_DESTS_FOR[d] === type) }),
      f('AMT', 'amt', 'signed'),
      f('SOURCE', 'source', 'enum', { options: TRACK_SOURCES }),
      f('SRC', 'src', 'byte', { max: 0x87, format: (v, hex) => ((v as number) >= 0x80 ? `TRACK ${(v as number) - 0x7f}` : `INST ${byte(v as number, hex)}`) }),
      f('ATTACK', 'attack', 'byte', { format: ticks }),
      f('HOLD', 'hold', 'byte', { format: ticks }),
      f('DECAY', 'decay', 'byte', { format: ticks }),
      f('SUSTAIN', 'sustain', 'byte'),
      f('RELEASE', 'release', 'byte', { format: ticks }),
      f('LFO SHAPE', 'lfoShape', 'enum', { options: LFO_SHAPES }),
      f('LFO TRIG', 'lfoTrig', 'enum', { options: LFO_TRIGS }),
      f('FREQ', 'freq', 'byte', { format: lfoSteps }),
    );
  }
  return fields;
}

/** Which mod fields matter for the slot's type, so the screen can dim the rest. */
export function modFieldRelevant(p: Project, id: number, f: Field): boolean {
  const n = Number(f.key[3]);
  const m = inst(p, id).mods[n];
  const k = f.key.split('.')[1];
  if (k === 'type') return true;
  if (m.type === 'OFF') return false;
  if (['dest', 'amt'].includes(k)) return true;
  if (m.type === 'AHD') return ['attack', 'hold', 'decay'].includes(k);
  if (m.type === 'ADSR') return ['attack', 'decay', 'sustain', 'release'].includes(k);
  if (m.type === 'TRACK') return k === 'source';
  if (m.type === 'DRUM') return ['attack', 'hold', 'decay'].includes(k);
  if (m.type === 'TRIG') return ['src', 'attack', 'hold', 'decay'].includes(k);
  return ['lfoShape', 'lfoTrig', 'freq'].includes(k);
}

/** EQ slot reference: -1 in the field means "none". */
function eqSlotField(group: string, read: (p: Project, id: number) => number | null, write: (p: Project, id: number, v: number | null) => void): Field {
  return {
    key: `${group}.eq`,
    label: 'EQ',
    group,
    type: 'number',
    min: -1,
    max: EQ_SLOTS - 1,
    coarse: 16,
    get: (p, id) => read(p, id) ?? -1,
    set: (p, id, v) => write(p, id, (v as number) < 0 ? null : (v as number)),
    format: (v, hex) => ((v as number) < 0 ? '--' : byte(v as number, hex)),
  };
}

const eqHz = (v: FieldValue) => {
  const f = 20 * 1000 ** ((v as number) / 255);
  return f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)}kHz` : `${Math.round(f)}Hz`;
};
const eqDb = (v: FieldValue) => {
  const d = (((v as number) - 0x80) / 0x80) * 18;
  return `${d > 0 ? '+' : ''}${d.toFixed(1)}dB`;
};
const eqQ = (v: FieldValue) => (0.1 * 100 ** ((v as number) / 255)).toFixed(2);

/** The EQ editor: one slot of the bank, three identical bands. */
export function eqFields(n: number): Field[] {
  const eq = (p: Project) => p.eqs[n];
  const fields: Field[] = [
    {
      key: 'eq.muted',
      label: 'BYPASS',
      group: `EQ ${byte(n, true)}`,
      type: 'bool',
      get: (p) => eq(p).muted,
      set: (p, _id, v) => {
        eq(p).muted = !!v;
      },
      format: (v) => (v ? 'BYPASSED' : 'OFF'),
    },
  ];
  ['LOW', 'MID', 'HIGH'].forEach((name, b) => {
    const band = (p: Project) => eq(p).bands[b] as unknown as Record<string, unknown>;
    const f = (label: string, key: string, type: FieldType, extra: Partial<Field> = {}): Field => ({
      key: `eq.${b}.${key}`,
      label,
      group: name,
      type,
      get: (p) => band(p)[key] as FieldValue,
      set: (p, _id, v) => {
        band(p)[key] = v;
      },
      ...extra,
    });
    fields.push(
      f('TYPE', 'type', 'enum', { options: EQ_TYPES }),
      f('FREQ', 'freq', 'byte', { format: eqHz }),
      f('GAIN', 'gain', 'byte', { format: eqDb }),
      f('Q', 'q', 'byte', { format: eqQ }),
      f('MODE', 'mode', 'enum', { options: EQ_MODES }),
    );
  });
  return fields;
}

// ------------------------------------------------------------------- mixer, effects, project

const rec = (o: object) => o as Record<string, unknown>;

function projField(
  group: string,
  label: string,
  path: (p: Project) => Record<string, unknown>,
  key: string,
  type: FieldType,
  extra: Partial<Field> = {},
): Field {
  return {
    key: `${group}.${label}`,
    label,
    group,
    type,
    get: (p) => path(p)[key] as FieldValue,
    set: (p, _id, v) => {
      path(p)[key] = v;
    },
    ...extra,
  };
}

export function mixerFields(): Field[] {
  const tracks = Array.from({ length: TRACKS }, (_, t) =>
    projField('TRACKS', `TRACK ${t + 1}`, (p) => rec(p.mixer.tracks), String(t), 'byte'),
  );
  return [
    ...tracks,
    projField('RETURNS', 'CHORUS', (p) => rec(p.mixer), 'cho', 'byte'),
    projField('RETURNS', 'DELAY', (p) => rec(p.mixer), 'del', 'byte'),
    projField('RETURNS', 'REVERB', (p) => rec(p.mixer), 'rev', 'byte'),
    projField('MASTER', 'DJ FILTER', (p) => rec(p.mixer), 'djf', 'byte'),
    projField('MASTER', 'DJ RES', (p) => rec(p.mixer), 'djfRes', 'byte'),
    projField('MASTER', 'DJ TYPE', (p) => rec(p.mixer), 'djType', 'number', { min: 0, max: 2, coarse: 1, format: (v) => ['LP/HP', 'LP/BS', 'BS/HP'][v as number] }),
    projField('MASTER', 'LIMIT', (p) => rec(p.mixer), 'limit', 'byte'),
    projField('MASTER', 'VOLUME', (p) => rec(p.mixer), 'master', 'byte'),
    {
      ...eqSlotField('MASTER', (p) => p.mixer.eq, (p, _id, v) => {
        p.mixer.eq = v;
      }),
      label: 'MAIN EQ',
    },
  ];
}

export function effectFields(): Field[] {
  const ch = (p: Project) => rec(p.effects.chorus);
  const dl = (p: Project) => rec(p.effects.delay);
  const rv = (p: Project) => rec(p.effects.reverb);
  return [
    projField('CHORUS', 'MOD DEPTH', ch, 'depth', 'byte'),
    projField('CHORUS', 'MOD FREQ', ch, 'rate', 'byte'),
    projField('CHORUS', 'WIDTH', ch, 'width', 'byte'),
    projField('CHORUS', 'REVERB SEND', ch, 'rev', 'byte'),
    projField('DELAY (TICKS)', 'TIME L', dl, 'timeL', 'byte', { min: 1 }),
    projField('DELAY (TICKS)', 'TIME R', dl, 'timeR', 'byte', { min: 1 }),
    projField('DELAY (TICKS)', 'FEEDBACK', dl, 'feedback', 'byte'),
    projField('DELAY (TICKS)', 'WIDTH', dl, 'width', 'byte'),
    projField('DELAY (TICKS)', 'REVERB SEND', dl, 'rev', 'byte'),
    projField('REVERB', 'SIZE', rv, 'size', 'byte'),
    projField('REVERB', 'DAMPING', rv, 'damp', 'byte'),
    projField('REVERB', 'WIDTH', rv, 'width', 'byte'),
    projField('REVERB', 'MOD DEPTH', rv, 'modDepth', 'byte'),
    projField('REVERB', 'MOD FREQ', rv, 'modFreq', 'byte'),
  ];
}

export function projectFields(midiOutputs: string[]): Field[] {
  const s = (p: Project) => rec(p.settings);
  const root = (p: Project) => rec(p);
  return [
    projField('PROJECT', 'NAME', root, 'name', 'text'),
    projField('PROJECT', 'TEMPO', root, 'tempo', 'number', { min: 20, max: 300, coarse: 10, format: (v) => `${v} BPM` }),
    projField('PROJECT', 'TRANSPOSE', root, 'transpose', 'signed', { min: -48, max: 48, coarse: 12, format: (v) => signed(v as number, false) }),
    projField('DISPLAY', 'NUMBERS', s, 'hex', 'bool', { format: (v) => (v ? 'HEX (M8)' : 'DEC (POLYEND)') }),
    projField('KEYS', 'SCALE', s, 'scale', 'enum', { options: ALL_SCALES }),
    projField('KEYS', 'ROOT', s, 'scaleRoot', 'number', { min: 0, max: 11, coarse: 7, format: (v) => noteLabel(v as number) }),
    projField('KEYS', 'OCTAVE', s, 'octave', 'number', { min: 0, max: 8, coarse: 1 }),
    projField('KEYS', 'STEP JUMP', s, 'stepJump', 'number', { min: 0, max: 16, coarse: 4 }),
    projField('LIVE', 'LIVE QUANT', s, 'liveQuant', 'enum', { options: ['CHAIN', 'BAR', 'BEAT'] }),
    {
      key: 'PROJECT.MIDI',
      label: 'MIDI OUT',
      group: 'MIDI',
      type: 'enum',
      options: ['(NONE)', ...midiOutputs],
      get: (p) => p.settings.midiOut ?? '(NONE)',
      set: (p, _id, v) => {
        p.settings.midiOut = v === '(NONE)' ? null : (v as string);
      },
    },
  ];
}

/** M8 Scale view: one user scale's name, the 12 notes it uses and each note's tuning. */
export function scaleFields(p: Project, n: number): Field[] {
  const root = p.settings.scaleRoot;
  const sc = (pp: Project) => pp.scales[n];
  const fields: Field[] = [
    {
      key: 'scale.name',
      label: 'NAME',
      group: 'NOTES',
      type: 'text',
      get: (pp) => sc(pp).name,
      set: (pp, _id, v) => {
        sc(pp).name = String(v).slice(0, 12);
      },
    },
  ];
  const tuning: Field[] = [];
  for (let k = 0; k < 12; k++) {
    const note = NOTE_NAMES[(root + k) % 12].replace('-', '');
    fields.push({
        key: `scale.on${k}`,
        label: `${note} ${k === 0 ? '(ROOT)' : ''}`.trim(),
        group: 'NOTES',
        type: 'bool',
        get: (pp) => sc(pp).notes[k],
        set: (pp, _id, v) => {
          sc(pp).notes[k] = !!v;
        },
        format: (v) => (v ? 'ON' : '--'),
    });
    tuning.push({
        key: `scale.tune${k}`,
        label: `${note} TUNE`,
        group: 'TUNING (CENTS)',
        type: 'number',
        min: -100,
        max: 100,
        coarse: 10,
        get: (pp) => sc(pp).tune[k],
        set: (pp, _id, v) => {
          sc(pp).tune[k] = v as number;
        },
        format: (v) => `${(v as number) > 0 ? '+' : ''}${v}`,
    });
  }
  return [...fields, ...tuning];
}

// ------------------------------------------------------------------- help

/** One line per parameter, shown in the inspector (after the M8 manual's descriptions). */
const HELP: [RegExp, string][] = [
  [/^INSTRUMENT\.type$/, 'The sound engine. Changing it keeps the other settings for when you switch back.'],
  [/^INSTRUMENT\.transpose$/, 'ON: follows the project TRANSPOSE and TSP. Turn off for drums.'],
  [/^INSTRUMENT\.tableTic$/, 'Ticks per table row. 01 every tick, 00 one row per note, FC–FE maps, FF 200 rows/s.'],
  [/^INSTRUMENT\.fine$/, 'Fine tune in cents.'],
  [/^WAVSYNTH\.shape$/, 'Base shape, noise, or a wave table (WT) whose frame SCAN picks.'],
  [/^WAVSYNTH\.size$/, 'Horizontal size of the cycle; with pulse shapes it sets how smooth PWM is.'],
  [/^WAVSYNTH\.mult$/, 'Repeats the shape inside one cycle — a hard-sync-like brightness.'],
  [/^WAVSYNTH\.warp$/, 'Pushes the shape to one side of the cycle.'],
  [/^WAVSYNTH\.scan$/, 'Basic shapes: mirror point (PWM on PULSE50). WT shapes: which of the 64 frames. Mod or SCN it to sweep.'],
  [/^FMSYNTH\.algo$/, 'How operators A–D feed each other. The last one (0B) is additive: four plain oscillators.'],
  [/^op\d\.ratio$/, 'Frequency ratio to the note: 1.00 = the note, 2.00 an octave up, 0.50 an octave down.'],
  [/^op\d\.level$/, 'Modulators: how hard they modulate (brightness). Carriers: their volume.'],
  [/^op\d\.feedback$/, 'The operator feeds itself: brighter, sine turns saw-like.'],
  [/^op\d\.decay$/, 'Ticks for the operator to die away; 00 holds. Short modulator decays make plucks and bells.'],
  [/^op\d\.shape$/, 'Operator wave. SW2–SW6 are sine variations.'],
  [/^sampler\.sample$/, 'Which sample plays. Load, record or edit samples below.'],
  [/^SAMPLER\.play$/, 'Direction and looping. REV modes start at the end: a short volume envelope ends before the attack. OSC modes loop the whole sample and carry on across notes; REPITCH follows the tempo (STEPS).'],
  [/^SAMPLER\.start$/, 'Where playback starts (00 = beginning). In WAVETABLE / GRANULAR: the position.'],
  [/^SAMPLER\.loop$/, 'Loop start for loop modes. In GRANULAR: grain size.'],
  [/^SAMPLER\.length$/, 'How much of the sample plays after START. In GRANULAR: spread.'],
  [/^SAMPLER\.slices$/, 'Cut into equal slices mapped to notes from C-1 up; notes past the last slice play it (SLI picks one).'],
  [/^SAMPLER\.steps$/, 'REPITCH: the whole sample’s length in steps (sixteenths); it plays at the rate that fits the tempo. A tempo change applies from the next note.'],
  [/^SAMPLER\.detune$/, '80 is in tune. First digit: semitones (90 one up, 70 one down); second: 1/16 semitone.'],
  [/^SAMPLER\.degrade$/, 'Sample rate reduction: 00 clean, higher holds each sample longer for a lo-fi, aliased sound.'],
  [/^HYPERSYNTH\.shift$/, 'Cross-fades notes 1–3 against notes 4–6: 00 only 1–3, 80 all six, FF only 4–6.'],
  [/^HYPERSYNTH\.subosc$/, 'Square sub-oscillator: 01–7F two octaves below, 80–FF one octave below, louder towards the top of each half. 00 off.'],
  [/^HYPERSYNTH\./, 'A chord of detuned oscillators: the notes are offsets from the played note.'],
  [/^FILTER\.filter$/, 'LP>HP: low-pass, RES sets a 6 dB/oct high-pass. ZDF LP/HP: steeper, 24 dB/oct. WAV types (Wavsynth) filter the cycle itself: the tone follows the note.'],
  [/^FILTER\.cutoff$/, 'Filter frequency (WAV types: a harmonic of the note). Mod CUTOFF with an envelope for the classic sweep.'],
  [/^FILTER\.res$/, 'Resonance: emphasis at the cutoff. On LP>HP it sets the high-pass frequency instead.'],
  [/^AMP\.amp$/, 'Drive into the limiter: 20 is clean, higher saturates.'],
  [/^AMP\.lim$/, 'How the drive is shaped: CLIP hard, SIN soft, FOLD and WRAP for harsher tones.'],
  [/^MIXER\.pan$/, 'Pan: 00 left, 80 centre, FF right.'],
  [/^MIXER\.(dry|cho|del|rev)$/, 'Dry level and the three send levels (chorus, delay, reverb).'],
  [/\.eq$/, 'EQ slot from the bank (-- none). X opens it in the EQ editor.'],
  [/^mod\d\.type$/, 'AHD / ADSR / DRUM envelopes, LFO, TRIG (fired by another track) or TRACK (note or velocity).'],
  [/^mod\d\.dest$/, 'What it moves. The list includes the parameters of this instrument type.'],
  [/^mod\d\.amt$/, 'How far and which way: 7F full up, 80 full down.'],
  [/^mod\d\.(attack|hold|decay|release)$/, 'Time in ticks (24 per beat): follows the tempo.'],
  [/^mod\d\.freq$/, 'LFO speed as cycle length in steps: FF one step, DF two, BF four…'],
  [/^mod\d\.lfoTrig$/, 'FREE runs across notes, RETRIG restarts, HOLD stops on the end value, ONCE plays one cycle.'],
  [/^mod\d\.src$/, 'TRIG source: an instrument, or everything on a track.'],
  [/^TRACKS\./, 'Track level; also scales that track’s sends.'],
  [/^MASTER\.DJ FILTER$/, '80 off; lower sweeps a low-pass, higher a high-pass (or band-stop, see DJ TYPE).'],
  [/^MASTER\.LIMIT$/, 'Main limiter drive.'],
  [/^PROJECT\.TEMPO$/, 'Beats per minute. TPO changes it from the song.'],
  [/^PROJECT\.TRANSPOSE$/, 'Transposes instruments with TRANSP on.'],
  [/^DISPLAY\.NUMBERS$/, 'Hex like the M8, or decimal like the Polyend.'],
  [/^KEYS\.SCALE$/, 'Pads, note entry (X + ←→) and Fill follow it. USER scales come from the Scales screen.'],
  [/^KEYS\.STEP JUMP$/, 'Rows the cursor moves after a note from the pads or keys.'],
  [/^INSTRUMENT\.name$/, 'Up to 16 characters, shown in the pool, the tracks list and the breadcrumb.'],
  [/^MIDI OUT\./, 'Sends notes to the MIDI output chosen on the Project screen: channel and optional program change.'],
  [/^CHORUS\./, 'The chorus send effect every instrument reaches through its CHO level.'],
  [/^DELAY \(TICKS\)\./, 'The delay send effect; times in ticks follow the tempo.'],
  [/^REVERB\./, 'The reverb send effect every instrument reaches through its REV level.'],
  [/^RETURNS\./, 'How loud each send effect comes back into the mix.'],
  [/^MASTER\./, 'The main output: DJ filter, limiter, volume and the main EQ slot.'],
  [/^eq\.muted$/, 'Bypass this EQ slot everywhere it is used (X X toggles).'],
  [/^eq\.\d\.type$/, 'Band shape: cuts, shelves, bell, band-pass or all-pass.'],
  [/^eq\.\d\.freq$/, 'Centre or corner frequency, 20 Hz–20 kHz.'],
  [/^eq\.\d\.gain$/, 'Boost or cut in dB (80 = 0 dB).'],
  [/^eq\.\d\.q$/, 'Bandwidth: higher Q is narrower.'],
  [/^eq\.\d\.mode$/, 'Which part of the stereo image the band works on.'],
  [/^scale\./, 'User scale: which notes are in, and each one’s tuning in cents (played back).'],
  [/^PROJECT\.NAME$/, 'The project name, used for exported files.'],
  [/^KEYS\.(ROOT|OCTAVE)$/, 'Scale root and the octave of the pads and the computer-keyboard piano.'],
  [/^MIDI\./, 'A Web MIDI output for MIDI OUT instruments.'],
  [/^mod\d\.(sustain|source|lfoShape)$/, 'Sustain level (ADSR), the TRACK source, or the LFO shape.'],
  [/^hyper\.chord\d$/, 'Chord note as semitones above the played note (-- unused).'],
  [/^midi\.program$/, 'Program change sent with the first note (-- none).'],
  [/^PROJECT\.MIDI$/, 'A Web MIDI output for MIDI OUT instruments.'],
  [/^LIVE\.LIVE QUANT$/, 'When a cued chain starts: at the end of the current chain, the next bar, or the next beat.'],
];

export function fieldHelp(f: Field): string | undefined {
  return HELP.find(([re]) => re.test(f.key))?.[1];
}
