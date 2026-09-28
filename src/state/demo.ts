/**
 * The song that loads on first launch, so the app makes a sound before anyone has learnt
 * the keys: "AMEN CITY", jungle at 172 BPM in F minor. There is no break loop in the
 * built-in samples, so the break is programmed from one-shots the way it is done on the
 * M8: kick, snare and hats on their own tracks, ghost snares at low velocity, a swing
 * groove on the hats (GRV) with DEL nudging the ghosts onto it, CHA so the break never
 * repeats exactly, and RET rolls and ratchets at the ends of phrases. Under it a reese
 * (a Hypersynth of detuned saws with an LFO on the filter) doubled by a sine sub, with
 * legato slides (PSL), PIT octave jumps and a PBN fall; minor-seventh pads, stabs thrown
 * into the delay, a reversed cymbal swell into each drop.
 *
 * Every chain is two bars, so every song row is two bars: 14 rows, about 39 seconds.
 *   00–01 intro: low-passed break (SNR/HAT LP instruments), pad, a stab into the delay
 *   02–05 drop: full break, reese + sub, crash, stabs; a fill at the end of 05
 *   06–07 breakdown: filtered hats, sub drone, pad, FM bells; a snare roll rising in pitch and speed
 *   08–0D second drop: two-step kick, choppier snare, open hats, bass variations, fills
 * Phrase numbers are grouped by track: 0x kick, 1x snare, 2x hats, 3x reese, 4x sub,
 * 5x pad, 6x stab and bells, 7x percussion.
 */
import { defaultInstrument, emptyChain, emptyPhrase, newProject } from '../core/factory';
import { fromSigned } from '../core/fx';
import { NOTE_OFF, type FxSlot, type Instrument, type Project } from '../core/types';

type Fx = [string, number];
type StepSpec = [row: number, note: number | null, vel?: number | null, inst?: number | null, ...fx: Fx[]];

/**
 * Velocities below are written 00–FF for readability and stored 00–7F. Every note gets
 * the instrument number unless `inst` is null on purpose: on the M8 a note without one is
 * a legato pitch change (the slides below).
 */
function phrase(p: Project, id: number, steps: StepSpec[]) {
  const ph = emptyPhrase();
  let current: number | null = null;
  for (const [row, note, vel, inst, ...fx] of steps) {
    const s = ph.steps[row];
    if (inst != null) current = inst;
    s.note = note;
    s.vel = vel == null ? null : vel >> 1;
    s.inst = inst !== undefined ? inst : note != null && note !== NOTE_OFF ? current : null;
    fx.forEach(([cmd, val], i) => (s.fx[i] = { cmd, val } as FxSlot));
  }
  p.phrases[id] = ph;
}

function chain(p: Project, id: number, rows: [phrase: number, tsp?: number][]) {
  const c = emptyChain();
  rows.forEach(([ph, tsp], i) => (c.rows[i] = { phrase: ph, tsp: fromSigned(tsp ?? 0) }));
  p.chains[id] = c;
}

function instrument(p: Project, id: number, patch: (i: Instrument) => void) {
  const i = defaultInstrument();
  patch(i);
  p.instruments[id] = i;
}

/** Drum velocities: X accent, x hit, o soft, g ghost, `,` whisper, `.` rest. */
const VEL: Record<string, number> = { X: 0xff, x: 0xc8, o: 0x98, g: 0x68, ',': 0x44 };

/** A drum phrase from a 16-character pattern, with commands per row. */
function beat(p: Project, id: number, inst: number, note: number, pattern: string, fx: Record<number, Fx[]> = {}) {
  const steps: StepSpec[] = [];
  [...pattern].forEach((ch, row) => {
    const f = fx[row] ?? [];
    if (VEL[ch] != null) steps.push([row, note, VEL[ch], inst, ...f]);
    else if (f.length) steps.push([row, null, null, null, ...f]);
  });
  phrase(p, id, steps);
}

