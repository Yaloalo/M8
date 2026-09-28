/**
 * The Polyend "Fill" tool, applied to a range of phrase rows: choose which rows
 * (pattern), which of them may change (where), and how values are spread (value).
 */
import { scaleSteps, snapToScale } from './format';
import { NOTE_OFF, type PhraseStep, type ScaleRef, type UserScale } from './types';

export type FillTarget = 'NOTE' | 'VEL' | 'INST' | 'FX';
export type FillWhere = 'ALL' | 'EMPTY' | 'EXISTING';
export type FillPattern = 'EVERY' | 'EUCLID' | 'RANDOM';
export type FillValue = 'CONSTANT' | 'FROM-TO' | 'RANDOM';

export interface FillOptions {
  target: FillTarget;
  where: FillWhere;
  pattern: FillPattern;
  /** EVERY: interval. EUCLID: number of hits. RANDOM: density 0–100. */
  amount: number;
  value: FillValue;
  from: number;
  to: number;
  /** Only for FX. */
  fxSlot: number;
  fxCmd: string;
  scale: ScaleRef;
  /** The project's user scales, for USER scales. */
  scales?: UserScale[];
  root: number;
  /** Instrument written alongside new notes. */
  inst: number | null;
}

/** Bjorklund-equivalent spread: hit where floor(i·k/n) steps up. */
export function euclid(hits: number, length: number, rotate = 0): boolean[] {
  const k = Math.max(0, Math.min(hits, length));
  const out = Array.from({ length }, (_, i) => {
    const j = (i + rotate) % length;
    return k > 0 && Math.floor((j * k) / length) !== Math.floor(((j - 1) * k) / length);
  });
  return out;
}

function hasValue(s: PhraseStep, o: FillOptions) {
  switch (o.target) {
    case 'NOTE':
      return s.note != null;
    case 'VEL':
      return s.vel != null;
    case 'INST':
      return s.inst != null;
    case 'FX':
      return s.fx[o.fxSlot]?.cmd != null;
  }
}

export function fillSteps(
  steps: PhraseStep[],
  o: FillOptions,
  rng: () => number = Math.random,
): PhraseStep[] {
  const n = steps.length;
  const hits =
    o.pattern === 'EVERY'
      ? steps.map((_, i) => i % Math.max(1, o.amount) === 0)
      : o.pattern === 'EUCLID'
        ? euclid(o.amount, n)
        : steps.map(() => rng() * 100 < o.amount);
  const chosen = steps.map((s, i) => {
    if (!hits[i]) return false;
    if (o.where === 'EMPTY') return !hasValue(s, o);
    if (o.where === 'EXISTING') return hasValue(s, o);
    return true;
  });
  const count = chosen.filter(Boolean).length;
  let k = 0;
  return steps.map((s, i) => {
    if (!chosen[i]) return s;
    const t = count > 1 ? k / (count - 1) : 0;
    k++;
    let v =
      o.value === 'CONSTANT'
        ? o.from
        : o.value === 'FROM-TO'
          ? Math.round(o.from + (o.to - o.from) * t)
          : Math.min(o.from, o.to) + Math.floor(rng() * (Math.abs(o.to - o.from) + 1));
    const next: PhraseStep = { ...s, fx: s.fx.map((f) => ({ ...f })) };
    switch (o.target) {
      case 'NOTE':
        v = Math.max(0, Math.min(127, v));
        if (scaleSteps(o.scale, o.scales).length < 12) v = Math.min(127, snapToScale(v, o.scale, o.root, o.scales));
        next.note = v;
        if (next.inst == null && o.inst != null) next.inst = o.inst;
        break;
      case 'VEL':
        next.vel = Math.max(0, Math.min(0x7f, v));
        break;
      case 'INST':
        next.inst = Math.max(0, Math.min(127, v));
        break;
      case 'FX':
        next.fx[o.fxSlot] = { cmd: o.fxCmd, val: Math.max(0, Math.min(255, v)) };
        break;
    }
    return next;
  });
}

/** Polyend "Invert": reverse the order of the rows in a range. */
export const reverseSteps = <T>(rows: T[]) => [...rows].reverse();

export function transposeSteps(steps: PhraseStep[], semis: number): PhraseStep[] {
  return steps.map((s) =>
    s.note == null || s.note === NOTE_OFF
      ? s
      : { ...s, note: Math.max(0, Math.min(127, s.note + semis)) },
  );
}
