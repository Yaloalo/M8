/**
 * Built-in drum and tone samples, synthesised offline at startup so the app ships no audio
 * files and the sampler works on first launch without a network.
 */

export const BUILTIN_SAMPLES: { id: string; name: string }[] = [
  { id: 'builtin:kick', name: 'KICK' },
  { id: 'builtin:snare', name: 'SNARE' },
  { id: 'builtin:hat', name: 'HAT' },
  { id: 'builtin:openhat', name: 'OPENHAT' },
  { id: 'builtin:clap', name: 'CLAP' },
  { id: 'builtin:tom', name: 'TOM' },
  { id: 'builtin:rim', name: 'RIM' },
  { id: 'builtin:cowbell', name: 'COWBELL' },
  { id: 'builtin:bass', name: 'BASS' },
  { id: 'builtin:stab', name: 'STAB' },
  { id: 'builtin:wavetable', name: 'WTABLE' },
];

/** Deterministic noise, so every launch renders identical samples. */
function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed = 1) {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < d.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  return buf;
}

type Voice = (ctx: OfflineAudioContext, out: AudioNode) => void;

function env(ctx: BaseAudioContext, peak: number, attack: number, decay: number, t0 = 0) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  return g;
}

function noise(ctx: OfflineAudioContext, seconds: number, seed: number) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seconds, seed);
  src.start(0);
  return src;
}

const VOICES: Record<string, { seconds: number; voice: Voice }> = {
  'builtin:kick': {
    seconds: 0.8,
    voice: (ctx, out) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(160, 0);
      o.frequency.exponentialRampToValueAtTime(48, 0.12);
      o.frequency.exponentialRampToValueAtTime(40, 0.6);
      const g = env(ctx, 1, 0.002, 0.6);
      o.connect(g).connect(out);
      o.start(0);
      const click = noise(ctx, 0.02, 7);
      const cg = env(ctx, 0.35, 0.0005, 0.012);
      click.connect(cg).connect(out);
    },
  },
  'builtin:snare': {
    seconds: 0.5,
    voice: (ctx, out) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(240, 0);
      o.frequency.exponentialRampToValueAtTime(170, 0.08);
      o.connect(env(ctx, 0.6, 0.001, 0.12)).connect(out);
      o.start(0);
      const n = noise(ctx, 0.5, 11);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;
      n.connect(hp).connect(env(ctx, 0.7, 0.001, 0.25)).connect(out);
    },
  },
  'builtin:hat': {
    seconds: 0.15,
    voice: (ctx, out) => {
      const n = noise(ctx, 0.15, 23);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      n.connect(hp).connect(env(ctx, 0.7, 0.0005, 0.05)).connect(out);
    },
  },
  'builtin:openhat': {
    seconds: 0.7,
    voice: (ctx, out) => {
      const n = noise(ctx, 0.7, 29);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6500;
      n.connect(hp).connect(env(ctx, 0.6, 0.001, 0.55)).connect(out);
    },
  },
  'builtin:clap': {
    seconds: 0.5,
    voice: (ctx, out) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 1.2;
      bp.connect(out);
      [0, 0.011, 0.022, 0.034].forEach((t, i) => {
        const n = noise(ctx, 0.5, 31 + i);
        const last = i === 3;
        n.connect(env(ctx, last ? 1 : 0.8, 0.0005, last ? 0.3 : 0.01, t)).connect(bp);
      });
    },
  },
  'builtin:tom': {
    seconds: 0.7,
    voice: (ctx, out) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(190, 0);
      o.frequency.exponentialRampToValueAtTime(110, 0.3);
      o.connect(env(ctx, 0.9, 0.002, 0.5)).connect(out);
      o.start(0);
    },
  },
  'builtin:rim': {
    seconds: 0.12,
    voice: (ctx, out) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 1700;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2000;
      bp.Q.value = 4;
      o.connect(bp).connect(env(ctx, 0.8, 0.0005, 0.035)).connect(out);
      o.start(0);
    },
  },
  'builtin:cowbell': {
    seconds: 0.5,
    voice: (ctx, out) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 800;
      bp.Q.value = 2;
      const g = env(ctx, 0.5, 0.001, 0.35);
      bp.connect(g).connect(out);
      for (const f of [540, 800]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        o.connect(bp);
        o.start(0);
      }
    },
  },
  'builtin:bass': {
    seconds: 1,
    voice: (ctx, out) => {
      // Steady saw at C-4 (261.63 Hz) so the sampler's loop modes have something to loop.
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 261.6256;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.5, 0.005);
      g.gain.setValueAtTime(0.5, 0.97);
      g.gain.linearRampToValueAtTime(0, 1);
      o.connect(lp).connect(g).connect(out);
      o.start(0);
    },
  },
  'builtin:stab': {
    seconds: 0.9,
    voice: (ctx, out) => {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(5000, 0);
      lp.frequency.exponentialRampToValueAtTime(700, 0.4);
      const g = env(ctx, 0.35, 0.003, 0.7);
      lp.connect(g).connect(out);
      // C minor 7 at C-4.
      for (const semi of [0, 3, 7, 10]) {
        for (const det of [-7, 7]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = 261.6256 * 2 ** (semi / 12);
          o.detune.value = det;
          o.connect(lp);
          o.start(0);
        }
      }
    },
  },
};

