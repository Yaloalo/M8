import { Sequencer, type PlayMode } from '../core/sequencer';
import type { Project } from '../core/types';
import { AudioEngine } from './engine';

export interface RenderOptions {
  mode: PlayMode;
  songRow: number;
  track?: number;
  chain?: number;
  phrase?: number;
  seconds: number;
  /** Extra seconds for release and effect tails. */
  tail?: number;
  /** 0–1 as the render advances. */
  onProgress?: (fraction: number) => void;
}

/** Seconds per render window; the sequencer schedules one window ahead. */
const WINDOW = 0.5;
const AHEAD = 0.1;

/**
 * Runs the same sequencer and engine as live playback. The render is suspended every
 * window: notes are scheduled only a little ahead and finished voices are disconnected, so
 * the audio graph stays small and render time grows linearly with the song length.
 */
export async function renderProject(
  project: Project,
  opts: RenderOptions,
  samples: Map<string, AudioBuffer>,
): Promise<AudioBuffer> {
  const sampleRate = 44100;
  const tail = opts.tail ?? 2;
  const total = opts.seconds + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * total), sampleRate);
  const engine = new AudioEngine(ctx, samples);
  const seq = new Sequencer(project, engine);
  engine.setProject(project, seq.tickDuration());
  seq.start(opts);
  // A short lead-in keeps the first transient off sample zero.
  let t = 0.01;
  let stopped = false;
  const scheduleTo = (until: number) => {
    const end = Math.min(until, opts.seconds);
    while (t < end && seq.playing) {
      seq.processTick(t);
      t += seq.tickDuration();
    }
    if (!stopped && (t >= opts.seconds || !seq.playing)) {
      stopped = true;
      engine.stopAll(Math.min(t, opts.seconds));
    }
  };
  scheduleTo(WINDOW + AHEAD);
  const quantum = 128 / sampleRate;
  const next = (at: number) => {
    if (at >= total - quantum) return;
    // Suspend times are rounded to the render quantum; keep them strictly increasing.
    const when = Math.ceil(at / quantum) * quantum;
    void ctx.suspend(when).then(() => {
      engine.collect(when);
      scheduleTo(when + WINDOW + AHEAD);
      opts.onProgress?.(when / total);
      next(when + WINDOW);
      void ctx.resume();
    });
  };
  next(WINDOW);
  const buf = await ctx.startRendering();
  opts.onProgress?.(1);
  return buf;
}
