import { useEffect } from 'react';
import {
  clearCursor,
  copySelection,
  keyDown,
  keyUp,
  paste,
  releaseAll,
  setOctave,
  stepId,
  typeKey,
  wantsLetter,
  type Key,
} from '../state/actions';
import { isFormView } from '../state/fields';
import { getState, redo, setState, undo } from '../state/store';
import { focusTextField } from './FormView';
import { spaceGoesToControl } from './modality';

/** m8c's default mapping: arrows, Shift, Z = OPTION, X = EDIT, Space = PLAY. */
function hwKey(e: KeyboardEvent): Key | null {
  switch (e.key) {
    case 'ArrowUp':
      return 'UP';
    case 'ArrowDown':
      return 'DOWN';
    case 'ArrowLeft':
      return 'LEFT';
    case 'ArrowRight':
      return 'RIGHT';
    case 'Shift':
      return 'SHIFT';
    case ' ':
      return 'PLAY';
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.code === 'KeyZ') return 'OPTION';
  if (e.code === 'KeyX') return 'EDIT';
  return null;
}

/** A field that takes typed text. Sliders and checkboxes are not: the tracker keys stay on. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    ['TEXTAREA', 'SELECT'].includes(t.tagName) ||
    (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)));

export function useKeyboard() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        const k = e.key.toLowerCase();
        if (k === 'z') (e.shiftKey ? redo : undo)();
        else if (k === 'y') redo();
        else if (k === 'c') copySelection();
        else if (k === 'x') copySelection(true);
        else if (k === 'v') paste();
        else return;
        e.preventDefault();
        return;
      }
      if ((e.code === 'KeyX' || e.code === 'KeyZ') && !e.ctrlKey && !e.metaKey && wantsLetter(e.key)) {
        typeKey(e.key);
        e.preventDefault();
        return;
      }
      const hw = hwKey(e);
      // Someone tabbing through controls gets Space for the focused one, as in any page.
      if (hw === 'PLAY' && spaceGoesToControl(document.activeElement)) return;
      if (hw) {
        e.preventDefault();
        if (e.repeat && (hw === 'SHIFT' || hw === 'OPTION' || hw === 'EDIT' || hw === 'PLAY')) return;
        if (hw === 'EDIT' && isFormView(getState().view) && focusTextField()) return;
        // Buttons keep focus after a click; Space must not also "click" them.
        // A clicked control (button, slider, checkbox) gives Space back to PLAY and must not
        // also react to it.
        if (hw === 'PLAY' || (document.activeElement as HTMLInputElement | null)?.type === 'range') (document.activeElement as HTMLElement | null)?.blur?.();
        keyDown(hw);
        return;
      }
      if (e.altKey) return;
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          clearCursor();
          break;
        case 'Escape':
          setState({ selection: null, fillOpen: false, fxPick: null, status: '' });
          break;
        case '[':
          stepId(-1);
          break;
        case ']':
          stepId(1);
          break;
        case '-':
          setOctave(-1);
          break;
        case '=':
        case '+':
          setOctave(1);
          break;
        default:
          if (!typeKey(e.key)) return;
      }
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      const hw = hwKey(e) ?? (e.key === 'z' || e.key === 'Z' ? 'OPTION' : e.key === 'x' || e.key === 'X' ? 'EDIT' : null);
      if (hw) keyUp(hw);
    };
    const blur = () => releaseAll();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
}
