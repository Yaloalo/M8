/** Grid cell editing under the cursor: insert, nudge, clear, new/clone, and direct typing. */
import { defaultInstrument, getChain, defaultGroove, getGroove, getTable, getPhrase, unusedChain, unusedInstrument, unusedPhrase } from '../../core/factory';
import { inScale } from '../../core/format';
import { FX_BY_CODE, FX_CODES } from '../../core/fx';
import { GRIDS, insertValue, nudge, typeDigit, type Cell, type GridView } from '../../core/grids';
import { MAX_GROOVES, NOTE_OFF, ROWS, type Groove, type Phrase, type Project, type Table } from '../../core/types';
import { isFormView } from '../fields';
import { poolEdit, setPoolOrigin } from '../pool';
import { preview } from '../transport';
import { commit, getState, setState } from '../store';
import { currentCell, currentKind, cursor, dims, gridId, hex, isGridView, moveTo, openView } from './cursor';
import { clearSelection, nudgeSelection } from './selection';
import { nudgeFormField } from './forms';
import { recordLive } from './live';
import { openFxPick } from './keys';

// ------------------------------------------------------------------- grid editing

function writeCell(view: GridView, row: number, col: number, v: Cell, key?: string) {
  const id = gridId(view);
  commit((d) => {
    GRIDS[view].set(d, id, row, col, v);
    // A note written into a step without an instrument takes the last one, as on the M8.
    if (view === 'PHRASE' && col === 0 && typeof v === 'number' && v !== NOTE_OFF) {
      const steps = d.phrases[id].steps;
      if (steps[row].inst == null) {
        // An instrument chosen on purpose (pool pick, I column) wins; otherwise the phrase's own
        // (nearest above, then below), then the last used.
        let near: number | null = null;
        for (let r = row - 1; r >= 0 && near == null; r--) near = steps[r].inst;
        for (let r = row + 1; r < steps.length && near == null; r++) near = steps[r].inst;
        const st = getState();
        steps[row].inst = st.instPinned ? st.last.inst : (near ?? st.last.inst);
      }
    }
  }, key ?? `${view}:${id}:${row}:${col}`);
  remember(view, col, v);
}

function remember(view: GridView, col: number, v: Cell) {
  if (v == null) return;
  const kind = GRIDS[view].columns[col].kind;
  const s = getState();
  const last = { ...s.last };
  const ids = { ...s.ids };
  if (kind === 'chain' && typeof v === 'number') ids.chain = last.chain = v;
  else if (kind === 'phrase' && typeof v === 'number') ids.phrase = last.phrase = v;
  else if (kind === 'inst' && typeof v === 'number') ids.inst = last.inst = v;
  else if (kind === 'note' && typeof v === 'number' && v !== NOTE_OFF) last.note = v;
  else if (kind === 'vel' && typeof v === 'number') last.vel = v;
  else if (kind === 'fxcmd' && typeof v === 'string') last.fxcmd = v;
  else if (kind === 'fxval' && typeof v === 'number') last.fxval = v;
  else if (kind === 'ticks' && typeof v === 'number') last.ticks = v;
  setState({ last, ids, ...(kind === 'inst' && typeof v === 'number' ? { instPinned: true } : {}) });
}

export function previewAt(view: GridView, row: number) {
  const s = getState();
  if (view !== 'PHRASE') return;
  const step = getPhrase(s.project, s.ids.phrase).steps[row];
  if (step.note != null && step.note !== NOTE_OFF) {
    void preview(s.track, step.inst ?? s.last.inst, step.note, step.vel ?? 0xff);
  }
}

export function insertAtCursor() {
  const s = getState();
  if (!isGridView(s.view)) return;
  const c = cursor(s);
  const kind = GRIDS[s.view].columns[c.col].kind;
  if (kind === 'fxval' && currentFxCmd() == null) {
    writeCell(s.view, c.row, c.col - 1, s.last.fxcmd);
  }
  writeCell(s.view, c.row, c.col, insertValue(kind, s.last));
  previewAt(s.view, c.row);
}

function currentFxCmd(): string | null {
  const s = getState();
  if (!isGridView(s.view)) return null;
  const c = cursor(s);
  const v = GRIDS[s.view].get(s.project, gridId(s.view), c.row, c.col - 1);
  return typeof v === 'string' ? v : null;
}

/** Write a value into the cell under the cursor (palette, pickers): remembered and undoable. */
export function setCurrentCell(v: Cell) {
  const s = getState();
  if (!isGridView(s.view)) return;
  const c = cursor(s);
  writeCell(s.view, c.row, c.col, v);
}

