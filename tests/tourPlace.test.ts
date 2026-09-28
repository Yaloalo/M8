import { describe, expect, it } from 'vitest';
import { placeBubble } from '../src/ui/tourPlace';

const phone = { vw: 390, vh: 844, headerBottom: 124, transportTop: 788, width: 358, height: 150 };

describe('teach bubble placement', () => {
  it('stays on screen when the phone edit bar has scrolled above the viewport', () => {
    // Round 6 bug: the bar's rect was −291, which pushed the bubble to −354.
    const p = placeBubble({ ...phone, box: { top: 300, left: 16, width: 358, height: 400 }, barTop: -291 });
    expect(p.top).toBeGreaterThanOrEqual(132);
    expect(p.top + 150).toBeLessThanOrEqual(788);
  });

  it('keeps clear of a visible edit bar', () => {
    const p = placeBubble({ ...phone, box: { top: 200, left: 16, width: 358, height: 44 }, barTop: 700 });
    expect(p.top + 150).toBeLessThanOrEqual(700);
  });

  it('never covers the header, even for targets inside it', () => {
    const p = placeBubble({ ...phone, box: { top: 10, left: 200, width: 60, height: 40 }, barTop: null });
    expect(p.top).toBeGreaterThanOrEqual(132);
  });

  it('sits beside a tall right-column target on desktop', () => {
    const p = placeBubble({ vw: 1440, vh: 900, headerBottom: 124, transportTop: 844, width: 300, height: 150, box: { top: 400, left: 1080, width: 320, height: 380 }, barTop: null });
    expect(p.left + 300).toBeLessThanOrEqual(1080);
  });

  it('docks at the top when the cursor is in the lower half of a tall grid', () => {
    const p = placeBubble({ ...phone, box: { top: 130, left: 8, width: 374, height: 700 }, barTop: null, avoidY: 700 });
    expect(p.top).toBe(132);
  });

  it('docks under-tall grids at the bottom-right', () => {
    const p = placeBubble({ vw: 1440, vh: 900, headerBottom: 124, transportTop: 844, width: 300, height: 150, box: { top: 230, left: 40, width: 1000, height: 600 }, barTop: null });
    expect(p.top).toBe(844 - 150 - 12);
  });

  it('does not cover the cell the person just picked (step 4 under a crumb)', () => {
    const cell = { top: 300, left: 60, width: 60, height: 30 };
    const box = { top: 80, left: 100, width: 80, height: 40 };
    const p = placeBubble({ vw: 1440, vh: 900, headerBottom: 124, transportTop: 844, width: 300, height: 150, box, barTop: null, avoid: [cell] });
    const overlaps = p.left < cell.left + cell.width && cell.left < p.left + 300 && p.top < cell.top + cell.height && cell.top < p.top + 150;
    expect(overlaps).toBe(false);
  });

  it('leaves the top of a medium target free when neither side has room', () => {
    // Phone tracks panel: too tall for a bubble above or below, too short to count as a grid.
    const box = { top: 140, left: 16, width: 358, height: 520 };
    const p = placeBubble({ ...phone, box, barTop: null });
    expect(p.top).toBeGreaterThan(box.top + 100);
  });

  it('narrows to leave a column of buttons free when nothing else clears them', () => {
    // 320×640 phone, the tracks panel filling the band, M / S at the right.
    const ms = Array.from({ length: 8 }, (_, i) => ({ top: 150 + i * 46, left: 230, width: 74, height: 44 }));
    const p = placeBubble({ vw: 320, vh: 640, headerBottom: 104, transportTop: 584, width: 288, height: 150, box: { top: 110, left: 16, width: 288, height: 400 }, barTop: null, avoid: ms });
    expect(p.left + p.width).toBeLessThanOrEqual(230);
  });
});
