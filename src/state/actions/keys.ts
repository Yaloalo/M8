/** The eight M8 keys: held-key state and the key-combo state machine (keyDown / keyUp). */
import { getPhrase } from '../../core/factory';
import { FX_BY_CODE, FX_CODES } from '../../core/fx';
import { NOTE_OFF } from '../../core/types';
import { formFor, isFormView } from '../fields';
import { armPoolPick, poolClear, poolCopyValue, poolPasteValue, poolPick, poolResetValue, takePoolPick } from '../pool';
import { preview, queueRow, queueStopTrack, stop } from '../transport';
import { getState, setState, undo } from '../store';
import { currentCell, currentTrack, cursor, goTo, hex, isGridView, move, navigate, stepId, type Dir, type Key } from './cursor';
import { copySelection, interpolate, moveBlock, paste, selectionNotes, selectionRect, toggleSelection } from './selection';
import { copyEq, copyInstrument, openEqFromField, pasteEq, pasteInstrument, resetField, toggleEqMute } from './forms';
import { SNAPSHOT_VIEWS, clearMuteSolo, playContext, playSong, recallSnapshot, storeSnapshot, toggleLive, toggleMute, toggleSolo } from './live';
import { jumpInChain, jumpInSong, jumpTrack, moveTrack, showTrackTime, soloSide, toggleBookmark } from './song';
import { chooseFx, clearCursor, cloneUnderCursor, createNew, insertAtCursor, nudgeCursor, previewAt } from './cells';

// ------------------------------------------------------------------- the eight keys

const held = { SHIFT: false, OPTION: false, EDIT: false, LEFT: false };
let optionUsed = false;
let editUsed = false;
let lastEditTap = 0;
let lastCloneTap = 0;
let lastCloneDone = false;
/** Where the last clone happened: a deep-clone second tap must be on the same cell. */
let lastCloneAt = '';
let optionTaps: number[] = [];
let optionDownAt = 0;
let lastUpAtTop = 0;
let optionTimer: ReturnType<typeof setTimeout> | undefined;
/** OPTION + SHIFT / OPTION + PLAY are momentary; releasing OPTION first latches (M8). */
let momentary: { kind: 'mute' | 'solo'; track: number; latched: boolean } | null = null;

export const isHeld = (k: 'SHIFT' | 'OPTION' | 'EDIT') => held[k];

/** Opened by holding EDIT (+ ↑↓): letting go of EDIT places the command, as on the M8. */
let fxPickByHold = false;

export function openFxPick() {
  fxPickByHold = held.EDIT;
  const cmd = currentCell();
  const at = typeof cmd === 'string' ? FX_CODES.indexOf(cmd) : FX_CODES.indexOf(getState().last.fxcmd);
  setState({ fxPick: Math.max(0, at) });
}

let renderSelectionHook: ((rect: { r0: number; r1: number; c0: number; c1: number }) => void) | null = null;
/** The UI provides the renderer (it needs the audio modules); keys only ask for it. */
export function onRenderSelection(fn: typeof renderSelectionHook) {
  renderSelectionHook = fn;
}

function optionArrow(k: Dir) {
  const s = getState();
  if (s.selection && selectionNotes(k)) return;
  const vertical = k === 'UP' || k === 'DOWN';
  const sign = (k === 'UP' || k === 'LEFT' ? -1 : 1) as 1 | -1;
  switch (s.view) {
    case 'SONG':
      if (vertical) move(k, 16);
      else soloSide(sign);
      break;
    case 'CHAIN':
      if (vertical) jumpInSong(sign);
      else jumpTrack(sign);
      break;
    case 'PHRASE':
      if (vertical) jumpInChain(sign);
      else jumpTrack(sign);
      break;
    case 'INST':
    case 'MODS':
    case 'TABLE':
      stepId(vertical ? sign * 16 : sign);
      break;
    case 'POOL':
      move(vertical ? k : sign < 0 ? 'UP' : 'DOWN', vertical ? 16 : 1);
      break;
    case 'GROOVE':
      if (!vertical) stepId(sign);
      break;
    default:
      if (vertical) move(k, 16);
  }
}

