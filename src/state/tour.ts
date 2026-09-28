/**
 * Teach mode: a short guided tour. Each step points at one thing and waits until the
 * person has actually done it (the `done` check runs on every state change), so it teaches
 * by doing rather than by reading. Steps can always be skipped.
 */
import { getInstrument, getPhrase } from '../core/factory';
import type { Project } from '../core/types';
import { moveTo, openView } from './actions';
import type { ViewId } from './store';
import { commitProject, getState, revision, setState, type State } from './store';
import { stop } from './transport';

export interface TourStep {
  /** CSS selector of the thing to point at; missing targets fall back to a centred bubble. */
  target: string | ((s: State) => string);
  title: string;
  text: string;
  /** The keyboard way to do the same, shown smaller. */
  keys?: string;
  /** Bring the grid cursor into view when the step starts (it is part of what is shown). */
  showCursor?: boolean;
  /** Controls the bubble must leave free (beyond the grid cursor), e.g. mute / solo. */
  keepClear?: string;
  /** Something inside the target to scroll into view, e.g. the suggested command. */
  reveal?: string;
  /** Runs when the step starts; its return value is handed to `done`. */
  enter?: (s: State) => unknown;
  done?: (s: State, snap: unknown) => boolean;
}

const notes = (s: State) => getPhrase(s.project, s.ids.phrase).steps.map((st) => st.note);
const fxCount = (s: State) =>
  getPhrase(s.project, s.ids.phrase).steps.reduce((n, st) => n + st.fx.filter((f) => f.cmd).length, 0);
const cur = (s: State) => s.cursors[s.view];
/** After Skip or Back the person may be elsewhere: bring them to the step's screen. */
const on = (v: ViewId) => {
  if (getState().view !== v) openView(v);
};

export const TOUR: TourStep[] = [
  {
    target: '[data-tour="play"]',
    title: 'Hear it first',
    text: 'Press Play to hear the song.',
    keys: 'Space',
    enter: () => openView('SONG'),
    done: (s) => s.playing,
  },
  {
    target: '[data-tour="tracks"]',
    title: 'Eight tracks',
    keepClear: '[data-tour="tracks"] .ms',
    text: 'Each track plays one sound at a time. Watch the notes and meters. Then stop.',
    keys: 'Space again',
    done: (s) => !s.playing,
  },
  {
    target: '.tracker-song',
    title: 'The song',
    text: 'Columns are tracks, numbers are chains. Click a chain number.',
    enter: (s) => {
      openView('SONG');
      return `${s.cursors.SONG.row}:${s.cursors.SONG.col}`;
    },
    done: (s, at) =>
      s.view === 'SONG' &&
      `${cur(s).row}:${cur(s).col}` !== at &&
      s.project.song[cur(s).row][cur(s).col] != null,
  },
  {
    target: '[data-tour="crumb-CHAIN"]',
    title: 'Open it',
    text: 'Open that chain.',
    keys: 'Shift + →',
    done: (s) => s.view === 'CHAIN',
  },
  {
    target: '.tracker-chain',
    title: 'A chain',
    text: 'A list of phrases played in order, each with a transpose. Pick a phrase, then open PHRASE.',
    keys: 'Shift + →',
    enter: () => on('CHAIN'),
    done: (s) => s.view === 'PHRASE',
  },
  {
    target: '.tracker-phrase',
    title: 'A phrase',
    text: '16 steps: note, velocity, instrument, three commands. Click a cell in the N column; an empty one (---) is best.',
    enter: () => {
      on('PHRASE');
      const s = getState();
      return `${s.cursors.PHRASE.row}:${s.cursors.PHRASE.col}`;
    },
    done: (s, at) => s.view === 'PHRASE' && cur(s).col === 0 && `${cur(s).row}:${cur(s).col}` !== at,
  },
  {
    // The pad buttons themselves (not the panel heading), so they come fully into view with
    // as little scrolling as possible and the cursor row stays visible above them.
    target: '[data-tour="pads"] .pads',
    title: 'Write a note',
    text: 'Click a pad. The note is written and played, and the cursor moves on.',
    keys: 'Q W E R T Y U',
    enter: () => {
      on('PHRASE');
      return getState().notesEntered;
    },
    done: (s, n) => s.view === 'PHRASE' && s.notesEntered > (n as number),
  },
  {
    // On a phone the edit bar under the grid holds the same buttons.
    target: '.cell-bar, [data-tour="steppers"]',
    title: 'Change it',
    showCursor: true,
    text: 'The cursor is back on your note. Change it with these: ±1 semitone, ±oct an octave.',
    keys: 'hold X + arrows',
    enter: () => {
      on('PHRASE');
      const s = getState();
      moveTo('PHRASE', s.lastNoteRow, 0);
      return JSON.stringify(notes(s));
    },
    done: (s, snap) => JSON.stringify(notes(s)) !== snap,
  },
  {
    target: (s) =>
      // The command list open: point at its Place button, so the list itself stays readable.
      s.fxPick != null
        ? '[data-tour="fx-place"]'
        : s.view === 'PHRASE' && s.cursors.PHRASE.col >= 3 && s.cursors.PHRASE.col % 2 === 1
        ? '[data-tour="fx-palette"], [data-tour="fx-pick"]'
        : // The FX1 cell on the row of the note just written, so it scrolls into view.
          `#cell-PHRASE-${s.lastNoteRow}-3`,
    title: 'Commands',
    reveal: '[data-code="RET"]',
    // With the command list open, its help and Place button stay readable.
    keepClear: '.fx-pick-head, .fx-pick-help, [data-tour="fx-place"]',
    text: 'Click the FX1 cell (---) next to your note and pick a command from the list, e.g. RET.',
    keys: 'type R E T',
    enter: () => {
      on('PHRASE');
      return fxCount(getState());
    },
    done: (s, n) => fxCount(s) > (n as number),
  },
  {
    target: '[data-tour="play"]',
    title: 'Loop the phrase',
    text: 'On this screen Play loops just this phrase.',
    keys: 'Space',
    enter: () => on('PHRASE'),
    done: (s) => s.playing && s.playMode === 'PHRASE',
  },
  {
    target: '[data-tour="crumb-INST"]',
    title: 'The sound',
    text: 'Open the instrument this phrase plays.',
    keys: 'Shift + →',
    enter: () => on('PHRASE'),
    done: (s) => s.view === 'INST',
  },
  {
    target: '.form',
    title: 'Parameters',
    text: 'Click a row, then − / +. You hear the change on the next note.',
    keys: 'hold X + ← →',
    enter: () => {
      on('INST');
      const s = getState();
      return JSON.stringify(getInstrument(s.project, s.ids.inst));
    },
    done: (s, snap) => JSON.stringify(getInstrument(s.project, s.ids.inst)) !== snap,
  },
  {
    target: '[data-tour="subtab-MODS"]',
    title: 'More inside',
    text: 'Envelopes and LFOs are under Mods; the note sequencer under Table.',
    keys: 'Shift + ↑',
    enter: () => on('INST'),
    done: (s) => s.view === 'MODS',
  },
  {
    target: '[data-tour="tracks"]',
    title: 'Mute and solo',
    keepClear: '[data-tour="tracks"] .ms',
    text: 'Mute (M) or solo (S) a track while it plays.',
    keys: 'Z + Shift · Z + Space',
    enter: (s) => JSON.stringify([s.project.mixer.mute, s.project.mixer.solo]),
    done: (s, snap) => JSON.stringify([s.project.mixer.mute, s.project.mixer.solo]) !== snap,
  },
  {
    target: '[data-tour="project"] strong',
    title: 'That’s the loop',
    text: 'Song → chain → phrase → instrument. Files, render and every shortcut are under Project. Playback has been stopped.',
    enter: () => stop(),
  },
];

