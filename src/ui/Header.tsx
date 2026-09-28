import { getInstrument } from '../core/factory';
import { hex2 } from '../core/format';
import { openView, peekIds } from '../state/actions';
import { startTour } from '../state/tour';
import { useStore, type ViewId } from '../state/store';
import { setThemePreference, useTheme } from '../lib/theme';
import { Icon } from './Icon';

export const VIEW_LABEL: Record<ViewId, string> = {
  SONG: 'Song',
  CHAIN: 'Chain',
  PHRASE: 'Phrase',
  INST: 'Instrument',
  MODS: 'Mods',
  TABLE: 'Table',
  GROOVE: 'Groove',
  MIXER: 'Mixer',
  EFFECTS: 'Effects',
  PERFORM: 'Perform',
  POOL: 'Pool',
  SCALE: 'Scales',
  EQ: 'EQ',
  PROJECT: 'Project',
};

/** Which top-level place a screen belongs to; side screens live inside their parent. */
export const GROUP: Record<ViewId, ViewId> = {
  SONG: 'SONG',
  CHAIN: 'CHAIN',
  PHRASE: 'PHRASE',
  GROOVE: 'PHRASE',
  INST: 'INST',
  MODS: 'INST',
  TABLE: 'INST',
  MIXER: 'MIXER',
  EFFECTS: 'MIXER',
  PERFORM: 'MIXER',
  POOL: 'INST',
  SCALE: 'PROJECT',
  EQ: 'MIXER',
  PROJECT: 'PROJECT',
};

function Crumb({ view, long, short, id, sub }: { view: ViewId; long: string; short?: string; id?: number; sub?: string }) {
  const current = useStore((s) => GROUP[s.view] === view);
  return (
    <a
      href={`#${view.toLowerCase()}`}
      data-tour={`crumb-${view}`}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        openView(view);
      }}
    >
      <span className="crumb-long">{long}</span>
      <span className="crumb-short">{short ?? long}</span>
      {id != null && <b>{hex2(id)}</b>}
      {sub && <small>{sub}</small>}
    </a>
  );
}

export function Header() {
  const view = useStore((s) => s.view);
  const name = useStore((s) => s.project.name);
  // Each crumb shows what a click on it opens (the thing under the cursor), not the last id.
  useStore((s) => s.cursors);
  useStore((s) => s.ids);
  useStore((s) => s.project);
  const chainId = peekIds('CHAIN').ids.chain;
  const phraseId = peekIds('PHRASE').ids.phrase;
  const instId = peekIds('INST').ids.inst;
  const instName = useStore((s) => getInstrument(s.project, instId).name);
  const touring = useStore((s) => s.tour != null);
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <header className="app-header">
      <a className="skip-link" href="#editor">
        Skip to editor
      </a>
      <a className="skip-link" href="#keys">
        Skip to the M8 keys
      </a>
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <div>
            EIGHT<span>TRACKER</span>
          </div>
          <small>SONG · CHAIN · PHRASE · INSTRUMENT</small>
        </div>
        <div className="topbar-actions">
          <button
            className="project-chip"
            data-tour="project"
            aria-current={view === 'PROJECT' ? 'page' : undefined}
            title="Project: files, samples, render, settings, keys"
            onClick={() => openView('PROJECT')}
          >
            <span>PROJECT</span>
            <strong>{name || 'UNTITLED'}</strong>
          </button>
          <button
            className={`teach-button ${touring ? 'is-on' : ''}`}
            data-tour="teach"
            aria-pressed={touring}
            onClick={() => startTour()}
            title="A short guided tour: it points at things and waits for you to try them"
          >
            <Icon name="teach" size={16} />
            <span>Teach</span>
          </button>
          <button
            className="icon-button theme-toggle"
            aria-label={next === 'dark' ? 'Switch to dark theme' : 'Switch to light theme'}
            onClick={() => setThemePreference(next)}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            <span className="theme-label">{next === 'dark' ? 'Dark' : 'Light'}</span>
          </button>
        </div>
      </div>
      <nav className="top-nav" aria-label="Where you are">
        <ol className="crumbs">
          <li>
            <Crumb view="SONG" long="SONG" />
          </li>
          <li>
            <Crumb view="CHAIN" long="CHAIN" short="CH" id={chainId} />
          </li>
          <li>
            <Crumb view="PHRASE" long="PHRASE" short="PH" id={phraseId} />
          </li>
          <li>
            <Crumb view="INST" long="INSTRUMENT" short="INST" id={instId} sub={instName || undefined} />
          </li>
        </ol>
        <div className="nav-side">
          <Crumb view="MIXER" long="MIXER" short="MIX" />
        </div>
      </nav>
    </header>
  );
}

const SUBTABS: Partial<Record<ViewId, [ViewId, string][]>> = {
  PHRASE: [
    ['PHRASE', 'Steps'],
    ['GROOVE', 'Groove'],
  ],
  INST: [
    ['INST', 'Parameters'],
    ['MODS', 'Mods'],
    ['TABLE', 'Table'],
    ['POOL', 'Pool'],
  ],
  PROJECT: [
    ['PROJECT', 'Project'],
    ['SCALE', 'Scales'],
  ],
  MIXER: [
    ['MIXER', 'Mixer'],
    ['EQ', 'EQ'],
    ['EFFECTS', 'Effects'],
    ['PERFORM', 'Perform'],
  ],
};

/** The side screens of a place (mods, table, groove, effects) as a segmented control. */
export function SubTabs() {
  const view = useStore((s) => s.view);
  const tabs = SUBTABS[GROUP[view]];
  // Screens without side screens still show their name in the same control, so the editor
  // heading looks and measures the same everywhere.
  // A quiet label, not a pressed button: there is nothing else to switch to.
  if (!tabs)
    return (
      <div className="segmented subtabs is-single">
        <span className="subtab-only">{VIEW_LABEL[view]}</span>
      </div>
    );
  return (
    <div className="segmented subtabs" role="group" aria-label={`${VIEW_LABEL[GROUP[view]]} screens`}>
      {tabs.map(([v, label]) => (
        <button key={v} data-tour={`subtab-${v}`} aria-pressed={v === view} onClick={() => openView(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
