import { describe, expect, it, vi } from 'vitest';
import { newProject } from '../src/core/factory';
import { TOUR, goToStep, tourShouldAdvance } from '../src/state/tour';
import { getState, replaceProject, setState } from '../src/state/store';

vi.mock('../src/state/transport', () => ({
  play: vi.fn(),
  stop: vi.fn(),
  preview: vi.fn(),
  queueRow: vi.fn(),
  queueStopTrack: vi.fn(),
  expectBusy: vi.fn(),
}));

describe('teach mode', () => {
  it('advances only after the person acts', () => {
    replaceProject(newProject());
    goToStep(0);
    expect(tourShouldAdvance(getState())).toBe(false);
    setState({ playing: true });
    expect(tourShouldAdvance(getState())).toBe(true);
  });

  it('going back to a step that is already done waits for a fresh action', () => {
    setState({ playing: true });
    goToStep(0);
    setState({ status: 'something else changed' });
    expect(tourShouldAdvance(getState())).toBe(false);
    // The tour checks after every state change, as its store subscription does.
    setState({ playing: false });
    expect(tourShouldAdvance(getState())).toBe(false);
    setState({ playing: true });
    expect(tourShouldAdvance(getState())).toBe(true);
  });

  it('every step has a target and short text', () => {
    for (const s of TOUR) {
      expect(s.target).toBeTruthy();
      expect(s.text.length).toBeLessThan(160);
    }
  });
});
