import { getChain, getGroove, getInstrument, getPhrase, getTable } from './factory';
import { FX_BY_CODE, toSigned } from './fx';
import { SCALE_NAMES, scaleTune, snapToScale, USER_SCALE_NAMES } from './format';
import {
  MAX_TABLES,
  NOTE_OFF,
  ROWS,
  SONG_ROWS,
  TICKS_PER_BEAT,
  TRACKS,
  type FxSlot,
  type Instrument,
  type PhraseStep,
  type Project,
  type ScaleRef,
} from './types';

/** Voice parameters the sequencer sets on the playing voice; values are absolute bytes. */
export type VoiceParam =
  | 'VOL'
  | 'CUT'
  | 'RES'
  | 'AMP'
  | 'PAN'
  | 'SCH'
  | 'SDL'
  | 'SRV'
  /** Live on the sounding voice (absolute bytes): Wavsynth SCAN/WARP/SIZE, FM operator levels. */
  | 'SCN'
  | 'WRP'
  | 'SIZ'
  | 'FMA'
  | 'FMB'
  | 'FMC'
  | 'FMD';

/** Relative instrument commands and the instrument field each one offsets. */
const RELATIVE: Record<string, keyof Instrument | 'vel'> = {
  VOL: 'vel',
  CUT: 'cutoff',
  RES: 'res',
  AMP: 'amp',
  PAN: 'pan',
  SCH: 'cho',
  SDL: 'del',
  SRV: 'rev',
};
/** Envelope/LFO commands: they shape the next notes' instrument copy. */
const MOD_OFFSETS = new Set(['EA1', 'AT1', 'HO1', 'DE1', 'EA2', 'AT2', 'HO2', 'DE2', 'LA1', 'LF1', 'LA2', 'LF2', 'SIZ', 'MUL', 'WRP', 'SCN', 'STA', 'LEN', 'LOP', 'FMA', 'FMB', 'FMC', 'FMD', 'SWM', 'WID']);
/** Instrument-type commands: which parameter of the next note's instrument copy they offset. */
const TYPE_OFFSETS: Record<string, (i: Instrument, d: number) => void> = {
  SIZ: (i, d) => (i.wav = { ...i.wav, size: clampByte(i.wav.size + d) }),
  MUL: (i, d) => (i.wav = { ...i.wav, mult: clampByte(i.wav.mult + d) }),
  WRP: (i, d) => (i.wav = { ...i.wav, warp: clampByte(i.wav.warp + d) }),
  SCN: (i, d) => (i.wav = { ...i.wav, scan: clampByte(i.wav.scan + d) }),
  STA: (i, d) => (i.sampler = { ...i.sampler, start: clampByte(i.sampler.start + d) }),
  LEN: (i, d) => (i.sampler = { ...i.sampler, length: clampByte(i.sampler.length + d) }),
  LOP: (i, d) => (i.sampler = { ...i.sampler, loop: clampByte(i.sampler.loop + d) }),
  FMA: (i, d) => fmLevel(i, 0, d),
  FMB: (i, d) => fmLevel(i, 1, d),
  FMC: (i, d) => fmLevel(i, 2, d),
  FMD: (i, d) => fmLevel(i, 3, d),
  SWM: (i, d) => (i.hyper = { ...i.hyper, swarm: clampByte(i.hyper.swarm + d) }),
  WID: (i, d) => (i.hyper = { ...i.hyper, width: clampByte(i.hyper.width + d) }),
};
/** Commands that also act on the sounding voice, and the instrument value they offset. */
const LIVE: Record<string, (i: Instrument) => number> = {
  SCN: (i) => i.wav.scan,
  WRP: (i) => i.wav.warp,
  SIZ: (i) => i.wav.size,
  FMA: (i) => i.fm.ops[0].level,
  FMB: (i) => i.fm.ops[1].level,
  FMC: (i) => i.fm.ops[2].level,
  FMD: (i) => i.fm.ops[3].level,
};

function fmLevel(i: Instrument, n: number, d: number) {
  i.fm = { ...i.fm, ops: i.fm.ops.map((op, k) => (k === n ? { ...op, level: clampByte(op.level + d) } : op)) };
}
/** Commands that decide whether/when a row plays rather than doing something. */
const META = new Set(['CHA', 'NTH', 'DEL', 'RND', 'RNL', 'REP', 'RTO']);
const PRE = new Set(['TPO', 'GRV', 'GGR', 'TSP', 'HOP', 'SNG', 'TBL', 'TIC', 'PSL', 'INS', 'SED', 'ARC', 'SCA', 'SCG', 'SLI']);

/** Phrase velocity is 00–7F (M8); the engine takes a 0–255 byte. */
const engineVel = (v: number) => Math.min(255, Math.round((Math.max(0, v) * 255) / 127));
const clampByte = (v: number) => Math.max(0, Math.min(255, v));

