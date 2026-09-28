import { useEffect, type CSSProperties } from 'react';
import { formatField, modFieldRelevant, type Field } from '../core/forms';
import { moveTo, nudgeCursor, setField } from '../state/actions';
import { formFor } from '../state/fields';
import { followCursor } from './scroller';
import { startValueDrag } from './valueDrag';
import { getState, useStore, type ViewId } from '../state/store';

/** Field groups become panels-in-a-panel; the cursor row is the inverted one. */
export function FormView({ view }: { view: ViewId }) {
  useStore((st) => st.project);
  useStore((st) => st.cursors);
  useStore((st) => st.ids);
  const s = getState();
  const { fields, id } = formFor(s, view);
  const cursor = s.cursors[view];
  const hex = s.project.settings.hex;
  // The cursor field stays in view as it moves (keyboard, or the docked keys on a phone).
  useEffect(() => {
    followCursor(document.getElementById(`field-row-${view}-${cursor.row}`));
  }, [view, cursor.row]);
  const groups: { name: string; items: { f: Field; index: number }[] }[] = [];
  fields.forEach((f, index) => {
    const g = groups.at(-1);
    if (g && g.name === f.group) g.items.push({ f, index });
    else groups.push({ name: f.group, items: [{ f, index }] });
  });

  return (
    <div className={`form form-${view.toLowerCase()}`} role="list">
      {groups.map((g) => (
        <section key={g.name} className="form-group" aria-label={g.name}>
          <div className="small-label form-group-title">{g.name}</div>
          {g.items.map(({ f, index }) => {
            const v = f.get(s.project, id);
            const here = cursor.row === index;
            const idle = view === 'MODS' && !modFieldRelevant(s.project, id, f);
            const bar = f.type === 'byte' ? (v as number) / 255 : null;
            return (
              <div
                key={f.key}
                id={`field-row-${view}-${index}`}
                role="listitem"
                className={`field ${here ? 'is-cursor' : ''} ${idle ? 'is-idle' : ''}`}
                onPointerDown={(e) => {
                  moveTo(view, index, 0);
                  // Drag the value up / down (not from the name input or the steppers).
                  if (f.type !== 'text' && !(e.target as HTMLElement).closest('input, button, select')) startValueDrag(e, (dir, coarse) => nudgeCursor(coarse, dir));
                }}
              >
                <span className="field-label">{f.label}</span>
                {f.type === 'text' ? (
                  <input
                    id={`field-${f.key}`}
                    className="field-text"
                    value={v as string}
                    maxLength={16}
                    aria-label={f.label}
                    onFocus={() => moveTo(view, index, 0)}
                    onChange={(e) => setField(view, index, e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span className="field-value">
                    {bar != null && (
                      <i className="field-bar" style={{ '--v': bar } as CSSProperties} aria-hidden="true" />
                    )}
                    <b>{formatField(f, v, hex)}</b>
                  </span>
                )}
                {here && f.type !== 'text' && (
                  <span className="field-steppers">
                    <button
                      aria-label={`${f.label} down`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => nudgeCursor(false, -1)}
                    >
                      −
                    </button>
                    <button
                      aria-label={`${f.label} up`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => nudgeCursor(false, 1)}
                    >
                      +
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** Used by the keyboard handler: EDIT on a text field focuses its input. */
export function focusTextField(): boolean {
  const s = getState();
  const { fields } = formFor(s);
  const f = fields[s.cursors[s.view].row];
  if (f?.type !== 'text') return false;
  document.getElementById(`field-${f.key}`)?.focus();
  return true;
}
