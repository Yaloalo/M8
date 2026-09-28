import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { encodeWav } from '../audio/wav';
import { renderProject } from '../audio/render';
import { getInstrument } from '../core/factory';
import { hex2 } from '../core/format';
import { withBuiltins } from '../state/boot';
import { startRecording, stopRecording } from '../state/recorder';
import { demoProject } from '../state/demo';
import { newProject } from '../core/factory';
import { copySelection, paste, playSong, stepId } from '../state/actions';
import { measureSeconds } from '../core/measure';
import { zip } from '../audio/zip';
import { rangeProject } from './renderSelection';
import { isFormView } from '../state/fields';
import { download, exportProject, importProject, saveSample } from '../state/persist';
import { addUserSample, allSamples, preview } from '../state/transport';
import { commit, getState, redo, replaceProject, setState, undo, useStore, type State, type ViewId } from '../state/store';
import type { Project } from '../core/types';
import { FormView } from './FormView';
import { SubTabs } from './Header';
import { SampleView } from './Displays';
import { CellBar } from './CellBar';
import { PerformView } from './Perform';
import { PoolView } from './Pool';
import { PRESETS } from '../core/presets';
import { GridView } from './GridView';
import { Icon } from './Icon';
import { Inspector } from './Inspector';
import { KeysPanel, PadsPanel, TracksPanel, ViewMapPanel } from './Side';
import { mainScroller } from './scroller';
import { startValueDrag } from './valueDrag';
import type { GridView as GridViewId } from '../core/grids';

const DESCRIPTION: Record<ViewId, string> = {
  SONG: 'Eight tracks, each walking its own column of chains. An empty row sends a track back to the top of its block, so chains of different lengths drift against each other.',
  CHAIN: 'A list of phrases played top to bottom, each with a transpose. The chain ends at the first empty row.',
  PHRASE: 'Sixteen steps of note, velocity, instrument and three commands. Rows without an instrument keep the last one.',
  INST: 'The sound. Every instrument also owns the table with the same number, which runs alongside each note.',
  MODS: 'Four modulators per instrument: AHD and ADSR envelopes, and an LFO, each with a destination and a signed amount.',
  TABLE: 'A small sequencer that restarts with every note: transpose, volume and three commands per row, at the instrument’s TBL TIC speed.',
  GROOVE: 'Ticks per step, looping over the filled rows. 06 06 is straight sixteenths; 07 05 swings. Switch a track with GRV.',
  MIXER: 'Track levels, effect returns, the master DJ filter and the limiter.',
  EQ: 'The EQ bank: 128 slots of three bands (type, frequency, gain, Q, stereo mode). Instruments and the main mix pick a slot by number, so several can share one. X X mutes the slot; Shift + Z / Shift + X copy and paste it.',
  SCALE: 'Sixteen user scales: which notes are in and how each is tuned. Pick one as the project SCALE, or with SCA/SCG (y A–F = user scales 0–5). Pads, fill and note entry follow it; the tuning is played.',
  POOL: 'All 128 instrument slots: what each is, how many steps use it and its mixer levels. X picks (back into the phrase you came from) or makes one; X + ↑↓ on the number moves the slot; X + arrows on VOL–REV change them; Space listens.',
  PERFORM: 'Momentary moves while the song plays, after the Polyend Tracker’s performance mode: DJ filter, freeze, throws, beat repeat. Nothing here is saved.',
  EFFECTS: 'The three send effects every instrument can reach: chorus, delay and reverb. Delay times are in ticks, so they follow the tempo.',
  PROJECT: 'Tempo, transpose, display and keyboard settings, files, samples and rendering.',
};

function IdStepper({ label, value }: { label: string; value: number }) {
  return (
    <span className="id-stepper" role="group" aria-label={`${label} number`}>
      <button className="icon-button" aria-label={`Previous ${label}`} onClick={() => stepId(-1)} title="[ or Z + ←">
        <Icon name="left" size={14} />
      </button>
      <b className="drag-value" title="Drag up / down to change" onPointerDown={(e) => startValueDrag(e, (dir, coarse) => stepId(dir * (coarse ? 16 : 1)))}>
        {hex2(value)}
      </b>
      <button className="icon-button" aria-label={`Next ${label}`} onClick={() => stepId(1)} title="] or Z + →">
        <Icon name="right" size={14} />
      </button>
    </span>
  );
}