/** Choose in the effect list: write the command (and keep the value), then close. */
export function chooseFx(index: number) {
  const s = getState();
  setState({ fxPick: null });
  if (!isGridView(s.view) || currentKind(s) !== 'fxcmd') return;
  const code = FX_CODES[index];
  if (code) {
    writeCell(s.view, cursor(s).row, cursor(s).col, code);
    setState({ status: `${code} · ${FX_BY_CODE[code].name.toUpperCase()}` });
  }
}

export function nudgeCursor(coarse: boolean, dir: 1 | -1) {
  const s = getState();
  if (s.view === 'POOL') return poolEdit(coarse, dir, coarse);
  if (isFormView(s.view)) return nudgeFormField(coarse, dir);
  if (!isGridView(s.view)) return;
  if (s.selection) return nudgeSelection(coarse, dir);
  const c = cursor(s);
  const kind = GRIDS[s.view].columns[c.col].kind;
  let v = currentCell(s);
  if (v == null) {
    insertAtCursor();
    return;
  }
  if (kind === 'fxval' && currentFxCmd() == null) return;
  if (kind === 'fxcmd' && coarse) {
    // EDIT + ↑↓ on a command opens the effect help / selection list (M8).
    openFxPick();
    return;
  }
  if (kind === 'inst' && v === 0 && coarse && dir < 0) {
    // Below instrument 00: open the pool to pick one; the pick is written back here (M8).
    setPoolOrigin({ phrase: s.ids.phrase, row: c.row });
    openView('POOL');
    moveTo('POOL', 0, 0);
    return;
  }
  if (s.view === 'GROOVE' && coarse && typeof v === 'number') return shiftGroove(c.row, v, dir);
  v = nudge(kind, v, coarse, dir);
  // Note entry follows the project scale (M8 quantised entry): skip notes outside it.
  const { scale, scaleRoot } = s.project.settings;
  if (kind === 'note' && !coarse && typeof v === 'number' && v !== NOTE_OFF && scale !== 'CHROMATIC') {
    for (let i = 0; i < 12 && !inScale(v, scale, scaleRoot, s.project.scales); i++) v = Math.max(0, Math.min(127, v + dir));
  }
  writeCell(s.view, c.row, c.col, v);
  if (kind === 'note' || kind === 'inst' || kind === 'vel') previewAt(s.view, c.row);
}

/**
 * Groove, EDIT + ↑↓: move a tick between this row and the one beneath (the one above on
 * the last row), so the pattern keeps its length — how swing is dialled in on the M8.
 */
function shiftGroove(row: number, v: number, dir: 1 | -1) {
  const id = getState().ids.groove;
  const steps = getGroove(getState().project, id).steps;
  let other = row + 1;
  if (other >= ROWS || steps[other] == null) other = row - 1;
  const o = other >= 0 ? steps[other] : null;
  if (o == null) {
    writeCell('GROOVE', row, 0, Math.max(0, Math.min(0xff, v + dir)));
    return;
  }
  if (v + dir < 0 || o - dir < 0 || v + dir > 0xff || o - dir > 0xff) return;
  commit((d) => {
    GRIDS.GROOVE.set(d, id, row, 0, v + dir);
    GRIDS.GROOVE.set(d, id, other, 0, o - dir);
  }, `groove-shift:${id}:${row}`);
}

export function clearCursor() {
  const s = getState();
  if (!isGridView(s.view)) return;
  if (s.selection) return clearSelection();
  const c = cursor(s);
  const kind = GRIDS[s.view].columns[c.col].kind;
  const old = currentCell(s);
  // OPTION + EDIT on an empty note writes a note-off (M8).
  if (kind === 'note' && old == null) {
    writeCell(s.view, c.row, c.col, NOTE_OFF, `off:${Date.now()}`);
    return;
  }
  const empty = kind === 'tsp' || kind === 'ttsp' ? 0 : null;
  writeCell(s.view, c.row, c.col, empty, `clear:${Date.now()}`);
  // EDIT on an empty cell inserts the last edited *or deleted* value.
  if (old != null && old !== NOTE_OFF) remember(s.view, c.col, old);
}

/** The table/groove command whose value is under the cursor, if any (TBL, TBX, GRV, GGR). */
function refCommand(): 'TABLE' | 'GROOVE' | null {
  const s = getState();
  if (currentKind(s) !== 'fxval') return null;
  const cmd = currentFxCmd();
  return cmd === 'TBL' || cmd === 'TBX' ? 'TABLE' : cmd === 'GRV' || cmd === 'GGR' ? 'GROOVE' : null;
}

