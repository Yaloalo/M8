/**
 * Starting points for an instrument slot, like loading an instrument on the M8 or from the
 * Polyend instrument library. Loading keeps nothing of the slot but its table.
 */
import { defaultInstrument } from './factory';
import type { Instrument } from './types';

export interface Preset {
  name: string;
  group: 'DRUMS' | 'BASS' | 'LEAD' | 'KEYS' | 'PAD';
  make: () => Instrument;
}

/**
 * Output levels, measured so every preset sits within about ±3 dB RMS of the others
 * (drums a little lower, since their peaks are higher for the same loudness).
 */
const LEVELS: Record<string, Partial<Pick<Instrument, 'dry' | 'amp'>>> = {
  KICK: { dry: 181 },
  SNARE: { dry: 239 },
  HAT: { dry: 255, amp: 0x35 },
  OPENHAT: { dry: 192 },
  CLAP: { dry: 215 },
  FMKICK: { dry: 255, amp: 0x29 },
  NZHAT: { dry: 255, amp: 0x60 },
  SAWBASS: { dry: 255, amp: 0x33 },
  ACID: { dry: 215 },
  SUB: { dry: 127 },
  FMBASS: { dry: 223 },
  CHIP: { dry: 118 },
  FMLEAD: { dry: 100 },
  PLUCK: { dry: 255, amp: 0x4f },
  BELL: { dry: 173 },
  SUPRSAW: { dry: 72 },
  CHORDPAD: { dry: 240 },
};

function build(name: string, patch: (i: Instrument) => void): () => Instrument {
  return () => {
    const i = defaultInstrument();
    i.name = name;
    patch(i);
    Object.assign(i, LEVELS[name]);
    return i;
  };
}

const sampler = (sample: string, patch: (i: Instrument) => void = () => {}) => (i: Instrument) => {
  i.type = 'SAMPLER';
  i.sampler.sample = sample;
  i.mods[0].type = 'OFF';
  patch(i);
};

