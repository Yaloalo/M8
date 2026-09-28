export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Place {
  top: number;
  left: number;
  side: 'above' | 'below' | 'none';
  arrowX: number;
  /** The bubble may come out narrower than asked, to leave a column of buttons free. */
  width: number;
}

const GAP = 12;

/**
 * Where the teach bubble goes. `band` is the visible area between the sticky header and
 * whatever covers the bottom (transport bar, or the phone edit bar when it is on screen).
 * The result always lies inside the band, so Next / Done can be reached.
 */
export function placeBubble(o: {
  box: Box | null;
  vw: number;
  vh: number;
  headerBottom: number;
  transportTop: number;
  /** Top of the phone edit bar, or null when it is not showing. */
  barTop: number | null;
  width: number;
  height: number;
  /** Screen y of the thing the person is working on (the grid cursor): keep clear of it. */
  avoidY?: number | null;
  /** Things the bubble must not cover (the grid cursor, the cell just picked). */
  avoid?: Box[];
}): Place {
  const { box, vw, height, headerBottom } = o;
  let width = o.width;
  // The edit bar only matters while it is actually inside the viewport.
  const barOn = o.barTop != null && o.barTop > headerBottom && o.barTop < o.vh;
  const foot = Math.min(o.transportTop, barOn ? o.barTop! : Infinity, o.vh);
  let top = (headerBottom + foot) / 2 - height / 2;
  let left = vw / 2 - width / 2;
  let side: Place['side'] = 'none';
  const sideRoom = box ? box.left - width - GAP : 0;
  if (box && box.left > vw / 2 && box.height > 160 && sideRoom > 16) {
    // A tall target in the right column: sit to its left so its buttons stay free.
    left = sideRoom;
    top = box.top;
  } else if (box && box.height > foot - headerBottom - height - 24) {
    // A target taller than half the band (a grid): dock at the bottom so the rows at the
    // top stay free to tap — or at the top when the cursor is down there.
    const mid = (headerBottom + foot) / 2;
    top = o.avoidY != null && o.avoidY > mid ? headerBottom + 8 : foot - height - 12;
    left = vw - width - 16;
  } else if (box) {
    const below = box.top + box.height + GAP;
    const above = box.top - GAP - height;
    if (below + height < foot - 8) {
      top = below;
      side = 'below';
    } else if (above > headerBottom + 8) {
      top = above;
      side = 'above';
    } else {
      // No room on either side: dock at the bottom of the band, leaving the target's top
      // (usually its first row of buttons) free.
      top = foot - height - 12;
    }
    left = box.left + box.width / 2 - width / 2;
  }
  // Always inside the visible band and the screen width.
  const minTop = headerBottom + 8;
  const maxTop = Math.max(minTop, foot - height - 8);
  const clampTop = (t: number) => Math.max(minTop, Math.min(maxTop, t));
  const clampLeft = (l: number) => Math.max(16, Math.min(vw - width - 16, l));
  top = clampTop(top);
  left = clampLeft(left);
  // Keep clear of what the person is working on. A small target must stay visible too; a
  // tall one (a grid) is covered in part anyway.
  const hits = (t: number, l: number, b: Box) =>
    l < b.left + b.width && b.left < l + width && t < b.top + b.height && b.top < t + height;
  const keep = [...(o.avoid ?? []), ...(box && box.height <= 160 ? [box] : [])];
  if (keep.some((b) => hits(top, left, b))) {
    // Also just below or above each thing to keep clear, so the bubble can sit between them.
    const around = keep.flatMap((b) => [b.top + b.height + 8, b.top - height - 8]);
    const tops = [top, box ? box.top + box.height + GAP : top, box ? box.top - GAP - height : top, foot - height - 12, minTop, ...around];
    const lefts = [left, box ? box.left : left, box ? box.left + box.width - width : left, 16, vw - width - 16];
    let found = false;
    search: for (const t of tops.map(clampTop))
      for (const l of lefts.map(clampLeft))
        if (!keep.some((b) => hits(t, l, b))) {
          top = t;
          left = l;
          found = true;
          break search;
        }
    // Nowhere clear at full width: narrow the bubble so it sits beside the things to keep
    // free (e.g. over the track names, leaving the M / S column). Text wraps a little more.
    if (!found && o.avoid?.length) {
      const inBand = o.avoid.filter((b) => b.top + b.height > headerBottom && b.top < foot);
      const edge = inBand.length ? Math.min(...inBand.map((b) => b.left)) : 0;
      const narrow = edge - 16 - 8;
      if (narrow >= 150 && narrow < width) {
        width = narrow;
        left = 16;
      }
    }
  }
  // After clamping, an arrow only makes sense if the bubble still clears the target.
  const clear = box && (top >= box.top + box.height || top + height <= box.top);
  if (!clear) side = 'none';
  const arrowX = box ? Math.max(18, Math.min(width - 18, box.left + box.width / 2 - left)) : 0;
  return { top, left, side, arrowX, width };
}
