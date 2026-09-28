/**
 * Every tracker screen that is a grid (song, chain, phrase, table, groove) described as
 * columns of typed cells, so cursor movement, editing, selection and clipboard are written
 * once instead of per screen.
 */
import { emptyChain, emptyPhrase, emptyTable, getChain, getGroove, getPhrase, getTable } from './factory';
import { FX_CODES, fromSigned, toSigned } from './fx';
import { NOTE_OFF, ROWS, SONG_ROWS, TRACKS, type Project } from './types';

export type CellKind =
  | 'chain'
  | 'phrase'
  | 'tsp'
  | 'note'
  | 'vel'
  | 'inst'
  | 'fxcmd'
  | 'fxval'
  | 'ttsp'
  | 'ticks';

export type Cell = number | string | null;

export interface Column {
  kind: CellKind;
  label: string;
  /** For fx columns, which slot. */
  slot?: number;
}

export type GridView = 'SONG' | 'CHAIN' | 'PHRASE' | 'TABLE' | 'GROOVE';

export interface GridSpec {
  rows: number;
  columns: Column[];
  get(p: Project, id: number, row: number, col: number): Cell;
  /** Mutates a draft. */
  set(p: Project, id: number, row: number, col: number, v: Cell): void;
}

const fxCols = (): Column[] =>
  [0, 1, 2].flatMap((slot) => [
    { kind: 'fxcmd' as const, label: `FX${slot + 1}`, slot },
    { kind: 'fxval' as const, label: '', slot },
  ]);

const num = (v: Cell) => (typeof v === 'number' ? v : null);

export const GRIDS: Record<GridView, GridSpec> = {
  SONG: {
    rows: SONG_ROWS,
    columns: Array.from({ length: TRACKS }, (_, t) => ({ kind: 'chain' as const, label: String(t + 1) })),
    get: (p, _id, row, col) => p.song[row][col],
    set: (p, _id, row, col, v) => {
      p.song[row][col] = num(v);
    },
  },
  CHAIN: {
    rows: ROWS,
    columns: [
      { kind: 'phrase', label: 'PH' },
      { kind: 'tsp', label: 'TSP' },
    ],
    get: (p, id, row, col) => {
      const r = getChain(p, id).rows[row];
      return col === 0 ? r.phrase : r.tsp;
    },
    set: (p, id, row, col, v) => {
      const c = (p.chains[id] ??= emptyChain());
      if (col === 0) c.rows[row].phrase = num(v);
      else c.rows[row].tsp = num(v) ?? 0;
    },
  },
  PHRASE: {
    rows: ROWS,
    columns: [
      { kind: 'note', label: 'N' },
      { kind: 'vel', label: 'V' },
      { kind: 'inst', label: 'I' },
      ...fxCols(),
    ],
    get: (p, id, row, col) => {
      const s = getPhrase(p, id).steps[row];
      if (col === 0) return s.note;
      if (col === 1) return s.vel;
      if (col === 2) return s.inst;
      const f = s.fx[(col - 3) >> 1];
      return (col - 3) % 2 === 0 ? f.cmd : f.cmd == null ? null : f.val;
    },
    set: (p, id, row, col, v) => {
      const s = (p.phrases[id] ??= emptyPhrase()).steps[row];
      if (col === 0) s.note = num(v);
      else if (col === 1) s.vel = num(v);
      else if (col === 2) s.inst = num(v);
      else setFx(s.fx[(col - 3) >> 1], (col - 3) % 2 === 0, v);
    },
  },
  TABLE: {
    rows: ROWS,
    columns: [{ kind: 'ttsp', label: 'N' }, { kind: 'vel', label: 'V' }, ...fxCols()],
    get: (p, id, row, col) => {
      const r = getTable(p, id).rows[row];
      if (col === 0) return r.tsp;
      if (col === 1) return r.vel;
      const f = r.fx[(col - 2) >> 1];
      return (col - 2) % 2 === 0 ? f.cmd : f.cmd == null ? null : f.val;
    },
    set: (p, id, row, col, v) => {
      const r = (p.tables[id] ??= emptyTable()).rows[row];
      if (col === 0) r.tsp = num(v) ?? 0;
      else if (col === 1) r.vel = num(v);
      else setFx(r.fx[(col - 2) >> 1], (col - 2) % 2 === 0, v);
    },
  },
  GROOVE: {
    rows: ROWS,
    columns: [{ kind: 'ticks', label: 'TICKS' }],
    get: (p, id, row) => getGroove(p, id).steps[row] ?? null,
    set: (p, id, row, _col, v) => {
      const g = (p.grooves[id] ??= { steps: Array.from({ length: ROWS }, () => null) });
      g.steps[row] = num(v);
    },
  },
};