// Instruments.
const KICK = 0x00;
const SNARE = 0x01;
const HAT = 0x02;
const REESE = 0x03;
const SUB = 0x04;
const PAD = 0x05;
const STAB = 0x06;
const CRASH = 0x07;
const RIM = 0x08;
const SNARE_LP = 0x09;
const HAT_LP = 0x0a;
const OPENHAT = 0x0b;
const SWELL = 0x0c;
const BELL = 0x0d;
const TOM = 0x0e;

// Notes (sub octave; the reese plays an octave up).
const C4 = 60;
const D4 = 62;
const F1 = 29;
const AB1 = 32;
const BB1 = 34;
const C2 = 36;
const DB2 = 37;
const EB2 = 39;
const F3 = 53;
const BB3 = 58;

type BassStep = [row: number, note: number | null, ...fx: Fx[]];

/**
 * One bass bar as a reese phrase and a sub phrase an octave below, so the two stay
 * locked. A slide (PSL) is written without an instrument: legato, the envelope carries on.
 */
function bass(p: Project, reeseId: number, subId: number, steps: BassStep[]) {
  for (const [id, inst, up] of [
    [reeseId, REESE, 12],
    [subId, SUB, 0],
  ] as const) {
    phrase(
      p,
      id,
      steps.map(([row, note, ...fx]): StepSpec => {
        if (note == null || note === NOTE_OFF) return [row, note, null, null, ...fx];
        const legato = fx.some(([c]) => c === 'PSL');
        return [row, note + up, null, legato ? null : inst, ...fx];
      }),
    );
  }
}

