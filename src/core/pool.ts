import type { Project } from './types';

/** Instrument slots the pool lists: every defined instrument and every one a phrase uses. */
export function poolIds(p: Project): number[] {
  const ids = new Set(Object.keys(p.instruments).map(Number));
  for (const ph of Object.values(p.phrases)) for (const st of ph.steps) if (st.inst != null) ids.add(st.inst);
  return [...ids].sort((a, b) => a - b);
}

/** How many phrase steps use each instrument. */
export function poolUsage(p: Project): Map<number, number> {
  const out = new Map<number, number>();
  for (const ph of Object.values(p.phrases)) for (const st of ph.steps) if (st.inst != null) out.set(st.inst, (out.get(st.inst) ?? 0) + 1);
  return out;
}