function setFx(f: { cmd: string | null; val: number }, isCmd: boolean, v: Cell) {
  if (isCmd) {
    f.cmd = typeof v === 'string' ? v : null;
    if (f.cmd == null) f.val = 0;
  } else if (f.cmd != null) {
    f.val = num(v) ?? 0;
  }
}

// ------------------------------------------------------------------- editing a cell

export interface Last {
  chain: number;
  phrase: number;
  note: number;
  vel: number;
  inst: number;
  fxcmd: string;
  fxval: number;
  ticks: number;
}

export const defaultLast = (): Last => ({
  chain: 0,
  phrase: 0,
  note: 60,
  vel: 0x64,
  inst: 0,
  fxcmd: 'VOL',
  fxval: 0,
  ticks: 6,
});

const LIMITS: Record<CellKind, [number, number]> = {
  chain: [0, 0xfe],
  phrase: [0, 0xfe],
  tsp: [-128, 127],
  note: [0, NOTE_OFF],
  vel: [0, 0x7f],
  inst: [0, 0x7f],
  fxcmd: [0, 0],
  fxval: [0, 0xff],
  ttsp: [-128, 127],
  ticks: [0, 0xff],
};

/** Value EDIT drops into an empty cell. */
export function insertValue(kind: CellKind, last: Last): Cell {
  switch (kind) {
    case 'chain':
      return last.chain;
    case 'phrase':
      return last.phrase;
    case 'note':
      return last.note;
    case 'vel':
      return last.vel;
    case 'inst':
      return last.inst;
    case 'fxcmd':
      return last.fxcmd;
    case 'fxval':
      return last.fxval;
    case 'ticks':
      return last.ticks;
    default:
      return 0;
  }
}

/** Signed kinds are stored as bytes; nudging works on the signed value. */
const isSigned = (k: CellKind) => k === 'tsp' || k === 'ttsp';

/** EDIT + arrow: fine is ±1, coarse is ±12 for notes, ±16 for bytes, ±1 command. */
export function nudge(kind: CellKind, v: Cell, coarse: boolean, dir: 1 | -1): Cell {
  if (kind === 'fxcmd') {
    const i = typeof v === 'string' ? FX_CODES.indexOf(v) : -1;
    const step = coarse ? 4 : 1;
    const n = FX_CODES.length;
    return FX_CODES[(((i < 0 ? 0 : i + dir * step) % n) + n) % n];
  }
  const [lo, hi] = LIMITS[kind];
  const amount = (coarse ? (kind === 'note' ? 12 : 16) : 1) * dir;
  if (typeof v !== 'number') return null;
  if (isSigned(kind)) {
    return fromSigned(Math.max(lo, Math.min(hi, toSigned(v & 0xff) + amount)));
  }
  if (kind === 'note' && v === NOTE_OFF) return dir < 0 ? 127 : NOTE_OFF;
  return Math.max(lo, Math.min(kind === 'note' ? 127 : hi, v + amount));
}

/** Typing digits into a number cell, tracker style: the new digit shifts in. */
export function typeDigit(kind: CellKind, v: Cell, digit: number, hex: boolean): Cell {
  if (kind === 'note' || kind === 'fxcmd') return v;
  const [lo, hi] = LIMITS[kind];
  const cur = typeof v === 'number' ? v & 0xff : 0;
  let next = hex ? ((cur << 4) | digit) & 0xff : (cur * 10 + digit) % 1000;
  if (!hex && next > 255) next = digit;
  if (isSigned(kind)) return next;
  return Math.max(lo, Math.min(hi, next));
}

export const kindName: Record<CellKind, string> = {
  chain: 'Chain',
  phrase: 'Phrase',
  tsp: 'Transpose',
  note: 'Note',
  vel: 'Velocity',
  inst: 'Instrument',
  fxcmd: 'Command',
  fxval: 'Value',
  ttsp: 'Transpose',
  ticks: 'Ticks',
};
