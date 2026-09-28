/** Grid selections and the clipboard: copy, cut, paste, fill, interpolate, move and randomise blocks. */
import { getPhrase } from '../../core/factory';
import { fillSteps, type FillOptions } from '../../core/fill';
import { fromSigned, toSigned } from '../../core/fx';
import { GRIDS, nudge, type Cell } from '../../core/grids';
import { NOTE_OFF, ROWS } from '../../core/types';
import { commit, getState, setState, type Cursor } from '../store';
import { cursor, dims, gridId, isGridView, moveTo, type Dir } from './cursor';

// ------------------------------------------------------------------- selection & clipboard

export function selectionRect(s = getState()) {
  if (!s.selection || s.selection.view !== s.view) return null;
  const a = s.selection.anchor;
  const b = cursor(s);
  return {
    r0: Math.min(a.row, b.row),
    r1: Math.max(a.row, b.row),
    c0: Math.min(a.col, b.col),
    c1: Math.max(a.col, b.col),
  };
}

export function beginSelection(anchor?: Cursor) {
  const s = getState();
  if (!isGridView(s.view)) return;
  setState({ selection: { view: s.view, anchor: anchor ?? { ...cursor(s) } } });
}

/** SHIFT + OPTION: start a selection; again widens it to whole rows, then the whole grid. */
export function toggleSelection() {
  const s = getState();
  if (!isGridView(s.view)) return;
  const rect = selectionRect(s);
  const d = dims(s.view);
  if (!rect) return beginSelection();
  const c = cursor(s);
  if (rect.c0 !== 0 || rect.c1 !== d.cols - 1) {
    setState({ selection: { view: s.view, anchor: { row: rect.r0, col: 0 } } });
    moveTo(s.view, rect.r1, d.cols - 1);
  } else if (s.view !== 'SONG' && (rect.r0 !== 0 || rect.r1 !== d.rows - 1)) {
    setState({ selection: { view: s.view, anchor: { row: 0, col: 0 } } });
    moveTo(s.view, d.rows - 1, d.cols - 1);
  } else {
    setState({ selection: null });
    moveTo(s.view, c.row, c.col);
  }
}

export function copySelection(clear = false) {
  const s = getState();
  if (!isGridView(s.view)) return;
  const rect = selectionRect(s) ?? { r0: cursor(s).row, r1: cursor(s).row, c0: cursor(s).col, c1: cursor(s).col };
  const spec = GRIDS[s.view];
  const id = gridId(s.view);
  const cells: Cell[][] = [];
  for (let r = rect.r0; r <= rect.r1; r++) {
    const row: Cell[] = [];
    for (let c = rect.c0; c <= rect.c1; c++) row.push(spec.get(s.project, id, r, c));
    cells.push(row);
  }
  const kinds = spec.columns.slice(rect.c0, rect.c1 + 1).map((c) => c.kind);
  setState({ clipboard: { kinds, cells }, selection: null, status: `${clear ? 'CUT' : 'COPIED'} ${cells.length}×${kinds.length}` });
  moveTo(s.view, rect.r0, rect.c0);
  if (clear) clearRect(rect);
}

export function paste() {
  const s = getState();
  if (!isGridView(s.view) || !s.clipboard) return;
  const spec = GRIDS[s.view];
  const id = gridId(s.view);
  const c = cursor(s);
  const { kinds, cells } = s.clipboard;
  commit((d) => {
    cells.forEach((row, r) =>
      row.forEach((v, k) => {
        const col = c.col + k;
        const rr = c.row + r;
        if (rr >= spec.rows || col >= spec.columns.length) return;
        if (spec.columns[col].kind !== kinds[k]) return;
        spec.set(d, id, rr, col, v);
      }),
    );
  });
  setState({ status: 'PASTED' });
}

function clearRect(rect: { r0: number; r1: number; c0: number; c1: number }) {
  const s = getState();
  if (!isGridView(s.view)) return;
  const spec = GRIDS[s.view];
  const id = gridId(s.view);
  commit((d) => {
    // Values first, then commands, so clearing a command does not skip its value.
    for (let r = rect.r0; r <= rect.r1; r++)
      for (let c = rect.c1; c >= rect.c0; c--) {
        const kind = spec.columns[c].kind;
        spec.set(d, id, r, c, kind === 'tsp' || kind === 'ttsp' ? 0 : null);
      }
  });
}

export function clearSelection() {
  const rect = selectionRect();
  if (!rect) return;
  clearRect(rect);
  setState({ selection: null });
}

export function nudgeSelection(coarse: boolean, dir: 1 | -1) {
  const s = getState();
  const rect = selectionRect(s);
  if (!rect || !isGridView(s.view)) return;
  const spec = GRIDS[s.view];
  const id = gridId(s.view);
  commit((d) => {
    for (let r = rect.r0; r <= rect.r1; r++)
      for (let c = rect.c0; c <= rect.c1; c++) {
        const kind = spec.columns[c].kind;
        const v = spec.get(d, id, r, c);
        if (v == null || (kind === 'note' && v === NOTE_OFF)) continue;
        spec.set(d, id, r, c, nudge(kind, v, coarse, dir));
      }
  }, `selnudge:${s.view}`);
}

