import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { toSigned } from '../core/fx';
import { byte, noteName, rowLabel, signed } from '../core/format';
import { GRIDS, type Cell, type CellKind, type GridView as GridViewId } from '../core/grids';
import { NOTE_OFF, type Project } from '../core/types';
import { getPhrase } from '../core/factory';
import { beginSelection, gridId, keyDown, keyUp, moveTo, nudgeCursor, selectionRect } from '../state/actions';
import { followCursor, scrollByY, scrollerOf, scrollTopOf } from './scroller';
import { startValueDrag } from './valueDrag';
import { getState, setState, useStore } from '../state/store';

export function formatCell(kind: CellKind, v: Cell, hex: boolean): string {
  switch (kind) {
    case 'note':
      return noteName(typeof v === 'number' ? v : null);
    case 'fxcmd':
      return typeof v === 'string' ? v : '---';
    case 'tsp':
    case 'ttsp':
      return signed(toSigned((v as number) & 0xff), hex);
    default:
      return byte(typeof v === 'number' ? v : null, hex);
  }
}

const WIDTH: Record<CellKind, string> = {
  chain: 'minmax(var(--w-byte), 1fr)',
  phrase: 'minmax(var(--w-byte), 1fr)',
  tsp: 'minmax(var(--w-byte), 1fr)',
  note: 'minmax(var(--w-note), 1.3fr)',
  vel: 'minmax(var(--w-byte), 1fr)',
  inst: 'minmax(var(--w-byte), 1fr)',
  fxcmd: 'minmax(var(--w-cmd), 1.2fr)',
  fxval: 'minmax(var(--w-byte), 1fr)',
  ttsp: 'minmax(var(--w-byte), 1fr)',
  ticks: 'minmax(var(--w-byte), 1fr)',
};

const VISIBLE = 16;

/** Rows currently under a playhead, per screen. */
function playRows(view: GridViewId, id: number): Map<number, Set<number>> {
  const s = getState();
  const out = new Map<number, Set<number>>();
  const add = (row: number, col: number) => {
    if (!out.has(row)) out.set(row, new Set());
    out.get(row)!.add(col);
  };
  s.positions.forEach((pos, t) => {
    if (view === 'SONG' && pos.queued != null) add(pos.queued, t + 100);
    if (!pos.active) return;
    if (view === 'SONG') add(pos.songRow, t);
    else if (view === 'CHAIN' && pos.chainId === id) add(pos.chainRow, -1);
    else if (view === 'PHRASE' && pos.phraseId === id) add(pos.step, -1);
    else if (view === 'TABLE' && pos.tableId === id) add(pos.tableRow, -1);
  });
  return out;
}

/** Chains whose phrases hold no note: the M8 draws them dimmed on the song screen. */
function hollowChains(p: Project): Set<number> {
  const out = new Set<number>();
  for (const [k, c] of Object.entries(p.chains)) {
    const hasNote = c.rows.some((r) => r.phrase != null && getPhrase(p, r.phrase).steps.some((s) => s.note != null));
    if (!hasNote) out.add(Number(k));
  }
  for (const row of p.song) for (const id of row) if (id != null && !p.chains[id]) out.add(id);
  // Only chains that are referenced matter; unused ids are never drawn.
  return out;
}

