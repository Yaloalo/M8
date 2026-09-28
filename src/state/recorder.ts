/**
 * Sample recording (the M8 sampler records too). It lives outside the UI so changing
 * screens or instrument type never orphans a running recorder or a live microphone: the
 * take always lands in the instrument it was started on, and the input is released on
 * stop, at the length cap, and when the page goes away.
 */
import { saveSample } from './persist';
import { commit, getState, setState } from './store';
import { addUserSample } from './transport';

const MAX_SECONDS = 60;
let recStartedAt = 0;
export const recordingSeconds = () => (take ? (Date.now() - recStartedAt) / 1000 : 0);

interface Take {
  recorder: MediaRecorder;
  stream: MediaStream;
  inst: number;
  meter: AudioContext | null;
  cap: ReturnType<typeof setTimeout>;
  raf: number;
}

let take: Take | null = null;
/** Set while the microphone permission/stream is being opened: a second tap must wait. */
let starting = false;

export const isRecording = () => take != null || starting;

function release(t: Take) {
  clearTimeout(t.cap);
  cancelAnimationFrame(t.raf);
  t.stream.getTracks().forEach((tr) => tr.stop());
  void t.meter?.close().catch(() => {});
}

export async function startRecording(inst: number) {
  if (take || starting) return;
  starting = true;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    starting = false;
    setState({ status: 'NO MICROPHONE ACCESS' });
    return;
  }
  starting = false;
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  let meter: AudioContext | null = null;
  let raf = 0;
  try {
    // An input meter, so a silent take is noticed before it is stopped.
    meter = new AudioContext();
    // Made after the permission prompt, it may start suspended (and read silence): wake it.
    void meter.resume().catch(() => {});
    const an = meter.createAnalyser();
    an.fftSize = 512;
    meter.createMediaStreamSource(stream).connect(an);
    const data = new Float32Array(an.fftSize);
    const tick = () => {
      an.getFloatTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      // Peak hold with a short fall, so the meter doesn't drop to zero between sounds.
      setState({ recLevel: Math.max(peak, getState().recLevel * 0.92) });
      raf = requestAnimationFrame(tick);
      if (take) take.raf = raf;
    };
    raf = requestAnimationFrame(tick);
  } catch {
    meter = null;
  }
  const cap = setTimeout(() => stopRecording(), MAX_SECONDS * 1000);
  take = { recorder, stream, inst, meter, cap, raf };
  recorder.onstop = async () => {
    const t = take;
    take = null;
    if (t) release(t);
    setState({ recording: false, recLevel: 0 });
    const data = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer();
    if (!data.byteLength) return setState({ status: 'NOTHING RECORDED' });
    const id = `user:${Date.now().toString(36)}:rec`;
    try {
      await addUserSample(id, data);
    } catch {
      setState({ status: 'RECORDING COULD NOT BE DECODED' });
      return;
    }
    await saveSample(id, data).catch(() => {});
    const n = Object.values(getState().project.samples).filter((m) => m.name.startsWith('REC')).length + 1;
    const target = t?.inst ?? inst;
    commit((d) => {
      d.samples[id] = { name: `REC ${n}`, builtin: false };
      const i = d.instruments[target];
      if (i) {
        i.type = 'SAMPLER';
        i.sampler = { ...i.sampler, sample: id, start: 0, length: 0xff };
      }
    });
    setState({ status: `RECORDED REC ${n} INTO INSTRUMENT ${target.toString(16).toUpperCase().padStart(2, '0')}` });
  };
  recorder.start();
  recStartedAt = Date.now();
  setState({ recording: true, status: `RECORDING INTO ${inst.toString(16).toUpperCase().padStart(2, '0')} · MAX ${MAX_SECONDS} S` });
}

export function stopRecording() {
  if (take && take.recorder.state !== 'inactive') take.recorder.stop();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!take) return;
    release(take);
    take = null;
  });
}
