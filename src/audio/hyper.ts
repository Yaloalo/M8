/** Hypersynth SHIFT and SUBOSC mappings, kept pure so they can be tested. */

/**
 * SHIFT as the gains of notes 1–3 and notes 4–6: a cross-fade that holds both at full in the
 * middle. 00 plays only 1–3, 80 all six (older projects), FF only 4–6; each side fades
 * linearly over its half.
 */
export function shiftGains(v: number): [number, number] {
  const b = Math.max(0, Math.min(255, Math.round(v)));
  return [b <= 0x80 ? 1 : (0xff - b) / 0x7f, b >= 0x80 ? 1 : b / 0x80];
}

/**
 * SUBOSC (M8: two octaves below the root below 80, one octave below above 80). 00 is off;
 * 01–7F: two octaves down, level 01/7F … 7F/7F; 80–FF: one octave down, level 1/128 … 1.
 * Level 1 is as loud as one chord note.
 */
export function subOsc(v: number): { octaves: number; level: number } {
  const b = Math.max(0, Math.min(255, Math.round(v)));
  if (b === 0) return { octaves: 0, level: 0 };
  return b < 0x80 ? { octaves: 2, level: b / 0x7f } : { octaves: 1, level: (b - 0x7f) / 0x80 };
}