export function keyDown(k: Key) {
  const s = getState();
  if (s.fxPick != null) {
    // The effect list takes the keys while it is open.
    if (k === 'UP' || k === 'DOWN') setState({ fxPick: (s.fxPick + (k === 'UP' ? -1 : 1) + FX_CODES.length) % FX_CODES.length });
    else if (k === 'LEFT' || k === 'RIGHT') {
      // ← → jump to the first command of the previous / next group.
      const kinds = ['sequencer', 'instrument', 'mixer'];
      const g = kinds.indexOf(FX_BY_CODE[FX_CODES[s.fxPick]].kind) + (k === 'LEFT' ? -1 : 1);
      const kind = kinds[Math.max(0, Math.min(2, g))];
      setState({ fxPick: FX_CODES.findIndex((c) => FX_BY_CODE[c].kind === kind) });
    }
    else if (k === 'EDIT') {
      held.EDIT = true;
      editUsed = true;
      chooseFx(s.fxPick);
    } else if (k === 'OPTION') {
      held.OPTION = true;
      optionUsed = true;
      fxPickByHold = false;
      setState({ fxPick: null });
    }
    return;
  }
  switch (k) {
    case 'UP':
    case 'DOWN':
    case 'LEFT':
    case 'RIGHT': {
      if (k === 'LEFT') held.LEFT = true;
      const vertical = k === 'UP' || k === 'DOWN';
      const sign = k === 'UP' || k === 'LEFT' ? -1 : 1;
      if (s.view === 'SONG' && s.reorder) {
        // Reorder mode: EDIT + ←→ moves the track, DOWN leaves the mode.
        if (held.EDIT && !vertical) {
          editUsed = true;
          moveTrack(sign as 1 | -1);
        } else if (k === 'DOWN') setState({ reorder: false, status: 'REORDER OFF' });
        else if (!vertical) move(k);
        break;
      }
      if (s.view === 'SONG' && k === 'UP' && !held.EDIT && !held.OPTION && !held.SHIFT && cursor(s).row === 0) {
        const now = Date.now();
        if (now - lastUpAtTop < 400) {
          setState({ reorder: true, status: 'REORDER: X + ←→ MOVES THE TRACK · ↓ DONE' });
          lastUpAtTop = 0;
          break;
        }
        lastUpAtTop = now;
      }
      if (held.EDIT) {
        editUsed = true;
        if (s.selection && vertical && isGridView(s.view)) moveBlock(sign as 1 | -1);
        // EDIT + up/down is the coarse step, EDIT + left/right the fine one.
        else nudgeCursor(vertical, (vertical ? -sign : sign) as 1 | -1);
      } else if (held.OPTION) {
        optionUsed = true;
        optionArrow(k);
      } else if (held.SHIFT) {
        if (s.view === 'SONG' && k === 'LEFT' && !s.selection) toggleLive();
        else if (!s.selection) navigate(k);
        else move(k);
      } else {
        move(k);
      }
      break;
    }
    case 'EDIT': {
      if (held.EDIT) return;
      held.EDIT = true;
      editUsed = false;
      const rect = selectionRect(s);
      const single = !!rect && rect.r0 === rect.r1 && rect.c0 === rect.c1;
      if (held.SHIFT && single) {
        // SHIFT + OPTION, then EDIT: clone; a second EDIT makes it a deep clone. Checked
        // before OPTION + EDIT, because OPTION is often still held here.
        editUsed = true;
        optionUsed = true;
        const now = Date.now();
        const here = `${s.view}:${cursor(s).row}:${cursor(s).col}`;
        if (now - lastCloneTap < 400 && lastCloneDone && lastCloneAt === here) {
          undo();
          cloneUnderCursor(true);
          lastCloneTap = 0;
          setState({ selection: null });
        } else {
          lastCloneDone = cloneUnderCursor(false);
          lastCloneTap = now;
          lastCloneAt = here;
          // Leave selection mode unless a second tap turns this into a deep clone.
          setTimeout(() => {
            if (lastCloneTap === now) setState({ selection: null });
          }, 420);
        }
      } else if (held.OPTION) {
        optionUsed = true;
        if (s.selection) copySelection(true);
        else if (s.view === 'POOL') poolResetValue() || poolClear();
        else if (isFormView(s.view)) resetField();
        else clearCursor();
      } else if (held.SHIFT) {
        editUsed = true;
        if (rect && interpolate()) setState({ selection: null });
        else if (s.view === 'POOL') poolPasteValue() || pasteInstrument();
        else if (s.view === 'INST' || s.view === 'MODS') pasteInstrument();
        else if (s.view === 'EQ') pasteEq();
        else if (SNAPSHOT_VIEWS.includes(s.view)) recallSnapshot();
        else paste();
      } else if (s.view === 'EQ') {
        const now = Date.now();
        if (now - lastEditTap < 350) toggleEqMute();
        lastEditTap = now;
      } else if (onEqField()) {
        // Opened on release, so EDIT + arrows can still step the slot number (M8).
        eqOpenPending = true;
      } else if (s.view === 'POOL') {
        // Picked on release, so EDIT + arrows can edit mixer columns or move the slot.
        armPoolPick();
      } else if (isGridView(s.view) && !s.selection) {
        const now = Date.now();
        if (now - lastEditTap < 350 && currentCell() != null) {
          createNew();
          // A double tap is used up: a third tap right after it starts a new pair.
          lastEditTap = 0;
        } else {
          if (currentCell() == null) insertAtCursor();
          else previewAt(s.view, cursor(s).row);
          lastEditTap = now;
        }
      } else if (s.selection && s.view === 'SONG' && !s.playing && Date.now() - lastEditTap < 350) {
        // EDIT EDIT in a song selection while stopped: render it to a new instrument.
        lastEditTap = 0;
        const r = selectionRect(s);
        if (r && renderSelectionHook) renderSelectionHook(r);
        setState({ selection: null });
      } else if (s.selection && s.view === 'SONG') {
        lastEditTap = Date.now();
      } else if (
        s.selection &&
        lastCloneDone &&
        Date.now() - lastCloneTap < 400 &&
        lastCloneAt === `${s.view}:${cursor(s).row}:${cursor(s).col}`
      ) {
        // SHIFT released between the two taps of a deep clone.
        undo();
        cloneUnderCursor(true);
        lastCloneTap = 0;
        setState({ selection: null });
      }
      break;
    }
    case 'OPTION':
      if (held.OPTION) return;
      held.OPTION = true;
      optionUsed = false;
      optionDownAt = Date.now();
      if (!held.SHIFT && !held.EDIT && s.view === 'SONG') {
        clearTimeout(optionTimer);
        optionTimer = setTimeout(() => held.OPTION && !optionUsed && showTrackTime(), 450);
      }
      if (held.SHIFT) {
        optionUsed = true;
        if (s.view === 'POOL') poolCopyValue() || copyInstrument();
        else if (s.view === 'INST' || s.view === 'MODS') copyInstrument();
        else if (s.view === 'EQ') copyEq();
        else if (SNAPSHOT_VIEWS.includes(s.view)) storeSnapshot();
        else toggleSelection();
      } else if (held.EDIT) {
        optionUsed = true;
        editUsed = true;
        if (s.view === 'POOL') poolResetValue() || poolClear();
        else if (isFormView(s.view)) resetField();
        else clearCursor();
      }
      break;
    case 'SHIFT':
      if (held.SHIFT) return;
      held.SHIFT = true;
      if (held.OPTION) {
        optionUsed = true;
        const track = currentTrack();
        toggleMute(track);
        momentary = { kind: 'mute', track, latched: false };
      }
      break;
    case 'PLAY':
      if (s.view === 'POOL' && !held.OPTION && !held.SHIFT && s.playing) stop();
      else if (s.view === 'POOL' && !held.OPTION && !held.SHIFT) {
        // In the pool PLAY auditions the highlighted instrument.
        const id = cursor(s).row;
        if (s.project.instruments[id]) void preview(s.track, id, 60);
      } else if (held.EDIT) {
        // EDIT + PLAY: hear the instrument.
        editUsed = true;
        const note = s.view === 'PHRASE' ? getPhrase(s.project, s.ids.phrase).steps[cursor(s).row].note : null;
        void preview(s.track, s.ids.inst, note != null && note !== NOTE_OFF ? note : 60);
      } else if (held.OPTION && held.SHIFT) {
        // The OPTION + SHIFT mute that led here must not spring back after clearing.
        momentary = null;
        clearMuteSolo();
      }
      else if (held.OPTION) {
        optionUsed = true;
        const track = currentTrack();
        toggleSolo(track);
        momentary = { kind: 'solo', track, latched: false };
      } else if (held.LEFT && s.playing && s.playMode === 'SONG' && s.view === 'SONG') {
        // LEFT + PLAY cues the whole row, with or without live mode.
        const row = cursor(s).row;
        queueRow(row);
        setState({ status: `CUED ROW ${hex(row)}` });
      } else if (s.live && s.playing && s.playMode === 'SONG' && s.view === 'SONG') {
        if (held.SHIFT) return stop();
        // Live mode: PLAY cues the chain under the cursor; on the one playing, stops the track.
        const c = cursor(s);
        const pos = s.positions[c.col];
        if (pos.active && pos.songRow === c.row) {
          queueStopTrack(c.col);
          setState({ status: `TRACK ${c.col + 1} STOPS AT CHAIN END` });
        } else {
          queueRow(c.row, c.col);
          setState({ status: `CUED ${hex(c.row)} ON TRACK ${c.col + 1}` });
        }
      } else if (held.SHIFT) playSong();
      else playContext();
      break;
  }
}

