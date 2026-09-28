/** The send effects: reverb (with freeze), chorus and delay, each returning into the mix bus. */
import { volGain } from './mappings';

export const FREEZE_LOOP = 1.2;

export class SendEffects {
  readonly revIn: GainNode;
  readonly revGate: GainNode;
  readonly convolver: ConvolverNode;
  readonly revTap: GainNode;
  readonly revRet: GainNode;
  /** XRM/XRF: a short modulated delay on the reverb return (a slow shimmer); 0 depth = none. */
  readonly revMod: DelayNode;
  readonly revLfo: OscillatorNode;
  readonly revLfoGain: GainNode;
  readonly frzCap: GainNode;
  readonly frzFb: GainNode;
  readonly frzOut: GainNode;
  readonly choIn: GainNode;
  readonly choLfo: OscillatorNode;
  readonly choDepthL: GainNode;
  readonly choDepthR: GainNode;
  readonly choPanL: StereoPannerNode;
  readonly choPanR: StereoPannerNode;
  readonly choRet: GainNode;
  readonly choRev: GainNode;
  readonly delIn: GainNode;
  readonly delL: DelayNode;
  readonly delR: DelayNode;
  readonly fbL: GainNode;
  readonly fbR: GainNode;
  readonly delPanL: StereoPannerNode;
  readonly delPanR: StereoPannerNode;
  readonly delRet: GainNode;
  readonly delRev: GainNode;
  private frozen = false;

  constructor(
    readonly ctx: BaseAudioContext,
    sum: AudioNode,
  ) {
    const c = ctx;
    const gain = (v = 1) => {
      const g = c.createGain();
      g.gain.value = v;
      return g;
    };
    const panner = (v: number) => {
      const p = c.createStereoPanner();
      p.pan.value = v;
      return p;
    };

    // Reverb, with a freeze loop: XRZ captures a slice of the tail into a delay line that
    // feeds itself while the input is gated off.
    this.revIn = gain();
    this.revGate = gain();
    this.convolver = c.createConvolver();
    this.revTap = gain();
    this.revRet = gain(volGain(0xc0));
    this.revMod = c.createDelay(0.05);
    this.revMod.delayTime.value = 0;
    this.revLfo = c.createOscillator();
    this.revLfo.frequency.value = 0.5;
    this.revLfoGain = gain(0);
    this.revLfo.connect(this.revLfoGain).connect(this.revMod.delayTime);
    this.revLfo.start(0);
    this.revIn.connect(this.revGate).connect(this.convolver).connect(this.revTap).connect(this.revMod).connect(this.revRet);
    this.revRet.connect(sum);
    this.frzCap = gain(0);
    this.frzFb = gain(0);
    this.frzOut = gain(0);
    const frzLine = c.createDelay(2);
    frzLine.delayTime.value = FREEZE_LOOP;
    this.convolver.connect(this.frzCap).connect(frzLine);
    frzLine.connect(this.frzFb).connect(frzLine);
    frzLine.connect(this.frzOut).connect(this.revRet);

    // Chorus: two modulated delay lines in antiphase, spread by panners.
    this.choIn = gain();
    const dL = c.createDelay(0.1);
    const dR = c.createDelay(0.1);
    dL.delayTime.value = 0.012;
    dR.delayTime.value = 0.016;
    this.choLfo = c.createOscillator();
    this.choDepthL = gain(0.002);
    this.choDepthR = gain(-0.002);
    this.choLfo.connect(this.choDepthL).connect(dL.delayTime);
    this.choLfo.connect(this.choDepthR).connect(dR.delayTime);
    this.choLfo.start(0);
    this.choPanL = panner(-1);
    this.choPanR = panner(1);
    const choOut = gain();
    this.choIn.connect(dL).connect(this.choPanL).connect(choOut);
    this.choIn.connect(dR).connect(this.choPanR).connect(choOut);
    this.choRet = gain(volGain(0xc0));
    this.choRev = gain(0);
    choOut.connect(this.choRet).connect(sum);
    choOut.connect(this.choRev).connect(this.revIn);

    // Delay: independent left/right lines with damped feedback.
    this.delIn = gain();
    this.delL = c.createDelay(5);
    this.delR = c.createDelay(5);
    this.fbL = gain(0.4);
    this.fbR = gain(0.4);
    const lpL = c.createBiquadFilter();
    const lpR = c.createBiquadFilter();
    lpL.frequency.value = lpR.frequency.value = 6000;
    this.delL.connect(this.fbL).connect(lpL).connect(this.delL);
    this.delR.connect(this.fbR).connect(lpR).connect(this.delR);
    this.delPanL = panner(-1);
    this.delPanR = panner(1);
    const delOut = gain();
    this.delIn.connect(this.delL).connect(this.delPanL).connect(delOut);
    this.delIn.connect(this.delR).connect(this.delPanR).connect(delOut);
    this.delRet = gain(volGain(0xc0));
    this.delRev = gain(0);
    delOut.connect(this.delRet).connect(sum);
    delOut.connect(this.delRev).connect(this.revIn);
  }

  buildImpulse(size: number, damp: number, width: number) {
    const sr = this.ctx.sampleRate;
    const seconds = 0.3 + (size / 255) * 5.5;
    const full = Math.floor(sr * seconds);
    // The last fifth of the tail is below −48 dB: dropping it saves a fifth of the
    // convolution without an audible change.
    const len = Math.floor(full * 0.8);
    const buf = this.ctx.createBuffer(2, len, sr);
    let s = 0x2545f491;
    const rnd = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) / 4294967296) * 2 - 1;
    };
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const w = width / 255;
    let lpL = 0;
    let lpR = 0;
    for (let i = 0; i < len; i++) {
      const t = i / full;
      const decay = Math.exp(-6.9 * t);
      // Damping closes a one-pole low-pass as the tail goes on, like air absorption.
      const k = 1 - (damp / 255) * 0.97 * t;
      lpL += (rnd() - lpL) * k;
      lpR += (rnd() - lpR) * k;
      L[i] = lpL * decay;
      R[i] = (w * lpR + (1 - w) * lpL) * decay;
    }
    this.convolver.buffer = buf;
  }

  setFreeze(time: number, on: boolean) {
    if (on === this.frozen) return;
    this.frozen = on;
    const ramp = (p: AudioParam, v: number, at: number, dur = 0.02) => {
      p.setValueAtTime(p.value, at);
      p.linearRampToValueAtTime(v, at + dur);
    };
    for (const p of [this.revGate.gain, this.frzCap.gain, this.frzFb.gain, this.frzOut.gain, this.revTap.gain]) {
      p.cancelScheduledValues(time);
    }
    if (on) {
      // Capture one loop of tail, then let the loop feed itself in place of the reverb.
      ramp(this.revGate.gain, 0, time);
      this.frzCap.gain.setValueAtTime(1, time);
      this.frzCap.gain.setValueAtTime(0, time + FREEZE_LOOP);
      this.frzFb.gain.setValueAtTime(0, time);
      this.frzFb.gain.setValueAtTime(0.985, time + FREEZE_LOOP);
      ramp(this.frzOut.gain, 1, time + FREEZE_LOOP - 0.05, 0.05);
      ramp(this.revTap.gain, 0, time + FREEZE_LOOP - 0.05, 0.05);
    } else {
      ramp(this.revGate.gain, 1, time);
      ramp(this.frzFb.gain, 0, time, 0.3);
      ramp(this.frzOut.gain, 0, time, 0.3);
      ramp(this.revTap.gain, 1, time, 0.05);
      this.frzCap.gain.setValueAtTime(0, time);
    }
  }
}
