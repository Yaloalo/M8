import { useEffect } from 'react';
import { getInstrument, getPhrase } from '../core/factory';
import { FX, FX_FOR_TYPE } from '../core/fx';
import { chooseFx } from '../state/actions';
import { getState, setState, useStore } from '../state/store';

const KINDS = [
  ['sequencer', 'Sequencer'],
  ['instrument', 'Instrument'],
  ['mixer', 'Mixer & effects'],
] as const;

/**
 * The M8 effect help/selection view: every command with its help. ↑↓ move, ←→ jump by
 * eight, X places it, Z closes. Tap works too.
 */
export function FxPicker() {
  const at = useStore((s) => s.fxPick);
  useEffect(() => {
    if (at != null) document.getElementById(`fxpick-${at}`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  if (at == null) return null;
  const current = FX[at];
  // The instrument this row plays: its own I, or the nearest one above in the phrase.
  const s = getState();
  const steps = getPhrase(s.project, s.ids.phrase).steps;
  let instId: number | null = null;
  for (let r = s.cursors.PHRASE.row; r >= 0 && instId == null && s.view === 'PHRASE'; r--) instId = steps[r].inst;
  const type = getInstrument(s.project, instId ?? s.ids.inst).type;
  const applies = (code: string) => !FX_FOR_TYPE[code] || FX_FOR_TYPE[code] === type;
  return (
    <div className="fx-pick" role="dialog" aria-label="Choose a command">
      <div className="fx-pick-head">
        <span className="small-label">
          Commands<span className="key-only"> · ↑↓ · ←→ group · X place · Z close</span>
        </span>
        <button className="icon-button" aria-label="Close" onClick={() => setState({ fxPick: null })}>
          ×
        </button>
      </div>
      <div className="fx-pick-body">
        <ul className="fx-pick-list" role="listbox" aria-activedescendant={`fxpick-${at}`}>
          {KINDS.map(([kind, label]) => (
            <li key={kind} role="presentation">
              <div className="small-label fx-pick-group">{label}</div>
              <ul role="group">
                {FX.map((f, i) =>
                  f.kind === kind ? (
                    <li
                      key={f.code}
                      id={`fxpick-${i}`}
                      role="option"
                      aria-selected={i === at}
                      className={`${i === at ? 'is-cursor' : ''} ${applies(f.code) ? '' : 'is-other'}`}
                      title={applies(f.code) ? undefined : `For ${FX_FOR_TYPE[f.code]} instruments`}
                      onPointerDown={() => setState({ fxPick: i })}
                      onDoubleClick={() => chooseFx(i)}
                    >
                      <b>{f.code}</b> <span>{f.name}</span>
                    </li>
                  ) : null,
                )}
              </ul>
            </li>
          ))}
        </ul>
        <div className="fx-pick-help" aria-live="polite">
          <b>
            {current.code} · {current.name}
          </b>
          <p>{current.help}</p>
          <button className="primary" data-tour="fx-place" onClick={() => chooseFx(at)}>
            Place {current.code}
          </button>
        </div>
      </div>
    </div>
  );
}