/** EDIT went down on an EQ field: open the editor if it comes up without arrows. */
let eqOpenPending = false;
function onEqField() {
  const s = getState();
  if (s.view !== 'INST' && s.view !== 'MIXER') return false;
  const { fields } = formFor(s);
  return !!fields[cursor(s).row]?.key.endsWith('.eq');
}

export function keyUp(k: Key) {
  if (k === 'EDIT' && fxPickByHold) {
    fxPickByHold = false;
    held.EDIT = false;
    const at = getState().fxPick;
    if (at != null) chooseFx(at);
    return;
  }
  if (k === 'EDIT') {
    held.EDIT = false;
    if (eqOpenPending) {
      eqOpenPending = false;
      if (!editUsed) openEqFromField();
    }
    if (takePoolPick() && !editUsed && getState().view === 'POOL') poolPick(false);
    if (editUsed) lastEditTap = 0;
  } else if (k === 'OPTION') {
    held.OPTION = false;
    if (momentary) {
      momentary.latched = true;
      momentary = null;
      setState({ status: 'LATCHED' });
    }
    // OPTION on its own inside a selection copies it, as on the M8.
    if (!optionUsed && getState().selection) copySelection();
    // On its own in the EQ editor it leaves, back to where the EQ was opened (M8 manual).
    else if (!optionUsed && getState().view === 'EQ' && Date.now() - optionDownAt < 400) goTo(getState().eqReturn);
    else if (!optionUsed && getState().view === 'SONG' && Date.now() - optionDownAt < 400) {
      // Three bare taps bookmark the chain; taps used for Z + arrows etc. never count.
      const now = Date.now();
      optionTaps = [...optionTaps.filter((x) => now - x < 700), now];
      if (optionTaps.length >= 3) {
        optionTaps = [];
        toggleBookmark();
      }
    } else if (optionUsed) optionTaps = [];
  } else if (k === 'SHIFT') {
    held.SHIFT = false;
    releaseMomentary('mute');
  } else if (k === 'PLAY') releaseMomentary('solo');
  else if (k === 'LEFT') held.LEFT = false;
}

function releaseMomentary(kind: 'mute' | 'solo') {
  if (!momentary || momentary.kind !== kind || momentary.latched) return;
  const { track } = momentary;
  momentary = null;
  if (kind === 'mute') toggleMute(track);
  else toggleSolo(track);
}

export function releaseAll() {
  momentary = null;
  held.SHIFT = held.OPTION = held.EDIT = held.LEFT = false;
  lastCloneTap = 0;
  lastCloneDone = false;
  lastEditTap = 0;
}
