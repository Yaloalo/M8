import { describe, expect, it } from 'vitest';
import { defaultInstrument, newProject } from '../src/core/factory';
import { fieldHelp, formatField, instrumentFields } from '../src/core/forms';
import { SAMPLE_PLAYS, type Instrument } from '../src/core/types';
import { lastRepairs, migrate } from '../src/state/persist';
import { safeInstrument } from '../src/audio/safety';
import { degradeHold, detuneSemitones, repitchRate, tickAt } from '../src/audio/sampler';
import { shiftGains, subOsc } from '../src/audio/hyper';

const project = (patch: (i: Instrument) => void) => {
  const p = newProject();
  const i = defaultInstrument();
  patch(i);
  p.instruments[0] = i;
  return p;
};
const labels = (i: (x: Instrument) => void) => instrumentFields(project(i), 0, []).map((f) => f.label);

describe('sampler DETUNE / DEGRADE / REPITCH', () => {
  it('DETUNE: 80 centre, first digit semitones, second 1/16 semitone', () => {
    expect(detuneSemitones(0x80)).toBe(0);
    expect(detuneSemitones(0x90)).toBe(1);
    expect(detuneSemitones(0x70)).toBe(-1);
    expect(detuneSemitones(0x88)).toBe(0.5);
    expect(detuneSemitones(0x81)).toBe(1 / 16);
    expect(detuneSemitones(0x7f)).toBe(-1 / 16);
    expect(detuneSemitones(0x00)).toBe(-8);
    expect(detuneSemitones(0xff)).toBeCloseTo(7.9375, 6);
  });

  it('REPITCH: the whole sample lasts STEPS sixteenths at the tempo', () => {
    // 1 s sample, STEPS 10 (16 steps): 2 s at 120 BPM, 1.6 s at 150 BPM.
    expect(repitchRate(1, 0x10, tickAt(120))).toBeCloseTo(0.5, 9);
    expect(1 / repitchRate(1, 0x10, tickAt(120))).toBeCloseTo(2, 9);
    expect(repitchRate(1, 0x10, tickAt(150))).toBeCloseTo(0.625, 9);
    expect(1 / repitchRate(1, 0x10, tickAt(150))).toBeCloseTo(1.6, 9);
    // A one-bar loop at 120 BPM that is 2 s long plays as recorded.
    expect(repitchRate(2, 16, tickAt(120))).toBeCloseTo(1, 9);
    // STEPS 00 never divides by zero.
    expect(Number.isFinite(repitchRate(1, 0, tickAt(120)))).toBe(true);
  });

  it('DEGRADE: 00 leaves the sample alone, higher holds longer', () => {
    expect(degradeHold(0)).toBe(1);
    let prev = 1;
    for (let v = 1; v <= 255; v++) {
      const h = degradeHold(v);
      expect(h).toBeGreaterThan(prev);
      prev = h;
    }
    expect(degradeHold(0xff)).toBeGreaterThan(64);
  });

  it('offers the M8 play modes', () => {
    for (const m of ['OSC', 'OSC REV', 'OSC PP', 'REPITCH'] as const) expect(SAMPLE_PLAYS).toContain(m);
  });
});

describe('hypersynth SHIFT / SUBOSC', () => {
  it('SHIFT cross-fades notes 1–3 against 4–6, both full at 80', () => {
    expect(shiftGains(0x00)).toEqual([1, 0]);
    expect(shiftGains(0x80)).toEqual([1, 1]);
    expect(shiftGains(0xff)).toEqual([0, 1]);
    const [a, b] = shiftGains(0x40);
    expect(a).toBe(1);
    expect(b).toBeCloseTo(0.5, 6);
    expect(shiftGains(0xc0)[0]).toBeCloseTo(0x3f / 0x7f, 6);
  });

  it('SUBOSC: 00 off, below 80 two octaves down, from 80 one octave down', () => {
    expect(subOsc(0)).toEqual({ octaves: 0, level: 0 });
    expect(subOsc(0x7f)).toEqual({ octaves: 2, level: 1 });
    expect(subOsc(0x40).octaves).toBe(2);
    expect(subOsc(0x80).octaves).toBe(1);
    expect(subOsc(0xff)).toEqual({ octaves: 1, level: 1 });
    expect(subOsc(0x40).level).toBeLessThan(subOsc(0x7f).level);
  });
});

