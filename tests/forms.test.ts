import { describe, expect, it } from 'vitest';
import { defaultInstrument, newProject } from '../src/core/factory';
import { effectFields, eqFields, fieldHelp, instrumentFields, mixerFields, modFields, projectFields, scaleFields } from '../src/core/forms';
import { INSTRUMENT_TYPES, MOD_TYPES } from '../src/core/types';

describe('parameter help', () => {
  it('every parameter on every screen has a line of help', () => {
    const p = newProject();
    const missing: string[] = [];
    const check = (fs: { key: string }[]) => fs.forEach((f) => fieldHelp(f as never) || missing.push(f.key));
    for (const type of INSTRUMENT_TYPES) {
      p.instruments[0] = { ...defaultInstrument(), type };
      check(instrumentFields(p, 0, []));
    }
    for (const type of MOD_TYPES) {
      p.instruments[0].mods[0] = { ...p.instruments[0].mods[0], type };
      check(modFields(p, 0));
    }
    check(mixerFields());
    check(effectFields());
    check(eqFields(0));
    check(scaleFields(p, 0));
    check(projectFields([]));
    expect([...new Set(missing)]).toEqual([]);
  });
});
