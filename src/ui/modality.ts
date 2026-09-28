/**
 * How the last focus change happened. Space is the M8 PLAY key, but someone tabbing through
 * controls expects Space to press the focused one: only then does it go to the control.
 * (`:focus-visible` can't tell, because Chromium turns it on for a clicked button as soon
 * as any key is pressed.)
 */
let byKeyboard = false;

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => e.key === 'Tab' && (byKeyboard = true), true);
  window.addEventListener('pointerdown', () => (byKeyboard = false), true);
}

export const focusCameFromKeyboard = () => byKeyboard;

/**
 * Was the last press on the big on-screen key panel? Then the page must not scroll to follow
 * the grid cursor, or the keys would jump away from the finger with every press.
 */
let panelPressAt = -Infinity;
if (typeof window !== 'undefined') {
  // Only the latest press counts: a press anywhere else (or a real key) clears it.
  window.addEventListener(
    'pointerdown',
    (e) => (panelPressAt = (e.target as Element | null)?.closest?.('.keys-panel') ? performance.now() : -Infinity),
    true,
  );
  window.addEventListener('keydown', () => (panelPressAt = -Infinity), true);
}
export const pressedOnKeyPanel = (withinMs = 1500) => performance.now() - panelPressAt < withinMs;

/** Should Space press this element instead of playing? */
export function spaceGoesToControl(el: Element | null, keyboard = byKeyboard): boolean {
  if (!keyboard || !el || el === document.body) return false;
  return el.matches('button, [role="button"], input[type="checkbox"], select, summary');
}
