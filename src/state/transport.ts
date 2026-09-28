/**
 * Owns the AudioContext, the engine and the sequencer. The sequencer runs ahead of the
 * audio clock (lookahead scheduling); positions it reports are queued with their audio
 * timestamps and handed to the UI only when the sound actually plays.
 */
import { AudioEngine, type TrackPerformParam } from '../audio/engine';
import { BUILTIN_SAMPLES, decodeSample, renderBuiltins } from '../audio/samples';
import { getInstrument } from '../core/factory';
import { Sequencer, type Position, type StartOptions } from '../core/sequencer';
import { TRACKS, type Project } from '../core/types';
import { loadSamples } from './persist';
import { getState, onProjectChange, setState } from './store';

/**
 * Schedule this far ahead: comfortably longer than a slow frame (a screen switch can block
 * the main thread for ~100 ms), short enough that edits are heard within a beat.
 */
const LOOKAHEAD = 0.25;
/** While a heavy screen change renders, schedule further ahead so no note arrives late. */
const BUSY_LOOKAHEAD = 0.7;
let busyUntil = 0;

/** Call before something that may block the main thread (a screen switch). */
export function expectBusy() {
  busyUntil = performance.now() + 1500;
  schedule();
}
const INTERVAL = 25;

/**
 * The scheduling clock runs in a Worker: timers there are not throttled in background tabs
 * the way main-thread setInterval is.
 */
let clock: Worker | null = null;
function startClock() {
  try {
    if (!clock) {
      const src = `let id=0;onmessage=e=>{clearInterval(id);if(e.data==='start')id=setInterval(()=>postMessage(0),${INTERVAL});};`;
      clock = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      clock.onmessage = () => schedule();
    }
    clock.postMessage('start');
  } catch {
    clock = null;
    timer = setInterval(schedule, INTERVAL);
  }
}
function stopClock() {
  clock?.postMessage('stop');
  clearInterval(timer);
  timer = undefined;
}

let ctx: AudioContext | null = null;
let engine: AudioEngine | null = null;
let seq: Sequencer | null = null;
let samples = new Map<string, AudioBuffer>();
let timer: ReturnType<typeof setInterval> | undefined;
let nextTime = 0;
let queue: { time: number; track: number; pos: Position }[] = [];
let raf = 0;
let booting: Promise<void> | null = null;

/** Audio may only start from a user gesture, so everything is created lazily here. */
export function ensureAudio(): Promise<void> {
  if (booting) return booting.then(() => void ctx?.resume());
  booting = (async () => {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    const builtins = await renderBuiltins(ctx.sampleRate);
    samples = new Map(builtins);
    for (const [id, data] of await loadSamples()) {
      try {
        samples.set(id, await decodeSample(ctx, data.slice(0)));
      } catch {
        /* A sample that no longer decodes plays as silence. */
      }
    }
    engine = new AudioEngine(ctx, samples);
    const p = getState().project;
    seq = new Sequencer(p, engine);
    seq.onPosition = (track, time, pos) => queue.push({ time, track, pos });
    engine.setProject(p, seq.tickDuration());
    await applyMidiOutput(p.settings.midiOut);
  })();
  return booting.then(() => void ctx?.resume());
}

onProjectChange((p) => {
  if (seq) seq.project = p;
  if (seq && !seq.playing) seq.tempo = p.tempo;
  if (engine && seq) engine.setProject(p, seq.tickDuration());
  void applyMidiOutput(p.settings.midiOut);
});

let midiAccess: MIDIAccess | null = null;
let midiName: string | null | undefined;
async function applyMidiOutput(name: string | null) {
  if (name === midiName || !engine) return;
  midiName = name;
  if (!name) {
    engine.setMidiOutput(null);
    return;
  }
  try {
    midiAccess ??= await navigator.requestMIDIAccess();
    const out = [...midiAccess.outputs.values()].find((o) => o.name === name) ?? null;
    engine.setMidiOutput(out);
  } catch {
    engine.setMidiOutput(null);
  }
}

export async function midiOutputNames(): Promise<string[]> {
  try {
    if (!('requestMIDIAccess' in navigator)) return [];
    midiAccess ??= await navigator.requestMIDIAccess();
    return [...midiAccess.outputs.values()].map((o) => o.name ?? 'MIDI OUT');
  } catch {
    return [];
  }
}

function schedule() {
  if (!ctx || !seq) return;
  const ahead = performance.now() < busyUntil ? BUSY_LOOKAHEAD : LOOKAHEAD;
  while (nextTime < ctx.currentTime + ahead && seq.playing) {
    seq.processTick(nextTime);
    nextTime += seq.tickDuration();
  }
  if (!seq.playing) stop();
}

/** When each track's current step started sounding (audio time), for live recording. */
const stepStart: { time: number; step: number; phraseId: number | null; stepTicks: number }[] = Array.from({ length: TRACKS }, () => ({ time: 0, step: 0, phraseId: null, stepTicks: 6 }));

