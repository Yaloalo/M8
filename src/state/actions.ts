/**
 * Everything the M8 keys do, plus the web shortcuts layered on top. The UI (keyboard,
 * on-screen keys, clicks, inspector buttons) only ever calls into this module.
 *
 * The code lives in ./actions/*; this barrel keeps the public names in one place.
 */
import { TRACKS } from '../core/types';
import { poolClear, poolMove } from './pool';
import { redo, undo } from './store';

export {
  currentCell,
  currentKind,
  currentTrack,
  goTo,
  gridId,
  isGridView,
  moveTo,
  openView,
  peekIds,
  setId,
  stepId,
  type Key,
} from './actions/cursor';
export {
  chooseFx,
  clearCursor,
  cloneUnderCursor,
  enterNote,
  nudgeCursor,
  setCurrentCell,
  setOctave,
  typeKey,
  wantsLetter,
} from './actions/cells';
export { copyInstrument, pasteInstrument, resetField, setField } from './actions/forms';
export { beginSelection, copySelection, fill, paste, reverseRows, selectionRect } from './actions/selection';
export { clearMuteSolo, playContext, playSong, toggleLive, toggleMute, toggleSolo } from './actions/live';
export { trackTicks } from './actions/song';
export { isHeld, keyDown, keyUp, onRenderSelection, openFxPick, releaseAll } from './actions/keys';

export { undo, redo, poolClear, poolMove };
export const tracks = TRACKS;
