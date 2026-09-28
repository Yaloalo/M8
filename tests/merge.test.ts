import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { merge3 } from '../src/state/merge';

const base = { tempo: 120, phrases: { 0: { steps: [{ note: null }, { note: null }, { note: null }] }, 1: { steps: [{ note: 5 }] } }, name: 'A' };

describe('two-tab merge', () => {
  it('keeps both tabs’ edits to different rows of the same phrase', () => {
    const local = produce(base, (d) => {
      d.phrases[0].steps[1].note = 60 as never;
    });
    // The other tab's save comes back as fresh JSON: no shared identity with base.
    const remote = JSON.parse(JSON.stringify(base));
    remote.phrases[0].steps[2].note = 64;
    remote.tempo = 140;
    const m = merge3(base, local, remote);
    expect(m.phrases[0].steps.map((s: { note: number | null }) => s.note)).toEqual([null, 60, 64]);
    expect(m.tempo).toBe(140);
  });

  it('lets this tab win when both changed the same value', () => {
    const local = produce(base, (d) => {
      d.name = 'MINE';
    });
    const remote = { ...JSON.parse(JSON.stringify(base)), name: 'THEIRS' };
    expect(merge3(base, local, remote).name).toBe('MINE');
  });

  it('takes the remote wholesale when this tab changed nothing', () => {
    const remote = { ...JSON.parse(JSON.stringify(base)), tempo: 99 };
    expect(merge3(base, base, remote)).toBe(remote);
  });

  it('keeps additions from both sides', () => {
    const local = produce(base, (d) => {
      (d.phrases as Record<number, unknown>)[2] = { steps: [] };
    });
    const remote = JSON.parse(JSON.stringify(base));
    remote.phrases[3] = { steps: [{ note: 1 }] };
    const m = merge3(base, local, remote) as typeof base & { phrases: Record<number, unknown> };
    expect(Object.keys(m.phrases).sort()).toEqual(['0', '1', '2', '3']);
  });
});
