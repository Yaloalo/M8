/** Cursor movement, grid geometry and the M8 view map (SHIFT + arrows, breadcrumbs, screen ids). */
import { getChain, getPhrase } from '../../core/factory';
import { GRIDS, type Cell, type CellKind, type GridView } from '../../core/grids';
import { EQ_SLOTS, MAX_GROOVES } from '../../core/types';
import { formFor } from '../fields';
import { openEqFromField } from './forms';
import { forgetPoolOrigin, poolPick } from '../pool';
import { expectBusy } from '../transport';
import { VIEW_MAP, getState, setState, type Cursor, type State, type ViewId } from '../store';

export type Key = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'OPTION' | 'EDIT' | 'SHIFT' | 'PLAY';
export type Dir = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

const GRID_VIEWS: GridView[] = ['SONG', 'CHAIN', 'PHRASE', 'TABLE', 'GROOVE'];
export const isGridView = (v: ViewId): v is GridView => (GRID_VIEWS as string[]).includes(v);

/** The id a grid screen edits (song has none). */
export function gridId(view: GridView, s = getState()): number {
  switch (view) {
    case 'CHAIN':
      return s.ids.chain;
    case 'PHRASE':
      return s.ids.phrase;
    case 'TABLE':
      return s.ids.table;
    case 'GROOVE':
      return s.ids.groove;
    default:
      return 0;
  }
}

export const cursor = (s = getState()) => s.cursors[s.view];

function setCursor(view: ViewId, c: Cursor) {
  setState((s) => ({ cursors: { ...s.cursors, [view]: c } }));
}

export function dims(view: ViewId): { rows: number; cols: number } {
  if (isGridView(view)) return { rows: GRIDS[view].rows, cols: GRIDS[view].columns.length };
  if (view === 'POOL') return { rows: 128, cols: 5 };
  return { rows: formFor(getState(), view).fields.length, cols: 1 };
}

export function currentKind(s = getState()): CellKind | null {
  if (!isGridView(s.view)) return null;
  return GRIDS[s.view].columns[cursor(s).col]?.kind ?? null;
}

export function currentCell(s = getState()): Cell {
  if (!isGridView(s.view)) return null;
  const c = cursor(s);
  return GRIDS[s.view].get(s.project, gridId(s.view, s), c.row, c.col);
}

/** The track a mute/solo/preview applies to. */
export const currentTrack = (s = getState()) => (s.view === 'SONG' ? cursor(s).col : s.track);

// ------------------------------------------------------------------- cursor

export function moveTo(view: ViewId, row: number, col: number) {
  const d = dims(view);
  const c = {
    row: Math.max(0, Math.min(d.rows - 1, row)),
    col: Math.max(0, Math.min(d.cols - 1, col)),
  };
  setCursor(view, c);
  // The song column under the cursor is the track chain and phrase screens play on.
  if (view === 'SONG') setState({ track: c.col });
}

export function move(dir: Dir, amount = 1) {
  const s = getState();
  const c = cursor(s);
  const dr = dir === 'UP' ? -amount : dir === 'DOWN' ? amount : 0;
  const dc = dir === 'LEFT' ? -1 : dir === 'RIGHT' ? 1 : 0;
  moveTo(s.view, c.row + dr, c.col + dc);
}

// ------------------------------------------------------------------- view map

export function goTo(view: ViewId) {
  // Leaving the pool any other way than a pick forgets where it was opened from.
  if (getState().view === 'POOL' && view !== 'POOL') forgetPoolOrigin();
  expectBusy();
  setState({ view, selection: null, fillOpen: false });
}

function mapPos(view: ViewId): [number, number] | null {
  for (let r = 0; r < VIEW_MAP.length; r++) {
    const c = VIEW_MAP[r].indexOf(view);
    if (c >= 0) return [r, c];
  }
  return null;
}

/** M8 edges that are not plain grid neighbours: the pool sits between phrase and instrument. */
const EDGES: Partial<Record<ViewId, Partial<Record<Dir, ViewId>>>> = {
  POOL: { LEFT: 'PHRASE', RIGHT: 'INST' },
  // Mods sits above the instrument but moves sideways like it (M8 manual, view map).
  MODS: { LEFT: 'PHRASE', RIGHT: 'TABLE' },
};

/** The ids a screen hands to the next one along the M8 path, read from its cursor. */
function carry(from: ViewId, to: ViewId, ids: State['ids'], track: number) {
  const s = getState();
  const p = s.project;
  const cur = s.cursors[from];
  if (from === 'SONG' && to === 'CHAIN') {
    ids.chain = p.song[cur.row][cur.col] ?? ids.chain;
    track = cur.col;
  } else if (from === 'CHAIN' && to === 'PHRASE') {
    ids.phrase = getChain(p, ids.chain).rows[cur.row].phrase ?? ids.phrase;
  } else if (from === 'PHRASE' && (to === 'INST' || to === 'GROOVE')) {
    const steps = getPhrase(p, ids.phrase).steps;
    for (let i = cur.row; i >= 0; i--) {
      if (steps[i].inst != null) {
        ids.inst = steps[i].inst!;
        break;
      }
    }
  } else if ((from === 'INST' || from === 'MODS') && to === 'TABLE') {
    ids.table = ids.inst;
  } else if (from === 'TABLE' && to === 'INST' && ids.table < 128) {
    ids.inst = ids.table;
  } else if (from === 'POOL' && (to === 'INST' || to === 'PHRASE' || to === 'MODS')) {
    ids.inst = s.cursors.POOL.row;
  }
  return track;
}