export function demoProject(): Project {
  const p = newProject();
  p.name = 'AMEN CITY';
  p.tempo = 172;
  p.settings.scale = 'MINOR';
  p.settings.scaleRoot = 5;

  const sampler = (name: string, sample: string, patch: (i: Instrument) => void = () => {}) => (i: Instrument) => {
    i.type = 'SAMPLER';
    i.name = name;
    i.sampler.sample = sample;
    i.mods[0].type = 'OFF';
    patch(i);
  };
  instrument(p, KICK, sampler('KICK', 'builtin:kick', (i) => (i.dry = 0xff)));
  // A little decimation and a soft clip give the one-shot snare some sampled-break grit.
  instrument(p, SNARE, sampler('SNARE', 'builtin:snare', (i) => {
    i.sampler.degrade = 0x38;
    i.amp = 0x30;
    i.lim = 'SIN';
    i.dry = 0xe0;
    i.rev = 0x28;
  }));
  instrument(p, HAT, sampler('HAT', 'builtin:hat', (i) => {
    i.pan = 0x98;
    i.dry = 0xff;
  }));
  instrument(p, REESE, (i) => {
    i.type = 'HYPERSYNTH';
    i.name = 'REESE';
    // One note, three saws detuned by SWARM: the beating is the reese.
    i.hyper.chord = [0, -1, -1, -1];
    i.hyper.swarm = 0x50;
    i.hyper.width = 0x50;
    i.filter = 'LOWPASS';
    i.cutoff = 0x74;
    i.res = 0x50;
    i.amp = 0x40;
    i.lim = 'SIN';
    i.mods[0] = { ...i.mods[0], type: 'ADSR', dest: 'VOLUME', amt: 127, attack: 0x01, decay: 0x30, sustain: 0xe0, release: 0x0a };
    // The filter breathes over a bar, restarted by each note; a short bite at the start.
    i.mods[1] = { ...i.mods[1], type: 'LFO', dest: 'CUTOFF', amt: 0x1c, lfoShape: 'TRI', lfoTrig: 'RETRIG', freq: 0x7f };
    i.mods[2] = { ...i.mods[2], type: 'AHD', dest: 'CUTOFF', amt: 0x24, decay: 0x10 };
    i.cho = 0x20;
  });
  instrument(p, SUB, (i) => {
    i.type = 'WAVSYNTH';
    i.name = 'SUB';
    i.wav.shape = 'SINE';
    // Soft saturation adds the upper harmonics small speakers need to hear a sub.
    i.amp = 0x38;
    i.lim = 'SIN';
    i.mods[0] = { ...i.mods[0], type: 'ADSR', dest: 'VOLUME', amt: 127, attack: 0x01, decay: 0x20, sustain: 0xf0, release: 0x08 };
  });
  instrument(p, PAD, (i) => {
    i.type = 'HYPERSYNTH';
    i.name = 'PAD';
    i.hyper.chord = [0, 3, 7, 10];
    i.hyper.swarm = 0x48;
    i.hyper.width = 0xd0;
    i.filter = 'LOWPASS';
    i.cutoff = 0x90;
    i.res = 0x20;
    i.mods[0] = { ...i.mods[0], type: 'ADSR', dest: 'VOLUME', amt: 127, attack: 0x20, decay: 0x40, sustain: 0xc0, release: 0x30 };
    i.mods[1] = { ...i.mods[1], type: 'LFO', dest: 'CUTOFF', amt: 0x18, lfoShape: 'SIN', lfoTrig: 'FREE', freq: 0x5f };
    i.dry = 0x90;
    i.cho = 0x70;
    i.rev = 0xb0;
  });
  // The built-in stab is C minor 7 at C-4: F-4 plays F minor 7, the chain transposes it.
  instrument(p, STAB, sampler('STAB', 'builtin:stab', (i) => {
    i.del = 0x50;
    i.rev = 0x60;
    i.pan = 0x70;
  }));
  instrument(p, CRASH, sampler('CRASH', 'builtin:openhat', (i) => {
    i.rev = 0x70;
    i.pan = 0x78;
  }));
  instrument(p, RIM, sampler('RIM', 'builtin:rim', (i) => {
    i.pan = 0x60;
    i.rev = 0x30;
  }));
  instrument(p, SNARE_LP, sampler('SNARE LP', 'builtin:snare', (i) => {
    i.sampler.degrade = 0x38;
    i.filter = 'LOWPASS';
    i.cutoff = 0x98;
    i.res = 0x50;
    i.amp = 0x28;
    i.lim = 'SIN';
    i.rev = 0x40;
  }));
  instrument(p, HAT_LP, sampler('HAT LP', 'builtin:hat', (i) => {
    i.filter = 'BANDPASS';
    i.cutoff = 0xc4;
    i.res = 0x40;
    i.amp = 0x28;
    i.lim = 'SIN';
    i.pan = 0x98;
    i.rev = 0x20;
  }));
  instrument(p, OPENHAT, sampler('OPENHAT', 'builtin:openhat', (i) => (i.pan = 0x68)));
  // Reversed and an octave down, the open hat lasts one bar at 172 BPM: a swell into the drop.
  instrument(p, SWELL, sampler('SWELL', 'builtin:openhat', (i) => {
    i.sampler.play = 'REV';
    i.rev = 0x80;
  }));
  instrument(p, BELL, (i) => {
    i.type = 'FMSYNTH';
    i.name = 'BELL';
    i.fm.algo = 7;
    i.fm.ops[0] = { shape: 'SIN', ratio: 350, level: 0x70, decay: 0x29, feedback: 0 };
    i.fm.ops[1] = { shape: 'SIN', ratio: 100, level: 0xc0, decay: 0, feedback: 0 };
    i.fm.ops[2] = { shape: 'SIN', ratio: 140, level: 0x40, decay: 0x1a, feedback: 0 };
    i.fm.ops[3] = { shape: 'SIN', ratio: 200, level: 0x80, decay: 0, feedback: 0 };
    i.mods[0] = { ...i.mods[0], decay: 0x9e };
    i.dry = 0xa0;
    i.del = 0x80;
    i.rev = 0x80;
    i.pan = 0x90;
  });
  instrument(p, TOM, sampler('TOM', 'builtin:tom', (i) => (i.rev = 0x30)));

  // Swing for the hats: odd sixteenths one tick late. DEL 01 puts a ghost snare on it.
  p.grooves[1] = { steps: [7, 5, ...Array.from({ length: 14 }, () => null)] };
  const GRV: Fx = ['GRV', 1];
  const LATE: Fx = ['DEL', 1];

  // Kick. Phrase 00 keeps rows 1, 6, 7, 9 and 0A free (the first steps of the tour).
  beat(p, 0x00, KICK, C4, 'X.x........x..o.', { 14: [['CHA', 0xa0]] });
  beat(p, 0x01, KICK, C4, 'X.x.......xx....');
  beat(p, 0x02, KICK, C4, 'X.........x...o.', { 14: [['CHA', 0x90]] });
  beat(p, 0x03, KICK, C4, 'X.x.......x.....');
  beat(p, 0x04, KICK, C4, 'X.........x.x...');
  beat(p, 0x05, KICK, C4, 'X.........x.....');

  // Snare: the Amen's 4, 7, 9, 12, 15, ghosts late and some left to chance.
  beat(p, 0x10, SNARE_LP, D4, '....X..g.o..X..g', { 7: [LATE], 15: [LATE] });
  beat(p, 0x11, SNARE_LP, D4, '....X..g.o....X.', { 7: [LATE] });
  // RET works inside its row: RET 03 adds a hit three ticks in (32nds), RET 02 two more
  // (48ths), RET 01 one every tick (a buzz); RET 9y also raises each hit a little.
  // Into the drop: a crescendo roll, the last hit clean.
  beat(p, 0x12, SNARE_LP, D4, '....X..g.o..goxX', { 7: [LATE], 12: [['RET', 0x03]], 13: [['RET', 0x93]], 14: [['RET', 0x92]] });
  beat(p, 0x13, SNARE, D4, '....X..g.o..X..g', { 7: [LATE], 15: [LATE, ['CHA', 0xb0]] });
  beat(p, 0x14, SNARE, D4, '....X..g.o.,..X.', { 7: [LATE], 11: [LATE, ['CHA', 0x70]] });
  beat(p, 0x15, SNARE, D4, '....X..g.ogoxgxX', { 7: [LATE], 10: [['RET', 0x30]], 12: [['RET', 0x03]], 13: [['RET', 0x93]], 14: [['RET', 0x92]] });
  beat(p, 0x16, SNARE, D4, '..g.X..g.g..X.g.', { 2: [['CHA', 0xb0]], 7: [LATE], 9: [LATE], 14: [['CHA', 0xa0]] });
  beat(p, 0x17, SNARE, D4, '.,..X..g.o.gX..o', { 1: [LATE], 7: [LATE], 11: [LATE, ['CHA', 0x90]] });
  beat(p, 0x18, SNARE, D4, '....X..g,,ggooXX', {
    7: [LATE],
    8: [['RET', 0x03]],
    9: [['RET', 0x03]],
    10: [['RET', 0x93]],
    11: [['RET', 0x93]],
    12: [['RET', 0x92]],
    13: [['RET', 0x92]],
    14: [['RET', 0x01]],
  });
  // The breakdown build: quarters, eighths, then a bar of sixteenths climbing in pitch and
  // level, 32nds from the middle, 48ths at the end, and one step of silence before the drop.
  beat(p, 0x19, SNARE, D4, 'g...g...o.o.o.o.');
  phrase(
    p,
    0x1a,
    Array.from({ length: 15 }, (_, row): StepSpec => {
      const ret: Fx[] = row >= 12 ? [['RET', 0x92]] : row >= 8 ? [['RET', 0x93]] : [];
      return [row, D4 + (row >> 1), 0x60 + row * 0x0a, SNARE, ...ret];
    }),
  );

  // Hats: sixteenths on the swing groove, accents on the beat, a few left to chance.
  beat(p, 0x20, HAT_LP, C4, 'x.o.x.o.x.o.x.o.', { 0: [GRV] });
  beat(p, 0x21, HAT_LP, C4, 'x.o.x.o.x.o.x,o,', { 0: [GRV], 13: [['CHA', 0x90]], 15: [['CHA', 0x90]] });
  beat(p, 0x22, HAT, C4, 'x,o,x,o,x,o,x,o,', { 0: [GRV], 3: [['CHA', 0xb0]], 11: [['CHA', 0xb0]] });
  // RET 30: one retrigger three ticks later, a 32nd-note ratchet.
  beat(p, 0x23, HAT, C4, 'x,o,x,o,x,o,x,oo', { 0: [GRV], 7: [['CHA', 0xa0]], 14: [['RET', 0x30]] });
  beat(p, 0x24, HAT, C4, 'x.o,x.oox.o,x,oo', { 0: [GRV], 6: [['RET', 0x30]], 11: [['CHA', 0x80]], 14: [['RET', 0x03]] });
  beat(p, 0x25, HAT, C4, 'x,o,x,oox,o,x,o,', { 0: [GRV], 6: [['RET', 0x30]], 13: [['CHA', 0xa0]] });

  // Bass, F minor: F, a slide up to A♭ and back; D♭ to C; PIT jumps an octave without a new
  // note, PBN falls away at the end.
  bass(p, 0x30, 0x40, [
    [0, F1],
    [14, AB1, ['PSL', 0x04]],
  ]);
  bass(p, 0x31, 0x41, [
    [0, F1, ['PSL', 0x06]],
    [8, NOTE_OFF],
    [10, F1],
    [11, NOTE_OFF],
    [12, C2],
    [14, EB2, ['PSL', 0x02]],
  ]);
  bass(p, 0x32, 0x42, [
    [0, DB2],
    [10, NOTE_OFF],
    [12, DB2],
    [14, EB2, ['PSL', 0x03]],
  ]);
  bass(p, 0x33, 0x43, [
    [0, C2],
    [6, null, ['PIT', 0x0c]],
    [7, null, ['PIT', 0xf4]],
    [10, BB1],
    [12, C2, ['PSL', 0x03]],
    [15, NOTE_OFF],
  ]);
  bass(p, 0x34, 0x44, [
    [0, F1, ['PSL', 0x06]],
    [4, null, ['PIT', 0x0c]],
    [5, null, ['PIT', 0xf4]],
    [8, C2],
    [10, DB2, ['PSL', 0x02]],
    [12, C2, ['PSL', 0x02]],
    [14, NOTE_OFF],
  ]);
  bass(p, 0x35, 0x45, [
    [0, C2],
    [8, EB2],
    [10, F1 + 12],
    [12, null, ['PBN', 0xf0]],
    [15, NOTE_OFF],
  ]);
  bass(p, 0x36, 0x46, [
    [0, C2],
    [4, null, ['PBN', 0xf8]],
    [12, NOTE_OFF],
  ]);
  // Breakdown: the sub alone, long notes.
  phrase(p, 0x47, [[0, F1, 0xe0, SUB]]);
  phrase(p, 0x48, [[0, DB2, 0xe0, SUB]]);
  phrase(p, 0x49, [
    [0, C2, null, null, ['PSL', 0x0c]],
    [12, NOTE_OFF],
  ]);

  // Pad: minor sevenths, i – iv – v. The second chord of a chain is legato (no instrument).
  phrase(p, 0x50, [[0, F3, 0xc0, PAD]]);
  phrase(p, 0x51, [[0, BB3, 0xc0, PAD]]);
  phrase(p, 0x52, [[0, C4, null, null]]);
  phrase(p, 0x53, [[0, F3, 0x90, PAD]]);
  phrase(p, 0x54, [[0, BB3, 0x90, PAD]]);

  // Stabs and bells. SDL raises the delay send for one hit: a throw.
  phrase(p, 0x60, [
    [0, 65, 0xb0, STAB, ['SDL', 0x70]],
    [10, 60, 0x70, STAB, ['SDL', 0x60]],
  ]);
  phrase(p, 0x61, [
    [3, 65, 0xc0, STAB],
    [6, 65, 0x90, STAB, ['SDL', 0x50]],
  ]);
  phrase(p, 0x62, [
    [0, 65, 0xb0, STAB],
    [10, 65, 0x90, STAB, ['KIL', 0x04]],
    [11, 65, 0xa0, STAB, ['SDL', 0x70]],
  ]);
  phrase(p, 0x63, [
    [0, 72, 0xc0, BELL],
    [6, 68, 0x90],
    [12, 67, 0x90],
  ]);
  phrase(p, 0x64, [
    [0, 65, 0xc0, BELL],
    [10, 63, 0x60],
  ]);
  phrase(p, 0x65, [
    [0, 73, 0xc0, BELL],
    [6, 72, 0x90],
    [12, 70, 0x90],
  ]);
  phrase(p, 0x66, [
    [0, 67, 0xc0, BELL],
    [8, 70, 0x80],
    [12, 72, 0x70],
  ]);

  // Percussion: crash, rim ghosts, open hats, a tom fill, the reversed swell.
  phrase(p, 0x70, [
    [0, 50, 0xd0, CRASH, GRV],
    [10, C4, 0x68, RIM],
    [13, C4, 0x44, RIM, ['CHA', 0xa0]],
  ]);
  beat(p, 0x71, RIM, C4, '...g......g..g..', { 0: [GRV], 3: [['CHA', 0x90]], 13: [['CHA', 0xb0]] });
  phrase(p, 0x72, [
    [0, null, null, null, GRV],
    [3, C4, 0x60, RIM],
    [9, 64, 0x90, TOM],
    [11, 60, 0xa0],
    [13, 57, 0xb0],
    [14, 53, 0xd0],
  ]);
  phrase(p, 0x73, [[0, 48, 0xe0, SWELL]]);
  beat(p, 0x74, OPENHAT, C4, '..o...o...o...o.', { 0: [GRV], 13: [['CHA', 0x80]] });
  phrase(p, 0x75, [
    [2, C4, 0x98, OPENHAT],
    [6, C4, 0x98],
    [10, C4, 0x98],
    [13, C4, 0x44, RIM, ['CHA', 0xa0]],
    [14, C4, 0xb0, OPENHAT],
  ]);
  phrase(p, 0x76, [
    [0, 50, 0xd0, CRASH, GRV],
    [6, C4, 0x98, OPENHAT],
    [10, C4, 0x98],
    [14, C4, 0x98],
  ]);

  // Waiting: a chain of an empty phrase keeps a track in step with the others.
  const REST = 0xfe;
  p.phrases[REST] = emptyPhrase();
  const W = 0xfe;
  chain(p, W, [[REST], [REST]]);

  // Chains, two bars each. The low digit is the track they are written for.
  chain(p, 0x00, [[0x00], [0x01]]);
  chain(p, 0x10, [[0x00], [0x03]]);
  chain(p, 0x20, [[0x02], [0x04]]);
  chain(p, 0x30, [[0x02], [0x03]]);
  chain(p, 0x40, [[0x02], [0x05]]);

  chain(p, 0x01, [[0x10], [0x11]]);
  chain(p, 0x11, [[0x10], [0x12]]);
  chain(p, 0x21, [[0x13], [0x14]]);
  chain(p, 0x31, [[0x13], [0x15]]);
  chain(p, 0x41, [[0x16], [0x17]]);
  chain(p, 0x51, [[0x16], [0x18]]);
  chain(p, 0x61, [[0x19], [0x1a]]);
  chain(p, 0x71, [[0x16], [0x15]]);

  chain(p, 0x02, [[0x20], [0x21]]);
  chain(p, 0x12, [[0x22], [0x23]]);
  chain(p, 0x22, [[0x24], [0x25]]);

  chain(p, 0x03, [[0x30], [0x31]]);
  chain(p, 0x13, [[0x32], [0x33]]);
  chain(p, 0x23, [[0x30], [0x34]]);
  chain(p, 0x33, [[0x32], [0x35]]);
  chain(p, 0x43, [[0x32], [0x36]]);

  chain(p, 0x04, [[0x40], [0x41]]);
  chain(p, 0x14, [[0x42], [0x43]]);
  chain(p, 0x24, [[0x40], [0x44]]);
  chain(p, 0x34, [[0x42], [0x45]]);
  chain(p, 0x44, [[0x42], [0x46]]);
  chain(p, 0x54, [[0x47], [REST]]);
  chain(p, 0x64, [[0x48], [0x49]]);

  chain(p, 0x05, [[0x50], [REST]]);
  chain(p, 0x15, [[0x51], [0x52]]);
  chain(p, 0x25, [[0x53], [REST]]);
  chain(p, 0x35, [[0x54], [0x52]]);

  chain(p, 0x06, [[0x60], [REST]]);
  // Same stabs a fourth down on the second bar: F minor 7, then C minor 7.
  chain(p, 0x16, [[0x61], [0x61, -5]]);
  chain(p, 0x26, [[0x62], [0x61, -5]]);
  chain(p, 0x36, [[0x63], [0x64]]);
  chain(p, 0x46, [[0x65], [0x66]]);

  chain(p, 0x07, [[REST], [0x73]]);
  chain(p, 0x17, [[0x70], [0x71]]);
  chain(p, 0x27, [[0x71], [0x71]]);
  chain(p, 0x37, [[0x71], [0x72]]);
  chain(p, 0x47, [[0x76], [0x75]]);
  chain(p, 0x57, [[0x74], [0x75]]);

  const song: (number | null)[][] = [
    // Intro: filtered break and pad.
    [0x00, 0x01, 0x02, W, W, 0x05, 0x06, W],
    [0x00, 0x11, 0x02, W, W, 0x15, 0x06, 0x07],
    // Drop.
    [0x00, 0x21, 0x12, 0x03, 0x04, 0x25, 0x16, 0x17],
    [0x00, 0x21, 0x12, 0x13, 0x14, 0x35, W, 0x27],
    [0x00, 0x21, 0x12, 0x03, 0x04, 0x25, 0x26, 0x27],
    [0x10, 0x31, 0x12, 0x13, 0x14, 0x35, W, 0x37],
    // Breakdown.
    [W, W, 0x02, W, 0x54, 0x05, 0x36, W],
    [W, 0x61, 0x02, W, 0x64, 0x15, 0x46, 0x07],
    // Second drop.
    [0x20, 0x41, 0x22, 0x03, 0x04, 0x25, 0x16, 0x47],
    [0x20, 0x41, 0x22, 0x13, 0x14, 0x35, W, 0x57],
    [0x20, 0x41, 0x22, 0x23, 0x24, 0x25, 0x26, 0x57],
    [0x30, 0x71, 0x22, 0x33, 0x34, 0x35, W, 0x37],
    [0x20, 0x41, 0x22, 0x23, 0x24, 0x25, 0x16, 0x47],
    [0x40, 0x51, 0x22, 0x43, 0x44, 0x35, W, 0x37],
  ];
  song.forEach((row, i) => (p.song[i] = row));

  p.mixer.tracks = [0xff, 0xff, 0xff, 0x7c, 0x78, 0xb8, 0xe8, 0xe8];
  // A little less drive into the limiter, a little more after it: the peaks of kick,
  // snare and bass together are caught without the whole mix pumping.
  p.mixer.limit = 0x30;
  p.mixer.master = 0xdc; // about 1.5 dB under full: headroom for inter-sample peaks
  p.effects.delay = { ...p.effects.delay, timeL: 0x12, timeR: 0x0c, feedback: 0x80 };
  p.effects.reverb = { ...p.effects.reverb, size: 0xc8, damp: 0x90 };
  return p;
}