/**
 * Where a track is right now in audio time: its phrase step and how many ticks into it.
 * The UI's positions trail the scheduler, so this is what a live note should land on.
 */
export function nowPlaying(
  track: number,
): { phraseId: number | null; step: number; ticks: number; tickDur: number; stepTicks: number; latency: number } | null {
  if (!ctx || !seq?.playing || !seq.tracks[track].active) return null;
  const at = stepStart[track];
  const tickDur = seq.tickDuration();
  const latency = (ctx as AudioContext & { outputLatency?: number }).outputLatency || ctx.baseLatency || 0;
  return { phraseId: at.phraseId, step: at.step, ticks: Math.max(0, (ctx.currentTime - at.time) / tickDur), tickDur, stepTicks: at.stepTicks, latency };
}

function frame() {
  if (!ctx) return;
  const now = ctx.currentTime;
  let changed = false;
  const positions = [...getState().positions];
  while (queue.length && queue[0].time <= now) {
    const e = queue.shift()!;
    // Queued rows change after positions were scheduled; always show the live value.
    positions[e.track] = { ...e.pos, queued: seq?.tracks[e.track].queued ?? null };
    stepStart[e.track] = { time: e.time, step: e.pos.step, phraseId: e.pos.phraseId, stepTicks: e.pos.stepTicks };
    changed = true;
  }
  if (changed) setState({ positions });
  raf = requestAnimationFrame(frame);
}

export async function play(o: StartOptions) {
  await ensureAudio();
  if (!ctx || !seq || !engine) return;
  stop();
  seq.project = getState().project;
  if (!seq.start(o)) {
    setState({ status: 'NOTHING TO PLAY HERE' });
    return;
  }
  nextTime = ctx.currentTime + 0.05;
  queue = [];
  startClock();
  schedule();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  setState({ playing: true, playMode: o.mode, status: '' });
}

export function stop() {
  engine?.trackPerformReset();
  stopClock();
  if (seq?.playing && ctx) seq.stop(ctx.currentTime);
  else if (ctx && engine) engine.stopAll(ctx.currentTime);
  cancelAnimationFrame(raf);
  queue = [];
  if (getState().playing) {
    setState({
      playing: false,
      positions: getState().positions.map((p) => ({ ...p, active: false })),
    });
  }
}

/** Live mode: queue a song row on a track (or on every track that has a chain there). */
export function queueRow(row: number, track?: number) {
  if (!seq?.playing || seq.mode !== 'SONG') return false;
  const p = getState().project;
  const tracks = track == null ? [...Array(TRACKS).keys()] : [track];
  for (const t of tracks) if (p.song[row][t] != null) seq.queue(t, row);
  setState({ positions: getState().positions.map((pos, t) => ({ ...pos, queued: seq!.tracks[t].queued })) });
  return true;
}

/** Perform screen: a mixer/effect command now, bypassing the song. */
export function perform(param: string, value: number) {
  if (!ctx || !engine) return;
  engine.master(ctx.currentTime, param, value);
}

/** Perform screen: momentary per-track moves (filter, volume, pan, throws). */
export function trackPerform(tracks: number[], param: TrackPerformParam, value: number) {
  if (!engine) return;
  for (const t of tracks) engine.trackPerform(t, param, value);
}

export function trackPerformReset(tracks?: number[]) {
  if (!engine) return;
  if (!tracks) engine.trackPerformReset();
  else for (const t of tracks) engine.trackPerformReset(t);
}

/** Replace a sample's audio for playback (sample editor results). */
export function sampleBuffer(id: string): AudioBuffer | undefined {
  return samples.get(id);
}

export function beatRepeat(steps: number | null) {
  seq?.setRepeat(steps);
}

/** Live mode: stop one track when its current chain ends. */
export function queueStopTrack(track: number) {
  if (!seq?.playing) return;
  seq.queueStop(track);
}

export function isPlaying() {
  return !!seq?.playing;
}

/** Hear a note while editing. Skipped during playback, where the song is the preview. */
export async function preview(track: number, instId: number | null, note: number, vel = 0xff, live = false) {
  if (instId == null || note > 127) return;
  // While playing, only live-recorded notes sound (the song is the preview otherwise).
  if (isPlaying() && !live) return;
  await ensureAudio();
  const p = getState().project;
  engine?.preview(track, getInstrument(p, instId), instId, note, vel);
}

export function levels(): number[] {
  return engine?.levels() ?? Array.from({ length: TRACKS }, () => 0);
}

export function analyser(): AnalyserNode | null {
  return engine?.analyser ?? null;
}

export async function addUserSample(id: string, data: ArrayBuffer) {
  await ensureAudio();
  if (!ctx || !engine) return;
  const buf = await decodeSample(ctx, data.slice(0));
  samples.set(id, buf);
  engine.addSample(id, buf);
}

export async function allSamples() {
  await ensureAudio();
  return samples;
}

export const builtinSamples = BUILTIN_SAMPLES;

export function applyProjectToEngine(p: Project) {
  if (engine && seq) engine.setProject(p, seq.tickDuration());
}
