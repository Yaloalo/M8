import { useLayoutEffect, useRef, useState } from 'react';
import { getChain, getInstrument } from '../core/factory';
import type { FillOptions, FillPattern, FillTarget, FillValue, FillWhere } from '../core/fill';
import { fieldHelp, formatField } from '../core/forms';
import { ALL_SCALES, byte, noteName } from '../core/format';
import { FX, FX_BY_CODE } from '../core/fx';
import { GRIDS, kindName } from '../core/grids';
import { NOTE_OFF, ROWS } from '../core/types';
import {
  clearCursor,
  cloneUnderCursor,
  copySelection,
  currentCell,
  currentKind,
  fill,
  goTo,
  gridId,
  isGridView,
  keyDown,
  keyUp,
  nudgeCursor,
  reverseRows,
  selectionRect,
  setField,
  setCurrentCell,
  setId,
  resetField,
  copyInstrument,
  pasteInstrument,
  poolClear,
  poolMove,
} from '../state/actions';
import { formFor } from '../state/fields';
import { getState, setState, useStore } from '../state/store';
import { formatCell } from './GridView';
import { Icon } from './Icon';
import { startValueDrag } from './valueDrag';
import { useFold } from './Fold';

function tapEdit() {
  keyDown('EDIT');
  keyUp('EDIT');
}

function Steppers({ coarseLabel }: { coarseLabel: string }) {
  return (
    <div className="stepper-row" data-tour="steppers">
      <button onClick={() => nudgeCursor(true, -1)} aria-label={`Down ${coarseLabel}`}>
        −{coarseLabel}
      </button>
      <button onClick={() => nudgeCursor(false, -1)} aria-label="Down one">
        −1
      </button>
      <button onClick={() => nudgeCursor(false, 1)} aria-label="Up one">
        +1
      </button>
      <button onClick={() => nudgeCursor(true, 1)} aria-label={`Up ${coarseLabel}`}>
        +{coarseLabel}
      </button>
    </div>
  );
}

/** Everything the inspector shows, except the playhead: no re-render per step while playing. */
function useEditorState() {
  useStore((st) => st.project);
  useStore((st) => st.view);
  useStore((st) => st.cursors);
  useStore((st) => st.ids);
  useStore((st) => st.selection);
  useStore((st) => st.clipboard);
  return getState();
}

