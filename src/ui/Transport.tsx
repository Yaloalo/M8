import { useEffect, useState } from 'react';
import { hex2 } from '../core/format';
import { playContext, playSong } from '../state/actions';
import { commit, getState, useStore } from '../state/store';
import { startValueDrag } from './valueDrag';
import { Icon } from './Icon';
import { Scope } from './Displays';
import { recordingSeconds, stopRecording } from '../state/recorder';

function setTempo(v: number) {
  const tempo = Math.max(20, Math.min(300, Math.round(v)));
  commit((d) => {
    d.tempo = tempo;
  }, 'tempo');
}

/** While a sample is being recorded, a Stop that is reachable from every screen. */
function RecStop() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor(recordingSeconds());
  return (
    <button className="bar-button rec-stop" onClick={stopRecording} aria-label="Stop recording">
      ● REC {String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')} ■
    </button>
  );
}

/** The dark strip along the bottom: the one control that always stops everything. */
export function Transport() {
  const playing = useStore((s) => s.playing);
  const mode = useStore((s) => s.playMode);
  const tempo = useStore((s) => s.project.tempo);
  const positions = useStore((s) => s.positions);
  const status = useStore((s) => s.status);
  const recording = useStore((s) => s.recording);
  const [draft, setDraft] = useState(String(tempo));
  useEffect(() => setDraft(String(tempo)), [tempo]);
  const lead = positions.find((p) => p.active);
  return (
    <footer className="transport-bar" aria-label="Transport">
      <div className="transport-status">
        {recording && <RecStop />}
        <span className={`transport-led ${playing ? 'is-on' : ''}`} aria-hidden="true" />
        <span className="transport-mode">{playing ? `PLAY ${mode}` : 'STOPPED'}</span>
        {status && <span className="transport-message" role="status">{status}</span>}
      </div>
      <div className="transport-center">
        <Scope />
        <div className="transport-beats" aria-hidden="true">
          {[0, 1, 2, 3].map((b) => (
            <i key={b} className={playing && lead && Math.floor(lead.step / 4) === b ? 'is-on' : ''} />
          ))}
        </div>
        <button className="bar-button" aria-label="Tempo down 5" onClick={() => setTempo(tempo - 5)}>
          −5
        </button>
        <label className="tempo-field">
          <span className="visually-hidden">Tempo in BPM</span>
          <input
            inputMode="numeric"
            className="drag-value"
            title="Type a tempo, or drag up / down"
            value={draft}
            onPointerDown={(e) => startValueDrag(e, (dir, coarse) => setTempo(getState().project.tempo + dir * (coarse ? 5 : 1)))}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onBlur={() => setTempo(Number(draft) || tempo)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <small>BPM</small>
        </label>
        <button className="bar-button" aria-label="Tempo up 5" onClick={() => setTempo(tempo + 5)}>
          +5
        </button>
        <button
          className={`bar-play ${playing ? 'is-playing' : ''}`}
          data-tour="play"
          aria-pressed={playing}
          onClick={() => playContext()}
          title="Space: play this screen · Shift+Space: play song"
        >
          <Icon name={playing ? 'stop' : 'play'} size={14} />
          {playing ? 'Stop' : 'Play'}
        </button>
        {/* Always there (disabled while playing), so the transport never shifts. */}
        <button className="bar-button bar-song" disabled={playing} onClick={() => playSong()} title="Play the song from the song cursor">
          Song
        </button>
      </div>
      <div className="transport-right" aria-hidden="true">
        {lead ? (
          <span className="transport-pos">
            ROW {hex2(lead.songRow)} · {hex2(lead.chainRow)} · {hex2(lead.step)}
          </span>
        ) : (
          <span className="key-only">
            <kbd>Space</kbd> play
          </span>
        )}
      </div>
    </footer>
  );
}