/** Free table: prefer 80–FF (00–7F belong to instruments), then any unused, empty one. */
function unusedTable(p: Project): number | null {
  const empty = (i: number) => !p.tables[i] || p.tables[i].rows.every((r) => !r.tsp && r.vel == null && r.fx.every((f) => !f.cmd));
  for (let i = 0x80; i < 0x100; i++) if (empty(i)) return i;
  for (let i = 1; i < 0x80; i++) if (empty(i) && !p.instruments[i]) return i;
  return null;
}

function unusedGroove(p: Project): number | null {
  for (let i = 1; i < MAX_GROOVES; i++) if (!p.grooves[i]) return i;
  return null;
}

/** EDIT twice on a chain, phrase or instrument cell: a fresh, unused one. */
export function createNew() {
  const s = getState();
  if (!isGridView(s.view)) return;
  const c = cursor(s);
  const kind = GRIDS[s.view].columns[c.col].kind;
  const p = s.project;
  const ref = refCommand();
  if (ref) {
    const nid = ref === 'TABLE' ? unusedTable(p) : unusedGroove(p);
    if (nid == null) return;
    commit((d) => {
      if (ref === 'GROOVE') d.grooves[nid] = defaultGroove();
      GRIDS[s.view as GridView].set(d, gridId(s.view as GridView), c.row, c.col, nid);
    }, `new:${Date.now()}`);
    setState({ status: `NEW ${ref} ${hex(nid)}` });
    return;
  }
  const id = kind === 'chain' ? unusedChain(p) : kind === 'phrase' ? unusedPhrase(p) : kind === 'inst' ? unusedInstrument(p) : null;
  if (id == null) return;
  if (kind === 'inst') {
    commit((d) => {
      d.instruments[id] = { ...defaultInstrument(), type: 'WAVSYNTH' };
    });
  }
  writeCell(s.view, c.row, c.col, id, `new:${Date.now()}`);
  setState({ status: `NEW ${kind.toUpperCase()} ${id.toString(16).toUpperCase().padStart(2, '0')}` });
}

/**
 * Copy the chain, phrase or instrument under the cursor into a new id and point the cell
 * at it (M8 clone). Deep: the chain's phrases are copied too. Copies are taken from the
 * committed project, never from an immer draft. Returns whether anything changed.
 */
export function cloneUnderCursor(deep: boolean): boolean {
  const s = getState();
  if (!isGridView(s.view)) return false;
  const view = s.view;
  const c = cursor(s);
  const kind = GRIDS[view].columns[c.col].kind;
  const v = currentCell(s);
  if (typeof v !== 'number') return false;
  const p = s.project;
  const at = gridId(view);
  let id: number | null = null;
  if (kind === 'chain') {
    id = unusedChain(p);
    if (id == null) return false;
    const chain = structuredClone(getChain(p, v));
    const phrases: [number, Phrase][] = [];
    if (deep) {
      const taken = new Set<number>();
      // A phrase the chain plays twice gets one copy, played twice (the structure is kept).
      const copies = new Map<number, number>();
      for (const row of chain.rows) {
        if (row.phrase == null) continue;
        const known = copies.get(row.phrase);
        if (known != null) {
          row.phrase = known;
          continue;
        }
        const pid = firstFree(p, taken);
        if (pid == null) break;
        taken.add(pid);
        copies.set(row.phrase, pid);
        phrases.push([pid, structuredClone(getPhrase(p, row.phrase))]);
        row.phrase = pid;
      }
    }
    const newId = id;
    commit((d) => {
      for (const [pid, ph] of phrases) d.phrases[pid] = ph;
      d.chains[newId] = chain;
      GRIDS[view].set(d, at, c.row, c.col, newId);
    });
  } else if (kind === 'phrase') {
    id = unusedPhrase(p);
    if (id == null) return false;
    const phrase = structuredClone(getPhrase(p, v));
    const newId = id;
    commit((d) => {
      d.phrases[newId] = phrase;
      GRIDS[view].set(d, at, c.row, c.col, newId);
    });
  } else if (kind === 'inst') {
    id = unusedInstrument(p);
    if (id == null) return false;
    const inst = structuredClone(p.instruments[v] ?? defaultInstrument());
    const table = p.tables[v] ? structuredClone(p.tables[v]) : null;
    const newId = id;
    commit((d) => {
      d.instruments[newId] = inst;
      if (table) d.tables[newId] = table;
      GRIDS[view].set(d, at, c.row, c.col, newId);
    });
  } else if (kind === 'fxval' && refCommand()) {
    const ref = refCommand()!;
    id = ref === 'TABLE' ? unusedTable(p) : unusedGroove(p);
    if (id == null) return false;
    const copy = ref === 'TABLE' ? structuredClone(getTable(p, v)) : structuredClone(getGroove(p, v));
    const newId = id;
    commit((d) => {
      if (ref === 'TABLE') d.tables[newId] = copy as Table;
      else d.grooves[newId] = copy as Groove;
      GRIDS[view].set(d, at, c.row, c.col, newId);
    });
  } else return false;
  remember(view, c.col, id);
  const what = kind === 'fxval' ? refCommand() : kind.toUpperCase();
  setState({ status: `${deep ? 'DEEP CLONE' : 'CLONE'} ${what} ${hex(v)} → ${hex(id)}` });
  return true;
}