describe('forms and migration for the new parameters', () => {
  it('shows the new rows where they belong, each with help', () => {
    expect(labels((i) => (i.type = 'SAMPLER'))).toEqual(expect.arrayContaining(['DETUNE', 'DEGRADE']));
    expect(labels((i) => (i.type = 'SAMPLER'))).not.toContain('STEPS');
    expect(labels((i) => ((i.type = 'SAMPLER'), (i.sampler.play = 'REPITCH')))).toContain('STEPS');
    expect(labels((i) => ((i.type = 'SAMPLER'), (i.sampler.play = 'WAVETABLE')))).not.toContain('DEGRADE');
    const hyper = labels((i) => (i.type = 'HYPERSYNTH'));
    expect(hyper).toEqual(expect.arrayContaining(['SHIFT', 'SUBOSC', 'NOTE 5', 'NOTE 6']));
    for (const play of SAMPLE_PLAYS) {
      const fs = instrumentFields(project((i) => ((i.type = 'SAMPLER'), (i.sampler.play = play))), 0, []);
      for (const f of fs) {
        expect(fieldHelp(f), f.key).toBeTruthy();
        expect(f.label.length, f.label).toBeLessThanOrEqual(9);
      }
    }
    const p = project((i) => ((i.type = 'SAMPLER'), (i.sampler.detune = 0x90)));
    const det = instrumentFields(p, 0, []).find((f) => f.label === 'DETUNE')!;
    expect(formatField(det, det.get(p, 0), true)).toBe('90 +1.00');
  });

  it('gives older files the defaults that sound the same', () => {
    const p = migrate({ version: 3, song: [], tempo: 120, instruments: { 0: { type: 'SAMPLER', sampler: { play: 'FWD' } }, 1: { type: 'HYPERSYNTH', hyper: { chord: [0, 4, 7] } } } });
    expect(lastRepairs()).toBe(0);
    expect(p.instruments[0].sampler).toMatchObject({ detune: 0x80, degrade: 0, steps: 0x10 });
    expect(p.instruments[1].hyper).toMatchObject({ shift: 0x80, subosc: 0, chord: [0, 4, 7] });
  });

  it('clamps and counts damaged values', () => {
    const p = migrate({
      version: 3,
      song: [],
      tempo: 120,
      instruments: {
        0: { type: 'SAMPLER', sampler: { play: 'OSC PP', detune: 300, degrade: -4, steps: 0 } },
        1: { type: 'HYPERSYNTH', hyper: { shift: 'x', subosc: 999, chord: [0, 1, 2, 3, 4, 5, 6, 7] } },
      },
    });
    expect(p.instruments[0].sampler).toMatchObject({ play: 'OSC PP', detune: 0xff, degrade: 0, steps: 1 });
    expect(p.instruments[1].hyper).toMatchObject({ shift: 0x80, subosc: 0xff });
    expect(p.instruments[1].hyper.chord).toHaveLength(6);
    expect(lastRepairs()).toBe(5);
  });

  it('the engine coerces the new fields too', () => {
    const raw = { ...defaultInstrument(), sampler: { ...defaultInstrument().sampler, steps: 0, detune: NaN }, hyper: { chord: [0] } } as unknown as Instrument;
    const s = safeInstrument(raw);
    expect(s.sampler).toMatchObject({ steps: 1, detune: 0x80, degrade: 0 });
    expect(s.hyper).toMatchObject({ shift: 0x80, subosc: 0 });
  });
});
