import { useState, type CSSProperties } from 'react';
import { TRACKS } from '../core/types';
import { beatRepeat, ensureAudio, perform, trackPerform, trackPerformReset } from '../state/transport';
import { getState, useStore } from '../state/store';

/** Hold-to-act pad: pointer down applies, pointer up (or leaving) restores. */
function HoldPad({ label, sub, on, off }: { label: string; sub: string; on: () => void; off: () => void }) {
  const [held, setHeld] = useState(false);
  const start = () => {
    void ensureAudio();
    setHeld(true);
    on();
  };
  const end = () => {
    if (!held) return;
    setHeld(false);
    off();
  };
  return (
    <button
      className={`perform-pad ${held ? 'is-held' : ''}`}
      aria-pressed={held}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !e.repeat && start()}
      onKeyUp={(e) => (e.key === 'Enter' || e.key === ' ') && end()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <b>{label}</b>
      <small>{sub}</small>
    </button>
  );
}

/**
 * The Polyend Tracker's performance idea on top of the M8 mixer: momentary moves that
 * never touch the saved song. Everything springs back when you let go.
 */
export function PerformView() {
  const playing = useStore((s) => s.playing);
  const [filter, setFilter] = useState(0x80);
  const [spring, setSpring] = useState(true);
  const restore = (param: string, key: 'djf' | 'del' | 'rev' | 'master') => perform(param, getState().project.mixer[key]);
  const fx = () => getState().project.effects;
  return (
    <div className="perform">
      {!playing && <p className="notice">Start the song (Space) and play with these while it runs. Nothing here is saved.</p>}
      <section className="perform-block" aria-label="DJ filter">
        <div className="small-label">DJ filter · {filter === 0x80 ? 'off' : filter < 0x80 ? 'low-pass' : 'high-pass'}</div>
        <input
          type="range"
          className="perform-slider"
          aria-label="DJ filter"
          min={0}
          max={255}
          value={filter}
          aria-valuetext={filter === 0x80 ? 'off' : filter < 0x80 ? `low-pass ${filter}` : `high-pass ${filter}`}
          style={{ '--v': filter / 255 } as CSSProperties}
          onPointerDown={() => void ensureAudio()}
          onChange={(e) => {
            const v = Number(e.target.value);
            setFilter(v);
            perform('DJF', v);
          }}
          onPointerUp={() => {
            if (!spring) return;
            setFilter(0x80);
            restore('DJF', 'djf');
          }}
        />
        <label className="perform-spring">
          <input type="checkbox" checked={spring} onChange={(e) => setSpring(e.target.checked)} /> Spring back to centre
        </label>
      </section>
      <section className="perform-block" aria-label="Effect throws">
        <div className="small-label">Hold</div>
        <div className="perform-pads">
          <HoldPad label="FREEZE" sub="reverb tail" on={() => perform('XRZ', 0xff)} off={() => perform('XRZ', 0)} />
          <HoldPad
            label="THROW"
            sub="delay up"
            on={() => {
              perform('VDE', 0xff);
              perform('XDF', 0xe0);
            }}
            off={() => {
              restore('VDE', 'del');
              perform('XDF', fx().delay.feedback);
            }}
          />
          <HoldPad label="WASH" sub="reverb up" on={() => perform('VRE', 0xff)} off={() => restore('VRE', 'rev')} />
          <HoldPad label="DUCK" sub="master down" on={() => perform('VMV', 0x60)} off={() => restore('VMV', 'master')} />
        </div>
      </section>
      <section className="perform-block" aria-label="Beat repeat">
        <div className="small-label">Beat repeat · every track loops its next steps</div>
        <div className="perform-pads">
          {[
            [8, '1/2'],
            [4, '1/4'],
            [2, '1/8'],
            [1, '1/16'],
          ].map(([n, label]) => (
            <HoldPad key={n} label={String(label)} sub={`${n} step${n === 1 ? '' : 's'}`} on={() => beatRepeat(Number(n))} off={() => beatRepeat(null)} />
          ))}
        </div>
      </section>
      <TrackFx />
    </div>
  );
}

/**
 * Polyend-style per-track slots: pick tracks, then slide or hold. Sliders spring back to
 * neutral on release unless "hold" is on; nothing is written to the project.
 */
function TrackFx() {
  const [picked, setPicked] = useState<number[]>([0]);
  const [hold, setHold] = useState(false);
  const [vals, setVals] = useState({ CUT: 0x80, VOL: 0x80, PAN: 0x80 });
  const neutral = { CUT: 0x80, VOL: 0x80, PAN: 0x80 };
  const slide = (k: 'CUT' | 'VOL' | 'PAN', v: number) => {
    setVals((x) => ({ ...x, [k]: v }));
    trackPerform(picked, k, v);
  };
  const letGo = (k: 'CUT' | 'VOL' | 'PAN') => {
    if (hold) return;
    setVals((x) => ({ ...x, [k]: neutral[k] }));
    trackPerform(picked, k, neutral[k]);
  };
  const label = { CUT: 'Filter', VOL: 'Volume', PAN: 'Pan' };
  return (
    <section className="perform-block" aria-label="Track effects">
      <div className="small-label">Track FX · pick tracks, then slide or hold</div>
      <div className="chips" role="group" aria-label="Tracks affected">
        {Array.from({ length: TRACKS }, (_, t) => (
          <button
            key={t}
            className={picked.includes(t) ? 'active' : ''}
            aria-pressed={picked.includes(t)}
            onClick={() => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t].sort()))}
          >
            {t + 1}
          </button>
        ))}
        <button onClick={() => setPicked(picked.length === TRACKS ? [] : Array.from({ length: TRACKS }, (_, t) => t))}>
          {picked.length === TRACKS ? 'None' : 'All'}
        </button>
      </div>
      <div className="perform-sliders">
        {(['CUT', 'VOL', 'PAN'] as const).map((k) => (
          <label key={k} className="perform-slide">
            <span className="small-label">{label[k]}</span>
            <input
              type="range"
              min={0}
              max={255}
              value={vals[k]}
              aria-valuetext={`${label[k]} ${vals[k] === 0x80 ? 'neutral' : vals[k]}`}
              onPointerDown={() => void ensureAudio()}
              onChange={(e) => slide(k, Number(e.target.value))}
              onPointerUp={() => letGo(k)}
              onKeyUp={() => letGo(k)}
            />
          </label>
        ))}
      </div>
      <div className="perform-pads">
        <HoldPad label="REV THROW" sub="picked tracks" on={() => trackPerform(picked, 'REV', 0xff)} off={() => trackPerform(picked, 'REV', 0)} />
        <HoldPad label="DEL THROW" sub="picked tracks" on={() => trackPerform(picked, 'DEL', 0xff)} off={() => trackPerform(picked, 'DEL', 0)} />
        <HoldPad label="CUT OUT" sub="picked silent" on={() => trackPerform(picked, 'VOL', 0)} off={() => trackPerform(picked, 'VOL', vals.VOL)} />
        <button
          className="perform-pad"
          onClick={() => {
            setVals(neutral);
            trackPerformReset();
          }}
        >
          <b>RESET</b>
          <small>all tracks</small>
        </button>
      </div>
      <label className="perform-spring">
        <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} /> Hold slider positions
      </label>
    </section>
  );
}
