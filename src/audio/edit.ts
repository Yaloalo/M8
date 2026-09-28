/**
 * The M8 sample editor's processes. Each works on a selection given as fractions of the
 * buffer and returns a new buffer; the original is never touched, so an edit can always be
 * undone by pointing the instrument back at the old sample.
 */

export type SampleOp =
  | 'CROP'
  | 'DELETE'
  | 'DUPLICATE'
  | 'NORMALIZE'
  | 'SILENCE'
  | 'REVERSE'
  | 'INVERT'
  | 'FADE IN'
  | 'FADE OUT'
  | 'MONO'
  | 'DOWNSAMPLE'
  | '8-BIT';

export const SAMPLE_OPS: SampleOp[] = [
  'CROP',
  'DELETE',
  'DUPLICATE',
  'NORMALIZE',
  'SILENCE',
  'REVERSE',
  'INVERT',
  'FADE IN',
  'FADE OUT',
  'MONO',
  'DOWNSAMPLE',
  '8-BIT',
];

function make(channels: number, length: number, sampleRate: number) {
  return new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, length), sampleRate });
}

function copy(buf: AudioBuffer) {
  const out = make(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch), ch);
  return out;
}

export function processSample(buf: AudioBuffer, op: SampleOp, from: number, to: number): AudioBuffer {
  const n = buf.length;
  const clampF = (f: number) => (Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0);
  let a = Math.floor(clampF(Math.min(from, to)) * n);
  let b = Math.ceil(clampF(Math.max(from, to)) * n);
  if (b - a < 1) {
    // An empty selection means the whole sample.
    a = 0;
    b = n;
  }
  const chs = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const len = b - a;

  switch (op) {
    case 'CROP': {
      const out = make(chs, len, sr);
      for (let ch = 0; ch < chs; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(a, b), ch);
      return out;
    }
    case 'DELETE': {
      if (len >= n) return make(chs, 1, sr);
      const out = make(chs, n - len, sr);
      for (let ch = 0; ch < chs; ch++) {
        const src = buf.getChannelData(ch);
        const dst = out.getChannelData(ch);
        dst.set(src.subarray(0, a), 0);
        dst.set(src.subarray(b), a);
      }
      return out;
    }
    case 'DUPLICATE': {
      const out = make(chs, n + len, sr);
      for (let ch = 0; ch < chs; ch++) {
        const src = buf.getChannelData(ch);
        const dst = out.getChannelData(ch);
        dst.set(src.subarray(0, b), 0);
        dst.set(src.subarray(a, b), b);
        dst.set(src.subarray(b), b + len);
      }
      return out;
    }
    case 'MONO': {
      const out = make(1, n, sr);
      const dst = out.getChannelData(0);
      for (let ch = 0; ch < chs; ch++) {
        const src = buf.getChannelData(ch);
        for (let i = 0; i < n; i++) dst[i] += src[i] / chs;
      }
      return out;
    }
    case 'DOWNSAMPLE': {
      // Halve the rate: average pairs and keep the playback rate at half, so pitch holds.
      const m = Math.max(1, Math.floor(n / 2));
      const out = make(chs, m, Math.max(3000, Math.round(sr / 2)));
      for (let ch = 0; ch < chs; ch++) {
        const src = buf.getChannelData(ch);
        const dst = out.getChannelData(ch);
        for (let i = 0; i < m; i++) dst[i] = (src[2 * i] + (src[2 * i + 1] ?? src[2 * i])) / 2;
      }
      return out;
    }
  }

  // The remaining processes change the selection in place on a copy.
  const out = copy(buf);
  let peak = 0;
  if (op === 'NORMALIZE') {
    for (let ch = 0; ch < chs; ch++) {
      const d = out.getChannelData(ch);
      for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
  }
  for (let ch = 0; ch < chs; ch++) {
    const d = out.getChannelData(ch);
    switch (op) {
      case 'NORMALIZE': {
        const g = peak > 1e-6 ? 0.99 / peak : 1;
        for (let i = a; i < b; i++) d[i] *= g;
        break;
      }
      case 'SILENCE':
        d.fill(0, a, b);
        break;
      case 'REVERSE':
        d.subarray(a, b).reverse();
        break;
      case 'INVERT':
        for (let i = a; i < b; i++) d[i] = -d[i];
        break;
      case 'FADE IN':
        for (let i = a; i < b; i++) d[i] *= (i - a) / len;
        break;
      case 'FADE OUT':
        for (let i = a; i < b; i++) d[i] *= 1 - (i - a) / len;
        break;
      case '8-BIT':
        for (let i = a; i < b; i++) d[i] = Math.round(d[i] * 127) / 127;
        break;
    }
  }
  return out;
}
