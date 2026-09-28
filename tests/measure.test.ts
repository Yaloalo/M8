import { describe, expect, it } from 'vitest';
import { emptyChain, emptyPhrase, newProject, defaultInstrument } from '../src/core/factory';
import { measureSeconds } from '../src/core/measure';
import { zip } from '../src/audio/zip';

function song(tempoFx = false) {
  const p = newProject();
  p.tempo = 120;
  p.instruments[0] = { ...defaultInstrument(), type: 'WAVSYNTH' };
  const ph = emptyPhrase();
  ph.steps[0] = { ...ph.steps[0], note: 60, inst: 0 };
  if (tempoFx) ph.steps[0].fx[0] = { cmd: 'TPO', val: 60 };
  p.phrases[0] = ph;
  const ch = emptyChain();
  ch.rows[0] = { phrase: 0, tsp: 0 };
  ch.rows[1] = { phrase: 0, tsp: 0 };
  p.chains[0] = ch;
  p.song[0][0] = 0;
  return p;
}

describe('render length', () => {
  it('is one pass of the song: two bars at 120 BPM = 4 s', () => {
    expect(measureSeconds(song(), 0)).toBeCloseTo(4, 1);
  });
  it('follows TPO inside the song', () => {
    expect(measureSeconds(song(true), 0)).toBeCloseTo(8, 0);
  });
});

describe('zip', () => {
  it('writes a stored archive with local headers and a central directory', async () => {
    const z = await zip([{ name: 'a.txt', blob: new Blob(['hello']) }]);
    const b = new Uint8Array(await z.arrayBuffer());
    expect([b[0], b[1], b[2], b[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(b.length).toBe(30 + 5 + 5 + 46 + 5 + 22);
  });
});
