/** Mixer mute/solo, playback, live recording and the mixer/effects/project snapshot. */
import { getPhrase } from '../../core/factory';
import { noteName as noteNameOf } from '../../core/format';
import { ROWS, TRACKS, type Project } from '../../core/types';
import { nowPlaying, play, preview, stop } from '../transport';
import { commit, getState, setState, type ViewId } from '../store';
import { currentTrack, hex } from './cursor';

// ------------------------------------------------------------------- mixer

export function toggleMute(track = currentTrack()) {
  commit((d) => {
    d.mixer.mute[track] = !d.mixer.mute[track];
  });
}

export function toggleSolo(track = currentTrack()) {
  commit((d) => {
    d.mixer.solo[track] = !d.mixer.solo[track];
  });
}

export function clearMuteSolo() {
  commit((d) => {
    d.mixer.mute = d.mixer.mute.map(() => false);
    d.mixer.solo = d.mixer.solo.map(() => false);
  });
}

// ------------------------------------------------------------------- transport

export function playContext() {
  const s = getState();
  if (s.playing) return stop();
  switch (s.view) {
    case 'CHAIN':
      return void play({ mode: 'CHAIN', songRow: s.cursors.SONG.row, track: s.track, chain: s.ids.chain });
    case 'PHRASE':
    case 'INST':
    case 'MODS':
    case 'TABLE':
    case 'GROOVE':
      return void play({ mode: 'PHRASE', songRow: s.cursors.SONG.row, track: s.track, phrase: s.ids.phrase });
    default:
      return playSong();
  }
}

export function playSong() {
  const s = getState();
  if (s.playing) return stop();
  void play({ mode: 'SONG', songRow: s.cursors.SONG.row });
}

// ------------------------------------------------------------------- live recording

/**
 * Live recording (Polyend REC + play): the note goes to the step playing now on the track
 * that plays this phrase. Hits in the first half of a step stay on it with their offset
 * as DEL (micro-timing); later hits move to the next step.
 */
export function recordLive(note: number): boolean {
  const s = getState();
  const track = [s.track, ...Array.from({ length: TRACKS }, (_, t) => t)].find((t) => s.positions[t]?.active && s.positions[t].phraseId === s.ids.phrase);
  if (track == null) return false;
  const now = nowPlaying(track);
  if (!now || now.phraseId !== s.ids.phrase) return false;
  // The step's real length (groove, swing), and what the listener hears lags by the output
  // latency, so the hit is placed where it was heard.
  const stepTicks = now.stepTicks;
  const ticks = Math.max(0, now.ticks - now.latency / now.tickDur);
  const late = ticks >= stepTicks / 2;
  const row = (now.step + (late ? 1 : 0)) % ROWS;
  const del = late ? 0 : Math.floor(ticks);
  const id = s.ids.phrase;
  const inst = getPhrase(s.project, id).steps.find((st) => st.inst != null)?.inst ?? s.last.inst;
  commit((d) => {
    const st = (d.phrases[id] ??= structuredClone(getPhrase(d, id))).steps[row];
    st.note = note;
    st.inst ??= inst;
    // Micro-timing kept as a DEL in a free FX slot (or the one already holding DEL).
    const slot = st.fx.findIndex((f) => f.cmd === 'DEL' || f.cmd == null);
    if (del > 0 && slot >= 0) st.fx[slot] = { cmd: 'DEL', val: del };
    else if (del === 0 && slot >= 0 && st.fx[slot].cmd === 'DEL') st.fx[slot] = { cmd: null, val: 0 };
  }, `live:${Date.now()}`);
  void preview(track, inst, note, 0xff, true);
  setState((st) => ({ notesEntered: st.notesEntered + 1, lastNoteRow: row, status: `REC ${noteNameOf(note)} → ROW ${hex(row)}${del ? ` DEL ${del}` : ''}` }));
  return true;
}

export function toggleLive() {
  const live = !getState().live;
  setState({ live, status: live ? 'LIVE: SPACE CUES · ← + SPACE CUES ROW · SHIFT + SPACE STOPS' : 'LIVE OFF' });
}

// ------------------------------------------------------------------- snapshots

/** Mixer / Effects / Project: SHIFT + OPTION stores a snapshot, SHIFT + EDIT recalls it (M8). */
let snapshot: Pick<Project, 'mixer' | 'effects' | 'tempo' | 'transpose'> | null = null;

export function storeSnapshot() {
  const { mixer, effects, tempo, transpose } = getState().project;
  snapshot = structuredClone({ mixer, effects, tempo, transpose });
  setState({ status: 'SNAPSHOT STORED · SHIFT + X RECALLS' });
}

export function recallSnapshot() {
  if (!snapshot) return setState({ status: 'NO SNAPSHOT YET · SHIFT + Z STORES ONE' });
  const snap = structuredClone(snapshot);
  commit((d) => {
    d.mixer = snap.mixer;
    d.effects = snap.effects;
    d.tempo = snap.tempo;
    d.transpose = snap.transpose;
  });
  setState({ status: 'SNAPSHOT RECALLED' });
}

export const SNAPSHOT_VIEWS: ViewId[] = ['MIXER', 'EFFECTS', 'PROJECT'];
