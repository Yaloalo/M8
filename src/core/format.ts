import { NOTE_OFF, type ScaleName, type ScaleRef, type UserScale } from './types';

export const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

/** MIDI 60 is C-4, as on the M8. */
export function noteName(n: number | null): string {
  if (n == null) return '---';
  if (n === NOTE_OFF) return 'OFF';
  const octave = Math.floor(n / 12) - 1;
  return NOTE_NAMES[n % 12] + (octave < 0 ? '-' : octave.toString(16).toUpperCase());
}

export const hex2 = (v: number) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0');

/** A byte as the project shows numbers: two hex digits or three decimal ones. */
export function byte(v: number | null, hex: boolean): string {
  if (v == null) return hex ? '--' : '---';
  return hex ? hex2(v) : String(v & 0xff).padStart(3, '0');
}

/** Signed byte: hex keeps the raw two's complement, decimal shows the sign. */
export function signed(v: number, hex: boolean): string {
  if (hex) return hex2(v < 0 ? v + 256 : v);
  return (v > 0 ? '+' : v < 0 ? '-' : ' ') + String(Math.abs(v)).padStart(2, '0');
}

/** Row labels, 00–0F or 01–16 (Polyend counts from one in decimal mode). */
export const rowLabel = (i: number, hex: boolean) =>
  hex ? hex2(i) : String(i + 1).padStart(3, '0');

export const SCALES: Record<ScaleName, number[]> = {
  CHROMATIC: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  MAJOR: [0, 2, 4, 5, 7, 9, 11],
  MINOR: [0, 2, 3, 5, 7, 8, 10],
  DORIAN: [0, 2, 3, 5, 7, 9, 10],
  PHRYGIAN: [0, 1, 3, 5, 7, 8, 10],
  MIXOLYDIAN: [0, 2, 4, 5, 7, 9, 10],
  'HARM MINOR': [0, 2, 3, 5, 7, 8, 11],
  'PENTA MAJ': [0, 2, 4, 7, 9],
  'PENTA MIN': [0, 3, 5, 7, 10],
  BLUES: [0, 3, 5, 6, 7, 10],
};
export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[];

export const USER_SCALE_NAMES = Array.from({ length: 16 }, (_, i) => `USER ${i.toString(16).toUpperCase()}` as ScaleRef);
export const ALL_SCALES: ScaleRef[] = [...SCALE_NAMES, ...USER_SCALE_NAMES];

/** Semitones (from the root) in a scale; user scales come from the project's Scale view. */
export function scaleSteps(scale: ScaleRef, user?: UserScale[]): number[] {
  if (scale.startsWith('USER ')) {
    const u = user?.[parseInt(scale.slice(5), 16)];
    const steps = u ? u.notes.flatMap((on, i) => (on ? [i] : [])) : [];
    return steps.length ? steps : SCALES.CHROMATIC;
  }
  return SCALES[scale as ScaleName] ?? SCALES.CHROMATIC;
}

/** A user scale's tuning for a note, in cents (built-in scales are equal-tempered). */
export function scaleTune(note: number, scale: ScaleRef, root: number, user?: UserScale[]): number {
  if (!scale.startsWith('USER ')) return 0;
  const u = user?.[parseInt(scale.slice(5), 16)];
  return u?.tune[(((note - root) % 12) + 12) % 12] ?? 0;
}

export const inScale = (note: number, scale: ScaleRef, root: number, user?: UserScale[]) =>
  scaleSteps(scale, user).includes((((note - root) % 12) + 12) % 12);

/** Nearest note at or above `note` that is in the scale. */
export function snapToScale(note: number, scale: ScaleRef, root: number, user?: UserScale[]): number {
  for (let i = 0; i < 12; i++) if (inScale(note + i, scale, root, user)) return note + i;
  return note;
}

export const noteFrequency = (semitones: number) => 440 * 2 ** ((semitones - 69) / 12);
