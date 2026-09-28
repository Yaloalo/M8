import { renderProject } from '../audio/render';
import { encodeWav } from '../audio/wav';
import { defaultInstrument, unusedInstrument } from '../core/factory';
import { TRACKS, type Project } from '../core/types';
import { onRenderSelection } from '../state/actions';
import { measureSeconds } from '../core/measure';
import { saveSample } from '../state/persist';
import { commit, getState, setState } from '../state/store';
import { addUserSample, allSamples } from '../state/transport';

/** A copy of the project that plays only `tracks`, and only song rows r0..r1 (looping). */
export function rangeProject(p: Project, r0: number, r1: number, tracks: number[]): Project {
  const copy = structuredClone(p);
  for (let t = 0; t < TRACKS; t++) {
    copy.mixer.solo[t] = false;
    copy.mixer.mute[t] = !tracks.includes(t);
    for (let r = 0; r < copy.song.length; r++) if (r < r0 || r > r1 || !tracks.includes(t)) copy.song[r][t] = null;
  }
  return copy;
}

/**
 * M8 "render selection": EDIT EDIT on a song selection while stopped bounces those tracks
 * and rows to a sample and puts it in a new SAMPLER instrument.
 */
onRenderSelection(async ({ r0, r1, c0, c1 }) => {
  const p = getState().project;
  const inst = unusedInstrument(p);
  if (inst == null) return setState({ status: 'NO FREE INSTRUMENT' });
  const copy = rangeProject(p, r0, r1, Array.from({ length: c1 - c0 + 1 }, (_, i) => c0 + i));
  const seconds = measureSeconds(copy, r0);
  if (!seconds) return setState({ status: 'NOTHING TO RENDER' });
  setState({ status: 'RENDERING SELECTION…' });
  try {
    const buf = await renderProject(
      copy,
      { mode: 'SONG', songRow: r0, seconds, tail: 1, onProgress: (f) => setState({ status: `RENDERING ${Math.round(f * 100)}%` }) },
      await allSamples(),
    );
    const bytes = await encodeWav(buf).arrayBuffer();
    const id = `user:${Date.now().toString(36)}:render`;
    await addUserSample(id, bytes);
    await saveSample(id, bytes).catch(() => {});
    commit((d) => {
      d.samples[id] = { name: 'RENDER', builtin: false };
      d.instruments[inst] = { ...defaultInstrument(), type: 'SAMPLER', name: 'RENDER', sampler: { ...defaultInstrument().sampler, sample: id } };
      d.instruments[inst].mods[0].type = 'OFF';
    });
    // The new instrument becomes the default for new notes, as on the M8.
    setState((st) => ({ last: { ...st.last, inst } }));
    setState({ status: `RENDERED TO INSTRUMENT ${inst.toString(16).toUpperCase().padStart(2, '0')}` });
  } catch {
    setState({ status: 'RENDER FAILED' });
  }
});
