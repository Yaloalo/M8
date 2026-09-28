import { useEffect } from 'react';
import { getInstrument, unusedInstrument } from '../core/factory';
import { hex2 } from '../core/format';
import { poolUsage } from '../core/pool';
import { keyDown, keyUp, moveTo, nudgeCursor, poolClear } from '../state/actions';
import { commit, getState, setState, useStore } from '../state/store';
import { followCursor } from './scroller';
import { startValueDrag } from './valueDrag';
import { preview } from '../state/transport';

const COLS = ['VOL', 'CHO', 'DEL', 'REV'] as const;
const KEYS = ['dry', 'cho', 'del', 'rev'] as const;

/**
 * The M8 instrument pool: all 128 slots. The cursor moves over the number and the four
 * mixer columns; X opens (or makes) an instrument, X + arrows edit a mixer column or, on the
 * number, move the slot. Space previews.
 */
export function PoolView() {
  const instruments = useStore((s) => s.project.instruments);
  const phrases = useStore((s) => s.project.phrases);
  const cursor = useStore((s) => s.cursors.POOL);
  const hex = useStore((s) => s.project.settings.hex);
  const used = poolUsage({ ...getState().project, phrases });
  useEffect(() => {
    // The pool table scrolls itself; keep the row in it, then the row clear of the bars.
    const row = document.getElementById(`pool-${cursor.row}`);
    row?.scrollIntoView({ block: 'nearest' });
    followCursor(row);
  }, [cursor.row]);
  const tap = () => {
    keyDown('EDIT');
    keyUp('EDIT');
  };
  return (
    <div className="pool-wrap">
      <table className="pool" role="grid" aria-label="Instrument pool" aria-rowcount={129}>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">NAME</th>
            <th scope="col">TYPE</th>
            <th scope="col">USED</th>
            {COLS.map((c) => (
              <th key={c} scope="col" className="pool-mix">
                {c}
              </th>
            ))}
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 128 }, (_, id) => {
            const inst = instruments[id];
            const n = used.get(id) ?? 0;
            const here = cursor.row === id;
            return (
              <tr
                key={id}
                id={`pool-${id}`}
                aria-rowindex={id + 2}
                className={`${here ? 'is-current' : ''} ${inst ? '' : 'is-empty'} ${inst && !n ? 'is-unused' : ''}`}
                aria-selected={here}
              >
                <th scope="row" className={here && cursor.col === 0 ? 'is-cursor' : ''} onPointerDown={() => moveTo('POOL', id, 0)} onDoubleClick={tap}>
                  {hex ? hex2(id) : String(id).padStart(3, '0')}
                </th>
                <td onPointerDown={() => moveTo('POOL', id, 0)} onDoubleClick={tap}>
                  {inst ? inst.name || '—' : '--'}
                </td>
                <td onPointerDown={() => moveTo('POOL', id, 0)}>{inst ? inst.type : ''}</td>
                <td onPointerDown={() => moveTo('POOL', id, 0)}>{n ? `${n} STEP${n > 1 ? 'S' : ''}` : inst ? 'UNUSED' : ''}</td>
                {KEYS.map((k, c) => (
                  <td
                    key={k}
                    className={`pool-mix ${here && cursor.col === c + 1 ? 'is-cursor' : ''}`}
                    onPointerDown={(e) => {
                      moveTo('POOL', id, c + 1);
                      if (inst) startValueDrag(e, (dir, coarse) => nudgeCursor(coarse, dir));
                    }}
                  >
                    {inst ? hex2(inst[k]) : ''}
                  </td>
                ))}
                <td className="pool-actions">
                  {inst ? (
                    <>
                      <button onClick={() => void preview(getState().track, id, 60)} aria-label={`Hear instrument ${hex2(id)}`}>
                        ▶
                      </button>
                      <button
                        onClick={() => {
                          moveTo('POOL', id, 0);
                          tap();
                        }}
                      >
                        Pick
                      </button>
                      <button
                        onClick={() => {
                          const to = unusedInstrument(getState().project);
                          if (to == null) return;
                          const copy = structuredClone(getInstrument(getState().project, id));
                          commit((d) => {
                            d.instruments[to] = copy;
                          });
                          setState({ status: `COPIED ${hex2(id)} → ${hex2(to)}` });
                        }}
                      >
                        Copy
                      </button>
                      <button
                        className="danger"
                        title={n > 0 ? `Used by ${n} steps: they go silent (undo brings it back)` : 'Clear this slot'}
                        onClick={() => {
                          if (n > 0 && !confirm(`Instrument ${hex2(id)} is used by ${n} steps. Clear it anyway? Undo brings it back.`)) return;
                          moveTo('POOL', id, 0);
                          poolClear();
                        }}
                      >
                        Clear
                      </button>
                    </>
                  ) : (
                    here && (
                      <button
                        onClick={() => {
                          moveTo('POOL', id, 0);
                          tap();
                        }}
                      >
                        New
                      </button>
                    )
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