export function Inspector() {
  const s = useEditorState();
  // On a phone the edit bar under the grid covers the basics; fill and help stay here.
  const fold = useFold('inspector', false);
  const view = s.view;
  const hex = s.project.settings.hex;
  const rect = selectionRect(s);
  // The desktop inspector has a fixed height: fade its bottom edge while more is below.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const checkMore = () => {
    const el = bodyRef.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useLayoutEffect(checkMore);

  let body: React.ReactNode = null;
  /** Always-visible tools under the scrolling body (instrument copy / paste / default). */
  let foot: React.ReactNode = null;
  let title = 'Inspector';

  if (isGridView(view)) {
    const kind = currentKind(s)!;
    const v = currentCell(s);
    const c = s.cursors[view];
    const col = GRIDS[view].columns[c.col];
    title = `${kindName[kind]} · row ${byte(c.row, hex)}`;
    const empty = v == null;
    const coarse = kind === 'note' ? 'oct' : kind === 'fxcmd' ? '4' : '16';
    const detail: string[] = [];
    if (kind === 'note' && typeof v === 'number' && v !== NOTE_OFF) detail.push(`MIDI ${v}`);
    if (kind === 'inst' && typeof v === 'number') {
      const inst = getInstrument(s.project, v);
      detail.push(`${inst.type}${inst.name ? ` · ${inst.name}` : ''}`);
    }
    if (kind === 'chain' && typeof v === 'number') {
      const n = getChain(s.project, v).rows.filter((r) => r.phrase != null).length;
      detail.push(n ? `${n} phrase${n > 1 ? 's' : ''}` : 'empty chain');
    }
    let fxHelp: string | null = null;
    if (kind === 'fxcmd' || kind === 'fxval') {
      const cmd = GRIDS[view].get(s.project, gridId(view, s), c.row, kind === 'fxcmd' ? c.col : c.col - 1);
      const def = typeof cmd === 'string' ? FX_BY_CODE[cmd] : undefined;
      if (def) {
        fxHelp = `${def.code} — ${def.name}. ${def.help}`;
        if (kind === 'fxval' && typeof v === 'number' && def.nibbles) detail.push(`x ${v >> 4} · y ${v & 0xf}`);
      }
    }
    // New / Clone / Open for chains, phrases and instruments: in the always-visible footer.
    if (!rect && (kind === 'chain' || kind === 'phrase' || kind === 'inst'))
      foot = (
        <div className="panel-tools inspect-inst-tools">
          <button
            onClick={() => {
              tapEdit();
              setTimeout(tapEdit, 10);
            }}
            title="EDIT twice: a new, unused one"
          >
            <Icon name="plus" size={14} /> New
          </button>
          <button onClick={() => cloneUnderCursor(true)} disabled={empty} title="Copy into a new id">
            <Icon name="clone" size={14} /> Clone
          </button>
          <button
            disabled={empty}
            onClick={() => {
              if (typeof v !== 'number') return;
              if (kind === 'chain') {
                setId('chain', v);
                setState({ track: c.col });
                goTo('CHAIN');
              } else if (kind === 'phrase') {
                setId('phrase', v);
                goTo('PHRASE');
              } else {
                setId('inst', v);
                goTo('INST');
              }
            }}
          >
            Open <Icon name="right" size={14} />
          </button>
        </div>
      );
    body = (
      <>
        <div className="inspect-value">
          <span className={`inspect-big drag-value ${empty ? 'is-empty' : ''}`} title="Drag up / down to change" onPointerDown={(e) => startValueDrag(e, (dir, coarse) => nudgeCursor(coarse, dir))}>
            {formatCell(kind, v, hex)}
          </span>
          <span className="inspect-meta">
            <span className="small-label">{col.label || kindName[kind]}</span>
            {detail.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </span>
        </div>
        {rect ? (
          <SelectionTools rows={rect.r1 - rect.r0 + 1} cols={rect.c1 - rect.c0 + 1} />
        ) : (
          <>
            <Steppers coarseLabel={coarse} />
            <div className="panel-tools">
              <button onClick={tapEdit}>{empty ? 'Insert' : 'Edit'}</button>
              <button onClick={clearCursor} disabled={empty}>
                <Icon name="trash" size={14} /> Clear
              </button>
            </div>
            {kind === 'fxcmd' && <FxPalette current={typeof v === 'string' ? v : null} />}
          </>
        )}
        {fxHelp && <p className="inspect-help">{fxHelp}</p>}
        {view === 'PHRASE' && <FillTool />}
      </>
    );
  } else if (view === 'POOL') {
    const c = s.cursors.POOL;
    title = `Pool · ${['SLOT', 'VOL', 'CHO', 'DEL', 'REV'][c.col]} ${byte(c.row, true)}`;
    body = (
      <>
        {c.col === 0 ? (
          <div className="panel-tools">
            <button onClick={() => poolMove(1)}>↑ Move up</button>
            <button onClick={() => poolMove(-1)}>↓ Move down</button>
            <button onClick={copyInstrument}>Copy</button>
            <button onClick={pasteInstrument}>Paste</button>
            <button className="danger" onClick={poolClear}>
              Clear
            </button>
          </div>
        ) : (
          <Steppers coarseLabel="16" />
        )}
        <p className="inspect-help">
          {c.col === 0
            ? 'Moving a slot moves every phrase reference with it. X picks it; on an empty slot X makes one; Z + X clears.'
            : 'Change this mixer level. Move with ← → to the other columns.'}
        </p>
      </>
    );
  } else if (view === 'PERFORM') {
    title = 'Perform';
    body = (
      <p className="inspect-help">
        Hold a pad to apply it, let go to return. The filter springs back unless you untick it. Beat repeat
        loops every track from the next step. Mutes here are the mixer’s.
      </p>
    );
  } else {
    const { fields, id } = formFor(s);
    const f = fields[s.cursors[view].row];
    if (f) {
      const v = f.get(s.project, id);
      title = `${f.group} · ${f.label}`;
      const help = fieldHelp(f);
      // Reverse on a sample with a short volume envelope is silent: say so right here.
      const inst = s.project.instruments[id];
      const env = inst?.mods.find((m) => m.dest === 'VOLUME' && m.type !== 'OFF' && m.type !== 'LFO');
      const revWarn =
        f.key === 'SAMPLER.play' && typeof v === 'string' && v.startsWith('REV') && env && env.hold + env.decay < 0x40
          ? 'The volume envelope is short: the reversed attack comes after it ends. Lengthen it in Mods, or raise START.'
          : null;
      // Instrument-wide tools: outside the scrolling body, so they are never under the fade.
      if (view === 'INST' || view === 'MODS')
        foot = (
          <div className="panel-tools inspect-inst-tools">
            <button onClick={resetField} title="Z + X: back to the default value">
              Default
            </button>
            <button onClick={copyInstrument} title="Shift + Z: copy this instrument" aria-label="Copy instrument">
              <Icon name="copy" size={14} /> Copy
            </button>
            <button onClick={pasteInstrument} title="Shift + X: paste into this slot" aria-label="Paste instrument">
              <Icon name="paste" size={14} /> Paste
            </button>
          </div>
        );
      body = (
        <>
          <div className={`inspect-value ${f.type === 'enum' || f.type === 'bool' ? 'is-choice' : ''}`}>
            <span className={`inspect-big ${f.type === 'text' ? '' : 'drag-value'}`} title={f.type === 'text' ? undefined : 'Drag up / down to change'} onPointerDown={(e) => f.type !== 'text' && startValueDrag(e, (dir, coarse) => nudgeCursor(coarse, dir))}>
              {formatField(f, v, hex)}
            </span>
          </div>
          {revWarn && <p className="notice rev-warn">{revWarn}</p>}
          {f.type === 'enum' || f.type === 'bool' ? (
            <div className="chips" role="group" aria-label={f.label}>
              {(f.type === 'bool' ? [false, true] : f.options!).map((o) => (
                <button
                  key={String(o)}
                  className={o === v ? 'active' : ''}
                  aria-pressed={o === v}
                  onClick={() => setField(view, s.cursors[view].row, o)}
                >
                  {f.type === 'bool' ? formatField(f, o, hex) : f.format ? f.format(o, hex) : String(o)}
                </button>
              ))}
            </div>
          ) : f.type === 'text' ? (
            <p className="inspect-help">Type the name in the field.</p>
          ) : (
            <>
              <Steppers coarseLabel={String(f.coarse ?? 16)} />
              <input
                type="range"
                className="inspect-range"
                aria-label={f.label}
                aria-valuetext={formatField(f, v, hex)}
                min={f.min ?? (f.type === 'signed' ? -128 : 0)}
                max={f.max ?? (f.type === 'signed' ? 127 : 255)}
                value={v as number}
                onChange={(e) => setField(view, s.cursors[view].row, Number(e.target.value))}
              />
            </>
          )}
          {/* The choices come first, so they are in view; the explanation follows. */}
          {help && <p className="inspect-help field-help">{help}</p>}
        </>
      );
    }
  }

  return (
    <section className={`panel inspector ${fold.folded ? 'is-folded' : ''}`} aria-label="Inspector">
      <ResetScroll body={bodyRef} keyOf={`${view}|${title}`} />
      <header className="panel-heading">
        <span className="small-label">{title}</span>
        <span className="panel-tools">
          {view !== 'PERFORM' && view !== 'POOL' && <span className="pill">{hex ? 'HEX' : 'DEC'}</span>}
          {fold.button}
        </span>
      </header>
      <div className={`panel-body ${more ? 'has-more' : ''}`} ref={bodyRef} onScroll={checkMore}>
        {body}
      </div>
      {foot && <footer className="inspect-foot">{foot}</footer>}
    </section>
  );
}

function SelectionTools({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      <p className="inspect-help">
        Selection {rows} × {cols}. EDIT + arrows changes every value in it.
      </p>
      <div className="panel-tools">
        <button onClick={() => copySelection()}>
          <Icon name="copy" size={14} /> Copy
        </button>
        <button onClick={() => copySelection(true)}>
          <Icon name="scissors" size={14} /> Cut
        </button>
        <button onClick={clearCursor}>
          <Icon name="trash" size={14} /> Clear
        </button>
        <button onClick={reverseRows}>
          <Icon name="reverse" size={14} /> Reverse
        </button>
        <button onClick={() => setState({ selection: null })}>Done</button>
      </div>
      <Steppers coarseLabel="16" />
    </>
  );
}

function FxPalette({ current }: { current: string | null }) {
  const view = useStore((st) => st.view);
  return (
    <div className="fx-palette" role="group" aria-label="Commands" data-tour="fx-palette">
      {FX.map((f) => (
        <button
          key={f.code}
          data-code={f.code}
          className={f.code === current ? 'active' : ''}
          aria-pressed={f.code === current}
          title={`${f.name}: ${f.help}`}
          onClick={() => {
            if (isGridView(view)) setCurrentCell(f.code);
          }}
        >
          {f.code}
        </button>
      ))}
    </div>
  );
}

const TARGETS: FillTarget[] = ['NOTE', 'VEL', 'INST', 'FX'];
const WHERES: FillWhere[] = ['ALL', 'EMPTY', 'EXISTING'];
const PATTERNS: FillPattern[] = ['EVERY', 'EUCLID', 'RANDOM'];
const VALUES: FillValue[] = ['CONSTANT', 'FROM-TO', 'RANDOM'];

function Seg<T extends string>({ label, options, value, onChange }: { label: string; options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="fill-row">
      <span className="small-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o} aria-pressed={o === value} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Num({ label, value, min, max, onChange, show }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; show?: (v: number) => string }) {
  return (
    <label className="fill-row">
      <span className="small-label">{label}</span>
      <span className="fill-num">
        <button aria-label={`${label} down`} onClick={() => onChange(Math.max(min, value - 1))}>
          −
        </button>
        <b>{show ? show(value) : value}</b>
        <button aria-label={`${label} up`} onClick={() => onChange(Math.min(max, value + 1))}>
          +
        </button>
      </span>
    </label>
  );
}

/** Polyend's Fill: which rows, which of them, what values. Works on the selection or the whole phrase. */
function FillTool() {
  const open = useStore((s) => s.fillOpen);
  const settings = useStore((s) => s.project.settings);
  const last = useStore((s) => s.last);
  const hasSel = useStore((s) => !!s.selection);
  const [o, setO] = useState<FillOptions>(() => ({
    target: 'NOTE',
    where: 'ALL',
    pattern: 'EVERY',
    amount: 4,
    value: 'CONSTANT',
    from: last.note,
    to: last.note + 12,
    fxSlot: 0,
    fxCmd: 'VOL',
    scale: settings.scale,
    root: settings.scaleRoot,
    inst: last.inst,
  }));
  const set = (patch: Partial<FillOptions>) => setO((p) => ({ ...p, ...patch }));
  if (!open) {
    return (
      <div className="fill-open">
        <button onClick={() => setState({ fillOpen: true })}>
          <Icon name="fill" size={14} /> Fill {hasSel ? 'selection' : 'phrase'}…
        </button>
        <button onClick={reverseRows}>
          <Icon name="reverse" size={14} /> Reverse
        </button>
      </div>
    );
  }
  const valueShow = (v: number) => (o.target === 'NOTE' ? noteName(v) : o.target === 'FX' || o.target === 'VEL' || o.target === 'INST' ? byte(v, settings.hex) : String(v));
  const maxValue = o.target === 'FX' ? 255 : 127;
  return (
    <div className="fill-tool" role="group" aria-label="Fill tool">
      <div className="small-label fill-title">FILL {hasSel ? 'SELECTION' : `ROWS 00–${byte(ROWS - 1, true)}`}</div>
      <Seg label="What" options={TARGETS} value={o.target} onChange={(target) => set({ target, from: target === 'NOTE' ? last.note : 0x40, to: target === 'NOTE' ? last.note + 12 : 0x7f })} />
      {o.target === 'FX' && (
        <label className="fill-row">
          <span className="small-label">Command</span>
          <select value={o.fxCmd} onChange={(e) => set({ fxCmd: e.target.value })}>
            {FX.map((f) => (
              <option key={f.code}>{f.code}</option>
            ))}
          </select>
          <select value={o.fxSlot} onChange={(e) => set({ fxSlot: Number(e.target.value) })} aria-label="FX slot">
            {[0, 1, 2].map((n) => (
              <option key={n} value={n}>
                FX{n + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      <Seg label="Where" options={WHERES} value={o.where} onChange={(where) => set({ where })} />
      <Seg label="Pattern" options={PATTERNS} value={o.pattern} onChange={(pattern) => set({ pattern, amount: pattern === 'RANDOM' ? 50 : 4 })} />
      <Num
        label={o.pattern === 'EVERY' ? 'Every' : o.pattern === 'EUCLID' ? 'Hits' : 'Density %'}
        value={o.amount}
        min={1}
        max={o.pattern === 'RANDOM' ? 100 : 16}
        onChange={(amount) => set({ amount })}
      />
      <Seg label="Value" options={VALUES} value={o.value} onChange={(value) => set({ value })} />
      <Num label={o.value === 'CONSTANT' ? 'Value' : 'From'} value={o.from} min={0} max={maxValue} onChange={(from) => set({ from })} show={valueShow} />
      {o.value !== 'CONSTANT' && <Num label="To" value={o.to} min={0} max={maxValue} onChange={(to) => set({ to })} show={valueShow} />}
      {o.target === 'NOTE' && (
        <label className="fill-row">
          <span className="small-label">Scale</span>
          <select value={o.scale} onChange={(e) => set({ scale: e.target.value as FillOptions['scale'] })}>
            {ALL_SCALES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      )}
      <div className="panel-tools">
        <button className="primary" onClick={() => fill({ ...o, scales: getState().project.scales })}>
          <Icon name="fill" size={14} /> Fill
        </button>
        <button onClick={() => setState({ fillOpen: false })}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * A new field or screen starts the fixed-height inspector at the top (no scroll carried
 * over), with the selected choice brought into view when it is further down.
 */
function ResetScroll({ body, keyOf }: { body: React.RefObject<HTMLDivElement | null>; keyOf: string }) {
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    el.scrollTop = 0;
    const chip = el.querySelector<HTMLElement>('.chips .active');
    if (chip) {
      const over = chip.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom + 40;
      if (over > 0) el.scrollTop = over;
    }
  }, [body, keyOf]);
  return null;
}
