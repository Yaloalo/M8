import { describe, expect, it } from 'vitest';
import { safeInstrument } from '../src/audio/safety';
import { defaultInstrument, newProject } from '../src/core/factory';
import { instrumentFields } from '../src/core/forms';
import { FILTER_TYPES, INSTRUMENT_TYPES, type FilterType, type InstrumentType } from '../src/core/types';
import { lastRepairs, migrate } from '../src/state/persist';

const WAV: FilterType[] = ['WAV LP', 'WAV HP', 'WAV BP', 'WAV BS'];
const saved = (instruments: Record<number, unknown>) => migrate({ version: 3, song: [], tempo: 120, instruments });

describe('filter types', () => {
  it('keeps the stored values of the original types', () => {
    expect(FILTER_TYPES.slice(0, 5)).toEqual(['OFF', 'LOWPASS', 'HIGHPASS', 'BANDPASS', 'BANDSTOP']);
  });

  it('every type survives a save/load on a Wavsynth, the non-WAV ones on every type', () => {
    const p = saved(Object.fromEntries(FILTER_TYPES.map((f, k) => [k, { type: 'WAVSYNTH', filter: f }])));
    FILTER_TYPES.forEach((f, k) => expect(p.instruments[k].filter).toBe(f));
    const q = saved({ 0: { type: 'FMSYNTH', filter: 'LP>HP' }, 1: { type: 'SAMPLER', filter: 'ZDF LP' }, 2: { type: 'HYPERSYNTH', filter: 'ZDF HP' } });
    expect([0, 1, 2].map((k) => q.instruments[k].filter)).toEqual(['LP>HP', 'ZDF LP', 'ZDF HP']);
    expect(lastRepairs()).toBe(0);
  });

  it('repairs a WAV type on an instrument that is not a Wavsynth to its nearest type', () => {
    const p = saved({ 0: { type: 'FMSYNTH', filter: 'WAV LP' }, 1: { type: 'SAMPLER', filter: 'WAV HP' }, 2: { type: 'HYPERSYNTH', filter: 'WAV BP' }, 3: { type: 'SAMPLER', filter: 'WAV BS' } });
    expect([0, 1, 2, 3].map((k) => p.instruments[k].filter)).toEqual(['LOWPASS', 'HIGHPASS', 'BANDPASS', 'BANDSTOP']);
    expect(lastRepairs()).toBe(4);
    // The engine does the same for an instrument whose type was switched away from Wavsynth.
    expect(safeInstrument({ ...defaultInstrument(), type: 'FMSYNTH', filter: 'WAV BS' }).filter).toBe('BANDSTOP');
    expect(safeInstrument({ ...defaultInstrument(), type: 'WAVSYNTH', filter: 'WAV BS' }).filter).toBe('WAV BS');
  });

  it('offers the WAV types on the Wavsynth only', () => {
    const p = newProject();
    const options = (type: InstrumentType) => {
      p.instruments[0] = { ...defaultInstrument(), type };
      return instrumentFields(p, 0, []).find((f) => f.key === 'FILTER.filter')?.options;
    };
    expect(options('WAVSYNTH')).toEqual(FILTER_TYPES);
    for (const type of INSTRUMENT_TYPES) {
      if (type === 'WAVSYNTH' || type === 'NONE' || type === 'MIDIOUT') continue;
      const o = options(type)!;
      expect(o).toContain('LP>HP');
      expect(o).toContain('ZDF HP');
      for (const w of WAV) expect(o).not.toContain(w);
    }
    // A WAV type kept from a Wavsynth shows as the type that plays.
    p.instruments[0] = { ...defaultInstrument(), type: 'FMSYNTH', filter: 'WAV HP' };
    expect(instrumentFields(p, 0, []).find((f) => f.key === 'FILTER.filter')!.get(p, 0)).toBe('HIGHPASS');
  });
});
