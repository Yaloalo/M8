import { pressedOnKeyPanel } from './modality';
/**
 * What scrolls a given element. On desktop the page itself does not scroll: the editor column
 * and the side column each scroll on their own. On phones the page scrolls. Code that keeps
 * something in view asks here instead of assuming the window.
 */
export type Scroller = Element | Window;

export function scrollerOf(el: Element | null): Scroller {
  for (let p = el?.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return window;
}

export const scrollTopOf = (s: Scroller) => (s instanceof Window ? s.scrollY : s.scrollTop);

export function scrollByY(s: Scroller, dy: number, smooth = false) {
  if (!dy) return;
  s.scrollBy({ top: dy, behavior: smooth ? 'smooth' : 'auto' });
}

/** The editor column when it scrolls by itself (desktop), else the page. */
export function mainScroller(): Scroller {
  const main = document.querySelector('.workspace-main');
  if (main) {
    const oy = getComputedStyle(main).overflowY;
    if (oy === 'auto' || oy === 'scroll') return main;
  }
  return window;
}

/**
 * Keep an element (the grid or form cursor) in view: scroll whatever scrolls it just far
 * enough that it clears the header, the transport and, on phones, the edit bar.
 */
export function keepInView(el: Element | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar')) || 56;
  const header = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 124;
  // On phones the edit bar floats above the transport: the cursor must clear it too.
  const cellBar = document.querySelector<HTMLElement>('.cell-bar');
  const barTop = cellBar?.getClientRects().length ? cellBar.getBoundingClientRect().top : Infinity;
  let floor = Math.min(window.innerHeight - bar - 12, barTop - 8);
  // Desktop Phrase screen: the pads stick to the bottom of the editor column.
  const pads = document.querySelector<HTMLElement>('.view-phrase .pads-panel');
  // Only while it is actually stuck there: in its own place under the grid it scrolls along.
  if (pads && getComputedStyle(pads).position === 'sticky' && !pads.contains(el)) {
    const pr = pads.getBoundingClientRect();
    if (Math.abs(pr.bottom - (window.innerHeight - bar - 8)) < 3) floor = Math.min(floor, pr.top - 8);
  }
  const sc = scrollerOf(el);
  if (r.bottom > floor) scrollByY(sc, r.bottom - floor);
  else if (r.top < header + 8) scrollByY(sc, r.top - header - 8);
}

/**
 * Follow the cursor after it moved. The one exception: a press on the big on-screen key
 * panel when that panel scrolls together with the cursor (phones, one page) — following would
 * pull the keys away from the finger. Where the panel sits in its own column (desktop,
 * tablets) the cursor is always followed.
 */
export function followCursor(el: Element | null) {
  if (!el) return;
  if (pressedOnKeyPanel() && scrollerOf(document.getElementById('keys')) === scrollerOf(el)) return;
  keepInView(el);
}