function History() {
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const clip = useStore((s) => !!s.clipboard);
  const view = useStore((s) => s.view);
  const barKeys = useStore((s) => s.barKeys);
  // Always the same four buttons in the same place; they grey out where they don't apply.
  const grid = !isFormView(view) && view !== 'PERFORM' && view !== 'POOL';
  return (
    <>
      <button className="icon-button" aria-label="Copy" title="Ctrl+C" disabled={!grid} onClick={() => copySelection()}>
        <Icon name="copy" size={14} />
      </button>
      <button className="icon-button" aria-label="Paste" title="Ctrl+V · Shift+X" disabled={!grid || !clip} onClick={paste}>
        <Icon name="paste" size={14} />
      </button>
      <button className="icon-button" aria-label="Undo" title="Ctrl+Z" disabled={!canUndo} onClick={undo}>
        <Icon name="undo" size={14} />
      </button>
      <button className="icon-button" aria-label="Redo" title="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
        <Icon name="redo" size={14} />
      </button>
      {/* Phones only (CSS): swap the edit bar for the eight M8 keys, right under the grid. */}
      <button
        className={`icon-button bar-keys-toggle ${barKeys ? 'is-on' : ''}`}
        aria-label="M8 keys in the edit bar"
        aria-pressed={barKeys}
        onClick={() => setState({ barKeys: !barKeys })}
      >
        <Icon name="keyboard" size={14} />
      </button>
    </>
  );
}

/** The M8 marks a phrase or chain that is used in more than one place with an asterisk. */
function sharedMark(p: Project, view: ViewId, ids: State['ids']): string | null {
  if (view === 'PHRASE') {
    let n = 0;
    for (const c of Object.values(p.chains)) for (const r of c.rows) if (r.phrase === ids.phrase) n++;
    return n > 1 ? `Used ${n} times in chains: edits change every use.` : null;
  }
  if (view === 'CHAIN') {
    let n = 0;
    for (const row of p.song) for (const c of row) if (c === ids.chain) n++;
    return n > 1 ? `Used ${n} times in the song: edits change every use.` : null;
  }
  return null;
}

