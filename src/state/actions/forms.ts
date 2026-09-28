/** Form screens: field edits and defaults, EQ and instrument copy/paste. */
import { getInstrument, newProject } from '../../core/factory';
import { nudgeField, type FieldValue } from '../../core/forms';
import { EQ_SLOTS, type Eq, type Instrument } from '../../core/types';
import { formFor } from '../fields';
import { commit, getState, setState, type ViewId } from '../store';
import { cursor, goTo, hex, moveTo } from './cursor';

// ------------------------------------------------------------------- forms

export function nudgeFormField(coarse: boolean, dir: 1 | -1) {
  const s = getState();
  const { fields, id } = formFor(s);
  const f = fields[cursor(s).row];
  if (!f || f.type === 'text') return;
  setField(s.view, cursor(s).row, nudgeField(f, f.get(s.project, id), coarse, dir));
}

export function setField(view: ViewId, row: number, v: FieldValue) {
  const s = getState();
  const { fields, id } = formFor(s, view);
  const f = fields[row];
  if (!f) return;
  commit((d) => {
    f.set(d, id, v);
  }, `${view}:${id}:${f.key}`);
  if (f.key === 'SAMPLER.play' && typeof v === 'string' && v.startsWith('REV')) {
    // Reversed one-shots start with their quiet tail: a short volume envelope ends first.
    const i = getState().project.instruments[id];
    const env = i?.mods.find((m) => m.dest === 'VOLUME' && m.type !== 'OFF');
    if (env && env.type !== 'LFO' && env.decay + env.hold < 0x40) setState({ status: 'REVERSE: LENGTHEN THE VOLUME ENVELOPE (MODS) OR TURN IT OFF TO HEAR THE ATTACK' });
  }
  // A mod type change can shorten the field list; keep the cursor on it.
  const again = formFor(getState(), view).fields;
  const at = again.findIndex((x) => x.key === f.key);
  moveTo(view, at >= 0 ? at : row, 0);
}

let instClip: Instrument | null = null;
let eqClip: Eq | null = null;

export function copyEq() {
  const s = getState();
  eqClip = structuredClone(s.project.eqs[s.ids.eq]);
  setState({ status: `COPIED EQ ${hex(s.ids.eq)}` });
}

export function pasteEq() {
  const s = getState();
  if (!eqClip) return;
  const copy = structuredClone(eqClip);
  commit((d) => {
    d.eqs[s.ids.eq] = copy;
  });
  setState({ status: `PASTED INTO EQ ${hex(s.ids.eq)}` });
}

export function toggleEqMute() {
  const s = getState();
  commit((d) => {
    d.eqs[s.ids.eq].muted = !d.eqs[s.ids.eq].muted;
  });
  setState({ status: getState().project.eqs[s.ids.eq].muted ? `EQ ${hex(s.ids.eq)} MUTED` : `EQ ${hex(s.ids.eq)} ON` });
}

/** EDIT on an instrument's or the mixer's EQ field opens that slot in the EQ editor. */
export function openEqFromField(): boolean {
  const s = getState();
  if (s.view !== 'INST' && s.view !== 'MIXER') return false;
  const { fields, id } = formFor(s);
  const f = fields[cursor(s).row];
  if (!f || !f.key.endsWith('.eq')) return false;
  let slot = f.get(s.project, id) as number;
  if (slot < 0) {
    // No EQ yet: take the first slot nobody uses and assign it.
    const used = new Set([s.project.mixer.eq, ...Object.values(s.project.instruments).map((i) => i.eq)]);
    slot = Array.from({ length: EQ_SLOTS }, (_, i) => i).find((i) => !used.has(i)) ?? 0;
    setField(s.view, cursor(s).row, slot);
  }
  setState({ ids: { ...getState().ids, eq: slot }, eqReturn: s.view });
  goTo('EQ');
  return true;
}

/** The instrument copy/paste act on: the pool's highlighted slot, or the open instrument. */
const instTarget = (s = getState()) => (s.view === 'POOL' ? s.cursors.POOL.row : s.ids.inst);

export function copyInstrument() {
  const s = getState();
  const id = instTarget(s);
  if (s.view === 'POOL' && !s.project.instruments[id]) return;
  instClip = structuredClone(getInstrument(s.project, id));
  setState({ status: `COPIED INSTRUMENT ${hex(id)}` });
}

export function pasteInstrument() {
  const s = getState();
  if (!instClip) return;
  const id = instTarget(s);
  const copy = structuredClone(instClip);
  commit((d) => {
    d.instruments[id] = copy;
  });
  setState({ status: `PASTED INTO ${hex(id)}` });
}

/** OPTION + EDIT on a parameter: back to its default (M8 "cut or set to default"). */
export function resetField() {
  const s = getState();
  const { fields, id } = formFor(s);
  const f = fields[cursor(s).row];
  if (!f || f.type === 'text') return;
  setField(s.view, cursor(s).row, f.get(newProject(), id));
}
