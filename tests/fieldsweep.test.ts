import { describe, expect, it, vi } from 'vitest';
import { defaultInstrument, newProject } from '../src/core/factory';
import { INSTRUMENT_TYPES as INST_TYPES } from '../src/core/types';
import { nudgeCursor, moveTo, openView, setField } from '../src/state/actions';
import { formFor } from '../src/state/fields';
import { getState, replaceProject, setState, type ViewId } from '../src/state/store';

vi.mock('../src/state/transport', () => ({
  play: vi.fn(),
  stop: vi.fn(),
  preview: vi.fn(),
  queueRow: vi.fn(),
  queueStopTrack: vi.fn(),
  expectBusy: vi.fn(),
}));

const alive = () => {
  const p = getState().project;
  expect(p).toBeTruthy();
  expect(Array.isArray(p.song)).toBe(true);
};

/** Every field of a form: ±1, ±coarse, then its minimum and maximum. The project must survive each. */
function sweep(view: ViewId) {
  openView(view);
  const { fields } = formFor(getState(), view);
  fields.forEach((f, row) => {
    if (f.type === 'text') return;
    moveTo(view, row, 0);
    for (const [coarse, dir] of [[false, 1], [false, -1], [true, 1], [true, -1]] as const) {
      nudgeCursor(coarse, dir);
      alive();
    }
    if (f.type === 'number' || f.type === 'byte' || f.type === 'signed') {
      setField(view, row, f.min ?? (f.type === 'signed' ? -128 : 0));
      alive();
      setField(view, row, f.max ?? (f.type === 'signed' ? 127 : 255));
      alive();
    }
  });
}

describe('every form field can be stepped without breaking the project', () => {
  for (const type of INST_TYPES)
    it(`instrument (${type}) and its mods`, () => {
      const p = newProject();
      p.instruments[0] = { ...defaultInstrument(), type };
      replaceProject(p);
      setState({ ids: { ...getState().ids, inst: 0 } });
      sweep('INST');
      sweep('MODS');
    });
  for (const view of ['MIXER', 'EFFECTS', 'PROJECT', 'SCALE', 'EQ'] as ViewId[])
    it(view, () => {
      replaceProject(newProject());
      sweep(view);
    });

  it('the EQ fields assign a slot and clear it again (the round-17 crash)', () => {
    replaceProject(newProject());
    openView('MIXER');
    const row = formFor(getState(), 'MIXER').fields.findIndex((f) => f.key === 'MASTER.eq');
    moveTo('MIXER', row, 0);
    nudgeCursor(false, 1);
    expect(getState().project.mixer.eq).toBe(0);
    nudgeCursor(false, -1);
    expect(getState().project.mixer.eq).toBeNull();
    alive();
  });
});
