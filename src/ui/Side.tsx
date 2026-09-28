import { useEffect, useRef, type CSSProperties } from 'react';
import { getInstrument } from '../core/factory';
import { hex2, inScale, NOTE_NAMES, noteName } from '../core/format';
import { TRACKS } from '../core/types';
import {
  currentTrack,
  enterNote,
  openView,
  keyDown,
  keyUp,
  setOctave,
  toggleMute,
  toggleSolo,
  type Key,
} from '../state/actions';
import { levels } from '../state/transport';
import { VIEW_MAP, getState, useStore } from '../state/store';
import { VIEW_LABEL } from './Header';
import { Icon } from './Icon';
import { startValueDrag } from './valueDrag';
import { useFold } from './Fold';

/** The M8's right-hand strip: what every track is doing now. */
export function TracksPanel() {
  const positions = useStore((s) => s.positions);
  const mixer = useStore((s) => s.project.mixer);
  const instruments = useStore((s) => s.project.instruments);
  const touring = useStore((s) => s.tour != null);
  const playing = useStore((s) => s.playing);
  const focus = useStore((s) => currentTrack(s));
  const meters = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    if (!playing) {
      meters.current.forEach((m) => m?.style.setProperty('--l', '0'));
      return;
    }
    let raf = 0;
    const tick = () => {
      levels().forEach((l, i) => meters.current[i]?.style.setProperty('--l', String(Math.min(1, l * 3))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const anySolo = mixer.solo.some(Boolean);
  const fold = useFold('tracks', false);
  return (
    <section className={`panel tracks-panel ${fold.folded && !touring ? 'is-folded' : ''}`} aria-label="Tracks" data-tour="tracks">
      <header className="panel-heading">
        <span className="small-label">Tracks</span>
        <span className="panel-tools">
          {/* Teach mode holds the panel open, so its fold toggle would only mislead. */}
          {!touring && fold.button}
          <span className="pill key-only">Z+Shift mute · Z+Space solo</span>
          <span className="pill touch-only">tap M or S</span>
        </span>
      </header>
      <ol className="track-list">
        {Array.from({ length: TRACKS }, (_, t) => {
          const pos = positions[t];
          const inst = pos.inst != null ? (instruments[pos.inst] ?? getInstrument(getState().project, pos.inst)) : null;
          const silent = mixer.mute[t] || (anySolo && !mixer.solo[t]);
          return (
            <li key={t} className={`track-line ${t === focus ? 'is-focus' : ''} ${silent ? 'is-silent' : ''} ${pos.active ? 'is-active' : ''}`}>
              <span className="track-num">{t + 1}</span>
              <span className="track-now">
                <b>{pos.active ? noteName(pos.note) : '---'}</b>
                <small>{pos.active && inst ? inst.name || `I${hex2(pos.inst!)}` : ''}</small>
              </span>
              <i className="meter" ref={(el) => void (meters.current[t] = el)} aria-hidden="true" />
              <button
                className={`ms ${mixer.mute[t] ? 'is-on' : ''}`}
                aria-pressed={mixer.mute[t]}
                aria-label={`Mute track ${t + 1}`}
                onClick={() => toggleMute(t)}
              >
                M
              </button>
              <button
                className={`ms ${mixer.solo[t] ? 'is-on' : ''}`}
                aria-pressed={mixer.solo[t]}
                aria-label={`Solo track ${t + 1}`}
                onClick={() => toggleSolo(t)}
              >
                S
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function ViewMapPanel() {
  const view = useStore((s) => s.view);
  const fold = useFold('view map', false);
  return (
    <section className={`panel ${fold.folded ? 'is-folded' : ''}`} aria-label="View map">
      <header className="panel-heading">
        <span className="small-label">View map</span>
        <span className="panel-tools">
          <span className="pill">Shift + arrows</span>
          {fold.button}
        </span>
      </header>
      <div className="view-map">
        {VIEW_MAP.flatMap((row, r) =>
          row.map((v, c) =>
            v ? (
              <button
                key={v}
                className={v === view ? 'active' : ''}
                aria-pressed={v === view}
                style={{ gridRow: r + 1, gridColumn: c + 1 } as CSSProperties}
                onClick={() => openView(v)}
              >
                {v === 'INST' ? 'Inst' : VIEW_LABEL[v]}
              </button>
            ) : null,
          ),
        )}
      </div>
      {/* Off the map (reached from a field or a tab): still shown, so you can see where you are. */}
      <div className="view-map view-map-extra" role="group" aria-label="Also">
        {(['EQ', 'SCALE'] as const).map((v) => (
          <button key={v} className={v === view ? 'active' : ''} aria-pressed={v === view} onClick={() => openView(v)}>
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
    </section>
  );
}

const KEY_HINT: Record<Key, string> = {
  UP: '↑',
  DOWN: '↓',
  LEFT: '←',
  RIGHT: '→',
  OPTION: 'Z',
  EDIT: 'X',
  SHIFT: 'Shift',
  PLAY: 'Space',
};

export function HwKey({ k, label, icon, className = '' }: { k: Key; label?: string; icon?: string; className?: string }) {
  return (
    <button
      className={`hw-key hw-${k.toLowerCase()} ${className}`}
      aria-label={`${k} (${KEY_HINT[k]})`}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        keyDown(k);
      }}
      onPointerUp={() => keyUp(k)}
      onPointerCancel={() => keyUp(k)}
      onClick={(e) => {
        // Keyboard activation (Enter/Space on a focused key) arrives as a click without a pointer.
        if (e.detail === 0) {
          keyDown(k);
          keyUp(k);
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {icon ? <Icon name={icon} size={16} /> : label}
      <small>{KEY_HINT[k]}</small>
    </button>
  );
}

/** The eight M8 buttons. Hold with one finger, press with another — as on the device. */
export function KeysPanel() {
  const fold = useFold('keys', true);
  return (
    <section id="keys" tabIndex={-1} className={`panel keys-panel ${fold.folded ? 'is-folded' : ''}`} aria-label="M8 keys">
      <header className="panel-heading">
        <span className="small-label">Keys</span>
        <span className="panel-tools">
          <span className="pill">hold + press</span>
          {fold.button}
        </span>
      </header>
      <div className="hw-keys">
        <div className="hw-dpad">
          <HwKey k="UP" icon="up" />
          <HwKey k="LEFT" icon="left" />
          <HwKey k="DOWN" icon="down" />
          <HwKey k="RIGHT" icon="right" />
        </div>
        <div className="hw-mods">
          <HwKey k="OPTION" label="OPTION" />
          <HwKey k="EDIT" label="EDIT" />
          <HwKey k="SHIFT" label="SHIFT" />
          <HwKey k="PLAY" label="PLAY" />
        </div>
      </div>
    </section>
  );
}

/** Polyend-style pads: two octaves, scale notes solid, the rest dashed. */
export function PadsPanel() {
  const settings = useStore((s) => s.project.settings);
  const scales = useStore((s) => s.project.scales);
  const view = useStore((s) => s.view);
  const base = (settings.octave + 1) * 12;
  const rows = [base + 12, base];
  return (
    <section className="panel pads-panel" aria-label="Note pads" data-tour="pads">
      <header className="panel-heading">
        <span className="small-label">
          Pads · {settings.scale} {NOTE_NAMES[settings.scaleRoot].replace('-', '')}
          <span className="pads-mode"> · {view === 'PHRASE' ? `writes, jumps ${settings.stepJump}` : 'preview'}</span>
        </span>
        <span className="panel-tools">
          <button className="icon-button" aria-label="Octave down" onClick={() => setOctave(-1)}>
            <Icon name="minus" size={14} />
          </button>
          <span className="pill drag-value" title="Drag up / down to change" onPointerDown={(e) => startValueDrag(e, (dir) => setOctave(dir))}>
            OCT {settings.octave}
          </span>
          <button className="icon-button" aria-label="Octave up" onClick={() => setOctave(1)}>
            <Icon name="plus" size={14} />
          </button>
        </span>
      </header>
      <div className="pads">
        {rows.map((start) =>
          Array.from({ length: 12 }, (_, i) => {
            const note = start + i;
            const on = inScale(note, settings.scale, settings.scaleRoot, scales);
            const root = (note - settings.scaleRoot) % 12 === 0;
            return (
              <button
                key={note}
                className={`pad ${on ? 'is-scale' : 'is-out'} ${root ? 'is-root' : ''}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  enterNote(note);
                }}
                onClick={(e) => e.detail === 0 && enterNote(note)}
                aria-label={`Note ${noteName(note)}`}
              >
                {noteName(note)}
              </button>
            );
          }),
        )}
      </div>
    </section>
  );
}
