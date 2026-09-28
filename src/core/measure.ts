import { Sequencer, type Output } from './sequencer';
import { TRACKS, type Project } from './types';

const silent: Output = {
  trigger() {},
  release() {},
  kill() {},
  param() {},
  pitch() {},
  vibrato() {},
  master() {},
  stopAll() {},
};

/**
 * How long one pass of the song from `songRow` lasts, found by running the sequencer
 * silently: grooves, TPO, HOP and chains of any length count. A pass ends when every track
 * that started is back at its starting step (or has stopped). Capped at `maxSeconds`.
 */
export function measureSeconds(p: Project, songRow: number, maxSeconds = 600): number {
  const seq = new Sequencer(p, silent, () => 0.5);
  if (!seq.start({ mode: 'SONG', songRow })) return 0;
  const startKey = (t: number) => {
    const pos = seq.position(t);
    return `${pos.songRow}:${pos.chainRow}:${pos.step}`;
  };
  const start = Array.from({ length: TRACKS }, (_, t) => (seq.tracks[t].active ? startKey(t) : null));
  const done = start.map((k) => k == null);
  let seconds = 0;
  let longest = 0;
  let ticks = 0;
  seq.onPosition = (t) => {
    if (done[t] || ticks === 0) return;
    if (startKey(t) === start[t]) {
      done[t] = true;
      longest = Math.max(longest, seconds);
    }
  };
  while (seconds < maxSeconds && !done.every(Boolean) && seq.playing) {
    seq.processTick(seconds);
    seconds += seq.tickDuration();
    ticks++;
    for (let t = 0; t < TRACKS; t++) {
      if (!done[t] && !seq.tracks[t].active) {
        done[t] = true;
        longest = Math.max(longest, seconds);
      }
    }
  }
  return Math.min(maxSeconds, Math.max(longest, done.every(Boolean) ? longest : seconds));
}
