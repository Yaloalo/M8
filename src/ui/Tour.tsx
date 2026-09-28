import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TOUR, endTour, goToStep, revertTour, tourChangedProject, tourShouldAdvance } from '../state/tour';
import { getState, subscribe, useStore } from '../state/store';
import { Icon } from './Icon';
import { placeBubble } from './tourPlace';
import { keepInView, scrollByY, scrollerOf } from './scroller';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
  /** The target lives in the header or transport bar. */
  fixed: boolean;
}

const BUBBLE_W = 300;

/**
 * The floating teach-mode bubble plus a ring around its target. Nothing here captures
 * clicks except the bubble itself, so the highlighted thing stays usable.
 */
export function Tour() {
  const step = useStore((s) => s.tour);
  const [box, setBox] = useState<Box | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [bubbleH, setBubbleH] = useState(120);
  const def = step != null ? TOUR[step] : null;

  // Advance once the step's action has been done. This listens to the store directly, so
  // the bubble does not re-render on every playhead move.
  useEffect(() => {
    if (!def?.done || step == null) return;
    let armed = false;
    const check = () => {
      if (armed || getState().tour !== step) return;
      if (tourShouldAdvance(getState())) {
        armed = true;
        setTimeout(() => {
          if (getState().tour === step) goToStep(step + 1);
        }, 450);
      }
    };
    return subscribe(check);
  }, [def, step]);

  // Follow the target through scrolling, layout changes and screen switches.
  useEffect(() => {
    if (!def) return;
    let raf = 0;
    let scrolled = false;
    let lastSel = '';
    let revealed = '';
    const track = () => {
      const sel = typeof def.target === 'string' ? def.target : def.target(getState());
      // A new target (e.g. the command list appearing) may need scrolling to again.
      if (sel !== lastSel) {
        lastSel = sel;
        scrolled = false;
      }
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.offsetParent != null || getComputedStyle(e).position === 'fixed') ?? null;
      if (el) {
        let r = el.getBoundingClientRect();
        // Inside a scrolling box (the inspector, the command list) only the visible part
        // counts, so the ring never spills over the panels below. The editor and side columns
        // themselves don't clip here: a target scrolled out of its column must still count as
        // off screen, so it is scrolled back (the ring is kept inside the band below anyway).
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const oy = getComputedStyle(p).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight && !p.matches('.workspace-main, .workspace-side')) {
            const c = p.getBoundingClientRect();
            const top = Math.max(r.top, c.top);
            const bottom = Math.min(r.bottom, c.bottom);
            r = new DOMRect(r.left, top, r.width, Math.max(0, bottom - top));
          }
        }
        // A step can name one thing inside the target to bring into view (e.g. RET).
        if (def.reveal && sel !== revealed) {
          const inner = el.querySelector<HTMLElement>(def.reveal);
          if (inner) {
            revealed = sel;
            // Centre it in each scrolling box around it (not the page, which would move the
            // whole frame); the scroll cue fades the bottom edge, so the middle is clear.
            for (let p = inner.parentElement; p && p !== document.body; p = p.parentElement) {
              const oy = getComputedStyle(p).overflowY;
              if ((oy !== 'auto' && oy !== 'scroll') || p.scrollHeight <= p.clientHeight) continue;
              const pr = p.getBoundingClientRect();
              const ir = inner.getBoundingClientRect();
              p.scrollTop += ir.top - pr.top - (p.clientHeight - ir.height) / 2;
            }
          }
        }
        // Targets in a fixed bar (header, transport, the phone edit bar) get a full ring.
        const fixed = getComputedStyle(el).position === 'fixed' || !!el.closest('.transport-bar, .app-header, .cell-bar, .fx-pick');
        // The usable band is between the sticky header and the transport bar.
        const head = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0;
        const foot = document.querySelector('.transport-bar')?.getBoundingClientRect().top ?? window.innerHeight;
        const band = foot - head;
        const tall = r.height > band / 2;
        // A tall target is "off" only once none of it is in view, so scrolling inside it stays
        // free; a small one must be wholly in view.
        const off = !fixed && (tall ? r.bottom < head + 40 || r.top > foot - 40 : r.top < head || r.bottom > foot);
        // Scroll once per time the target goes off screen, so the person can still scroll.
        if (!off) scrolled = false;
        if (!scrolled && off) {
          scrolled = true;
          // Tall targets start just under the header, leaving room below for the bubble. A
          // small one scrolls only as far as needed, so what is above it (the grid cursor
          // while writing notes from the pads) stays in view as far as possible. Whatever
          // scrolls it — the editor or side column on desktop, the page on phones — moves.
          const dy = tall ? r.top - head - 8 : r.bottom > foot ? r.bottom - foot + 16 : r.top - head - 16;
          // The column the target sits in (desktop), or the page (phones).
          const col = el.closest('.workspace-main, .workspace-side');
          scrollByY(col && col.scrollHeight > col.clientHeight && getComputedStyle(col).overflowY === 'auto' ? col : scrollerOf(col ?? el), dy, true);
        }
        setBox((b) =>
          b && b.top === r.top && b.left === r.left && b.width === r.width && b.height === r.height && b.fixed === fixed
            ? b
            : { top: r.top, left: r.left, width: r.width, height: r.height, fixed },
        );
      } else setBox(null);
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    return () => cancelAnimationFrame(raf);
  }, [def]);

  useLayoutEffect(() => {
    if (bubble.current) setBubbleH(bubble.current.offsetHeight);
  });

  // "The cursor is back on your note": make sure it is on screen (also after Skip).
  useEffect(() => {
    if (!def?.showCursor) return;
    const t = setTimeout(() => keepInView(document.querySelector('.cell.is-cursor')), 60);
    return () => clearTimeout(t);
  }, [def]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
      // Enter on the last step is "Done" (not while typing in a field).
      else if (e.key === 'Enter' && getState().tour === TOUR.length - 1 && !(e.target as HTMLElement | null)?.closest?.('input, select, textarea')) endTour();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  if (step == null || !def) return null;
  // On a touch screen the words follow the finger.
  const touch = window.matchMedia('(pointer: coarse), (hover: none)').matches;
  const words = (t: string) => (touch ? t.replace(/\bClick\b/g, 'Tap').replace(/\bclick\b/g, 'tap') : t);
  const headerBottom = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0;
  const transportTop = document.querySelector('.transport-bar')?.getBoundingClientRect().top ?? window.innerHeight;
  const last = step === TOUR.length - 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(BUBBLE_W, vw - 32);
  const bar = document.querySelector('.cell-bar') as HTMLElement | null;
  const { top, left, side, arrowX, width: bubbleW } = placeBubble({
    box,
    vw,
    vh,
    headerBottom,
    transportTop,
    // The command list covers the edit bar while it is open: the bar is no floor then.
    barTop: bar && bar.getClientRects().length && !document.querySelector('.fx-pick') ? bar.getBoundingClientRect().top : null,
    avoidY: (() => {
      const c = document.querySelector('.cell.is-cursor, .pool .is-cursor');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return r.top + r.height / 2;
    })(),
    // The grid cursor (e.g. the chain just picked) stays in sight, with a little margin.
    // (The grid cursor doesn't count while the command list covers the grid.)
    avoid: [
      ...document.querySelectorAll(
        [document.querySelector('.fx-pick') ? '' : '.cell.is-cursor, .pool .is-cursor', def.keepClear ?? ''].filter(Boolean).join(', ') || ':not(*)',
      ),
    ].map((c) => {
      const r = c.getBoundingClientRect();
      return { top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 };
    }),
    width,
    height: bubbleH,
  });

  return (
    <>
      {box && (
        <div
          className="tour-ring"
          aria-hidden="true"
          style={(() => {
            // Targets in the header or transport get a full ring; everything else is clipped
            // to the band between them, so the ring never paints over the fixed bars.
            // Decided by the element (in the header or transport bar), not by where it
            // happens to be scrolled: a grid scrolled under the header is still clipped.
            const fixedTarget = box.fixed;
            // On phones the edit bar floats above the transport: stop above it too.
            const barEl = document.querySelector('.cell-bar');
            const floor = barEl && barEl.getClientRects().length ? Math.min(transportTop, barEl.getBoundingClientRect().top) : transportTop;
            const top = fixedTarget ? box.top - 5 : Math.max(box.top - 5, headerBottom + 2);
            const bottom = fixedTarget ? box.top + box.height + 5 : Math.min(box.top + box.height + 5, floor - 6);
            return { top, left: box.left - 5, width: box.width + 10, height: Math.max(0, bottom - top) };
          })()}
        />
      )}
      <div
        ref={bubble}
        className={`tour-bubble is-${side}`}
        role="dialog"
        aria-live="polite"
        aria-label={`Teach mode, step ${step + 1} of ${TOUR.length}: ${def.title}`}
        style={{ top, left, width: bubbleW, ['--arrow-x' as string]: `${arrowX}px` }}
      >
        <div className="tour-head">
          <span className="small-label">
            Teach · {step + 1}/{TOUR.length}
          </span>
          <button className="tour-close icon-button" aria-label="End teach mode" onClick={endTour}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <strong>{def.title}</strong>
        <p>{words(def.text)}</p>
        {def.keys && !touch && (
          <p className="tour-keys">
            Keys: <kbd>{def.keys}</kbd>
          </p>
        )}
        <div className="tour-actions">
          {step > 0 && (
            <button className="text-link" onClick={() => goToStep(step - 1)}>
              Back
            </button>
          )}
          {last ? (
            <>
              {tourChangedProject() && (
                <button onClick={revertTour} title="Put the project back as it was before the tour">
                  Undo tour edits
                </button>
              )}
              <button className="primary" onClick={endTour}>
                Done
              </button>
            </>
          ) : (
            <button onClick={() => goToStep(step + 1)}>{def.done ? 'Skip' : 'Next'}</button>
          )}
        </div>
      </div>
    </>
  );
}
