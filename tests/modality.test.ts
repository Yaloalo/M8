import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { addEventListener: () => {} });
const body = { matches: () => false };
vi.stubGlobal('document', { body });
const { spaceGoesToControl } = await import('../src/ui/modality');

const el = (sel: string) => ({ matches: (q: string) => q.split(', ').some((x) => x === sel) }) as unknown as Element;

describe('Space and focus', () => {
  it('a clicked button never takes Space from PLAY', () => {
    expect(spaceGoesToControl(el('button'), false)).toBe(false);
  });
  it('a button reached with Tab gets Space', () => {
    expect(spaceGoesToControl(el('button'), true)).toBe(true);
  });
  it('the grid and the page keep Space as PLAY', () => {
    expect(spaceGoesToControl(el('div'), true)).toBe(false);
    expect(spaceGoesToControl(body as unknown as Element, true)).toBe(false);
  });
});