export const PRESETS: Preset[] = [
  { name: 'KICK', group: 'DRUMS', make: build('KICK', sampler('builtin:kick')) },
  { name: 'SNARE', group: 'DRUMS', make: build('SNARE', sampler('builtin:snare', (i) => (i.rev = 0x30))) },
  { name: 'HAT', group: 'DRUMS', make: build('HAT', sampler('builtin:hat')) },
  { name: 'OPEN HAT', group: 'DRUMS', make: build('OPENHAT', sampler('builtin:openhat')) },
  { name: 'CLAP', group: 'DRUMS', make: build('CLAP', sampler('builtin:clap', (i) => (i.rev = 0x40))) },
  {
    name: 'FM KICK',
    group: 'DRUMS',
    make: build('FMKICK', (i) => {
      i.type = 'FMSYNTH';
      i.fm.ops[2] = { shape: 'SIN', ratio: 150, level: 0x60, decay: 0x01, feedback: 0 };
      i.fm.ops[3] = { shape: 'SIN', ratio: 100, level: 0xff, decay: 0, feedback: 0 };
      i.mods[0] = { ...i.mods[0], decay: 0x0b };
      i.mods[2] = { ...i.mods[2], type: 'AHD', dest: 'PITCH', amt: 0x50, decay: 0x01 };
    }),
  },
  {
    name: 'NOISE HAT',
    group: 'DRUMS',
    make: build('NZHAT', (i) => {
      i.type = 'WAVSYNTH';
      i.wav.shape = 'NOISE';
      i.filter = 'HIGHPASS';
      i.cutoff = 0xc8;
      // Six ticks: the v1 → ticks conversion had squeezed this to a 20 ms click.
      i.mods[0] = { ...i.mods[0], decay: 0x06 };
    }),
  },
  {
    name: 'SAW BASS',
    group: 'BASS',
    make: build('SAWBASS', (i) => {
      i.type = 'WAVSYNTH';
      i.wav.shape = 'SAW';
      i.filter = 'LOWPASS';
      i.cutoff = 0x48;
      i.res = 0x70;
      i.amp = 0x30;
      i.lim = 'SIN';
      i.mods[0] = { ...i.mods[0], hold: 0x01, decay: 0x14 };
      i.mods[1] = { ...i.mods[1], type: 'AHD', dest: 'CUTOFF', amt: 0x50, decay: 0x05 };
    }),
  },
  {
    name: 'ACID',
    group: 'BASS',
    make: build('ACID', (i) => {
      i.type = 'WAVSYNTH';
      i.wav.shape = 'SAW';
      i.filter = 'LOWPASS';
      i.cutoff = 0x30;
      i.res = 0xc0;
      i.amp = 0x50;
      i.lim = 'SIN';
      i.mods[0] = { ...i.mods[0], hold: 0x03, decay: 0x1a };
      i.mods[1] = { ...i.mods[1], type: 'AHD', dest: 'CUTOFF', amt: 0x70, decay: 0x03 };
    }),
  },
  {
    name: 'SUB',
    group: 'BASS',
    make: build('SUB', (i) => {
      i.type = 'WAVSYNTH';
      i.wav.shape = 'SINE';
      i.mods[0] = { ...i.mods[0], hold: 0x08, decay: 0x3d };
    }),
  },
  {
    name: 'FM BASS',
    group: 'BASS',
    make: build('FMBASS', (i) => {
      i.type = 'FMSYNTH';
      i.fm.algo = 1;
      i.fm.ops[0] = { shape: 'SIN', ratio: 100, level: 0x30, decay: 0x03, feedback: 0 };
      i.fm.ops[1] = { shape: 'SIN', ratio: 200, level: 0x40, decay: 0x08, feedback: 0 };
      i.fm.ops[2] = { shape: 'SIN', ratio: 100, level: 0x50, decay: 0x0f, feedback: 0 };
      i.fm.ops[3] = { shape: 'SIN', ratio: 50, level: 0xff, decay: 0, feedback: 0 };
      i.mods[0] = { ...i.mods[0], hold: 0x01, decay: 0x1a };
    }),
  },
  {
    name: 'CHIP LEAD',
    group: 'LEAD',
    make: build('CHIP', (i) => {
      i.type = 'WAVSYNTH';
      i.wav.shape = 'PULSE25';
      i.mods[0] = { ...i.mods[0], hold: 0x3d, decay: 0x3d };
      i.mods[3] = { ...i.mods[3], type: 'LFO', dest: 'PITCH', amt: 0x06, freq: 0xee };
      i.del = 0x40;
    }),
  },
  {
    name: 'FM LEAD',
    group: 'LEAD',
    make: build('FMLEAD', (i) => {
      i.type = 'FMSYNTH';
      i.fm.ops[2] = { shape: 'SIN', ratio: 350, level: 0x50, decay: 0x0f, feedback: 0 };
      i.fm.ops[3] = { shape: 'SIN', ratio: 100, level: 0xe0, decay: 0, feedback: 0 };
      i.mods[0] = { ...i.mods[0], decay: 0x56 };
      i.del = 0x70;
      i.rev = 0x40;
    }),
  },
  {
    name: 'PLUCK',
    group: 'KEYS',
    make: build('PLUCK', (i) => {
      i.type = 'WAVSYNTH';
      i.wav.shape = 'PULSE50';
      i.filter = 'LOWPASS';
      i.cutoff = 0x60;
      i.mods[0] = { ...i.mods[0], decay: 0x08 };
      i.mods[1] = { ...i.mods[1], type: 'AHD', dest: 'CUTOFF', amt: 0x60, decay: 0x01 };
      i.rev = 0x30;
    }),
  },
  {
    name: 'FM BELL',
    group: 'KEYS',
    make: build('BELL', (i) => {
      i.type = 'FMSYNTH';
      i.fm.algo = 7;
      i.fm.ops[0] = { shape: 'SIN', ratio: 350, level: 0x70, decay: 0x29, feedback: 0 };
      i.fm.ops[1] = { shape: 'SIN', ratio: 100, level: 0xc0, decay: 0, feedback: 0 };
      i.fm.ops[2] = { shape: 'SIN', ratio: 140, level: 0x40, decay: 0x1a, feedback: 0 };
      i.fm.ops[3] = { shape: 'SIN', ratio: 200, level: 0x80, decay: 0, feedback: 0 };
      i.mods[0] = { ...i.mods[0], decay: 0x9e };
      i.rev = 0x60;
    }),
  },
  {
    name: 'SUPERSAW',
    group: 'PAD',
    make: build('SUPRSAW', (i) => {
      i.type = 'HYPERSYNTH';
      i.hyper.chord = [0, -1, -1, -1];
      i.hyper.swarm = 0x80;
      i.hyper.width = 0xff;
      i.mods[0] = { ...i.mods[0], attack: 0x01, hold: 0x08, decay: 0xcd };
      i.cho = 0x40;
      i.rev = 0x50;
    }),
  },
  {
    name: 'CHORD PAD',
    group: 'PAD',
    make: build('CHORDPAD', (i) => {
      i.type = 'HYPERSYNTH';
      i.hyper.chord = [0, 3, 7, 10];
      i.hyper.swarm = 0x40;
      i.filter = 'LOWPASS';
      i.cutoff = 0x70;
      i.mods[0] = { ...i.mods[0], attack: 0x29, hold: 0x08, decay: 0x9e };
      i.dry = 0x80;
      i.rev = 0x90;
      i.cho = 0x60;
    }),
  },
];
