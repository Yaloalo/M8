import { formatField } from '../core/forms';
import { FX } from '../core/fx';
import { GRIDS, kindName } from '../core/grids';
import {
  clearCursor,
  copySelection,
  currentCell,
  currentKind,
  isGridView,
  keyDown,
  keyUp,
  copyInstrument,
  nudgeCursor,
  openFxPick,
  paste,
  pasteInstrument,
  poolClear,
  poolMove,
  reverseRows,
  selectionRect,
  setCurrentCell,
} from '../state/actions';
import { formFor } from '../state/fields';
import { getState, setState, useStore } from '../state/store';
import { formatCell } from './GridView';
import { Icon } from './Icon';
import { HwKey } from './Side';

const tap = () => {
  keyDown('EDIT');
  keyUp('EDIT');
};

/**
 * On a phone the inspector is far below the grid, so the essentials ride along at the
 * bottom of the screen: the value under the cursor and the buttons that change it.
 */
export function CellBar() {
  useStore((s) => s.project);
  useStore((s) => s.cursors);
  useStore((s) => s.ids);
  const view = useStore((s) => s.view);
  useStore((s) => s.selection);
  const clip = useStore((s) => s.clipboard);
  const barKeys = useStore((s) => s.barKeys);
  const s = getState();
  const hex = s.project.settings.hex;
  const rect = selectionRect(s);
  if (barKeys)
    // The eight M8 keys, docked under the grid: hold one, press another, as on the device.
    return (
      <div className="cell-bar is-keys" role="group" aria-label="M8 keys">
        <HwKey k="LEFT" icon="left" />
        <HwKey k="DOWN" icon="down" />
        <HwKey k="UP" icon="up" />
        <HwKey k="RIGHT" icon="right" />
        <button className="cb-icon bar-keys-close" aria-label="Back to the edit buttons" onClick={() => setState({ barKeys: false })}>
          <Icon name="close" size={16} />
        </button>
        <HwKey k="OPTION" label="OPT" />
        <HwKey k="EDIT" label="EDIT" />
        <HwKey k="SHIFT" label="SHIFT" />
        <HwKey k="PLAY" label="PLAY" />
      </div>
    );
  if (isGridView(view) && rect) {
    // A selection (long press + drag, or SHIFT + OPTION): what can be done with it.
    return (
      <div className="cell-bar is-grid" role="group" aria-label="Edit the selection">
        <span className="cell-bar-value">
          <small>SELECTION</small>
          <b>
            {rect.r1 - rect.r0 + 1}×{rect.c1 - rect.c0 + 1}
          </b>
        </span>
        <span className="cell-bar-steps">
          <button onClick={() => nudgeCursor(false, -1)} aria-label="Every value down 1">
            −1
          </button>
          <button onClick={() => nudgeCursor(false, 1)} aria-label="Every value up 1">
            +1
          </button>
        </span>
        <button className="cb-icon" onClick={() => copySelection()} aria-label="Copy" title="Copy">
          <Icon name="copy" size={16} />
        </button>
        <button className="cb-icon" onClick={() => copySelection(true)} aria-label="Cut" title="Cut">
          <Icon name="scissors" size={16} />
        </button>
        <button className="cb-icon" onClick={clearCursor} aria-label="Clear" title="Clear">
          <Icon name="trash" size={16} />
        </button>
        <button className="cb-icon" onClick={reverseRows} aria-label="Reverse" title="Reverse">
          <Icon name="reverse" size={16} />
        </button>
        <button className="cb-icon" onClick={() => setState({ selection: null })} aria-label="Done" title="Done: end the selection">
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  }
  if (isGridView(view)) {
    const kind = currentKind(s)!;
    const v = currentCell(s);
    const coarse = kind === 'note' ? 'oct' : kind === 'fxcmd' ? '4' : '16';
    return (
      <div className="cell-bar is-grid" role="group" aria-label="Edit the cell under the cursor">
        <span className="cell-bar-value">
          <small>{GRIDS[view].columns[s.cursors[view].col].label || kindName[kind]}</small>
          <b>{formatCell(kind, v, hex)}</b>
        </span>
        {kind === 'fxcmd' ? (
          <button onClick={openFxPick} aria-label="Command list with help">
            List
          </button>
        ) : null}
        {kind === 'fxcmd' ? (
          <select
            data-tour="fx-pick"
            aria-label="Command"
            value={typeof v === 'string' ? v : ''}
            onChange={(e) => setCurrentCell(e.target.value || null)}
          >
            <option value="">---</option>
            {FX.map((f) => (
              <option key={f.code} value={f.code}>
                {f.code} {f.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="cell-bar-steps">
            <button onClick={() => nudgeCursor(true, -1)}>−{coarse}</button>
            <button onClick={() => nudgeCursor(false, -1)}>−1</button>
            <button onClick={() => nudgeCursor(false, 1)}>+1</button>
            <button onClick={() => nudgeCursor(true, 1)}>+{coarse}</button>
          </span>
        )}
        {/* Icons with names: on a 320 px phone every button still fits on one line. */}
        <button className="cb-icon" onClick={tap} aria-label={v == null ? 'Insert' : 'Play'} title={v == null ? 'Insert' : 'Play'}>
          <Icon name={v == null ? 'plus' : 'play'} size={16} />
        </button>
        {kind === 'note' && v == null ? (
          <button onClick={clearCursor} aria-label="Write note off">
            OFF
          </button>
        ) : (
          <button className="cb-icon" onClick={clearCursor} aria-label="Clear" title="Clear">
            <Icon name="trash" size={16} />
          </button>
        )}
        {clip && (
          <button className="cb-icon" onClick={paste} aria-label="Paste" title={`Paste ${clip.cells.length}×${clip.kinds.length} here`}>
            <Icon name="paste" size={16} />
          </button>
        )}
      </div>
    );
  }
  if (view === 'POOL') {
    const { row, col } = s.cursors.POOL;
    const inst = s.project.instruments[row];
    const key = (['dry', 'cho', 'del', 'rev'] as const)[col - 1];
    return (
      <div className="cell-bar" role="group" aria-label="Edit the pool slot">
        <span className="cell-bar-value">
          <small>{col ? ['VOL', 'CHO', 'DEL', 'REV'][col - 1] : `SLOT ${row.toString(16).toUpperCase().padStart(2, '0')}`}</small>
          <b>{col && inst ? inst[key].toString(16).toUpperCase().padStart(2, '0') : inst ? inst.name || inst.type : '--'}</b>
        </span>
        {col ? (
          <>
            <button onClick={() => nudgeCursor(false, -1)}>−1</button>
            <button onClick={() => nudgeCursor(false, 1)}>+1</button>
            <button onClick={() => nudgeCursor(true, 1)}>+16</button>
          </>
        ) : (
          <>
            <button onClick={() => poolMove(1)} aria-label="Move slot up">
              ↑
            </button>
            <button onClick={() => poolMove(-1)} aria-label="Move slot down">
              ↓
            </button>
            <button onClick={tap}>{inst ? 'Pick' : 'New'}</button>
            <button onClick={copyInstrument} disabled={!inst}>
              Copy
            </button>
            <button onClick={pasteInstrument}>Paste</button>
            <button onClick={poolClear} disabled={!inst}>
              Clear
            </button>
          </>
        )}
      </div>
    );
  }
  const { fields, id } = formFor(s);
  const f = fields[s.cursors[view].row];
  if (!f || f.type === 'text') return null;
  return (
    <div className="cell-bar" role="group" aria-label="Edit the selected parameter">
      <span className="cell-bar-value">
        <small>{f.label}</small>
        <b>{formatField(f, f.get(s.project, id), hex)}</b>
      </span>
      {f.type === 'enum' || f.type === 'bool' ? (
        <>
          <button onClick={() => nudgeCursor(false, -1)} aria-label="Previous option">‹</button>
          <button onClick={() => nudgeCursor(false, 1)} aria-label="Next option">›</button>
        </>
      ) : (
        <>
          <button onClick={() => nudgeCursor(true, -1)}>−{f.coarse ?? 16}</button>
          <button onClick={() => nudgeCursor(false, -1)}>−1</button>
          <button onClick={() => nudgeCursor(false, 1)}>+1</button>
          <button onClick={() => nudgeCursor(true, 1)}>+{f.coarse ?? 16}</button>
        </>
      )}
    </div>
  );
}