export function GridView({ view }: { view: GridViewId }) {
  const project = useStore((s) => s.project);
  const cursor = useStore((s) => s.cursors[view]);
  useStore((s) => s.selection);
  useStore((s) => s.positions);
  useStore((s) => s.ids);
  const spec = GRIDS[view];
  const id = gridId(view);
  const hex = project.settings.hex;
  const rect = selectionRect();
  const playing = playRows(view, id);
  const top = useRef(0);
  const dragFrom = useRef<{ row: number; col: number } | null>(null);

  // The song is 256 rows; show a window that follows the cursor, like the M8 screen.
  if (spec.rows > VISIBLE) {
    if (cursor.row < top.current) top.current = cursor.row;
    if (cursor.row >= top.current + VISIBLE) top.current = cursor.row - VISIBLE + 1;
  } else top.current = 0;
  const rows = Array.from({ length: Math.min(VISIBLE, spec.rows) }, (_, i) => top.current + i);
  const template = `var(--w-row) ${spec.columns.map((c) => WIDTH[c.kind]).join(' ')}`;
  const beats = view === 'PHRASE' || view === 'TABLE' || view === 'GROOVE';
  const mixer = project.mixer;
  const reorder = useStore((s) => s.reorder);
  const repeatLanes = useStore((s) =>
    s.positions
      .filter((pos) => pos.active && pos.repeatLane != null && pos.phraseId === s.ids.phrase)
      .map((pos) => pos.repeatLane!)
      .join(','),
  )
    .split(',')
    .filter(Boolean)
    .map(Number);
  const hollow = useMemo(() => (view === 'SONG' ? hollowChains(project) : null), [view, project]);
  const cursorId = `cell-${view}-${cursor.row}-${cursor.col}`;
  const box = useRef<HTMLDivElement>(null);

  // Touch: hold a cell (400 ms, without moving) to start a selection, then drag to extend
  // it. Before the hold completes a moving finger just scrolls the page as usual.
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const touchSelecting = useRef(false);
  const finger = useRef({ x: 0, y: 0 });
  const edgeLoop = useRef(0);
  const endHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
    touchSelecting.current = false;
    cancelAnimationFrame(edgeLoop.current);
  };
  const cellUnderFinger = () => {
    const m = document
      .elementFromPoint(finger.current.x, finger.current.y)
      ?.closest('.cell')
      ?.id.match(/^cell-\w+-(\d+)-(\d+)$/);
    if (m) moveTo(view, Number(m[1]), Number(m[2]));
  };
  // While selecting, a finger held near the edit bar or the header scrolls on, so one
  // gesture can select more than fits on screen. Past the page's end, the cursor steps on.
  const edgeScroll = () => {
    let last = 0;
    const tick = (t: number) => {
      if (!touchSelecting.current) return;
      const y = finger.current.y;
      const top = (document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0) + 40;
      const bar = document.querySelector('.cell-bar');
      const bottom = (bar && bar.getClientRects().length ? bar.getBoundingClientRect().top : window.innerHeight - 56) - 40;
      const dir = y > bottom ? 1 : y < top ? -1 : 0;
      if (dir) {
        const sc = scrollerOf(box.current);
        const before = scrollTopOf(sc);
        scrollByY(sc, dir * 8);
        if (scrollTopOf(sc) !== before) cellUnderFinger();
        else if (t - last > 110) {
          last = t;
          const c = getState().cursors[view];
          moveTo(view, c.row + dir, c.col);
        }
      }
      edgeLoop.current = requestAnimationFrame(tick);
    };
    edgeLoop.current = requestAnimationFrame(tick);
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // While selecting, the finger drags the selection instead of the page.
    const stopScroll = (e: TouchEvent) => touchSelecting.current && e.cancelable && e.preventDefault();
    el.addEventListener('touchmove', stopScroll, { passive: false });
    return () => el.removeEventListener('touchmove', stopScroll);
  }, []);
  useEffect(() => endHold, []);

  // Keep the cursor on screen, clear of the header, the transport and the phone edit bar.
  useEffect(() => {
    followCursor(document.getElementById(cursorId));
  }, [cursorId]);

  const here = spec.columns[cursor.col];
  const announce = `${here.label || 'value'} row ${rowLabel(cursor.row, hex)}: ${formatCell(here.kind, spec.get(project, id, cursor.row, cursor.col), hex)}`;
  return (
    <>
    <span className="visually-hidden" aria-live="polite">
      {announce}
    </span>
    <div
      className={`tracker tracker-${view.toLowerCase()}`}
      role="grid"
      ref={box}
      tabIndex={0}
      aria-label={`${view} grid. Arrows move, X edits, Z is option.`}
      aria-rowcount={spec.rows + 1}
      aria-activedescendant={cursorId}
      style={{ '--cols': template } as CSSProperties}
      onPointerUp={() => {
        dragFrom.current = null;
        endHold();
      }}
      onPointerCancel={endHold}
      onContextMenu={(e) => {
        // A long press selects; it must not also open the browser's menu.
        if (touchSelecting.current || hold.current) e.preventDefault();
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch') return;
        endHold();
        const from = dragFrom.current;
        if (!from) return;
        const timer = window.setTimeout(() => {
          touchSelecting.current = true;
          beginSelection(from);
          navigator.vibrate?.(10);
          edgeScroll();
        }, 400);
        hold.current = { timer, x: e.clientX, y: e.clientY };
        finger.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'touch') return;
        const h = hold.current;
        if (h && !touchSelecting.current && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) {
          endHold();
          return;
        }
        finger.current = { x: e.clientX, y: e.clientY };
        if (!touchSelecting.current) return;
        // Touch pointers stay captured by the first cell: find the one under the finger.
        cellUnderFinger();
      }}
      onWheel={(e) => {
        if (spec.rows <= VISIBLE || Math.abs(e.deltaY) < 4) return;
        moveTo(view, cursor.row + (e.deltaY > 0 ? 4 : -4), cursor.col);
      }}
    >
      <div className="tracker-head" role="row" aria-rowindex={1}>
        <span role="columnheader" className="tracker-rowhead">
          #
        </span>
        {spec.columns.map((c, i) => {
          const muted = view === 'SONG' && mixer.mute[i];
          const moving = view === 'SONG' && reorder && cursor.col === i;
          const rep = view === 'PHRASE' && c.kind === 'fxcmd' && repeatLanes.includes(c.slot ?? -1);
          const solo = view === 'SONG' && mixer.solo[i];
          return (
            <span
              key={i}
              role="columnheader"
              className={`${c.kind === 'fxval' ? 'is-val' : ''} ${muted ? 'is-muted' : ''} ${solo ? 'is-solo' : ''} ${moving ? 'is-moving' : ''}`}
            >
              {c.label}
              {rep && <em title="A REP from an earlier row is still running">^^</em>}
              {moving && <em>⇄</em>}
              {muted && <em aria-label="muted">M</em>}
              {solo && <em aria-label="solo">S</em>}
            </span>
          );
        })}
      </div>
      {rows.map((row) => {
        const play = playing.get(row);
        const rowPlaying = !!play?.has(-1);
        return (
          <div
            key={row}
            role="row"
            aria-rowindex={row + 2}
            className={`tracker-row ${beats && row % 4 === 0 ? 'is-beat' : ''} ${rowPlaying ? 'is-play' : ''}`}
          >
            <span className="tracker-rowhead" role="rowheader">
              {rowPlaying && <b aria-hidden="true">▸</b>}
              {rowLabel(row, hex)}
            </span>
            {spec.columns.map((c, col) => {
              const v = spec.get(project, id, row, col);
              const here = cursor.row === row && cursor.col === col;
              const sel =
                rect && row >= rect.r0 && row <= rect.r1 && col >= rect.c0 && col <= rect.c1;
              const cls = [
                'cell',
                `k-${c.kind}`,
                v == null || (c.kind === 'fxval' && v == null) ? 'is-empty' : '',
                c.kind === 'note' && v === NOTE_OFF ? 'is-off' : '',
                here ? 'is-cursor' : '',
                sel ? 'is-selected' : '',
                play?.has(col) ? 'is-play' : '',
                play?.has(col + 100) ? 'is-queued' : '',
                view === 'SONG' && mixer.mute[col] ? 'is-muted' : '',
                hollow && typeof v === 'number' && hollow.has(v) ? 'is-hollow' : '',
                view === 'SONG' && typeof v === 'number' && project.bookmarks.includes(v) ? 'is-bookmark' : '',
              ].join(' ');
              return (
                <span
                  key={col}
                  id={`cell-${view}-${row}-${col}`}
                  role="gridcell"
                  aria-selected={here}
                  aria-label={`${c.label || 'value'} ${v == null ? 'empty' : formatCell(c.kind, v, hex)}`}
                  className={cls}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    if (e.shiftKey && !getState().selection) beginSelection();
                    else if (!e.shiftKey && getState().selection) setState({ selection: null });
                    moveTo(view, row, col);
                    // Shift + drag selects (touch: hold, then drag); a plain mouse drag sets the
                    // value, up for more, down for less.
                    if (e.shiftKey || e.pointerType === 'touch') dragFrom.current = { row, col };
                    else {
                      dragFrom.current = null;
                      startValueDrag(e, (dir, coarse) => nudgeCursor(coarse, dir));
                    }
                  }}
                  onPointerEnter={(e) => {
                    const from = dragFrom.current;
                    if (!from || e.buttons !== 1) return;
                    if (!getState().selection) beginSelection(from);
                    moveTo(view, row, col);
                  }}
                  onDoubleClick={() => {
                    keyDown('EDIT');
                    keyUp('EDIT');
                  }}
                >
                  {formatCell(c.kind, v, hex)}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
    </>
  );
}