let startProject: Project | null = null;
let snap: unknown;
let enteredAt = 0;
/** Was the step's check already true on entry (e.g. after Back)? Then wait for a change. */
let doneOnEntry = false;

export function startTour() {
  if (getState().tour != null) return endTour();
  // Step 1 asks for Space: the Teach button must not keep focus and take it.
  if (typeof document !== 'undefined') (document.activeElement as HTMLElement | null)?.blur?.();
  startProject = getState().project;
  // Step 1 is "press Play": start from silence, so the first Space plays.
  stop();
  goToStep(0);
}

export function goToStep(i: number) {
  if (i >= TOUR.length) return endTour();
  setState({ tour: i, selection: null });
  snap = TOUR[i].enter?.(getState());
  enteredAt = revision;
  doneOnEntry = !!TOUR[i].done?.(getState(), snap);
}

/**
 * Should the tour move on? Only when the step's check has become true through something
 * the person did since the step began — a check that was already true (going Back to
 * "press Play" while playing) must first turn false.
 */
export function tourShouldAdvance(s: State): boolean {
  const def = s.tour != null ? TOUR[s.tour] : null;
  if (!def?.done || revision <= enteredAt) return false;
  const done = def.done(s, snap);
  if (!done) doneOnEntry = false;
  return done && !doneOnEntry;
}

/** Done only counts once something has happened since the step began (Back stays put). */
export const tourActedSince = () => revision > enteredAt;

export function tourSnap() {
  return snap;
}

export function endTour() {
  stop();
  setState({ tour: null });
}

/** Put the project back the way it was when the tour started (undoable). */
export function revertTour() {
  const p = startProject;
  if (!p) return;
  stop();
  commitProject(p);
  setState({ status: 'TOUR EDITS REVERTED' });
  endTour();
}

export const tourChangedProject = () => startProject != null && getState().project !== startProject;
