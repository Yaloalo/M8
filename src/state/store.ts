import { produce } from 'immer';
import { useSyncExternalStore } from 'react';
import { newProject } from '../core/factory';
import { defaultLast, type Cell, type CellKind, type Last } from '../core/grids';
import type { Position } from '../core/sequencer';
import { TRACKS, type Project } from '../core/types';

export type ViewId =
  | 'PROJECT'
  | 'SONG'
  | 'CHAIN'
  | 'PHRASE'
  | 'INST'
  | 'MODS'
  | 'TABLE'
  | 'GROOVE'
  | 'MIXER'
  | 'EFFECTS'
  | 'PERFORM'
  | 'POOL'
  | 'SCALE'
  | 'EQ';

/** The M8 view map, walked with SHIFT + arrows. */
export const VIEW_MAP: (ViewId | null)[][] = [
  [null, null, null, 'POOL', null],
  ['PROJECT', null, 'GROOVE', 'MODS', null],
  ['SONG', 'CHAIN', 'PHRASE', 'INST', 'TABLE'],
  ['MIXER', null, null, null, null],
  ['EFFECTS', null, null, null, null],
  ['PERFORM', null, null, null, null],
];

export interface Cursor {
  row: number;
  col: number;
}

export interface Clipboard {
  kinds: CellKind[];
  cells: Cell[][];
}

export interface State {
  project: Project;
  view: ViewId;
  cursors: Record<ViewId, Cursor>;
  ids: { chain: number; phrase: number; inst: number; table: number; groove: number; scale: number; eq: number };
  /** Song column the chain/phrase screens were entered from; plays in CHAIN/PHRASE mode. */
  track: number;
  /** Selection anchor; the cursor is the other corner. */
  selection: { view: ViewId; anchor: Cursor } | null;
  clipboard: Clipboard | null;
  last: Last;
  playing: boolean;
  playMode: 'SONG' | 'CHAIN' | 'PHRASE';
  positions: Position[];
  status: string;
  fillOpen: boolean;
  /** M8 live mode: PLAY on a song cell queues it instead of stopping. */
  live: boolean;
  /** Song track-reorder mode (UP UP on row 00). */
  reorder: boolean;
  /** Notes written from the pads or piano keys (teach mode counts them). */
  notesEntered: number;
  /** Phrase row of the last note written that way. */
  lastNoteRow: number;
  /** Phones: the edit bar shows the eight M8 keys instead of the edit buttons. */
  barKeys: boolean;
  /** An instrument was chosen on purpose (pool pick, I column edit): new notes use it. */
  instPinned: boolean;
  /** Where the EQ editor was opened from, so OPTION / Shift + ← lead back there. */
  eqReturn: ViewId;
  /** M8 effect help/selection list, open on a command cell (index into FX). */
  fxPick: number | null;
  /** Live note recording armed (Polyend REC): notes land at the playhead. */
  liveRec: boolean;
  /** A sample recording is running; its input peak 0–1. */
  recording: boolean;
  recLevel: number;
  /** Teach mode step, or null. */
  tour: number | null;
  canUndo: boolean;
  canRedo: boolean;
}

const zero = (): Cursor => ({ row: 0, col: 0 });

const idlePosition = (): Position => ({
  active: false,
  songRow: 0,
  chainId: null,
  chainRow: 0,
  phraseId: null,
  step: 0,
  tableId: null,
  tableRow: 0,
  note: null,
  inst: null,
  queued: null,
  repeatLane: null,
  stepTicks: 6,
});

let state: State = {
  project: newProject(),
  view: 'SONG',
  cursors: Object.fromEntries(
    ['PROJECT', 'SONG', 'CHAIN', 'PHRASE', 'INST', 'MODS', 'TABLE', 'GROOVE', 'MIXER', 'EFFECTS', 'PERFORM', 'POOL', 'SCALE', 'EQ'].map(
      (v) => [v, zero()],
    ),
  ) as Record<ViewId, Cursor>,
  ids: { chain: 0, phrase: 0, inst: 0, table: 0, groove: 0, scale: 0, eq: 0 },
  track: 0,
  selection: null,
  clipboard: null,
  last: defaultLast(),
  playing: false,
  playMode: 'SONG',
  positions: Array.from({ length: TRACKS }, idlePosition),
  status: '',
  fillOpen: false,
  tour: null,
  live: false,
  reorder: false,
  notesEntered: 0,
  lastNoteRow: 0,
  barKeys: false,
  instPinned: false,
  eqReturn: 'MIXER',
  fxPick: null,
  recording: false,
  liveRec: false,
  recLevel: 0,
  canUndo: false,
  canRedo: false,
};

const listeners = new Set<() => void>();
const projectListeners = new Set<(p: Project) => void>();

export const getState = () => state;

/** Counts state changes; teach mode uses it to tell "already true" from "just done". */
export let revision = 0;

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  revision++;
  const next = typeof patch === 'function' ? patch(state) : patch;
  const projectChanged = next.project && next.project !== state.project;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
  if (projectChanged) projectListeners.forEach((l) => l(state.project));
}

export function onProjectChange(l: (p: Project) => void) {
  projectListeners.add(l);
  return () => projectListeners.delete(l);
}

// ------------------------------------------------------------------- undo

const UNDO_LIMIT = 100;
const undoStack: Project[] = [];
const redoStack: Project[] = [];
let lastKey: string | null = null;
let lastTime = 0;

/**
 * Change the project. Repeated edits of the same thing within a second (holding EDIT and
 * tapping an arrow) coalesce into one undo step.
 */
export function commit(recipe: (draft: Project) => void, key?: string) {
  // A recipe's return value is always ignored: an expression-bodied setter that returns what
  // it assigned must never replace the project (Immer would take a returned value as the
  // new state). Replacing the whole project goes through `commitProject`.
  apply(produce(state.project, (d) => void recipe(d)), key);
}

/** Replace the whole project as one undoable step (e.g. undo the teach-mode edits). */
export function commitProject(p: Project) {
  apply(p);
}

/**
 * Changes from another tab arrive: apply them to the current project and to every undo and
 * redo step alike, so undo still takes back only this tab's own edits. Not undoable itself.
 */
export function rebaseProject(fn: (p: Project) => Project) {
  for (let i = 0; i < undoStack.length; i++) undoStack[i] = fn(undoStack[i]);
  for (let i = 0; i < redoStack.length; i++) redoStack[i] = fn(redoStack[i]);
  lastKey = null;
  setState({ project: fn(state.project) });
}

function apply(next: Project, key?: string) {
  const prev = state.project;
  if (next === prev) return;
  const now = Date.now();
  if (!(key && key === lastKey && now - lastTime < 1000)) {
    undoStack.push(prev);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  lastKey = key ?? null;
  lastTime = now;
  redoStack.length = 0;
  setState({ project: next, canUndo: true, canRedo: false });
}

export function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(state.project);
  lastKey = null;
  setState({ project: prev, canUndo: undoStack.length > 0, canRedo: true, status: 'UNDO' });
}

export function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(state.project);
  lastKey = null;
  setState({ project: next, canUndo: true, canRedo: redoStack.length > 0, status: 'REDO' });
}

/** Replace the whole project (load, new, import): not undoable, clears history. */
export function replaceProject(p: Project) {
  undoStack.length = 0;
  redoStack.length = 0;
  lastKey = null;
  setState({ project: p, canUndo: false, canRedo: false, selection: null });
}

// ------------------------------------------------------------------- react

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(state),
  );
}
