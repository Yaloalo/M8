import { BUILTIN_SAMPLES } from '../audio/samples';
import type { Project } from '../core/types';
import { demoProject } from './demo';
import { merge3 } from './merge';
import { adoptWithoutSaving, loadProject, onOtherTabSave, savedBase, saveProjectSoon, setSavedBase } from './persist';
import { getState, onProjectChange, rebaseProject, replaceProject, setState, subscribe, type State } from './store';

/** Built-in samples are listed in every project, so SAMPLER can pick them. */
export function withBuiltins(p: Project): Project {
  const samples = { ...p.samples };
  for (const s of BUILTIN_SAMPLES) samples[s.id] = { name: s.name, builtin: true };
  return { ...p, samples };
}

const PLACE = 'eight:place';

/** Where you were (screen, ids, cursors): a reload or a reopened tab comes back to it. */
function restorePlace() {
  try {
    const raw = localStorage.getItem(PLACE);
    if (!raw) return;
    const { view, ids, cursors, track } = JSON.parse(raw) as Pick<State, 'view' | 'ids' | 'cursors' | 'track'>;
    const s = getState();
    if (view in s.cursors) setState({ view, ids: { ...s.ids, ...ids }, cursors: { ...s.cursors, ...cursors }, track: track ?? 0 });
  } catch {
    /* A fresh start on the song screen is fine. */
  }
}

function rememberPlace() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = '';
  const save = () => {
    clearTimeout(timer);
    const { view, ids, cursors, track } = getState();
    const next = JSON.stringify({ view, ids, cursors, track });
    if (next === last) return;
    last = next;
    try {
      localStorage.setItem(PLACE, next);
    } catch {
      /* Storage blocked: nothing to remember. */
    }
  };
  subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(save, 300);
  });
  // A reload right after moving must not lose the place either.
  window.addEventListener('pagehide', save);
}

export async function boot() {
  const saved = await loadProject();
  replaceProject(withBuiltins(saved ?? demoProject()));
  if (!saved) setState({ status: 'DEMO LOADED' });
  else restorePlace();
  rememberPlace();
  onProjectChange(saveProjectSoon);
  setSavedBase(getState().project);
  // Another tab saved the project: its changes are merged into this tab's project and into
  // every undo step (so undo takes back only this tab's own edits). Nothing changed here
  // since the last save: the result is simply its version. Edits of this tab not saved yet
  // stay, and the merged project is saved.
  onOtherTabSave(async () => {
    const p = await loadProject();
    if (!p) return;
    const remote = withBuiltins(p);
    const b = savedBase();
    if (!b) return;
    const clean = getState().project === b;
    if (clean) adoptWithoutSaving(remote);
    else setSavedBase(remote);
    rebaseProject((q) => (q === b ? remote : merge3(b, q, remote)));
    setState({ status: clean ? 'UPDATED FROM ANOTHER TAB' : 'MERGED WITH EDITS FROM ANOTHER TAB' });
  });
}