/** Polyend "Invert": reverse the selected rows (whole grid when nothing is selected). */
export function reverseRows() {
  const s = getState();
  if (!isGridView(s.view)) return;
  const d0 = dims(s.view);
  const rect = selectionRect(s) ?? { r0: 0, r1: Math.min(d0.rows, ROWS) - 1, c0: 0, c1: d0.cols - 1 };
  const spec = GRIDS[s.view];
  const id = gridId(s.view);
  commit((d) => {
    const snapshot: Cell[][] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      const row: Cell[] = [];
      for (let c = rect.c0; c <= rect.c1; c++) row.push(spec.get(d, id, r, c));
      snapshot.push(row);
    }
    snapshot.reverse().forEach((row, i) => row.forEach((v, k) => spec.set(d, id, rect.r0 + i, rect.c0 + k, v)));
  });
}

export function fill(o: FillOptions) {
  const s = getState();
  if (s.view !== 'PHRASE') return;
  const rect = selectionRect(s) ?? { r0: 0, r1: ROWS - 1, c0: 0, c1: 0 };
  const id = s.ids.phrase;
  commit((d) => {
    const ph = getPhrase(d, id);
    const range = ph.steps.slice(rect.r0, rect.r1 + 1);
    const filled = fillSteps(range, o);
    const target = (d.phrases[id] ??= structuredClone(ph));
    filled.forEach((st, i) => (target.steps[rect.r0 + i] = st));
  });
  setState({ status: 'FILLED', fillOpen: false });
}

/** SHIFT + EDIT on a one-column selection: a straight line from the first value to the last. */
export function interpolate(): boolean {
  const s = getState();
  const rect = selectionRect(s);
  if (!rect || !isGridView(s.view) || rect.c0 !== rect.c1 || rect.r1 === rect.r0) return false;
  const spec = GRIDS[s.view];
  const kind = spec.columns[rect.c0].kind;
  if (kind === 'fxcmd') return false;
  const id = gridId(s.view);
  const a = spec.get(s.project, id, rect.r0, rect.c0);
  const b = spec.get(s.project, id, rect.r1, rect.c0);
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  const signedKind = kind === 'tsp' || kind === 'ttsp';
  const va = signedKind ? toSigned(a) : a;
  const vb = signedKind ? toSigned(b) : b;
  commit((d) => {
    for (let r = rect.r0; r <= rect.r1; r++) {
      const v = Math.round(va + ((vb - va) * (r - rect.r0)) / (rect.r1 - rect.r0));
      spec.set(d, id, r, rect.c0, signedKind ? fromSigned(v) : v);
    }
  });
  setState({ status: 'INTERPOLATED' });
  return true;
}

/** EDIT + ↑↓ in a selection: move the selected block by one row. */
export function moveBlock(dir: 1 | -1) {
  const s = getState();
  const rect = selectionRect(s);
  if (!rect || !isGridView(s.view) || !s.selection) return;
  const spec = GRIDS[s.view];
  const id = gridId(s.view);
  if (rect.r0 + dir < 0 || rect.r1 + dir >= spec.rows) return;
  commit((d) => {
    const cells: Cell[][] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      const row: Cell[] = [];
      for (let c = rect.c0; c <= rect.c1; c++) row.push(spec.get(d, id, r, c));
      cells.push(row);
    }
    const displaced: Cell[] = [];
    const from = dir > 0 ? rect.r1 + 1 : rect.r0 - 1;
    for (let c = rect.c0; c <= rect.c1; c++) displaced.push(spec.get(d, id, from, c));
    cells.forEach((row, i) => row.forEach((v, k) => spec.set(d, id, rect.r0 + i + dir, rect.c0 + k, v)));
    const freed = dir > 0 ? rect.r0 : rect.r1;
    displaced.forEach((v, k) => spec.set(d, id, freed, rect.c0 + k, v));
  }, `moveblock:${s.view}`);
  const a = s.selection.anchor;
  setState({ selection: { view: s.view, anchor: { row: a.row + dir, col: a.col } } });
  moveTo(s.view, cursor(s).row + dir, cursor(s).col);
}

let fillEvery = 0;

/** In a phrase selection that covers the note column, OPTION + arrows fill and randomise (M8). */
export function selectionNotes(k: Dir): boolean {
  const s = getState();
  const rect = selectionRect(s);
  if (s.view !== 'PHRASE' || !rect || rect.c0 !== 0) return false;
  const id = s.ids.phrase;
  const { note, inst } = s.last;
  commit((d) => {
    const ph = (d.phrases[id] ??= structuredClone(getPhrase(d, id)));
    for (let r = rect.r0; r <= rect.r1; r++) {
      const st = ph.steps[r];
      if (k === 'UP' || k === 'DOWN') {
        if (st.note != null && st.note !== NOTE_OFF) {
          const dir = k === 'UP' ? 1 : -1;
          st.note = Math.max(0, Math.min(127, st.note + dir * Math.floor(Math.random() * 4)));
        }
      } else if (k === 'RIGHT') {
        const on = Math.random() < 0.5;
        st.note = on ? note : null;
        st.inst = on ? inst : null;
      } else {
        const every = [1, 2, 4, 8][fillEvery % 4];
        const on = (r - rect.r0) % every === 0;
        st.note = on ? note : null;
        st.inst = on ? inst : null;
      }
    }
  });
  if (k === 'LEFT') {
    setState({ status: `FILL EVERY ${[1, 2, 4, 8][fillEvery % 4]}` });
    fillEvery++;
  } else setState({ status: k === 'RIGHT' ? 'RANDOM TRIGGERS' : 'RANDOM NOTES' });
  return true;
}