function Heading() {
  const [about, setAbout] = useState(false);
  const view = useStore((s) => s.view);
  const ids = useStore((s) => s.ids);
  const track = useStore((s) => s.track);
  const instType = useStore((s) => getInstrument(s.project, s.ids.inst).type);
  const instName = useStore((s) => getInstrument(s.project, s.ids.inst).name);
  const projectName = useStore((s) => s.project.name);
  const eqUsers = useStore((s) =>
    [s.project.mixer.eq === s.ids.eq ? 'main mix' : null, ...Object.entries(s.project.instruments).filter(([, i]) => i.eq === s.ids.eq).map(([k]) => `I${hex2(Number(k))}`)]
      .filter(Boolean)
      .join(' '),
  );
  const shared = useStore((s) => sharedMark(s.project, s.view, s.ids));
  const inst = { type: instType, name: instName };
  let eyebrow = '';
  let title = '';
  /** A shorter title for phones, so the number and name survive (Inst 00 · KICK). */
  let short = '';
  let actions: ReactNode = null;
  switch (view) {
    case 'SONG':
      eyebrow = 'Arrangement / Song';
      title = 'Song';
      break;
    case 'CHAIN':
      eyebrow = `Track ${track + 1} / Chain`;
      title = `Chain ${hex2(ids.chain)}`;
      actions = <IdStepper label="chain" value={ids.chain} />;
      break;
    case 'PHRASE':
      eyebrow = `Track ${track + 1} / Chain ${hex2(ids.chain)} / Phrase`;
      title = `Phrase ${hex2(ids.phrase)}`;
      actions = <IdStepper label="phrase" value={ids.phrase} />;
      break;
    case 'INST':
    case 'MODS':
      eyebrow = `Sound / ${inst.type}`;
      title = `${view === 'MODS' ? 'Mods' : 'Instrument'} ${hex2(ids.inst)}${inst.name ? ` · ${inst.name}` : ''}`;
      short = title.replace(/^Instrument/, 'Inst');
      actions = <IdStepper label="instrument" value={ids.inst} />;
      break;
    case 'TABLE':
      eyebrow = `Sound / Table${ids.table < 128 ? ` of instrument ${hex2(ids.table)}` : ''}`;
      title = `Table ${hex2(ids.table)}`;
      actions = <IdStepper label="table" value={ids.table} />;
      break;
    case 'GROOVE':
      eyebrow = 'Timing / Groove';
      title = `Groove ${hex2(ids.groove)}`;
      actions = <IdStepper label="groove" value={ids.groove} />;
      break;
    case 'MIXER':
      eyebrow = 'Output / Mixer';
      title = 'Mixer';
      break;
    case 'EFFECTS':
      eyebrow = 'Output / Effects';
      title = 'Effects';
      break;
    case 'PERFORM':
      eyebrow = 'Output / Perform';
      title = 'Perform';
      break;
    case 'EQ':
      eyebrow = `Output / EQ · ${eqUsers || 'unused'}`;
      title = `EQ ${hex2(ids.eq)}`;
      actions = <IdStepper label="EQ" value={ids.eq} />;
      break;
    case 'SCALE':
      eyebrow = 'Project / Scales';
      title = `Scale ${hex2(ids.scale)}`;
      actions = <IdStepper label="scale" value={ids.scale} />;
      break;
    case 'POOL':
      eyebrow = 'Sound / Instrument pool';
      title = 'Instrument pool';
      short = 'Pool';
      break;
    case 'PROJECT':
      eyebrow = 'Project / Settings';
      title = projectName || 'Project';
      break;
  }
  return (
    <header className="page-heading is-compact">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <div className="title-row">
          <h1>
            {short && short !== title ? (
              <>
                <span className="title-long">{title}</span>
                <span className="title-short">{short}</span>
              </>
            ) : (
              title
            )}
            {shared && (
              <abbr className="shared-mark" title={shared}>
                *
              </abbr>
            )}
          </h1>
          <button
            className="about-toggle icon-button"
            aria-expanded={about}
            aria-controls="about-screen"
            aria-label="About this screen"
            onClick={() => setAbout(!about)}
          >
            ?
          </button>
        </div>
        {about && (
          <p id="about-screen" className="about-text" role="note">
            {DESCRIPTION[view]}
          </p>
        )}
      </div>
      <div className="heading-actions">
        {/* The id stepper keeps its place on every screen, empty where there is no number. */}
        <span className="stepper-slot">{actions}</span>
        <span className="history">
          <History />
        </span>
      </div>
    </header>
  );
}

const EDITOR_HINT: Partial<Record<ViewId, string>> = {
  SONG: 'X on empty inserts · X X new chain · Shift+→ opens it',
  CHAIN: 'X X new phrase · Shift+→ opens it · Shift+← song',
  PHRASE: 'Q2W3E… notes · 1 OFF · type hex · letters pick a command',
  TABLE: 'Rows advance every TBL TIC ticks after each note',
  GROOVE: 'Empty rows are skipped',
  PERFORM: 'Hold a pad, let go to return',
  POOL: 'X picks · Shift+← picks for the phrase · Z+X clears',
};

export function Screen() {
  const view = useStore((s) => s.view);
  // Every screen opens at the top, however far the previous one was scrolled.
  const first = useRef(true);
  // A layout effect: it runs before the screen's own effects, so a form or grid can then
  // scroll to its cursor without this reset undoing it.
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    const main = mainScroller();
    if (main !== window) (main as Element).scrollTop = 0;
  }, [view]);
  const special = view === 'PERFORM' || view === 'POOL';
  const grid = !isFormView(view) && !special;
  return (
    <>
      <div className={`workspace-grid view-${view.toLowerCase()}`}>
        <div className="workspace-main">
          {/* The heading sits over the editor only, so the side column starts at the top. */}
          <Heading />
          <section className="panel editor-panel" id="editor" aria-label={`${view} editor`}>
            <header className="panel-heading">
              <SubTabs />
              <span className="editor-tools">
                <ScreenTools />
              </span>
              <span className="editor-hint">{EDITOR_HINT[view] ?? 'X + arrows changes · ↑↓ moves'}</span>
              {/* Phones: copy / paste / undo / redo live here, on the tools row, instead of
                  taking a row of their own under the title. */}
              <span className="editor-history history">
                <History />
              </span>
            </header>
            <div className={grid ? 'editor-scroll' : 'panel-body'}>
              {view === 'PERFORM' ? <PerformView /> : view === 'POOL' ? <PoolView /> : grid ? <GridView view={view as GridViewId} /> : <FormView view={view} />}
            </div>
          </section>
          {view !== 'PERFORM' && <CellBar />}
          {view === 'INST' && <InstSample />}
          {(view === 'PHRASE' || view === 'INST' || view === 'MODS') && <PadsPanel />}
          {view === 'PROJECT' && <ProjectPanels />}
        </div>
        <aside className="workspace-side" aria-label="Context">
          <Inspector />
          <TracksPanel />
          <KeysPanel />
          <ViewMapPanel />
        </aside>
      </div>
    </>
  );
}