const PATH: ViewId[] = ['SONG', 'CHAIN', 'PHRASE', 'INST', 'TABLE'];
/** Where a screen sits on the path; side screens count as their parent. */
const PARENT: Partial<Record<ViewId, ViewId>> = { GROOVE: 'PHRASE', MODS: 'INST' };

/**
 * What `openView(target)` would show, without going there: the breadcrumb labels use this
 * so each number is the one a click will open.
 */
export function peekIds(target: ViewId): { ids: State['ids']; track: number } {
  const s = getState();
  const ids = { ...s.ids };
  let track = s.track;
  const from = PATH.indexOf(PARENT[s.view] ?? s.view);
  const to = PATH.indexOf(PARENT[target] ?? target);
  if (from >= 0 && to > from) {
    for (let i = from; i < to; i++) track = carry(PATH[i], PATH[i + 1], ids, track);
    if (target !== PATH[to]) track = carry(PATH[to], target, ids, track);
  } else if (from >= 0 && PARENT[target] === PATH[from]) {
    track = carry(PATH[from], target, ids, track);
  } else if (s.view === 'TABLE' && target === 'INST') {
    track = carry('TABLE', 'INST', ids, track);
  } else if (s.view === 'POOL' && target === 'INST') {
    track = carry('POOL', 'INST', ids, track);
  }
  return { ids, track };
}

/**
 * Open a screen the way SHIFT + arrows would: moving right along the path carries the
 * chain, phrase and instrument under each cursor, so a click on PHRASE from the song
 * opens the phrase the song cursor leads to.
 */
export function openView(target: ViewId) {
  const s = getState();
  if (s.view === 'POOL' && (target === 'PHRASE' || target === 'INST')) return poolPick(target === 'PHRASE');
  const { ids, track } = peekIds(target);
  if (s.view === 'POOL' && target !== 'POOL') forgetPoolOrigin();
  expectBusy();
  // The EQ tab belongs to the mixer: that is where OPTION leads back from it.
  setState({ view: target, ids, track, selection: null, fillOpen: false, ...(target === 'EQ' ? { eqReturn: 'MIXER' as const } : {}) });
}

/** SHIFT + arrow: walk the view map, carrying the thing under the cursor along. */
export function navigate(dir: Dir) {
  const s = getState();
  // The EQ editor and the scales are reached from a field or a tab, not the map: Shift + ←
  // or ↑ leads back to where they were opened from.
  if ((s.view === 'EQ' || s.view === 'SCALE') && (dir === 'LEFT' || dir === 'UP')) {
    goTo(s.view === 'EQ' ? s.eqReturn : 'PROJECT');
    return;
  }
  // On an EQ field, Shift + → opens that EQ (M8 manual, instrument and mixer EQ).
  if (dir === 'RIGHT' && openEqFromField()) return;
  const pos = mapPos(s.view);
  if (!pos) return;
  const [r, c] = pos;
  const dr = dir === 'UP' ? -1 : dir === 'DOWN' ? 1 : 0;
  const dc = dir === 'LEFT' ? -1 : dir === 'RIGHT' ? 1 : 0;
  const target = EDGES[s.view]?.[dir] ?? VIEW_MAP[r + dr]?.[c + dc] ?? null;
  if (!target) return;
  if (s.view === 'POOL' && (target === 'PHRASE' || target === 'INST')) {
    // Leaving the pool sideways picks its instrument as the default for new notes (M8).
    return poolPick(target === 'PHRASE');
  }
  const ids = { ...s.ids };
  const track = carry(s.view, target, ids, s.track);
  if (s.view === 'POOL') forgetPoolOrigin();
  expectBusy();
  setState({ view: target, ids, track, selection: null, fillOpen: false });
}

/** Step the screen's id: which chain, phrase, instrument, table or groove is shown. */
export function stepId(delta: number) {
  const s = getState();
  const key = ({ CHAIN: 'chain', PHRASE: 'phrase', INST: 'inst', MODS: 'inst', TABLE: 'table', GROOVE: 'groove', SCALE: 'scale', EQ: 'eq' } as const)[
    s.view as 'CHAIN'
  ];
  if (!key) return;
  const max = { chain: 254, phrase: 254, inst: 127, table: 255, groove: MAX_GROOVES - 1, scale: 15, eq: EQ_SLOTS - 1 }[key];
  setState({ ids: { ...s.ids, [key]: Math.max(0, Math.min(max, s.ids[key] + delta)) } });
}

export function setId(key: keyof ReturnType<typeof getState>['ids'], value: number) {
  setState((s) => ({ ids: { ...s.ids, [key]: value } }));
}

export const hex = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
