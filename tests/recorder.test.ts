import { describe, expect, it, vi } from 'vitest';
import { defaultInstrument, newProject } from '../src/core/factory';
import { getState, replaceProject, setState } from '../src/state/store';

vi.mock('../src/state/transport', () => ({ addUserSample: vi.fn(async () => {}) }));
vi.mock('../src/state/persist', () => ({ saveSample: vi.fn(async () => {}) }));

const stopped: string[] = [];
class FakeRecorder {
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) });
    this.onstop?.();
  }
}
const track = { stop: () => stopped.push('mic') };
vi.stubGlobal('MediaRecorder', FakeRecorder);
let opened = 0;
vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => (opened++, { getTracks: () => [track] }) } });
vi.stubGlobal('requestAnimationFrame', () => 0);
vi.stubGlobal('cancelAnimationFrame', () => {});

describe('recorder', () => {
  it('writes the take into the instrument it started on and releases the microphone', async () => {
    const p = newProject();
    p.instruments[3] = { ...defaultInstrument(), type: 'SAMPLER' };
    p.instruments[5] = { ...defaultInstrument(), type: 'WAVSYNTH' };
    replaceProject(p);
    const { startRecording, stopRecording, isRecording } = await import('../src/state/recorder');
    await startRecording(3);
    expect(isRecording()).toBe(true);
    // The person moves on to another instrument and screen while recording.
    setState({ view: 'MODS', ids: { ...getState().ids, inst: 5 } });
    stopRecording();
    await new Promise((r) => setTimeout(r, 10));
    expect(isRecording()).toBe(false);
    expect(stopped).toContain('mic');
    const s = getState().project;
    expect(s.instruments[3].sampler.sample).toMatch(/^user:.*:rec$/);
    expect(s.instruments[5].sampler.sample).toBe(null);
    expect(getState().recording).toBe(false);
  });

  it('a double tap on Record opens the microphone once', async () => {
    const { startRecording, stopRecording } = await import('../src/state/recorder');
    opened = 0;
    await Promise.all([startRecording(3), startRecording(3)]);
    expect(opened).toBe(1);
    stopRecording();
    await new Promise((r) => setTimeout(r, 10));
  });
});