/** The current screen's own controls, always in the same slot of the editor heading. */
function ScreenTools() {
  const view = useStore((s) => s.view);
  const inst = useStore((s) => s.ids.inst);
  if (view === 'SONG') return <LiveToggle />;
  if (view === 'PHRASE') return <RecToggle />;
  if (view === 'INST' || view === 'MODS')
    return (
      <>
        <button onClick={() => void preview(getState().track, inst, 60)} title="Hear this instrument (X + Space)" aria-label="Play C-4">
          <Icon name="play" size={14} /> <span className="c4-label">C-4</span>
        </button>
        {view === 'INST' && <PresetPicker />}
      </>
    );
  return null;
}

/** M8 live mode switch: while the song plays, PLAY queues chains instead of stopping. */
function LiveToggle() {
  const live = useStore((s) => s.live);
  return (
    <button
      className={`live-toggle ${live ? 'is-on' : ''}`}
      aria-pressed={live}
      data-tour="live"
      title="Live mode: while the song plays, Space queues the chain under the cursor (Shift+Space the whole row). It starts when the track's current chain ends."
      onClick={() => setState({ live: !live, status: live ? 'LIVE OFF' : 'LIVE: SPACE QUEUES, STOP BUTTON STOPS' })}
    >
      LIVE
    </button>
  );
}

/** Polyend-style live recording: while the phrase plays, pads and keys write at the playhead. */
function RecToggle() {
  const on = useStore((s) => s.liveRec);
  return (
    <button
      className={`live-toggle ${on ? 'is-on' : ''}`}
      aria-pressed={on}
      title="Record live: play the phrase (Space) and play the pads or Q W E R… keys — notes land on the step that is playing, with their timing kept as DEL."
      onClick={() => setState({ liveRec: !on, status: on ? 'REC OFF' : 'REC: PLAY, THEN PLAY THE PADS' })}
    >
      ● REC
    </button>
  );
}

function InstSample() {
  const inst = useStore((s) => getInstrument(s.project, s.ids.inst));
  // Loading and recording live with the waveform they change.
  return inst.type === 'SAMPLER' ? (
    <SampleView
      inst={inst}
      tools={
        <>
          <SampleLoader assign />
          <Recorder />
        </>
      }
    />
  ) : null;
}