function firstFree(p: Project, taken: Set<number>) {
  const used = new Set<number>(taken);
  for (const c of Object.values(p.chains)) for (const r of c.rows) if (r.phrase != null) used.add(r.phrase);
  for (let i = 0; i < 255; i++) if (!used.has(i) && !p.phrases[i]) return i;
  return null;
}

// ------------------------------------------------------------------- typing

const PIANO = 'q2w3er5t6y7ui9o0p';
let fxBuffer = '';

/**
 * X and Z are EDIT and OPTION, but inside a half-typed command (N, then X for NXT) they
 * are letters. Commands that start with X are picked from the list.
 */
export function wantsLetter(key: string): boolean {
  const s = getState();
  if (!fxBuffer || currentKind(s) !== 'fxcmd') return false;
  const next = fxBuffer + key.toUpperCase();
  return FX_CODES.some((code) => code.startsWith(next));
}

/** Direct entry from a computer keyboard. Returns true when the key was used. */
export function typeKey(key: string): boolean {
  const s = getState();
  if (!isGridView(s.view)) return false;
  const c = cursor(s);
  const kind = GRIDS[s.view].columns[c.col].kind;
  const k = key.toLowerCase();
  if (kind === 'note') {
    if (k === '1') {
      writeCell(s.view, c.row, c.col, NOTE_OFF, `type:${Date.now()}`);
      advance();
      return true;
    }
    const i = PIANO.indexOf(k);
    if (i < 0) return false;
    const note = Math.min(127, (s.project.settings.octave + 1) * 12 + i);
    enterNote(note);
    return true;
  }
  if (kind === 'fxcmd') {
    if (!/^[a-z0-9]$/.test(k) || (/^[0-9]$/.test(k) && !fxBuffer)) return false;
    fxBuffer = (fxBuffer + k.toUpperCase()).slice(-3);
    const match = FX_CODES.find((code) => code === fxBuffer);
    if (match) {
      writeCell(s.view, c.row, c.col, match, `type:${Date.now()}`);
      fxBuffer = '';
    } else if (!FX_CODES.some((code) => code.startsWith(fxBuffer))) {
      fxBuffer = FX_CODES.some((code) => code.startsWith(k.toUpperCase())) ? k.toUpperCase() : '';
    }
    setState({ status: fxBuffer ? `CMD ${fxBuffer}_` : '' });
    return true;
  }
  const hex = s.project.settings.hex;
  const digit = hex ? parseInt(k, 16) : parseInt(k, 10);
  if (k.length !== 1 || Number.isNaN(digit)) return false;
  if (kind === 'fxval' && currentFxCmd() == null) return true;
  writeCell(s.view, c.row, c.col, typeDigit(kind, currentCell(s), digit, hex), `digits:${s.view}:${c.row}:${c.col}`);
  return true;
}

/** Note from the pads or the piano keys: write, hear, then step-jump (Polyend). */
export function enterNote(note: number) {
  const s = getState();
  if (s.view !== 'PHRASE') {
    void preview(s.track, s.ids.inst, note);
    return;
  }
  if (s.liveRec && s.playing && recordLive(note)) return;
  const c = cursor(s);
  if (c.col !== 0) moveTo('PHRASE', c.row, 0);
  writeCell('PHRASE', c.row, 0, note, `note:${Date.now()}`);
  setState((st) => ({ notesEntered: st.notesEntered + 1, lastNoteRow: c.row }));
  previewAt('PHRASE', c.row);
  advance();
}

function advance() {
  const s = getState();
  const c = cursor(s);
  const jump = s.project.settings.stepJump;
  if (jump > 0) moveTo(s.view, (c.row + jump) % dims(s.view).rows, c.col);
}

export function setOctave(delta: number) {
  commit((d) => {
    d.settings.octave = Math.max(0, Math.min(8, d.settings.octave + delta));
  }, 'octave');
}
