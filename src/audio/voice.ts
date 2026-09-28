/** The shapes a playing voice and a track's nodes are kept in. */
import type { Trigger } from '../core/sequencer';
import type { Instrument, LfoShape, Mod } from '../core/types';
import type { FilterHandle } from './filter';
import type { WavHandle } from './waves';

export interface EnvHandle {
  param: AudioParam;
  base: number;
  release: number;
}

export interface Voice {
  track: number;
  inst: Instrument;
  start: number;
  /** Scheduled stop of every source; Infinity while the note sustains. */
  end: number;
  sources: AudioScheduledSourceNode[];
  detunes: AudioParam[];
  nodes: AudioNode[];
  filter: FilterHandle | null;
  drive: GainNode | null;
  env: GainNode | null;
  level: GainNode | null;
  fade: GainNode | null;
  pan: StereoPannerNode | null;
  /** Send gains, created on first use: a send at 00 costs nothing until SCH/SDL/SRV raise it. */
  sends: Partial<Record<'SCH' | 'SDL' | 'SRV', GainNode>> | null;
  /** ADSR envelopes waiting for a note-off. */
  adsr: EnvHandle[];
  volumeAdsr: boolean;
  fine: number;
  /** Note the sources were tuned to; legato retunes relative to it. */
  note: number;
  /** Legato offset from `note`, in cents. */
  noteCents: number;
  released: boolean;
  vib: { osc: OscillatorNode; gain: GainNode } | null;
  fadeAt?: number;
  midi: { channel: number; note: number } | null;
  /** Connections from shared nodes (free-running LFOs) into this voice, undone on cleanup. */
  detach: (() => void)[];
  /** The voice was built without its limiter shaper; drive gains are scaled to match. */
  plainDrive: boolean;
  /** What ET/LT can restart: envelopes and LFOs in mod-slot order. */
  mods: ModHandle[];
  /** The trigger that started this voice, for an ET on the volume envelope. */
  trig: Trigger;
  /** Wavsynth: the single-cycle path, and (once SCAN/WARP/SIZE/MULT move) the crossfade bank. */
  wav: WavHandle | null;
  /** FM: operator gains and the gain a level of FF means for each (modulator index or carrier level). */
  ops: { g: GainNode; full: number }[] | null;
  /** Hypersynth: the detuned oscillators and their side (−1 / +1) for SWARM. */
  swarm: { detune: AudioParam; k: number }[] | null;
  /** Last pitch offset applied, so oscillators added later start in tune. */
  cents: number;
}


export type ModHandle =
  | { kind: 'ENV'; mod: Mod; param: AudioParam; base: number; peak: number; volume: boolean; trig?: boolean }
  | { kind: 'LFO'; mod: Mod; slot: number; signal: AudioScheduledSourceNode | null; gains: GainNode[]; free: boolean };

export interface FreeLfo {
  osc: OscillatorNode;
  shape: LfoShape;
  /** The rotation it was built with (LT), and its phase `q0` at `t0` running at `hz`. */
  rot: number;
  t0: number;
  q0: number;
  hz: number;
}

export interface TrackNodes {
  bus: GainNode;
  analyser: AnalyserNode;
  cho: GainNode;
  del: GainNode;
  rev: GainNode;
  /** Perform-screen nodes, neutral unless a pad or slider is held. */
  perf: {
    low: BiquadFilterNode;
    high: BiquadFilterNode;
    gain: GainNode;
    pan: StereoPannerNode;
    rev: GainNode;
    del: GainNode;
  };
}

/** What an instrument type's source builder adds its nodes to. */
export interface SourceKit {
  c: BaseAudioContext;
  /** Note start. */
  t: number;
  f0: number;
  /** The voice mix every source ends in. */
  mix: GainNode;
  sources: AudioScheduledSourceNode[];
  detunes: AudioParam[];
  nodes: AudioNode[];
  noise: AudioBuffer;
  /** An oscillator started at `t`, registered as a source with its detune. */
  osc(type: OscillatorType | PeriodicWave, freq: number): OscillatorNode;
}