/** Load a starting sound into this slot (its table is kept). */
function PresetPicker() {
  const id = useStore((s) => s.ids.inst);
  return (
    <label className="preset-picker">
      <span className="visually-hidden">Load a preset into instrument {hex2(id)}</span>
      <select
        value=""
        onChange={(e) => {
          const preset = PRESETS.find((p) => p.name === e.target.value);
          if (!preset) return;
          commit((d) => {
            d.instruments[id] = preset.make();
          });
          setState({ status: `LOADED ${preset.name}` });
          // Hear it at once: choosing a preset plays it (C-4), so browsing the list auditions.
          void preview(getState().track, id, 60);
        }}
      >
        <option value="">Preset…</option>
        {(['DRUMS', 'BASS', 'LEAD', 'KEYS', 'PAD'] as const).map((g) => (
          <optgroup key={g} label={g}>
            {PRESETS.filter((p) => p.group === g).map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------- project page

/** Record into this instrument; the recording itself lives in state/recorder.ts. */
function Recorder() {
  const recording = useStore((s) => s.recording);
  const level = useStore((s) => s.recLevel);
  return (
    <button
      className={recording ? 'is-recording' : ''}
      aria-pressed={recording}
      title="Record a sample from the microphone or line input (max 60 s)"
      onClick={() => (recording ? stopRecording() : void startRecording(getState().ids.inst))}
    >
      {recording ? (
        <>
          ■ Stop <i className="rec-level" style={{ '--l': Math.min(1, level * 1.5) } as React.CSSProperties} aria-hidden="true" />
        </>
      ) : (
        '● Record'
      )}
    </button>
  );
}

function SampleLoader({ assign = false }: { assign?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button onClick={() => input.current?.click()}>
        <Icon name="upload" size={14} /> {assign ? 'Load sample' : 'Add samples'}
      </button>
      <input
        ref={input}
        type="file"
        accept="audio/*,.wav,.aif,.aiff,.mp3,.ogg,.flac"
        multiple={!assign}
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          let lastId: string | null = null;
          for (const file of files) {
            const data = await file.arrayBuffer();
            const id = `user:${Date.now().toString(36)}:${file.name}`;
            try {
              await addUserSample(id, data);
            } catch {
              setState({ status: `CANNOT DECODE ${file.name}` });
              continue;
            }
            await saveSample(id, data).catch(() => {});
            const name = file.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 12);
            commit((d) => {
              d.samples[id] = { name, builtin: false };
            });
            lastId = id;
          }
          if (assign && lastId) {
            const id = lastId;
            const inst = getState().ids.inst;
            commit((d) => {
              if (d.instruments[inst]) d.instruments[inst].sampler.sample = id;
            });
          }
          if (lastId) setState({ status: 'SAMPLE LOADED' });
        }}
      />
    </>
  );
}

/**
 * The M8 render view: ROW START / LAST, which tracks, optional stems (one file per track).
 * Length follows the rows chosen; LOOPS repeats them.
 */
function RenderPanel({ fileName }: { fileName: (ext: string) => string }) {
  const songRow = useStore((s) => s.cursors.SONG.row);
  const song = useStore((s) => s.project.song);
  const [from, setFrom] = useState(songRow);
  const lastRow = (r: number) => {
    let end = r;
    while (end + 1 < song.length && song[end + 1].some((c) => c != null)) end++;
    return end;
  };
  const [to, setTo] = useState(() => lastRow(songRow));
  const [tracks, setTracks] = useState<number[]>([0, 1, 2, 3, 4, 5, 6, 7]);
  const [loops, setLoops] = useState(1);
  const [stems, setStems] = useState(false);
  const [busy, setBusy] = useState(false);
  // Measured by running the sequencer over the chosen rows, so TPO and grooves count; only
  // what changes the timing triggers a new measurement.
  const timing = useStore((s) => s.project.song);
  const chains = useStore((s) => s.project.chains);
  const phrases = useStore((s) => s.project.phrases);
  const grooves = useStore((s) => s.project.grooves);
  const tempo = useStore((s) => s.project.tempo);
  const seconds = useMemo(
    () => measureSeconds(rangeProject(getState().project, from, Math.max(from, to), tracks), from) * loops,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timing, chains, phrases, grooves, tempo, from, to, tracks, loops],
  );
  const go = async () => {
    setBusy(true);
    const project = getState().project;
    const groups = stems ? tracks.map((t) => [t]) : [tracks];
    const stemFiles: { name: string; blob: Blob }[] = [];
    try {
      for (const [k, group] of groups.entries()) {
        const copy = rangeProject(project, from, Math.max(from, to), group);
        const buf = await renderProject(
          copy,
          {
            mode: 'SONG',
            songRow: from,
            seconds,
            onProgress: (f) => setState({ status: `RENDERING ${stems ? `STEM ${k + 1}/${groups.length} ` : ''}${Math.round(f * 100)}%` }),
          },
          await allSamples(),
        );
        if (stems) stemFiles.push({ name: fileName(`track${group[0] + 1}.wav`), blob: encodeWav(buf) });
        else download(encodeWav(buf), fileName('wav'));
      }
      // All stems in one download, so the browser does not ask about multiple files.
      if (stems) download(await zip(stemFiles), fileName('stems.zip'));
      setState({ status: stems ? `RENDERED ${groups.length} STEMS` : 'RENDERED' });
    } catch {
      setState({ status: 'RENDER FAILED' });
    }
    setBusy(false);
  };
  const row = (label: string, v: number, set: (n: number) => void) => (
    <label className="render-length">
      <span className="small-label">{label}</span>
      <select value={v} onChange={(e) => set(Number(e.target.value))}>
        {song.map((r, i) =>
          r.some((c) => c != null) ? (
            <option key={i} value={i}>
              {hex2(i)}
            </option>
          ) : null,
        )}
      </select>
    </label>
  );
  return (
    <section className="panel" aria-label="Render">
      <header className="panel-heading">
        <span className="small-label">Render to WAV</span>
        <span className="pill">
          {seconds ? `${seconds.toFixed(1)} s` : 'nothing in range'}
        </span>
      </header>
      <div className="panel-body render-grid">
        <div className="panel-tools">
          {row('Row start', from, (n) => {
            setFrom(n);
            if (to < n) setTo(lastRow(n));
          })}
          {row('Row last', to, setTo)}
          <label className="render-length">
            <span className="small-label">Loops</span>
            <select value={loops} onChange={(e) => setLoops(Number(e.target.value))}>
              {[1, 2, 4, 8].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="perform-spring">
            <input type="checkbox" checked={stems} onChange={(e) => setStems(e.target.checked)} /> Stems (one file per track)
          </label>
        </div>
        <div className="chips" role="group" aria-label="Tracks to render">
          {Array.from({ length: 8 }, (_, t) => (
            <button
              key={t}
              className={tracks.includes(t) ? 'active' : ''}
              aria-pressed={tracks.includes(t)}
              onClick={() => setTracks((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t].sort()))}
            >
              {t + 1}
            </button>
          ))}
        </div>
        <div className="panel-tools">
          <button className="primary" disabled={busy || !seconds || !tracks.length} onClick={go}>
            <Icon name="wave" size={14} /> {busy ? 'Rendering…' : stems ? 'Render stems' : 'Render'}
          </button>
          <button onClick={() => playSong()}>
            <Icon name="play" size={14} /> Listen first
          </button>
        </div>
      </div>
    </section>
  );
}

function ProjectPanels() {
  const project = useStore((s) => s.project);
  const importer = useRef<HTMLInputElement>(null);
  const samples = Object.entries(project.samples);
  const fileName = (ext: string) => `${(project.name || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;

  return (
    <>
      <section className="panel" aria-label="Files">
        <header className="panel-heading">
          <span className="small-label">Files</span>
          <span className="pill">autosaved on this device</span>
        </header>
        <div className="panel-body panel-tools">
          <button
            className="danger"
            onClick={() => {
              if (confirm('Start an empty project? The current one is replaced (export it first to keep it).')) {
                replaceProject(withBuiltins(newProject()));
                setState({ status: 'NEW PROJECT' });
              }
            }}
          >
            New project
          </button>
          <button
            onClick={() => {
              if (confirm('Load the demo song? The current project is replaced.')) {
                replaceProject(withBuiltins(demoProject()));
                setState({ status: 'DEMO LOADED' });
              }
            }}
          >
            Load demo
          </button>
          <button onClick={async () => download(await exportProject(getState().project), fileName('eight.json'))}>
            <Icon name="download" size={14} /> Export
          </button>
          <button onClick={() => importer.current?.click()}>
            <Icon name="upload" size={14} /> Import
          </button>
          <input
            ref={importer}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (!confirm(`Import ${file.name}? The current project is replaced (export it first to keep it).`)) return;
              try {
                const { project: p, samples: data, repairs } = await importProject(file);
                for (const [id, buf] of data) await addUserSample(id, buf).catch(() => {});
                replaceProject(withBuiltins(p));
                setState({ status: repairs ? `IMPORTED · ${repairs} DAMAGED VALUE${repairs > 1 ? 'S' : ''} REPAIRED` : 'IMPORTED' });
              } catch {
                setState({ status: 'NOT A PROJECT FILE' });
              }
            }}
          />
        </div>
      </section>

      <RenderPanel fileName={fileName} />

      <section className="panel" aria-label="Samples">
        <header className="panel-heading">
          <span className="small-label">Samples</span>
          <span className="panel-tools">
            <SampleLoader />
          </span>
        </header>
        <ul className="sample-list">
          {samples.map(([id, meta]) => (
            <li key={id}>
              <b>{meta.name}</b>
              <span className="pill">{meta.builtin ? 'BUILT-IN' : 'YOURS'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-label="Key reference">
        <header className="panel-heading">
          <span className="small-label">Keys</span>
          <span className="pill">m8c layout</span>
        </header>
        <table className="key-table">
          <tbody>
            {KEY_REFERENCE.map(([keys, what]) => (
              <tr key={keys}>
                <th scope="row">{keys}</th>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

const KEY_REFERENCE: [string, string][] = [
  ['Arrows', 'Move the cursor'],
  ['Shift + arrows', 'Walk the view map: song → chain → phrase → instrument → table; project above song, groove above phrase, mods above instrument and the pool above mods, mixer, effects and perform below song'],
  ['X (EDIT)', 'Insert the last edited or deleted value into an empty cell'],
  ['X X', 'New unused chain, phrase or instrument; on a TBL/TBX value a new table, on GRV/GGR a new groove'],
  ['X + ← →', 'Change by one'],
  ['X + ↑ ↓', 'Change by 16 (a note by an octave); on a groove, move a tick to the next row; in a selection, move the block'],
  ['Z + X', 'Delete; on an empty note, write OFF; on a parameter, reset to default'],
  ['Z + ↑ ↓', 'Song: 16 rows · Chain: previous/next chain in the song · Phrase: previous/next phrase in the chain · Instrument/table: ±16'],
  ['Z + ← →', 'Song: solo tracks left/right · Chain/phrase: previous/next track · Instrument/table: previous/next'],
  ['Z + arrows in a note selection', '← fill every 1/2/4/8 rows with the last note · → random triggers · ↑↓ random notes'],
  ['Shift + Z', 'Select; again for rows, again for all. Z copies, Z + X cuts. On an instrument: copy it'],
  ['Shift + Z, then X', 'Clone the chain/phrase/instrument/table/groove under the cursor; X twice: deep clone'],
  ['Z Z Z (song)', 'Bookmark the chain under the cursor'],
  ['↑ ↑ on row 00', 'Track reorder: X + ←→ moves the track, ↓ ends'],
  ['Hold Z (song, stopped)', 'Show where the cursor row sits in the track’s time'],
  ['X X in a song selection', 'While stopped: render the selection to a new sampler instrument'],
  ['Shift + X', 'Paste; on a one-column selection: interpolate; on an instrument: paste it'],
  ['Space', 'Play / stop this screen (song, chain or phrase)'],
  ['Shift + Space', 'Play the song from the song cursor'],
  ['X + Space', 'Hear the instrument'],
  ['Shift + Z / Shift + X (mixer, effects, project)', 'Store / recall a snapshot of the mix, effects and tempo'],
  ['Pool: Z + X', 'On VOL–REV: reset the value · on the number: clear the slot (steps using it go silent; undo restores)'],
  ['Pool: Shift + Z / Shift + X', 'On VOL–REV: copy / paste the value · on the number: the instrument'],
  ['← + Space', 'While the song plays: cue the row under the cursor'],
  ['Shift + ← (song)', 'Live mode on/off: Space cues a chain, Space on a playing one stops its track, Shift + Space stops all'],
  ['Z + Shift', 'Mute the track while held; let go of Z first to keep it muted'],
  ['Z + Space', 'Solo the same way; Z + Shift + Space clears all'],
  ['Q 2 W 3 E R 5 …', 'Notes on the note column; 1 is OFF; - and = change octave'],
  ['0–9 A–F', 'Type values (0–9 in decimal mode)'],
  ['Letters on FX', 'Type a command, e.g. R E T or N X T (commands starting with X: pick from the list)'],
  ['[ ]', 'Previous / next id'],
  ['Delete', 'Clear the cell or selection'],
  ['Ctrl + Z / Shift + Z', 'Undo / redo'],
  ['Ctrl + C / X / V', 'Copy / cut / paste'],
];
