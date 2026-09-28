/**
 * The instrument pool's actions (M8 Instrument Pool view): pick into the phrase it was
 * opened from, edit the mixer columns, move and clear slots.
 */
import { defaultInstrument, getPhrase } from '../core/factory';
import { goTo, moveTo } from './actions';
import { commit, getState, setState } from './store';

const hex = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
const cursor = () => getState().cursors.POOL;

/** The phrase cell the pool was opened from (EDIT + ↓ below 00): picking writes back there. */
let poolOrigin: { phrase: number; row: number } | null = null;
let pendingPoolPick = false;

export const setPoolOrigin = (o: { phrase: number; row: number }) => (poolOrigin = o);
/** Leaving the pool any way but a pick forgets where it was opened from. */
export const forgetPoolOrigin = () => (poolOrigin = null);
/** EDIT pressed in the pool: pick on release unless an arrow turned it into an edit. */
export const armPoolPick = () => (pendingPoolPick = true);
export function takePoolPick() {
  const was = pendingPoolPick;
  pendingPoolPick = false;
  return was;
}

const POOL_PARAMS = ['dry', 'cho', 'del', 'rev'] as const;

/** Pick the pool's highlighted instrument: into the phrase it was opened from, or open it. */
export function poolPick(back: boolean) {
  const s = getState();
  const id = cursor().row;
  if (!s.project.instruments[id]) {
    commit((d) => {
      d.instruments[id] = { ...defaultInstrument(), type: 'WAVSYNTH' };
    });
  }
  setState((st) => ({ ids: { ...st.ids, inst: id }, last: { ...st.last, inst: id }, instPinned: true }));
  if (poolOrigin) {
    const o = poolOrigin;
    poolOrigin = null;
    commit((d) => {
      (d.phrases[o.phrase] ??= structuredClone(getPhrase(d, o.phrase))).steps[o.row].inst = id;
    });
    setState((st) => ({ ids: { ...st.ids, phrase: o.phrase } }));
    goTo('PHRASE');
    moveTo('PHRASE', o.row, 2);
    return;
  }
  goTo(back ? 'PHRASE' : 'INST');
}

/** Pool: move the highlighted slot up (+1) or down (−1), with every reference. */
export function poolMove(dir: 1 | -1) {
  if (getState().view === 'POOL') poolEdit(true, dir, true);
}

/** Pool: clear the highlighted slot (OPTION + EDIT). */
export function poolClear() {
  const s = getState();
  const id = cursor().row;
  if (!s.project.instruments[id]) return;
  let used = 0;
  for (const ph of Object.values(s.project.phrases)) for (const st of ph.steps) if (st.inst === id) used++;
  commit((d) => {
    delete d.instruments[id];
  });
  // Allowed, as on the M8, but never silent about what it did.
  setState({ status: used ? `CLEARED ${hex(id)} · ${used} STEP${used > 1 ? 'S' : ''} NOW SILENT (UNDO: CTRL+Z)` : `CLEARED ${hex(id)}` });
}

/** Pool, EDIT + arrows: mixer columns change; on the number column ↑↓ moves the slot. */
export function poolEdit(coarse: boolean, dir: 1 | -1, vertical: boolean) {
  const s = getState();
  pendingPoolPick = false;
  const { row, col } = cursor();
  if (col > 0) {
    const key = POOL_PARAMS[col - 1];
    if (!s.project.instruments[row]) return;
    commit((d) => {
      const i = d.instruments[row];
      i[key] = Math.max(0, Math.min(255, i[key] + dir * (coarse ? 16 : 1)));
    }, `pool:${row}:${key}`);
    return;
  }
  if (!vertical && coarse) return;
  const other = row - dir;
  if (other < 0 || other > 127) return;
  // Swap two slots and every reference to them, so the song sounds the same.
  const swap = (v: number | null) => (v === row ? other : v === other ? row : v);
  commit((d) => {
    const a = d.instruments[row];
    const b = d.instruments[other];
    if (b) d.instruments[row] = b;
    else delete d.instruments[row];
    if (a) d.instruments[other] = a;
    else delete d.instruments[other];
    const ta = d.tables[row];
    const tb = d.tables[other];
    if (tb) d.tables[row] = tb;
    else delete d.tables[row];
    if (ta) d.tables[other] = ta;
    else delete d.tables[other];
    for (const ph of Object.values(d.phrases)) for (const st of ph.steps) st.inst = swap(st.inst);
  });
  moveTo('POOL', other, 0);
  setState({ status: `MOVED ${hex(row)} → ${hex(other)}` });
}


const DEFAULTS = { dry: 0xc0, cho: 0, del: 0, rev: 0 } as const;
let valueClip: number | null = null;

/** On a mixer column (VOL–REV): OPTION + EDIT resets that value, not the instrument. */
export function poolResetValue(): boolean {
  const { row, col } = cursor();
  if (col === 0) return false;
  const key = POOL_PARAMS[col - 1];
  if (!getState().project.instruments[row]) return true;
  commit((d) => {
    d.instruments[row][key] = DEFAULTS[key];
  });
  setState({ status: `${key.toUpperCase()} ${hex(row)} RESET` });
  return true;
}

/** SHIFT + OPTION on a mixer column copies the value; on the number column, the instrument. */
export function poolCopyValue(): boolean {
  const { row, col } = cursor();
  if (col === 0) return false;
  const i = getState().project.instruments[row];
  if (i) {
    valueClip = i[POOL_PARAMS[col - 1]];
    setState({ status: `COPIED ${hex(valueClip)}` });
  }
  return true;
}

export function poolPasteValue(): boolean {
  const { row, col } = cursor();
  if (col === 0) return false;
  if (valueClip == null || !getState().project.instruments[row]) return true;
  const v = valueClip;
  commit((d) => {
    d.instruments[row][POOL_PARAMS[col - 1]] = v;
  });
  setState({ status: `PASTED ${hex(v)}` });
  return true;
}
