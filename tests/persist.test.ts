import { describe, expect, it } from 'vitest';
import { looksLikeProject, migrate } from '../src/state/persist';
import { demoProject } from '../src/state/demo';

describe('loading projects', () => {
  it('repairs a damaged project instead of crashing later', () => {
    const p = migrate({
      version: 2,
      song: [[0]],
      tempo: 120,
      phrases: { 0: { steps: [] }, 1: { steps: [{ note: 999, vel: 500, fx: [{ cmd: 'NOPE', val: 3 }] }] }, x: {} },
      chains: { 0: { rows: 'bad' } },
      instruments: { 3: { type: 'WAVSYNTH', mods: [{ decay: 'x' }] } },
    });
    expect(p.phrases[0].steps).toHaveLength(16);
    expect(p.phrases[1].steps[0]).toMatchObject({ note: 128, vel: 0x7f, fx: [{ cmd: null, val: 0 }, { cmd: null }, { cmd: null }] });
    expect(p.chains[0].rows).toHaveLength(16);
    expect(p.song).toHaveLength(256);
    expect(p.song[0][0]).toBe(0);
    expect(p.instruments[3].mods).toHaveLength(4);
    expect(p.instruments[3].fm.ops).toHaveLength(4);
  });

  it('replaces unknown enum values and non-numbers with defaults', () => {
    const p = migrate({
      format: 'eight-tracker',
      version: 2,
      song: [],
      tempo: 'fast',
      settings: { scale: 'FOO', octave: 'x', hex: 'yes' },
      instruments: { 0: { type: 'WAVSYNTH', wav: { shape: 'BAD', size: 'big' }, mods: [{ decay: 'x', type: 'WOBBLE', lfoShape: 3 }], filter: 'NOTCH', sampler: { play: 'SIDEWAYS' } } },
      effects: { delay: { timeL: 'x', feedback: 9999 } },
      mixer: { djType: 9, tracks: ['a'] },
    });
    expect(p.tempo).toBe(120);
    expect(p.settings).toMatchObject({ scale: 'CHROMATIC', octave: 4, hex: true });
    const i = p.instruments[0];
    expect(i.wav).toMatchObject({ shape: 'PULSE50', size: 0x80 });
    expect(i.mods[0]).toMatchObject({ type: 'AHD', lfoShape: 'TRI' });
    expect(Number.isFinite(i.mods[0].decay)).toBe(true);
    expect(i.filter).toBe('OFF');
    expect(i.sampler.play).toBe('FWD');
    expect(p.effects.delay.feedback).toBe(255);
    expect(p.effects.delay.timeL).toBeGreaterThan(0);
    expect(p.mixer.djType).toBe(2);
    expect(p.mixer.tracks[0]).toBe(0xe0);
  });

  it('converts version 1 files: velocities halve, envelope times become ticks', () => {
    const p = migrate({ version: 1, song: [], tempo: 120, phrases: { 0: { steps: [{ note: 60, vel: 0xff, inst: 0, fx: [] }] } }, instruments: { 0: { type: 'WAVSYNTH', mods: [{ type: 'AHD', decay: 0x60 }] } } });
    expect(p.phrases[0].steps[0].vel).toBe(0x7f);
    expect(p.instruments[0].mods[0].decay).toBe(0x1a);
    expect(p.version).toBe(3);
  });

  it('keeps the demo intact through a save/load round trip', () => {
    const d = demoProject();
    expect(migrate(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('refuses JSON that is not a project', () => {
    expect(looksLikeProject({ hello: 1 })).toBe(false);
    expect(looksLikeProject({ format: 'eight-tracker', project: {} })).toBe(false);
    expect(looksLikeProject({ format: 'eight-tracker', project: 5 })).toBe(false);
    expect(looksLikeProject({ format: 'eight-tracker', project: { song: [], tempo: 120 } })).toBe(true);
    expect(looksLikeProject(demoProject())).toBe(true);
  });

  it('turns garbage references into empty cells, not chain 00', () => {
    const p = migrate({ version: 3, tempo: 120, song: [['zz', {}, -5, [2], 3.5, 7]], chains: { 0: { rows: [{ phrase: 'x', tsp: 0 }] } } });
    expect(p.song[0].slice(0, 6)).toEqual([null, null, null, null, null, 7]);
    expect(p.chains[0].rows[0].phrase).toBeNull();
  });
});