/** Small seedable PRNG for SED. */
function mulberry32(seed: number) {
  let a = seed * 0x9e3779b9 + 0x6d2b79f5;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Trigger {
  track: number;
  time: number;
  /** Semitones, all static transposition applied. */
  note: number;
  vel: number;
  instId: number;
  inst: Instrument;
  /** Dynamic pitch offset (table, arp, bend) at the moment of the trigger, in cents. */
  cents: number;
  /** Semitone to glide from, for PSL. */
  glideFrom: number | null;
  glideTime: number;
  tickDur: number;
  /**
   * A note without an instrument number: retune the playing voice without retriggering
   * its envelopes (M8). Falls back to a normal trigger when nothing is sounding.
   */
  legato?: boolean;
}

/**
 * Mixer and send-effect commands, values are raw bytes: DJF/DJC cutoff, DJR resonance,
 * DJT type (0 LP/HP, 1 LP/BS, 2 BS/HP), VMV main, VCH/VDE/VRE effect returns, VT1–VT8
 * track volumes, XCM/XCF/XCW/XCR chorus, XDT (x = left, y = right, ×16 ticks)/XDF/XDW/XDR
 * delay, XRS/XRD/XRW reverb, XRZ freeze (> 00 on).
 */
export type MasterParam = string;

/** Where the sequencer sends sound. The audio engine implements it; tests record it. */
export interface Output {
  trigger(e: Trigger): void;
  /** Note-off: let the envelope release. */
  release(track: number, time: number): void;
  /** Hard cut. */
  kill(track: number, time: number): void;
  param(track: number, time: number, p: VoiceParam, v: number): void;
  /** Offset of the playing voice from its note, in cents; glide in seconds. */
  pitch(track: number, time: number, cents: number, glide: number): void;
  vibrato(track: number, time: number, speed: number, depth: number): void;
  master(time: number, p: MasterParam, v: number): void;
  /** ET/LT commands: restart the playing voice's envelopes or LFOs (n = 1st or 2nd of that kind), LFO at `phase` 00–FF. */
  retriggerMod?(track: number, time: number, kind: 'ENV' | 'LFO', n: number, phase: number): void;
  stopAll(time: number): void;
}

export type PlayMode = 'SONG' | 'CHAIN' | 'PHRASE';

export interface StartOptions {
  mode: PlayMode;
  songRow: number;
  /** For CHAIN and PHRASE: the one track that plays. */
  track?: number;
  chain?: number;
  phrase?: number;
}

export interface Position {
  active: boolean;
  songRow: number;
  chainId: number | null;
  chainRow: number;
  phraseId: number | null;
  step: number;
  tableId: number | null;
  tableRow: number;
  note: number | null;
  inst: number | null;
  /** Live mode: song row this track switches to when its chain ends. */
  queued: number | null;
  /** FX lane of a REP carried over from an earlier phrase (the M8 shows ^^ there). */
  repeatLane: number | null;
  /** Ticks this step lasts (groove), for live recording. */
  stepTicks: number;
}

interface TableRt {
  id: number;
  row: number;
  tick: number;
  tic: number;
  hop: number | null;
  /** HOP xy repeat counters, per row. */
  hops: Map<number, number>;
  /** Table DEL: ticks to hold. */
  wait: number;
  loops: number;
  aux: boolean;
}

interface TrackRt {
  active: boolean;
  songRow: number;
  blockStart: number;
  chainId: number | null;
  chainRow: number;
  phraseId: number | null;
  step: number;
  tick: number;
  stepTicks: number;
  groove: number;
  chainTsp: number;
  pending: { step: PhraseStep; left: boolean; right: boolean; gate: number } | null;
  fireTick: number;
  /** Phrase HOP: row in the next phrase, or FF to stop. */
  hop: number | null;
  songHop: number | null;
  note: number | null;
  inst: number | null;
  /** Velocity of the sounding note, 00–7F. */
  vel: number;
  ret: { every: number; volStep: number; vel: number; count: number; single: boolean } | null;
  kill: number;
  off: number;
  arp: { seq: number[]; pos: number; tick: number; random: boolean; x: number; y: number } | null;
  arcMode: number;
  arcSpeed: number;
  bend: number;
  bendCents: number;
  tableTsp: number;
  auxTsp: number;
  arpSemis: number;
  pit: number;
  fin: number;
  rel: Record<string, number>;
  lastCents: number;
  table: TableRt | null;
  aux: TableRt | null;
  queued: number | null;
  passes: Map<number, number>;
  pass: number;
  last: { cmd: string; val: number } | null;
  rep: { cmd: string; val: number; inc: number; to: number | null; lane: number; phrase: number | null } | null;
  rng: () => number;
  /** SCA: notes snap to this scale. */
  scale: { root: number; name: ScaleRef } | null;
  /** SLI: slice for the next note. */
  slice: number | null;
  /** RMX from another track: jump to this row at the next step. */
  remix: number | null;
  /** User-scale tuning of the playing note, cents. */
  tune: number;
  /** EQI: EQ slot for the next notes' instrument. */
  eqSlot: number | null;
  /** Beat repeat: where the loop starts and how many steps have passed since. */
  repSnap: { songRow: number; chainId: number | null; chainRow: number; phraseId: number | null; step: number; chainTsp: number } | null;
  repCount: number;
}

const fxOf = (slots: FxSlot[], code: string) => slots.find((f) => f.cmd === code);
const passOk = (n: number, pass: number) => n <= 1 || (pass - 1) % n === 0;

export class Sequencer {
  project: Project;
  tempo: number;
  mode: PlayMode = 'SONG';
  playing = false;
  tracks: TrackRt[];
  /** Ticks since start; idle tracks join a live queue on a bar line (96 ticks). */
  private clock = 0;
  /** TSP overrides the project transpose until playback stops. */
  private transposeOverride: number | null = null;
  onPosition?: (track: number, time: number, pos: Position) => void;

  constructor(
    project: Project,
    private out: Output,
    private rng: () => number = Math.random,
  ) {
    this.project = project;
    this.tempo = project.tempo;
    this.tracks = Array.from({ length: TRACKS }, () => this.idleTrack());
  }

  private idleTrack(): TrackRt {
    return {
      active: false,
      songRow: 0,
      blockStart: 0,
      chainId: null,
      chainRow: 0,
      phraseId: null,
      step: 0,
      tick: 0,
      stepTicks: 6,
      groove: 0,
      chainTsp: 0,
      pending: null,
      fireTick: 0,
      hop: null,
      songHop: null,
      note: null,
      inst: null,
      vel: 0x7f,
      ret: null,
      kill: -1,
      off: -1,
      arp: null,
      arcMode: 0,
      arcSpeed: 1,
      bend: 0,
      bendCents: 0,
      tableTsp: 0,
      auxTsp: 0,
      arpSemis: 0,
      pit: 0,
      fin: 0,
      rel: {},
      lastCents: 0,
      table: null,
      aux: null,
      queued: null,
      passes: new Map(),
      pass: 1,
      last: null,
      rep: null,
      rng: this.rng,
      scale: null,
      slice: null,
      remix: null,
      tune: 0,
      eqSlot: null,
      repSnap: null,
      repCount: 0,
    };
  }

  /** Polyend-style beat repeat: every track loops its next `steps` steps until cleared. */
  private repeat: number | null = null;
  setRepeat(steps: number | null) {
    this.repeat = steps;
    for (const trk of this.tracks) {
      trk.repSnap = null;
      trk.repCount = 0;
    }
  }

  tickDuration() {
    return 60 / (Math.max(1, this.tempo) * TICKS_PER_BEAT);
  }

  get transpose() {
    return this.transposeOverride ?? this.project.transpose;
  }

  start(o: StartOptions) {
    this.mode = o.mode;
    this.tempo = this.project.tempo;
    this.transposeOverride = null;
    this.tracks = Array.from({ length: TRACKS }, () => this.idleTrack());
    this.clock = 0;
    if (o.mode === 'SONG') {
      for (let t = 0; t < TRACKS; t++) {
        const trk = this.tracks[t];
        if (this.project.song[o.songRow]?.[t] == null) continue;
        trk.blockStart = this.blockTop(o.songRow, t);
        if (this.enterSongRow(trk, t, o.songRow)) this.beginTrack(trk);
      }
    } else {
      const t = o.track ?? 0;
      const trk = this.tracks[t];
      trk.songRow = o.songRow;
      if (o.mode === 'CHAIN' && o.chain != null) {
        trk.chainId = o.chain;
        if (this.enterChainRow(trk, 0)) this.beginTrack(trk);
      } else if (o.mode === 'PHRASE' && o.phrase != null) {
        trk.phraseId = o.phrase;
        this.beginTrack(trk);
      }
    }
    this.playing = this.tracks.some((t) => t.active);
    return this.playing;
  }

  stop(time: number) {
    this.playing = false;
    for (const trk of this.tracks) trk.active = false;
    this.out.stopAll(time);
  }

  position(t: number): Position {
    const trk = this.tracks[t];
    return {
      active: trk.active,
      songRow: trk.songRow,
      chainId: trk.chainId,
      chainRow: trk.chainRow,
      phraseId: trk.phraseId,
      step: trk.step,
      tableId: trk.table?.id ?? null,
      tableRow: trk.table?.row ?? 0,
      note: trk.note,
      inst: trk.inst,
      queued: trk.queued,
      repeatLane: trk.rep && trk.rep.phrase !== trk.phraseId ? trk.rep.lane : null,
      stepTicks: trk.stepTicks,
    };
  }

  /**
   * M8 live mode: the track moves to `row` when its current chain ends; an idle track
   * joins at the next bar line. `null` cancels.
   */
  queue(t: number, row: number | null) {
    if (this.mode !== 'SONG' || !this.playing) return;
    if (row != null && this.project.song[row]?.[t] == null) return;
    this.tracks[t].queued = row;
  }

  /** Live mode: stop a track when its current chain ends (queue its own row again). */
  queueStop(t: number) {
    const trk = this.tracks[t];
    if (trk.active) trk.queued = -1;
  }

  private blockTop(row: number, t: number) {
    let top = row;
    while (top > 0 && this.project.song[top - 1][t] != null) top--;
    return top;
  }

  private takeQueued(trk: TrackRt, t: number): boolean {
    const row = trk.queued;
    trk.queued = null;
    if (row == null) return false;
    if (row < 0) {
      trk.active = false;
      return true;
    }
    trk.blockStart = this.blockTop(row, t);
    return this.enterSongRow(trk, t, row);
  }

  /** Advance every track by one tick at audio time `time`. */
  processTick(time: number) {
    if (!this.playing) return;
    for (let t = 0; t < TRACKS; t++) {
      const trk = this.tracks[t];
      const q = this.project.settings.liveQuant === 'BEAT' ? 24 : 96;
      if (!trk.active && trk.queued != null && trk.queued >= 0 && this.clock % q === 0) {
        if (this.takeQueued(trk, t)) this.beginTrack(trk);
      } else if (
        trk.active &&
        trk.queued != null &&
        this.project.settings.liveQuant !== 'CHAIN' &&
        this.clock % q === 0 &&
        this.clock > 0
      ) {
        // LIVE QUANTIZE BAR/BEAT: switch on the grid instead of waiting for the chain to end.
        if (this.takeQueued(trk, t) && trk.active) this.beginTrack(trk);
      }
      this.processTrack(t, time);
    }
    this.clock++;
    this.playing = this.tracks.some((trk) => trk.active || (trk.queued != null && trk.queued >= 0));
  }

  // ---------------------------------------------------------------- structure

  private beginTrack(trk: TrackRt) {
    trk.active = true;
    trk.step = 0;
    trk.tick = 0;
    trk.stepTicks = this.nextStepTicks(trk);
    this.skipEmptySteps(trk, -1);
  }

  /** Point the track at a song row. False if nothing in it can play. */
  private enterSongRow(trk: TrackRt, t: number, row: number): boolean {
    const id = this.project.song[row]?.[t];
    if (id == null) return false;
    trk.songRow = row;
    trk.chainId = id;
    return this.enterChainRow(trk, 0);
  }

  private enterChainRow(trk: TrackRt, row: number): boolean {
    const chain = getChain(this.project, trk.chainId);
    const r = chain.rows[row];
    if (!r || r.phrase == null) return false;
    trk.chainRow = row;
    trk.phraseId = r.phrase;
    trk.chainTsp = toSigned(r.tsp & 0xff);
    return true;
  }

  /**
   * Ticks for the track's current step; a groove value of 00 skips the step entirely. The
   * groove row follows the phrase step (step 0 plays the groove's first row), so a groove
   * never drifts against the phrase or against other tracks on the same groove.
   */
  private nextStepTicks(trk: TrackRt) {
    // A groove loops at its first empty row (M8 manual).
    const all = getGroove(this.project, trk.groove).steps;
    const end = all.findIndex((s) => s == null);
    const steps = (end < 0 ? all : all.slice(0, end)) as number[];
    if (!steps.length) return 6;
    return Math.max(0, steps[trk.step % steps.length]);
  }

  private skipEmptySteps(trk: TrackRt, t: number) {
    for (let guard = 0; trk.active && trk.stepTicks === 0 && guard < ROWS * 4; guard++) {
      this.moveOn(trk, t);
      trk.stepTicks = this.nextStepTicks(trk);
    }
    if (trk.stepTicks === 0) trk.stepTicks = 1;
  }

  private advanceStep(trk: TrackRt, t: number) {
    trk.ret = null;
    if (this.repeat && trk.repSnap && ++trk.repCount >= this.repeat) {
      Object.assign(trk, trk.repSnap);
      trk.repCount = 0;
      trk.stepTicks = this.nextStepTicks(trk);
      this.skipEmptySteps(trk, t);
      return;
    }
    if (trk.remix != null) {
      trk.step = trk.remix;
      trk.remix = null;
    } else this.moveOn(trk, t);
    if (this.repeat && !trk.repSnap) {
      const { songRow, chainId, chainRow, phraseId, step, chainTsp } = trk;
      trk.repSnap = { songRow, chainId, chainRow, phraseId, step, chainTsp };
      trk.repCount = 0;
    }
    if (!trk.active) return;
    trk.stepTicks = this.nextStepTicks(trk);
    this.skipEmptySteps(trk, t);
  }

  private moveOn(trk: TrackRt, t: number) {
    if (trk.songHop != null && this.mode === 'SONG' && t >= 0) {
      const target = trk.songRow + trk.songHop;
      trk.songHop = null;
      if (target >= 0 && target < SONG_ROWS && this.enterSongRow(trk, t, target)) {
        trk.blockStart = this.blockTop(target, t);
        trk.step = 0;
        return;
      }
    }
    trk.songHop = null;
    if (trk.hop != null) {
      const hop = trk.hop;
      trk.hop = null;
      if (hop === 0xff) {
        trk.active = false;
        return;
      }
      // HOP y: row y of the next phrase in the chain (the same phrase in PHRASE mode).
      if (!this.advanceChain(trk, t)) {
        trk.active = false;
        return;
      }
      trk.step = hop & 0xf;
      return;
    }
    if (++trk.step >= ROWS) {
      trk.step = 0;
      if (!this.advanceChain(trk, t)) trk.active = false;
    }
  }

  private advanceChain(trk: TrackRt, t: number): boolean {
    if (this.mode === 'PHRASE') return true;
    if (trk.chainRow + 1 < ROWS && this.enterChainRow(trk, trk.chainRow + 1)) return true;
    if (this.mode === 'CHAIN') return this.enterChainRow(trk, 0);
    return this.advanceSong(trk, t);
  }

  private advanceSong(trk: TrackRt, t: number): boolean {
    if (trk.queued != null && this.takeQueued(trk, t)) return trk.active;
    // An empty song row sends the track back to the top of its block; chains without any
    // phrase are skipped, and a block with nothing playable stops the track.
    let row = trk.songRow;
    for (let guard = 0; guard < SONG_ROWS; guard++) {
      row = row + 1 < SONG_ROWS && this.project.song[row + 1][t] != null ? row + 1 : trk.blockStart;
      if (this.enterSongRow(trk, t, row)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- per tick

  private processTrack(t: number, time: number) {
    const trk = this.tracks[t];
    if (!trk.active) return;
    if (trk.tick === 0) this.loadStep(trk, t, time);
    if (trk.pending && trk.tick === trk.fireTick) {
      const p = trk.pending;
      trk.pending = null;
      // Tables, ARP, bends, RET and KIL started on earlier rows keep counting on this tick
      // too (a row without a note must not cost them a tick every step). A new note restarts
      // them itself; counters the row sets start on the next tick.
      const restarts = p.left && (p.step.note != null || p.step.fx.some((f) => f.cmd === 'INS'));
      if (!restarts) this.continuous(trk, t, time);
      this.fireRow(trk, t, p, time);
    } else {
      this.continuous(trk, t, time);
    }
    if (++trk.tick >= trk.stepTicks) {
      trk.tick = 0;
      this.advanceStep(trk, t);
    }
  }

  private loadStep(trk: TrackRt, t: number, time: number) {
    if (trk.step === 0 && trk.phraseId != null) {
      trk.pass = (trk.passes.get(trk.phraseId) ?? 0) + 1;
      trk.passes.set(trk.phraseId, trk.pass);
    }
    this.onPosition?.(t, time, this.position(t));
    const step = getPhrase(this.project, trk.phraseId).steps[trk.step];
    let left = true;
    let right = true;
    let gate = -1;
    step.fx.forEach((f, i) => {
      if (f.cmd === 'CHA') {
        const x = f.val >> 4;
        const y = f.val & 0xf;
        left &&= x === 0xf || trk.rng() * 15 < x;
        right &&= y === 0xf || trk.rng() * 15 < y;
        if (gate < 0) gate = i;
      } else if (f.cmd === 'NTH') {
        left &&= passOk(f.val >> 4, trk.pass);
        right &&= passOk(f.val & 0xf, trk.pass);
        if (gate < 0) gate = i;
      }
    });
    trk.pending = { step, left, right, gate };
    // GRV / GGR on this row set this row's own length (not only the next row's).
    // GRV / GGR on this row set this row's own length — unless a CHA / NTH gate before them
    // failed, as for every other command.
    const lane = step.fx.findIndex((f, i) => (f.cmd === 'GRV' || f.cmd === 'GGR') && (gate < 0 || (i < gate ? left : right)));
    const grv = lane >= 0 ? step.fx[lane] : null;
    if (grv) {
      if (grv.cmd === 'GGR') {
        // Every track changes groove now, including the step it is already in, so all of them
        // stay in phase (never shorter than what a track has already played of it).
        this.tracks.forEach((other, i) => {
          other.groove = grv.val;
          if (other === trk || !other.active) return;
          const len = Math.max(1, this.nextStepTicks(other));
          // Tracks before this one have already counted this tick (their `tick` is one ahead):
          // if the new length is used up already, they move on now, like this track will.
          if (i < t && other.tick >= len) {
            other.tick = 0;
            this.advanceStep(other, i);
          } else other.stepTicks = Math.max(other.tick + (i < t ? 0 : 1), len);
        });
      } else trk.groove = grv.val;
      trk.stepTicks = Math.max(1, this.nextStepTicks(trk));
    }
    const del = fxOf(step.fx, 'DEL');
    trk.fireTick = del ? Math.min(del.val, trk.stepTicks - 1) : 0;
  }

  /**
   * Values after RNL (randomise the command to its left) and RND (re-run the previously
   * active command with a random value), before anything runs.
   */
  private rolled(trk: TrackRt, fx: FxSlot[]): FxSlot[] {
    const out = fx.map((f) => ({ ...f }));
    out.forEach((f, i) => {
      if (f.cmd === 'RND') {
        const prev = trk.last;
        if (!prev || META.has(prev.cmd)) {
          out[i] = { cmd: null, val: 0 };
          return;
        }
        const hi = ((prev.val >> 4) + Math.floor(trk.rng() * ((f.val >> 4) + 1))) & 0xf;
        const lo = ((prev.val & 0xf) + Math.floor(trk.rng() * ((f.val & 0xf) + 1))) & 0xf;
        out[i] = { cmd: prev.cmd, val: (hi << 4) | lo };
        return;
      }
      if (f.cmd !== 'RNL' || i === 0) return;
      const prev = out[i - 1];
      if (!prev.cmd || META.has(prev.cmd)) return;
      const hi = ((prev.val >> 4) + Math.floor(trk.rng() * ((f.val >> 4) + 1))) & 0xf;
      const lo = ((prev.val & 0xf) + Math.floor(trk.rng() * ((f.val & 0xf) + 1))) & 0xf;
      prev.val = (hi << 4) | lo;
    });
    return out;
  }

  private fireRow(
    trk: TrackRt,
    t: number,
    p: { step: PhraseStep; left: boolean; right: boolean; gate: number },
    time: number,
  ) {
    const { step } = p;
    const fx = this.rolled(trk, step.fx);
    const sideOk = (i: number) => (p.gate < 0 ? true : i < p.gate ? p.left : p.right);
    const live = fx.map((f, i) => (f.cmd && sideOk(i) ? f : null));
    const get = (code: string) => live.find((f) => f?.cmd === code) ?? undefined;

    for (const f of live) if (f && PRE.has(f.cmd!)) this.applyPre(trk, f);

    let note = step.note;
    let inst = step.inst;
    if (fx[0]?.cmd === 'RNL' && sideOk(0) && note != null && note !== NOTE_OFF) {
      const x = fx[0].val >> 4;
      const y = fx[0].val & 0xf;
      note = Math.max(0, Math.min(127, note + Math.round((trk.rng() * 2 - 1) * x)));
      if (inst != null && y) inst = Math.min(127, inst + Math.floor(trk.rng() * (y + 1)));
    }
    const insFx = get('INS');
    if (insFx) inst = insFx.val & 0x7f;

    if (p.left) {
      if (note === NOTE_OFF) {
        trk.arp = null;
        trk.bend = 0;
        this.out.release(t, time);
      } else if (note != null) {
        const id = inst ?? trk.inst;
        if (id != null) {
          this.triggerNote(trk, t, time, note, id, step.vel ?? (inst != null ? 0x7f : trk.vel), {
            legato: inst == null,
            psl: get('PSL')?.val ?? null,
            tbl: get('TBL')?.val ?? null,
            tic: get('TIC')?.val ?? null,
          });
        }
      } else if (insFx && trk.note != null) {
        this.triggerRaw(trk, t, time, trk.note, insFx.val & 0x7f, trk.vel, false);
      } else if (step.vel != null) {
        trk.vel = step.vel & 0x7f;
        trk.rel.VOL = 0;
        this.out.param(t, time, 'VOL', engineVel(trk.vel));
      }
    }

    let commands = 0;
    let repCmd: FxSlot | null = null;
    let repLane = 0;
    for (const [lane, f] of live.entries()) {
      if (!f) continue;
      commands++;
      if (f.cmd === 'REP') {
        repCmd = f;
        repLane = lane;
      }
      else if (f.cmd === 'RTO') {
        if (trk.rep) trk.rep.to = f.val;
      } else if (!PRE.has(f.cmd!) && !META.has(f.cmd!)) this.applyFx(trk, t, f, time, 'phrase');
    }
    if (repCmd) {
      trk.rep =
        repCmd.val && trk.last
          ? { ...trk.last, inc: toSigned(repCmd.val), to: get('RTO')?.val ?? null, lane: repLane, phrase: trk.phraseId }
          : null;
    } else if (commands === 0 && trk.rep) {
      const r = trk.rep;
      let v = r.val + r.inc;
      if (r.to != null) v = r.inc > 0 ? Math.min(v, r.to) : Math.max(v, r.to);
      r.val = clampByte(v);
      this.applyFx(trk, t, { cmd: r.cmd, val: r.val }, time, 'phrase', true);
    } else if (commands > 0) {
      // A new command ends a repeat that started on an earlier row.
      trk.rep = null;
    }
  }

  /** Commands that must be known before the note is triggered. */
  private applyPre(trk: TrackRt, f: FxSlot) {
    const v = f.val;
    switch (f.cmd) {
      case 'TPO':
        if (v > 0) this.tempo = v;
        break;
      case 'GRV':
        trk.groove = v;
        break;
      case 'GGR':
        for (const other of this.tracks) other.groove = v;
        break;
      case 'TSP':
        this.transposeOverride = toSigned(v);
        break;
      case 'HOP':
        trk.hop = v;
        break;
      case 'SNG':
        trk.songHop = toSigned(v);
        break;
      case 'SED':
        trk.rng = mulberry32(v);
        break;
      case 'ARC':
        trk.arcMode = (v >> 4) & 3;
        trk.arcSpeed = Math.max(1, v & 0xf);
        break;
      case 'SCA':
      case 'SCG': {
        // y 0–9 are the built-in scales, A–F the first six user scales.
        const y = v & 0xf;
        const scale = { root: (v >> 4) % 12, name: y < SCALE_NAMES.length ? SCALE_NAMES[y] : USER_SCALE_NAMES[y - SCALE_NAMES.length] };
        for (const other of f.cmd === 'SCG' ? this.tracks : [trk]) other.scale = scale;
        break;
      }
      case 'SLI':
        trk.slice = v;
        break;
      case 'TIC':
        if (trk.table) trk.table.tic = v;
        break;
    }
  }

  private instrumentFor(trk: TrackRt, id: number): Instrument {
    const base = getInstrument(this.project, id);
    const keys = Object.keys(trk.rel).filter((k) => MOD_OFFSETS.has(k) && trk.rel[k]);
    if (!keys.length && trk.slice == null && trk.eqSlot == null) return base;
    const inst: Instrument = { ...base, mods: base.mods.map((m) => ({ ...m })) };
    for (const k of keys) TYPE_OFFSETS[k]?.(inst, trk.rel[k]);
    if (trk.eqSlot != null) inst.eq = trk.eqSlot;
    const envs = inst.mods.filter((m) => m.type === 'AHD' || m.type === 'ADSR');
    const lfos = inst.mods.filter((m) => m.type === 'LFO');
    for (const k of keys) {
      const d = trk.rel[k];
      const n = k.endsWith('2') ? 1 : 0;
      const env = envs[n];
      const lfo = lfos[n];
      if (k.startsWith('EA') && env) env.amt = Math.max(-128, Math.min(127, env.amt + d));
      if (k.startsWith('AT') && env) env.attack = clampByte(env.attack + d);
      if (k.startsWith('HO') && env) env.hold = clampByte(env.hold + d);
      if (k.startsWith('DE') && env) env.decay = clampByte(env.decay + d);
      if (k.startsWith('LA') && lfo) lfo.amt = Math.max(-128, Math.min(127, lfo.amt + d));
      if (k.startsWith('LF') && lfo) lfo.freq = clampByte(lfo.freq + d);
    }
    return inst;
  }

  private triggerNote(
    trk: TrackRt,
    t: number,
    time: number,
    raw: number,
    id: number,
    vel: number,
    o: { legato: boolean; psl: number | null; tbl: number | null; tic: number | null },
  ) {
    const inst = this.instrumentFor(trk, id);
    let played = raw;
    const user = this.project.scales;
    if (trk.scale && trk.scale.name !== 'CHROMATIC') played = Math.min(127, snapToScale(raw, trk.scale.name, trk.scale.root, user));
    // A user scale's tuning (from SCA, or the project scale) bends the note by its cents.
    const sc = trk.scale ?? { name: this.project.settings.scale, root: this.project.settings.scaleRoot };
    trk.tune = scaleTune(played, sc.name, sc.root, user);
    let base = played + trk.chainTsp + (inst.transpose ? this.transpose : 0);
    // SLI: the sampler picks its slice from the note, so aim the note at the slice.
    if (trk.slice != null && inst.type === 'SAMPLER' && inst.sampler.slices > 0) base = 24 + (trk.slice % inst.sampler.slices); // slice 0 = C-1
    trk.slice = null;
    const glideFrom = o.psl != null && trk.note != null ? trk.note : null;
    trk.inst = id;
    trk.vel = vel & 0x7f;
    if (!o.legato) {
      // A note with an instrument resets everything relative, as on the M8.
      trk.rel = Object.fromEntries(Object.entries(trk.rel).filter(([k]) => MOD_OFFSETS.has(k)));
      trk.arp = null;
      trk.arpSemis = 0;
      trk.bend = 0;
      trk.bendCents = 0;
      trk.pit = 0;
      trk.fin = 0;
      trk.kill = -1;
      trk.off = -1;
      trk.ret = null;
      this.startTable(trk, o.tbl ?? id, o.tic ?? inst.tableTic, base, false);
      // The first table row's transpose is part of the note's starting pitch.
      trk.tableTsp = toSigned(getTable(this.project, trk.table!.id).rows[trk.table!.row].tsp & 0xff);
    }
    trk.note = base;
    trk.lastCents = this.cents(trk);
    this.out.trigger({
      track: t,
      time,
      note: base,
      vel: engineVel(this.effectiveVel(trk)),
      instId: id,
      inst,
      cents: trk.lastCents,
      glideFrom,
      glideTime: o.psl != null ? o.psl * this.tickDuration() : 0,
      tickDur: this.tickDuration(),
      legato: o.legato,
    });
    if (!o.legato && trk.table) this.applyTableRow(trk, trk.table, t, time, true);
    if (!o.legato && trk.aux) this.applyTableRow(trk, trk.aux, t, time, true);
  }

  /** Retrigger (RET, INS, NXT): same note, fresh envelopes, table keeps running. */
  private triggerRaw(trk: TrackRt, t: number, time: number, note: number, id: number, vel: number, resetRel: boolean) {
    if (resetRel) trk.rel = {};
    this.out.trigger({
      track: t,
      time,
      note,
      vel: engineVel(vel),
      instId: id,
      inst: this.instrumentFor(trk, id),
      cents: this.cents(trk),
      glideFrom: null,
      glideTime: 0,
      tickDur: this.tickDuration(),
    });
  }

  private startTable(trk: TrackRt, id: number, tic: number, note: number, aux: boolean) {
    const prev = aux ? trk.aux : trk.table;
    let row = 0;
    if (tic === 0 && prev && prev.id === id) row = (prev.row + 1) % ROWS;
    else if (tic === 0xfc) row = Math.floor(note / 12) % ROWS;
    else if (tic === 0xfd) row = Math.floor(trk.vel / 8) % ROWS;
    else if (tic === 0xfe) row = note % 12;
    const tb: TableRt = { id: id % MAX_TABLES, row, tick: 0, tic, hop: null, hops: new Map(), wait: 0, loops: 0, aux };
    if (aux) trk.aux = tb;
    else trk.table = tb;
  }

  private effectiveVel(trk: TrackRt) {
    return Math.max(0, Math.min(127, trk.vel + (trk.rel.VOL ?? 0)));
  }

  /** Commands shared by phrases and tables. */
  private applyFx(trk: TrackRt, t: number, f: FxSlot, time: number, where: 'phrase' | 'table', repeating = false) {
    const cmd = f.cmd!;
    const v = f.val;
    if (!repeating && !META.has(cmd)) trk.last = { cmd, val: v };
    const rel = RELATIVE[cmd];
    if (rel) {
      trk.rel[cmd] = (trk.rel[cmd] ?? 0) + toSigned(v);
      if (rel === 'vel') this.out.param(t, time, 'VOL', engineVel(this.effectiveVel(trk)));
      else {
        const base = trk.inst != null ? (getInstrument(this.project, trk.inst)[rel] as number) : 0x80;
        this.out.param(t, time, cmd as VoiceParam, clampByte(base + trk.rel[cmd]));
      }
      return;
    }
    if (MOD_OFFSETS.has(cmd)) {
      trk.rel[cmd] = (trk.rel[cmd] ?? 0) + toSigned(v);
      // Wavsynth shape and FM levels also move the voice that is playing (so a table can
      // sweep a wave table); the rest shape the next note.
      const live = LIVE[cmd];
      if (live && trk.inst != null) this.out.param(t, time, cmd as VoiceParam, clampByte(live(getInstrument(this.project, trk.inst)) + trk.rel[cmd]));
      return;
    }
    if (FX_BY_CODE[cmd]?.kind === 'mixer') {
      this.out.master(time, cmd, v);
      return;
    }
    switch (cmd) {
      case 'PIT':
        trk.pit += toSigned(v);
        this.emitPitch(trk, t, time);
        break;
      case 'FIN':
        trk.fin += Math.round((toSigned(v) * 100) / 128);
        this.emitPitch(trk, t, time);
        break;
      case 'ARP': {
        const x = v >> 4;
        const y = v & 0xf;
        if (v === 0) {
          trk.arp = null;
          trk.arpSemis = 0;
        } else {
          const up = y ? [0, x, y] : [0, x];
          const seqs = [up, [...up].reverse(), y ? [0, x, y, x] : up, up];
          trk.arp = { seq: seqs[trk.arcMode], pos: 0, tick: 0, random: trk.arcMode === 3, x, y };
          trk.arpSemis = trk.arp.seq[0];
        }
        this.emitPitch(trk, t, time);
        break;
      }
      case 'PBN':
        trk.bend = toSigned(v);
        break;
      case 'PVB':
        this.out.vibrato(t, time, v >> 4, v & 0xf);
        break;
      case 'PVX':
        this.out.vibrato(t, time, (v >> 4) * 2, (v & 0xf) * 4);
        break;
      case 'KIL':
        if (v === 0) this.out.kill(t, time);
        else trk.kill = v;
        break;
      case 'OFF':
        if (v === 0) this.out.release(t, time);
        else trk.off = v;
        break;
      case 'RET': {
        const x = v >> 4;
        const y = v & 0xf;
        // X 0–7 lowers the volume on each retrigger, 8–F raises it (M8 manual).
        if (y) trk.ret = { every: y, volStep: x < 8 ? -x * 8 : (x - 8) * 8, vel: this.effectiveVel(trk), count: 0, single: false };
        else if (x) trk.ret = { every: x, volStep: 0, vel: this.effectiveVel(trk), count: 0, single: true };
        break;
      }
      case 'EQI':
        trk.eqSlot = v & 0x7f;
        break;
      case 'ET1':
      case 'ET2':
        if (v > 0) this.out.retriggerMod?.(t, time, 'ENV', cmd === 'ET2' ? 1 : 0, 0);
        break;
      case 'LT1':
      case 'LT2':
        this.out.retriggerMod?.(t, time, 'LFO', cmd === 'LT2' ? 1 : 0, v);
        break;
      case 'RMX': {
        // Tracks to the left jump to row y of their phrase at their next step.
        const n = v >> 4;
        for (let o = t - 1; o >= 0 && (n === 0 || o >= t - n); o--) {
          if (this.tracks[o].active) this.tracks[o].remix = v & 0xf;
        }
        break;
      }
      case 'NXT':
        if (t + 1 < TRACKS && trk.note != null) this.triggerRaw(this.tracks[t + 1], t + 1, time, trk.note, v & 0x7f, this.effectiveVel(trk), false);
        break;
      case 'THO': {
        const tb = where === 'table' ? trk.table : (trk.table ?? trk.aux);
        if (tb) tb.hop = v & 0xf;
        break;
      }
      case 'TBX':
        if (v === 0) {
          trk.aux = null;
          trk.auxTsp = 0;
          this.emitPitch(trk, t, time);
        } else if (trk.note != null) {
          this.startTable(trk, v, trk.inst != null ? getInstrument(this.project, trk.inst).tableTic : 1, trk.note, true);
          this.applyTableRow(trk, trk.aux!, t, time, false);
        }
        break;
      case 'TPO':
      case 'GRV':
      case 'GGR':
      case 'TSP':
      case 'SED':
      case 'ARC':
      case 'TIC':
      case 'SNG':
        if (where === 'table') this.applyPre(trk, f);
        break;
    }
  }

  private continuous(trk: TrackRt, t: number, time: number) {
    for (const tb of [trk.table, trk.aux]) if (tb) this.runTable(trk, tb, t, time);
    if (trk.arp && ++trk.arp.tick >= trk.arcSpeed) {
      const a = trk.arp;
      a.tick = 0;
      a.pos = a.random ? Math.floor(trk.rng() * a.seq.length) : (a.pos + 1) % a.seq.length;
      trk.arpSemis = a.seq[a.pos];
    }
    if (trk.bend) trk.bendCents = Math.max(-4800, Math.min(4800, trk.bendCents + trk.bend));
    this.emitPitch(trk, t, time);
    if (trk.ret && trk.note != null && trk.inst != null && ++trk.ret.count % trk.ret.every === 0) {
      const r = trk.ret;
      r.vel = Math.max(0, Math.min(127, r.vel + r.volStep));
      trk.rel = Object.fromEntries(Object.entries(trk.rel).filter(([k]) => MOD_OFFSETS.has(k)));
      this.triggerRaw(trk, t, time, trk.note, trk.inst, r.vel, false);
      if (r.single) trk.ret = null;
    }
    if (trk.kill > 0 && --trk.kill === 0) {
      trk.kill = -1;
      this.out.kill(t, time);
    }
    if (trk.off > 0 && --trk.off === 0) {
      trk.off = -1;
      this.out.release(t, time);
    }
  }

  private runTable(trk: TrackRt, tb: TableRt, t: number, time: number) {
    if (tb.wait > 0) {
      tb.wait--;
      return;
    }
    // TIC 00 advances per note, FC–FE are maps set at the trigger: none of them tick.
    if (tb.tic === 0 || (tb.tic >= 0xfc && tb.tic <= 0xfe)) return;
    const rows = tb.tic === 0xff ? Math.max(1, Math.round(200 * this.tickDuration())) : 0;
    if (!rows && ++tb.tick < tb.tic) return;
    tb.tick = 0;
    for (let i = 0; i < Math.max(1, rows); i++) {
      const next = tb.hop ?? (tb.row + 1) % ROWS;
      tb.hop = null;
      if (next <= tb.row) tb.loops++;
      tb.row = next;
      this.applyTableRow(trk, tb, t, time, false);
    }
  }

  private applyTableRow(trk: TrackRt, tb: TableRt, t: number, time: number, first: boolean) {
    const row = getTable(this.project, tb.id).rows[tb.row];
    const fx = this.rolled(trk, row.fx);
    // In a table, CHA xx and NTH xx gate everything to their left.
    let gate = -1;
    let ok = true;
    fx.forEach((f, i) => {
      if (gate >= 0) return;
      if (f.cmd === 'CHA') {
        gate = i;
        ok = f.val === 0xff || trk.rng() * 255 < f.val;
      } else if (f.cmd === 'NTH') {
        gate = i;
        ok = passOk(f.val, tb.loops + 1);
      }
    });
    if (ok) {
      const tsp = toSigned(row.tsp & 0xff);
      if (tb.aux) trk.auxTsp = tsp;
      else trk.tableTsp = tsp;
      if (!first) this.emitPitch(trk, t, time);
      if (row.vel != null) {
        // Table volume scales the phrase velocity.
        const v = Math.round((this.effectiveVel(trk) * (row.vel & 0x7f)) / 0x7f);
        this.out.param(t, time, 'VOL', engineVel(v));
      }
    }
    fx.forEach((f, i) => {
      if (!f.cmd || (gate >= 0 && i < gate && !ok) || META.has(f.cmd)) {
        if (f.cmd === 'DEL' && (gate < 0 || i > gate || ok)) tb.wait = f.val;
        return;
      }
      if (f.cmd === 'HOP') {
        const x = f.val >> 4;
        const count = tb.hops.get(tb.row) ?? 0;
        if (x === 0 || count < x) {
          tb.hop = f.val & 0xf;
          tb.hops.set(tb.row, count + 1);
        } else tb.hops.set(tb.row, 0);
      } else if (f.cmd === 'TIC') tb.tic = f.val;
      else if (f.cmd === 'THO') tb.hop = f.val & 0xf;
      else this.applyFx(trk, t, f, time, 'table');
    });
  }

  private cents(trk: TrackRt) {
    return (trk.tableTsp + trk.auxTsp + trk.arpSemis + trk.pit) * 100 + trk.bendCents + trk.fin + trk.tune;
  }

  private emitPitch(trk: TrackRt, t: number, time: number) {
    const c = this.cents(trk);
    if (c === trk.lastCents) return;
    trk.lastCents = c;
    this.out.pitch(t, time, c, 0);
  }
}