/**
 * Level every built-in to the same loudness of its loudest 50 ms (−7 dBFS RMS), so a hat
 * and a kick sit together at the same velocity. Peaks that would pass −0.5 dBFS are
 * rounded off with a soft clip rather than turning the whole sample down.
 */
function normalise(buf: AudioBuffer, hitDb = -7): AudioBuffer {
  const W = Math.max(1, Math.floor(buf.sampleRate * 0.05));
  let best = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i += Math.floor(W / 2) || 1) {
      let a = 0;
      const end = Math.min(d.length, i + W);
      for (let k = i; k < end; k++) a += d[k] * d[k];
      best = Math.max(best, a / W);
    }
  }
  if (best <= 0) return buf;
  const k = 10 ** (hitDb / 20) / Math.sqrt(best);
  const ceil = 0.94;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const x = d[i] * k;
      d[i] = Math.abs(x) < 0.7 ? x : Math.sign(x) * (0.7 + (ceil - 0.7) * Math.tanh((Math.abs(x) - 0.7) / (ceil - 0.7)));
    }
  }
  return buf;
}

/**
 * A wave table for the sampler's WAVETABLE mode: 64 single cycles of 2048 samples each,
 * morphing sine → saw → square → narrow pulse. Built additively (the first three) so the
 * cycles stay clean when pitched up.
 */
const WT_FRAME = 2048;
const WT_COUNT = 64;
function wavetableSample(sampleRate: number): AudioBuffer {
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const buf = ctx.createBuffer(1, WT_FRAME * WT_COUNT, sampleRate);
  const d = buf.getChannelData(0);
  const cycle = new Float32Array(WT_FRAME);
  const sines = Array.from({ length: 40 }, (_, k) => {
    const s = new Float32Array(WT_FRAME);
    for (let n = 0; n < WT_FRAME; n++) s[n] = Math.sin((2 * Math.PI * (k + 1) * n) / WT_FRAME);
    return s;
  });
  for (let f = 0; f < WT_COUNT; f++) {
    const x = f / (WT_COUNT - 1);
    cycle.fill(0);
    if (x < 2 / 3) {
      // Sine → saw (first third), then saw → square (second third) by fading even partials.
      const a = Math.min(1, x * 3);
      const b = Math.max(0, x * 3 - 1);
      sines.forEach((s, i) => {
        const k = i + 1;
        const amp = k === 1 ? 1 : (a / k) * (k % 2 ? 1 : 1 - b);
        if (amp) for (let n = 0; n < WT_FRAME; n++) cycle[n] += amp * s[n];
      });
    } else {
      // Square → 10 % pulse.
      const duty = 0.5 - 0.4 * ((x - 2 / 3) * 3);
      let mean = 0;
      for (let n = 0; n < WT_FRAME; n++) mean += cycle[n] = n / WT_FRAME < duty ? 1 : -1;
      mean /= WT_FRAME;
      for (let n = 0; n < WT_FRAME; n++) cycle[n] -= mean;
    }
    let peak = 0;
    for (const v of cycle) peak = Math.max(peak, Math.abs(v));
    for (let n = 0; n < WT_FRAME; n++) d[f * WT_FRAME + n] = (cycle[n] / (peak || 1)) * 0.8;
  }
  return buf;
}

export async function renderBuiltins(sampleRate: number): Promise<Map<string, AudioBuffer>> {
  const map = new Map<string, AudioBuffer>();
  map.set('builtin:wavetable', wavetableSample(sampleRate));
  await Promise.all(
    BUILTIN_SAMPLES.filter(({ id }) => id !== 'builtin:wavetable').map(async ({ id }) => {
      const spec = VOICES[id];
      const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * spec.seconds), sampleRate);
      spec.voice(ctx, ctx.destination);
      map.set(id, normalise(await ctx.startRendering()));
    }),
  );
  return map;
}

export function decodeSample(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // decodeAudioData detaches its input; copy so the caller can still persist the bytes.
  return ctx.decodeAudioData(data.slice(0));
}
