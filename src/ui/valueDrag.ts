/**
 * Drag a value: press on it and move the mouse up (more) or down (less), like a knob. Every
 * few pixels is one step; a fast drag takes coarse steps (an octave, 16). A press without
 * movement stays a plain click, so selecting, double-clicking and focusing work as before.
 * Mouse and pen only: on touch a vertical drag scrolls (and long-press selects).
 */
import type { PointerEvent as ReactPointerEvent } from 'react';

const STEP_PX = 5;
/** Pixels per millisecond above which a step is a coarse one. */
const FAST = 0.9;

let dragging = false;
/** True while a value drag is running (so hover / selection code can stand back). */
export const isValueDragging = () => dragging;

export function startValueDrag(e: ReactPointerEvent, step: (dir: 1 | -1, coarse: boolean) => void, onEnd?: () => void) {
  if (e.button !== 0 || e.pointerType === 'touch') return;
  const target = e.currentTarget as HTMLElement;
  const id = e.pointerId;
  let lastY = e.clientY;
  let lastT = e.timeStamp;
  let acc = 0;
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    const dy = lastY - ev.clientY;
    const dt = Math.max(1, ev.timeStamp - lastT);
    lastY = ev.clientY;
    lastT = ev.timeStamp;
    acc += dy;
    if (!moved && Math.abs(acc) < 3) return;
    if (!moved) {
      moved = true;
      dragging = true;
      document.body.classList.add('is-value-dragging');
      try {
        target.setPointerCapture(id);
      } catch {
        /* capture is a nicety: the window listeners carry the drag anyway */
      }
    }
    const coarse = Math.abs(dy) / dt > FAST;
    while (Math.abs(acc) >= STEP_PX) {
      const dir = acc > 0 ? 1 : -1;
      acc -= dir * STEP_PX;
      step(dir, coarse);
    }
  };
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    if (moved) {
      document.body.classList.remove('is-value-dragging');
      // A drag is not a click: swallow the click that follows the release.
      const stop = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
      onEnd?.();
    }
    dragging = false;
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
