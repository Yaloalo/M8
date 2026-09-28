import { noteFrequency } from '../core/format';
import { toSigned } from '../core/fx';
import type { Output, Trigger, VoiceParam } from '../core/sequencer';
import { EQ_SLOTS, TRACKS, WAV_FILTER_NEAREST, isWavFilter, type Eq, type Instrument, type Mod, type ModDest, type Project } from '../core/types';
import { bandNeutral, buildEq, eqActive, eqDb, eqHz, eqQ, eqShape, safeEq } from './eq';
import { SendEffects } from './effects';
import { buildFilter, cutoffTargets, resTargets, setCutoff, setRes, type FilterHandle } from './filter';
import { fmSources } from './fm';
import {
  LIMIT_CURVES,
  driveGain,
  hold,
  panValue,
  revModBase,
  revModDepth,
  revModHz,
  send,
  volGain,
} from './mappings';
import { LfoOscillators, lfoCurve, lfoHz, oscHz, scheduleEnvelope, startValue, trigMatches } from './mods';
import { byte, fin, guard, safeInstrument } from './safety';
import { SampleBuffers, samplerSources, type OscPhase } from './sampler';
import { shiftGains, subOsc } from './hyper';
import type { FreeLfo, SourceKit, TrackNodes, Voice } from './voice';
import { AXIS_KEY, WaveCache, isAxis, isFilterAxis, wavBank, wavWave, type WavAxis, type WavHandle } from './waves';

export type TrackPerformParam = 'CUT' | 'VOL' | 'PAN' | 'REV' | 'DEL';

export class AudioEngine implements Output {
  readonly analyser: AnalyserNode;
  readonly trackAnalysers: AnalyserNode[];

  private tracks: TrackNodes[];
  private voices: (Voice | null)[] = Array.from({ length: TRACKS }, () => null);
  private live = new Set<Voice>();
  private waves: WaveCache;
  private bufs: SampleBuffers;
  private lfos: LfoOscillators;
  private fx: SendEffects;
  private noise: AudioBuffer;
  private midiOut: MIDIOutput | null = null;
  private midiPrograms = new Map<number, number>();
  private tickDur = 60 / (120 * 24);
  private last: Record<string, number> = {};
  private levelBuf = new Float32Array(256);
  /** OSC play mode keeps the sample's phase running across notes, per track. */
  private oscPhase: OscPhase[] = Array.from({ length: TRACKS }, () => null);

  private sum: GainNode;
  /** The EQ bank, sanitised; re-read only when the project's bank object changes. */
  private eqBank: Eq[] = [];
  private eqBankRef: unknown = null;
  /** Main EQ: the chain between the mix bus and the DJ filter, rebuilt only when its shape changes. */
  private mainEq: { nodes: AudioNode[]; biquads: (BiquadFilterNode | null)[]; input: AudioNode; output: AudioNode } | null = null;
  private mainEqShape = '';
  private mainEqKey = '';
  /** EQM: a slot chosen by command, until the mixer's MAIN EQ is edited. */
  private eqmOverride: number | null = null;
  private lastMixerEq: number | null | undefined = undefined;
  private djLow: BiquadFilterNode;
  private djBand: BiquadFilterNode;
  private djHigh: BiquadFilterNode;
  private djType = 0;
  private audible: boolean[] = Array.from({ length: TRACKS }, () => true);
  private trackVol: number[] = Array.from({ length: TRACKS }, () => 0xe0);
  private freeLfos = new Map<string, FreeLfo>();
  private reverbSettings = { size: 0xa0, damp: 0x80, width: 0xff };
  private delaySettings = { timeL: 0x12, timeR: 0x18 };
  private limitDrive: GainNode;
  private masterGain: GainNode;

  constructor(
    readonly ctx: BaseAudioContext,
    private samples: Map<string, AudioBuffer>,
  ) {
    const c = ctx;
    this.waves = new WaveCache(c);
    this.bufs = new SampleBuffers(c);
    this.lfos = new LfoOscillators(c);
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

    this.sum = gain();
    this.djLow = c.createBiquadFilter();
    this.djLow.type = 'lowpass';
    this.djLow.frequency.value = c.sampleRate / 2 - 100;
    // A peaking band at 0 dB is transparent, so band-stop modes need no node-type switch
    // and stay sample-accurately schedulable.
    this.djBand = c.createBiquadFilter();
    this.djBand.type = 'peaking';
    this.djBand.gain.value = 0;
    this.djHigh = c.createBiquadFilter();
    this.djHigh.type = 'highpass';
    this.djHigh.frequency.value = 10;
    this.limitDrive = gain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -1;
    comp.knee.value = 0;
    comp.ratio.value = 20;
    comp.attack.value = 0.002;
    comp.release.value = 0.1;
    this.masterGain = gain(volGain(0xe0));
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 1024;
    // Main EQ sits before the DJ filter and the limiter, as in the M8 mixer; with no active
    // slot the mix goes straight through.
    this.sum.connect(this.djLow);
    this.djLow.connect(this.djBand).connect(this.djHigh).connect(this.limitDrive).connect(comp);
    // Brick wall: the compressor catches most peaks, the curve guarantees the rest. It is
    // linear below 0.7 and saturates towards 0.95, never above, so nothing clips.
    const wall = c.createWaveShaper();
    const curve = new Float32Array(4096);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      const a = Math.abs(x);
      curve[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.25 * Math.tanh((a - 0.7) / 0.25));
    }
    wall.curve = curve;
    wall.oversample = 'none';
    const out = comp.connect(this.masterGain).connect(wall);
    if (typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext) out.connect(c.destination);
    else out.connect(this.analyser).connect(c.destination);

    // Reverb (with freeze), chorus and delay, returning into the mix bus.
    this.fx = new SendEffects(c, this.sum);

    // Every track has its own send gains, so muting a track also silences what it feeds
    // into the effects.
    const offline = typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext;
    this.tracks = Array.from({ length: TRACKS }, () => {
      const bus = gain(volGain(0xe0));
      const analyser = c.createAnalyser();
      analyser.fftSize = 256;
      const low = c.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = c.sampleRate / 2 - 100;
      const high = c.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 10;
      const pGain = gain(1);
      const pPan = panner(0);
      const pRev = gain(0);
      const pDel = gain(0);
      if (offline) {
        // A render needs neither meters nor the perform screen: keep its graph lean.
        bus.connect(this.sum);
      } else {
        bus.connect(low).connect(high).connect(pGain).connect(pPan).connect(analyser).connect(this.sum);
        pPan.connect(pRev).connect(this.fx.revIn);
        pPan.connect(pDel).connect(this.fx.delIn);
      }
      const cho = gain(volGain(0xe0));
      const del = gain(volGain(0xe0));
      const rev = gain(volGain(0xe0));
      cho.connect(this.fx.choIn);
      del.connect(this.fx.delIn);
      rev.connect(this.fx.revIn);
      return { bus, analyser, cho, del, rev, perf: { low, high, gain: pGain, pan: pPan, rev: pRev, del: pDel } };
    });
    this.trackAnalysers = this.tracks.map((t) => t.analyser);

    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 0x9e3779b9;
    for (let i = 0; i < d.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
    }
    this.fx.buildImpulse(0xa0, 0x80, 0xff);
  }

  // ---------------------------------------------------------------- configuration

  setSamples(map: Map<string, AudioBuffer>) {
    this.samples = map;
  }

  addSample(id: string, buffer: AudioBuffer) {
    this.samples.set(id, buffer);
  }

  setMidiOutput(output: MIDIOutput | null) {
    this.midiOut = output;
    this.midiPrograms.clear();
  }

  /** Cheap to call on every edit: only changed values touch the graph. */
  setProject(p: Project, tickDur: number) {
    guard('setProject', () => this.applyProject(p, tickDur));
  }

  private applyProject(p: Project, tickDur: number) {
    this.tickDur = fin(tickDur, this.tickDur, 1e-4, 1);
    const now = this.ctx.currentTime;
    const set = (key: string, raw: number, param: AudioParam | AudioParam[], map: (v: number) => number) => {
      const v = byte(raw, 0);
      if (this.last[key] === v) return;
      this.last[key] = v;
      const x = map(v);
      if (!Number.isFinite(x)) return;
      for (const pr of Array.isArray(param) ? param : [param]) pr.setTargetAtTime(x, now, 0.015);
    };
    const m = p.mixer;
    const anySolo = m.solo.some(Boolean);
    for (let t = 0; t < TRACKS; t++) {
      this.audible[t] = !m.mute[t] && (!anySolo || m.solo[t]);
      const vt = byte(m.tracks?.[t], 0xe0);
      if (this.last[`vt${t}`] !== vt) {
        this.last[`vt${t}`] = vt;
        this.trackVol[t] = vt;
      }
      this.applyTrack(t, now, true);
    }
    const djType = Math.round(fin(m.djType, 0, 0, 2));
    if (this.last.djType !== djType) {
      this.last.djType = djType;
      this.djType = djType;
      this.last.djf = -1;
    }
    set('cho', m.cho, this.fx.choRet.gain, volGain);
    set('del', m.del, this.fx.delRet.gain, volGain);
    set('rev', m.rev, this.fx.revRet.gain, volGain);
    set('master', m.master, this.masterGain.gain, volGain);
    set('limit', m.limit, this.limitDrive.gain, (v) => 2 ** ((v - 0x40) / 64));
    if (p.eqs !== this.eqBankRef) {
      this.eqBankRef = p.eqs;
      this.eqBank = Array.from({ length: EQ_SLOTS }, (_, k) => safeEq(Array.isArray(p.eqs) ? p.eqs[k] : undefined));
    }
    const mixerEq = typeof m.eq === 'number' && Number.isFinite(m.eq) ? Math.round(fin(m.eq, 0, 0, EQ_SLOTS - 1)) : null;
    if (mixerEq !== this.lastMixerEq) {
      // Editing MAIN EQ in the mixer takes over from an earlier EQM command.
      this.lastMixerEq = mixerEq;
      this.eqmOverride = null;
    }
    this.applyMainEq(now);
    const djf = byte(m.djf, 0x80);
    const djRes = byte(m.djfRes, 0x30);
    if (this.last.djf !== djf || this.last.djfRes !== djRes) {
      this.last.djf = djf;
      this.last.djfRes = djRes;
      this.djf = djf;
      this.djRes = djRes;
      this.applyDjf(now, true);
    }

    const e = p.effects;
    set('choDepth', e.chorus.depth, [this.fx.choDepthL.gain], (v) => (v / 255) * 0.006);
    set('choDepthR', e.chorus.depth, [this.fx.choDepthR.gain], (v) => -(v / 255) * 0.006);
    set('choRate', e.chorus.rate, this.fx.choLfo.frequency, (v) => 0.05 * 100 ** (v / 255));
    set('choWidth', e.chorus.width, [this.fx.choPanL.pan], (v) => -v / 255);
    set('choWidthR', e.chorus.width, [this.fx.choPanR.pan], (v) => v / 255);
    set('choRev', e.chorus.rev, this.fx.choRev.gain, send);
    const tl = byte(e.delay.timeL, 0x12);
    const tr = byte(e.delay.timeR, 0x18);
    if (this.last.delTL !== tl) this.delaySettings.timeL = this.last.delTL = tl;
    if (this.last.delTR !== tr) this.delaySettings.timeR = this.last.delTR = tr;
    const dkey = this.delaySettings.timeL * 1e9 + this.delaySettings.timeR * 1e5 + Math.round(tickDur * 1e5);
    if (this.last.delKey !== dkey) {
      this.last.delKey = dkey;
      this.applyDelayTimes(now, true);
    }
    set('fb', e.delay.feedback, [this.fx.fbL.gain, this.fx.fbR.gain], (v) => (v / 255) * 0.95);
    set('delWidth', e.delay.width, [this.fx.delPanL.pan], (v) => -v / 255);
    set('delWidthR', e.delay.width, [this.fx.delPanR.pan], (v) => v / 255);
    set('delRev', e.delay.rev, this.fx.delRev.gain, send);
    set('revModBase', e.reverb.modDepth, this.fx.revMod.delayTime, revModBase);
    set('revModDepth', e.reverb.modDepth, this.fx.revLfoGain.gain, revModDepth);
    set('revModFreq', e.reverb.modFreq, this.fx.revLfo.frequency, revModHz);
    const r = { size: byte(e.reverb.size, 0xa0), damp: byte(e.reverb.damp, 0x80), width: byte(e.reverb.width, 0xff) };
    const revKey = r.size * 65536 + r.damp * 256 + r.width;
    if (this.last.revKey !== revKey) {
      this.last.revKey = revKey;
      this.reverbSettings = { ...r };
      this.fx.buildImpulse(r.size, r.damp, r.width);
    }
  }

  private djf = 0x80;
  private djRes = 0x30;

  private applyTrack(t: number, time: number, smooth: boolean) {
    const tn = this.tracks[t];
    const g = this.audible[t] ? volGain(this.trackVol[t]) : 0;
    for (const pr of [tn.bus.gain, tn.cho.gain, tn.del.gain, tn.rev.gain]) {
      if (smooth) pr.setTargetAtTime(g, time, 0.015);
      else pr.setValueAtTime(g, time);
    }
  }

  private applyDelayTimes(time: number, smooth: boolean) {
    const ticks = (v: number) => Math.min(4.9, Math.max(1, v) * this.tickDur);
    for (const [pr, v] of [
      [this.fx.delL.delayTime, this.delaySettings.timeL],
      [this.fx.delR.delayTime, this.delaySettings.timeR],
    ] as const) {
      if (smooth) pr.setTargetAtTime(ticks(v), time, 0.05);
      else pr.setValueAtTime(ticks(v), time);
    }
  }

  /** Per-track output level, 0–1, for meters. */
  levels(): number[] {
    return this.trackAnalysers.map((a) => {
      const buf = this.levelBuf.subarray(0, a.fftSize);
      a.getFloatTimeDomainData(buf);
      let acc = 0;
      for (let i = 0; i < buf.length; i++) acc += buf[i] * buf[i];
      return Math.min(1, Math.sqrt(acc / buf.length) * 3);
    });
  }

  /**
   * DJ filter: 80 is off. Below 80 the low side engages (low-pass, or band-stop for type 2),
   * above 80 the high side (high-pass, or band-stop for type 1).
   */
  private applyDjf(time: number, smooth: boolean) {
    const v = this.djf;
    const nyq = this.ctx.sampleRate / 2 - 100;
    const q = 0.7 + (this.djRes / 255) * 12;
    const lowSide = v < 0x80;
    const highSide = v > 0x80;
    const sweepDown = Math.min(nyq, 20 * 1000 ** (v / 128));
    const sweepUp = Math.min(nyq, 20 * 1000 ** ((v - 128) / 127));
    const bandLow = lowSide && this.djType === 2;
    const bandHigh = highSide && this.djType === 1;
    const band = bandLow || bandHigh;
    const targets: [AudioParam, number][] = [
      [this.djLow.frequency, lowSide && !bandLow ? sweepDown : nyq],
      [this.djLow.Q, lowSide && !bandLow ? q : 0.7],
      [this.djHigh.frequency, highSide && !bandHigh ? sweepUp : 10],
      [this.djHigh.Q, highSide && !bandHigh ? q : 0.7],
      [this.djBand.frequency, band ? (bandLow ? sweepDown : sweepUp) : 1000],
      [this.djBand.Q, band ? 0.5 + q / 4 : 1],
      [this.djBand.gain, band ? -30 : 0],
    ];
    for (const [p, val] of targets) {
      if (smooth) p.setTargetAtTime(val, time, 0.015);
      else p.setValueAtTime(val, time);
    }
  }

  // ---------------------------------------------------------------- Output

  trigger(raw: Trigger) {
    guard('trigger', () => {
      if (!Number.isFinite(raw.time) || !Number.isFinite(raw.note) || raw.track < 0 || raw.track >= TRACKS) return;
      const e: Trigger = {
        ...raw,
        note: fin(raw.note, 60, -24, 151),
        vel: fin(raw.vel, 255, 0, 255),
        cents: fin(raw.cents, 0, -9600, 9600),
        glideFrom: raw.glideFrom == null ? null : fin(raw.glideFrom, raw.note, -24, 151),
        glideTime: fin(raw.glideTime, 0, 0, 30),
        tickDur: fin(raw.tickDur, this.tickDur, 1e-4, 1),
        inst: safeInstrument(raw.inst),
      };
      this.startNote(e);
      this.fireTrigMods(e);
    });
  }

  /** Every other sounding voice whose TRIG mod listens to this note restarts that envelope. */
  private fireTrigMods(e: Trigger) {
    for (const v of this.voices) {
      if (!v || v.trig === e || v.midi || v.released || v.end <= e.time) continue;
      for (const h of v.mods) {
        if (h.kind !== 'ENV' || !h.trig || !trigMatches(h.mod.src, e)) continue;
        h.param.cancelScheduledValues(e.time);
        this.envelope(v, h.param, h.mod, e.time, 0, 1, v.trig.tickDur);
      }
    }
  }

  private startNote(e: Trigger) {
    const prev = this.voices[e.track];
    if (e.legato && prev && !prev.midi && !prev.released && prev.end > e.time + 0.002) {
      // Legato: retune what is sounding; envelopes and sample position carry on.
      const from = prev.noteCents;
      prev.noteCents = (e.note - prev.note) * 100;
      const target = prev.noteCents + e.cents + prev.fine;
      for (const d of prev.detunes) {
        if (e.glideTime > 0) {
          d.setValueAtTime(from + e.cents + prev.fine, e.time);
          d.linearRampToValueAtTime(target, e.time + e.glideTime);
        } else d.setValueAtTime(target, e.time);
      }
      return;
    }
    if (prev?.midi) this.midiNoteOff(prev, e.time);
    else if (prev) this.choke(prev, e.time, 0.004);
    this.voices[e.track] = null;
    const v = e.inst.type === 'MIDIOUT' ? this.midiVoice(e) : this.audioVoice(e);
    this.voices[e.track] = v;
  }

  release(track: number, time: number) {
    guard('release', () => this.releaseNow(track, fin(time, this.ctx.currentTime)));
  }

  private releaseNow(track: number, time: number) {
    const v = this.voices[track];
    if (!v) return;
    v.released = true;
    if (v.midi) {
      this.midiNoteOff(v, time);
      return;
    }
    if (v.volumeAdsr) {
      let end = time;
      for (const h of v.adsr) {
        hold(h.param, time);
        h.param.setTargetAtTime(h.base, time, h.release / 5);
        end = Math.max(end, time + h.release);
      }
      this.stopAt(v, end + 0.02);
    } else {
      for (const h of v.adsr) {
        hold(h.param, time);
        h.param.setTargetAtTime(h.base, time, h.release / 5);
      }
      this.choke(v, time, 0.03);
    }
  }

  kill(track: number, time: number) {
    guard('kill', () => {
      const v = this.voices[track];
      if (!v || !Number.isFinite(time)) return;
      if (v.midi) this.midiNoteOff(v, time);
      else this.choke(v, time, 0.003);
    });
  }

  param(track: number, time: number, p: VoiceParam, raw: number) {
    guard('param', () => {
      if (Number.isFinite(time)) this.setParam(track, time, p, byte(raw, 0x80));
    });
  }

  private setParam(track: number, time: number, p: VoiceParam, val: number) {
    const v = this.voices[track];
    if (!v || v.midi) return;
    switch (p) {
      case 'VOL':
        v.level?.gain.setValueAtTime(volGain(val), time);
        break;
      case 'CUT':
        if (v.filter) setCutoff(v.filter, val, time);
        else if (v.wav?.filter) this.moveAxis(v, 'CUTOFF', val, time);
        break;
      case 'RES':
        if (v.filter) setRes(v.filter, val, time);
        else if (v.wav?.filter) this.moveAxis(v, 'RES', val, time);
        break;
      case 'AMP':
        v.drive?.gain.setValueAtTime(driveGain(val) * (v.plainDrive ? 8 : 1), time);
        break;
      case 'PAN':
        v.pan?.pan.setValueAtTime(panValue(val), time);
        break;
      case 'SCH':
      case 'SDL':
      case 'SRV': {
        if (!v.sends || !v.pan) break;
        let g = v.sends[p];
        if (!g) {
          if (val === 0) break;
          g = v.sends[p] = this.makeSend(v.nodes, v.pan, track, p, 0);
        }
        g.gain.setValueAtTime(send(val), time);
        break;
      }
      case 'SCN':
      case 'WRP':
      case 'SIZ':
        this.moveAxis(v, p === 'SCN' ? 'SCAN' : p === 'WRP' ? 'WARP' : 'SIZE', val, time);
        break;
      case 'FMA':
      case 'FMB':
      case 'FMC':
      case 'FMD': {
        const op = v.ops?.['ABCD'.indexOf(p[2])];
        op?.g.gain.setTargetAtTime((val / 255) * op.full, time, 0.005);
        break;
      }
    }
  }

  /** A Wavsynth bank axis set from a command: moves the bank, or brings one in on the first move. */
  private moveAxis(v: Voice, axis: WavAxis, val: number, time: number) {
    const h = v.wav;
    if (!h) return;
    const key = AXIS_KEY[axis];
    if (h.bank?.axis === axis) {
      h.bank.pos.offset.setValueAtTime(val / 255, time);
      h.vals[key] = val;
    } else if (val !== h.vals[key] || h.bank) {
      // First move on this axis: bring in a bank starting at the new value.
      h.vals[key] = val;
      wavBank(this.ctx, this.waves, v, axis, time);
    }
  }

  pitch(track: number, time: number, rawCents: number, rawGlide: number) {
    guard('pitch', () => {
      if (Number.isFinite(time)) this.setPitch(track, time, fin(rawCents, 0, -9600, 9600), fin(rawGlide, 0, 0, 30));
    });
  }

  private setPitch(track: number, time: number, cents: number, glide: number) {
    const v = this.voices[track];
    if (!v || v.midi) return;
    v.cents = cents;
    const target = cents + v.fine + v.noteCents;
    for (const d of v.detunes) {
      if (glide > 0) d.linearRampToValueAtTime(target, time + glide);
      else d.setValueAtTime(target, time);
    }
  }

  vibrato(track: number, time: number, rawSpeed: number, rawDepth: number) {
    guard('vibrato', () => {
      if (Number.isFinite(time)) this.setVibrato(track, time, fin(rawSpeed, 0, 0, 64), fin(rawDepth, 0, 0, 64));
    });
  }

  private setVibrato(track: number, time: number, speed: number, depth: number) {
    const v = this.voices[track];
    if (!v || v.midi || !v.detunes.length) return;
    if (!speed && !depth) {
      v.vib?.gain.gain.setValueAtTime(0, time);
      return;
    }
    if (!v.vib) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      for (const d of v.detunes) gain.connect(d);
      osc.start(time);
      if (Number.isFinite(v.end)) osc.stop(v.end);
      v.sources.push(osc);
      v.nodes.push(osc, gain);
      v.vib = { osc, gain };
    }
    v.vib.osc.frequency.setValueAtTime(0.5 + speed * 0.77, time);
    v.vib.gain.gain.setValueAtTime(depth * 6.67, time);
  }

  /** Mixer and send-effect commands; they hold until the matching project field is edited. */
  master(time: number, p: string, raw: number) {
    guard('master', () => {
      if (Number.isFinite(time)) this.setMaster(time, p, byte(raw, 0));
    });
  }

  private setMaster(time: number, p: string, v: number) {
    const set = (param: AudioParam, value: number) => param.setValueAtTime(value, time);
    if (/^VT[1-8]$/.test(p)) {
      const t = Number(p[2]) - 1;
      this.trackVol[t] = v;
      this.applyTrack(t, time, false);
      return;
    }
    switch (p) {
      case 'EQM':
        this.eqmOverride = Math.min(EQ_SLOTS - 1, v);
        return this.applyMainEq(time);
      case 'VMV':
        return set(this.masterGain.gain, volGain(v));
      case 'DJF':
      case 'DJC':
        this.djf = v;
        return this.applyDjf(time, false);
      case 'DJR':
        this.djRes = v;
        return this.applyDjf(time, false);
      case 'DJT':
        this.djType = Math.min(2, v);
        return this.applyDjf(time, false);
      case 'VCH':
        return set(this.fx.choRet.gain, volGain(v));
      case 'VDE':
        return set(this.fx.delRet.gain, volGain(v));
      case 'VRE':
        return set(this.fx.revRet.gain, volGain(v));
      case 'XCM':
        set(this.fx.choDepthL.gain, (v / 255) * 0.006);
        return set(this.fx.choDepthR.gain, -(v / 255) * 0.006);
      case 'XCF':
        return set(this.fx.choLfo.frequency, 0.05 * 100 ** (v / 255));
      case 'XCW':
        set(this.fx.choPanL.pan, -v / 255);
        return set(this.fx.choPanR.pan, v / 255);
      case 'XCR':
        return set(this.fx.choRev.gain, send(v));
      case 'XDT':
        // Coarse: each nibble is sixteen ticks.
        this.delaySettings = { timeL: Math.max(1, (v >> 4) * 16), timeR: Math.max(1, (v & 0xf) * 16) };
        return this.applyDelayTimes(time, false);
      case 'XDF':
        set(this.fx.fbL.gain, (v / 255) * 0.95);
        return set(this.fx.fbR.gain, (v / 255) * 0.95);
      case 'XDW':
        set(this.fx.delPanL.pan, -v / 255);
        return set(this.fx.delPanR.pan, v / 255);
      case 'XDR':
        return set(this.fx.delRev.gain, send(v));
      case 'XRS':
      case 'XRD':
      case 'XRW': {
        // A new impulse cannot be scheduled; it applies when the command is processed.
        const r = { ...this.reverbSettings };
        if (p === 'XRS') r.size = v;
        else if (p === 'XRD') r.damp = 255 - v;
        else r.width = v;
        this.reverbSettings = r;
        return this.fx.buildImpulse(r.size, r.damp, r.width);
      }
      case 'XRZ':
        return this.fx.setFreeze(time, v > 0);
      case 'XRM':
        set(this.fx.revMod.delayTime, revModBase(v));
        return set(this.fx.revLfoGain.gain, revModDepth(v));
      case 'XRF':
        return set(this.fx.revLfo.frequency, revModHz(v));
    }
  }

  stopAll(rawTime: number) {
    const time = fin(rawTime, this.ctx.currentTime);
    guard('stopAll', () => this.stopEverything(time));
    this.voices.fill(null);
    this.oscPhase.fill(null);
  }

  private stopEverything(time: number) {
    for (const v of this.live) {
      if (v.midi) this.midiNoteOff(v, time);
      else {
        v.vib?.gain.gain.cancelScheduledValues(time);
        this.choke(v, time, 0.01);
      }
    }
    this.voices.fill(null);
  }

  /**
   * Perform screen: a momentary change on one track, applied now and never saved. CUT is a
   * DJ-style filter (80 off), VOL a gain (80 unity, FF +6 dB), PAN the track's pan, REV and
   * DEL extra sends into the reverb and delay.
   */
  trackPerform(track: number, param: TrackPerformParam, value: number) {
    guard('trackPerform', () => {
      const tn = this.tracks[track];
      if (!tn) return;
      const v = byte(value, 0x80);
      const now = this.ctx.currentTime;
      const nyq = this.ctx.sampleRate / 2 - 100;
      const to = (pr: AudioParam, x: number) => pr.setTargetAtTime(x, now, 0.02);
      switch (param) {
        case 'CUT':
          to(tn.perf.low.frequency, v < 0x80 ? Math.min(nyq, 20 * 1000 ** (v / 128)) : nyq);
          to(tn.perf.high.frequency, v > 0x80 ? Math.min(nyq, 20 * 1000 ** ((v - 128) / 127)) : 10);
          break;
        case 'VOL':
          to(tn.perf.gain.gain, v <= 0x80 ? (v / 128) ** 2 : 1 + (v - 128) / 127);
          break;
        case 'PAN':
          to(tn.perf.pan.pan, panValue(v));
          break;
        case 'REV':
          to(tn.perf.rev.gain, send(v));
          break;
        case 'DEL':
          to(tn.perf.del.gain, send(v));
          break;
      }
    });
  }

  /** Back to neutral: one track, or all of them. */
  trackPerformReset(track?: number) {
    const list = track == null ? [...Array(TRACKS).keys()] : [track];
    for (const t of list) {
      this.trackPerform(t, 'CUT', 0x80);
      this.trackPerform(t, 'VOL', 0x80);
      this.trackPerform(t, 'PAN', 0x80);
      this.trackPerform(t, 'REV', 0);
      this.trackPerform(t, 'DEL', 0);
    }
  }

  /** Audition a note right now, e.g. while typing it in with the sequencer stopped. */
  preview(track: number, inst: Instrument, instId: number, note: number, vel: number) {
    const time = this.ctx.currentTime + 0.005;
    this.trigger({
      track,
      time,
      note,
      vel,
      instId,
      inst,
      cents: 0,
      glideFrom: null,
      glideTime: 0,
      tickDur: this.tickDur,
    });
    const v = this.voices[track];
    if (v && !Number.isFinite(v.end)) this.release(track, time + 0.6);
  }

  // ---------------------------------------------------------------- voice lifecycle

  private choke(v: Voice, time: number, fade: number) {
    if (time >= v.end) return;
    if (v.fade) {
      const g = v.fade.gain;
      // Before any fade has begun the gain is exactly 1, so restate it rather than rely on
      // cancelAndHoldAtTime, which not every engine has.
      if (v.fadeAt == null || time < v.fadeAt) {
        g.cancelScheduledValues(time);
        g.setValueAtTime(1, time);
      } else hold(g, time);
      g.linearRampToValueAtTime(0, time + fade);
      v.fadeAt = Math.min(v.fadeAt ?? Infinity, time);
    }
    this.stopAt(v, time + fade + 0.005);
  }

  private stopAt(v: Voice, time: number) {
    if (time >= v.end) return;
    v.end = time;
    for (const s of v.sources) {
      try {
        s.stop(time);
      } catch {
        // Already ended.
      }
    }
    if (!v.sources.length) this.live.delete(v);
  }

  private cleanup(v: Voice) {
    if (!this.live.has(v)) return;
    this.live.delete(v);
    for (const d of v.detach) d();
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {
        // Not connected.
      }
    }
    if (this.voices[v.track] === v) this.voices[v.track] = null;
  }

  private audioVoice(e: Trigger): Voice | null {
    const c = this.ctx;
    const inst = e.inst;
    const t = e.time;
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];
    const detunes: AudioParam[] = [];
    const mix = c.createGain();
    nodes.push(mix);
    const f0 = noteFrequency(e.note);
    let naturalEnd = Infinity;
    let wavH: WavHandle | null = null;
    let opsH: Voice['ops'] = null;
    let swarmH: Voice['swarm'] = null;

    const osc = (type: OscillatorType | PeriodicWave, freq: number) => {
      const o = c.createOscillator();
      if (type instanceof PeriodicWave) o.setPeriodicWave(type);
      else o.type = type;
      o.frequency.value = Math.min(freq, c.sampleRate / 2);
      o.start(t);
      sources.push(o);
      detunes.push(o.detune);
      nodes.push(o);
      return o;
    };
    const kit: SourceKit = { c, t, f0, mix, sources, detunes, nodes, noise: this.noise, osc };

    switch (inst.type) {
      case 'WAVSYNTH': {
        const w = inst.wav;
        if (w.shape === 'NOISE') {
          const src = c.createBufferSource();
          src.buffer = this.noise;
          src.loop = true;
          src.playbackRate.value = Math.max(0.05, Math.min(16, f0 / noteFrequency(60)));
          sources.push(src);
          detunes.push(src.detune);
          nodes.push(src);
          src.connect(mix);
          src.start(t);
        } else {
          // WAV LP/HP/BP/BS shape the cycle's harmonics instead of filtering the output.
          const wf = isWavFilter(inst.filter) ? inst.filter : null;
          const vals = { scan: w.scan, warp: w.warp, size: w.size, mult: w.mult, cutoff: inst.cutoff, res: inst.res };
          const wave = wavWave(this.waves, w.shape, vals, wf);
          const g = c.createGain();
          g.gain.value = 0.6;
          nodes.push(g);
          osc(wave, f0).connect(g).connect(mix);
          wavH = { plain: g, dest: mix, f0, vals, filter: wf, bank: null };
        }
        break;
      }
      case 'FMSYNTH':
        opsH = fmSources(kit, inst.fm, e.tickDur, this.waves);
        break;
      case 'HYPERSYNTH': {
        const h = inst.hyper;
        // Negative entries are unused slots; an all-empty chord still plays the root. The
        // slot number (not the position among the used ones) decides the SHIFT group.
        const slots = h.chord.slice(0, 6).map((off, slot) => ({ off, slot })).filter((n) => n.off >= 0);
        const used = slots.length ? slots : [{ off: 0, slot: 0 }];
        const chord = used.map((n) => n.off);
        const spread = (h.swarm / 255) * 50;
        const width = h.width / 255;
        const g = c.createGain();
        // Balanced against the other types at default settings (about −16 dB RMS held).
        g.gain.value = 0.84 / Math.sqrt(chord.length * 3);
        nodes.push(g);
        g.connect(mix);
        // One panner per side, shared by every chord note: same sound, a third of the nodes.
        const sides = [-1, 1].map((k) => {
          const p = c.createStereoPanner();
          p.pan.value = k * width;
          nodes.push(p);
          p.connect(g);
          return p;
        });
        // SHIFT: notes 1–3 against 4–6. A group at full goes straight to the shared bus
        // (the usual graph); a faded one gets its own gain and pair of side panners.
        const gains = shiftGains(h.shift);
        const buses: ({ centre: AudioNode; sides: AudioNode[] } | null)[] = [null, null];
        const bus = (grp: number) => {
          if (gains[grp] >= 1) return { centre: g as AudioNode, sides: sides as AudioNode[] };
          if (buses[grp]) return buses[grp];
          const gg = c.createGain();
          gg.gain.value = gains[grp];
          nodes.push(gg);
          gg.connect(g);
          const ps = [-1, 1].map((k) => {
            const p = c.createStereoPanner();
            p.pan.value = k * width;
            nodes.push(p);
            p.connect(gg);
            return p;
          });
          return (buses[grp] = { centre: gg, sides: ps });
        };
        used.forEach(({ off, slot }, i) => {
          const grp = slot < 3 ? 0 : 1;
          if (gains[grp] <= 0) return;
          const b = bus(grp);
          [-1, 0, 1].forEach((k) => {
            const freq = f0 * 2 ** (off / 12 + (k * spread + i * 0.7) / 1200);
            const o = osc(h.shape === 'SQR' ? 'square' : 'sawtooth', freq);
            o.connect(k === 0 ? b.centre : b.sides[k < 0 ? 0 : 1]);
            if (k !== 0) (swarmH ??= []).push({ detune: o.detune, k });
          });
        });
        // SUBOSC: a square one or two octaves below the played note, in the centre. It is
        // one of the voice's detunes, so pitch mods, glide and FIN move it with the chord.
        const sub = subOsc(h.subosc);
        if (sub.level > 0) {
          const sg = c.createGain();
          sg.gain.value = sub.level;
          nodes.push(sg);
          sg.connect(g);
          osc('square', f0 / 2 ** sub.octaves).connect(sg);
        }
        break;
      }
      case 'SAMPLER': {
        const end = samplerSources(kit, this.samplerPositions(e), e.note, e.track, this.samples, this.bufs, this.oscPhase, e.tickDur);
        if (end == null) return null;
        naturalEnd = end;
        break;
      }
      default:
        return null;
    }

    // Filter → drive → limiter → envelope → level → fade → pan → dry and sends.
    let head: AudioNode = mix;
    let filter: FilterHandle | null = null;
    // A WAV type is in the cycle already; with no cycle (NOISE) it is its ordinary type.
    const ft = isWavFilter(inst.filter) ? (wavH?.filter ? 'OFF' : WAV_FILTER_NEAREST[inst.filter]) : inst.filter;
    if (ft !== 'OFF' && !isWavFilter(ft)) {
      filter = buildFilter(c, ft, inst.cutoff, inst.res, nodes);
      head.connect(filter.input);
      head = filter.output;
    }
    const drive = c.createGain();
    // A CLIP limiter at unity drive leaves ordinary levels untouched, so the shaper is
    // skipped there (the master brick wall still guards the mix). An AMP that is raised
    // later on such a voice boosts it without the clip.
    const plain = inst.lim === 'CLIP' && inst.amp <= 0x20 && !inst.mods.some((m) => m.type !== 'OFF' && m.dest === 'AMP');
    drive.gain.value = plain ? driveGain(inst.amp) * 8 : driveGain(inst.amp);
    const shaper = plain ? null : c.createWaveShaper();
    if (shaper) {
      shaper.curve = LIMIT_CURVES[inst.lim] ?? LIMIT_CURVES.CLIP;
      // Oversampling is the costliest part of a voice; it pays only when drive bends hard.
      shaper.oversample = inst.lim === 'CLIP' && inst.amp <= 0x30 ? 'none' : '2x';
    }
    const env = c.createGain();
    const level = c.createGain();
    level.gain.value = volGain(e.vel);
    const fade = c.createGain();
    const pan = c.createStereoPanner();
    pan.pan.value = panValue(inst.pan);
    const dry = c.createGain();
    dry.gain.value = send(inst.dry);
    nodes.push(drive, env, level, fade, pan, dry);
    let tone: AudioNode = head.connect(drive);
    if (shaper) {
      nodes.push(shaper);
      tone = tone.connect(shaper);
    }
    // Instrument EQ from the bank, only built when the slot does something: most voices
    // need no extra nodes. Stereo-only EQs run on the mono voice; one with a LEFT/RIGHT/
    // MID/SIDE band has to sit after the panner, where there are two channels.
    const slot = inst.eq != null ? this.eqBank[inst.eq] : null;
    const eq = eqActive(slot) ? slot : null;
    const stereoOnly = !!eq && eq.bands.every((b) => bandNeutral(b) || b.mode === 'STEREO');
    if (eq && stereoOnly) {
      const chain = buildEq(this.ctx, eq, nodes);
      tone.connect(chain.input);
      tone = chain.output;
    }
    tone.connect(env).connect(level).connect(fade).connect(pan);
    const tn = this.tracks[e.track];
    let post: AudioNode = pan;
    if (eq && !stereoOnly) {
      const chain = buildEq(this.ctx, eq, nodes);
      pan.connect(chain.input);
      post = chain.output;
    }
    post.connect(dry).connect(tn.bus);
    const sends: Voice['sends'] = {};
    for (const [key, v] of [['SCH', inst.cho], ['SDL', inst.del], ['SRV', inst.rev]] as const) {
      if (v > 0) sends[key] = this.makeSend(nodes, post, e.track, key, send(v));
    }

    const fine = inst.fine;
    const startCents = e.cents + fine;
    for (const d of detunes) {
      if (e.glideFrom != null && e.glideTime > 0) {
        d.setValueAtTime((e.glideFrom - e.note) * 100 + startCents, t);
        d.linearRampToValueAtTime(startCents, t + e.glideTime);
      } else d.setValueAtTime(startCents, t);
    }

    const voice: Voice = {
      track: e.track,
      inst,
      start: t,
      end: Infinity,
      sources,
      detunes,
      nodes,
      filter,
      drive,
      env,
      level,
      fade,
      pan,
      sends,
      adsr: [],
      volumeAdsr: false,
      fine,
      note: e.note,
      noteCents: 0,
      released: false,
      vib: null,
      midi: null,
      detach: [],
      mods: [],
      trig: e,
      plainDrive: plain,
      wav: wavH,
      ops: opsH,
      swarm: swarmH,
      cents: e.cents,
    };

    // A mod on a Wavsynth shape parameter needs the crossfade bank from the first sample,
    // and before the pitch mods are wired, so they reach every layer.
    const axisMod = inst.mods.find(
      (m) => m.type !== 'OFF' && m.amt !== 0 && (isAxis(m.dest) || (!!wavH?.filter && isFilterAxis(m.dest))),
    );
    if (axisMod && voice.wav) wavBank(c, this.waves, voice, axisMod.dest as WavAxis, t);

    // Modulation. The first envelope on VOLUME owns the amp envelope; without one the
    // note holds until note-off, the next note, or the end of a one-shot sample.
    let volumeEnv: Mod | undefined;
    const td = e.tickDur;
    inst.mods.forEach((mod, slot) => {
      if (mod.type === 'OFF' || mod.amt === 0) return;
      const amt = toSigned(mod.amt & 0xff) / 127;
      if (mod.type === 'TRACK') {
        // Tracking: note or velocity sets the destination once, at the trigger.
        const x = mod.source === 'VEL' ? e.vel / 255 : Math.max(-1, Math.min(1, (e.note - 60) / 64));
        if (mod.dest === 'VOLUME') {
          const a = Math.abs(amt);
          // VEL with a positive amount makes soft notes quieter; NOTE tilts by pitch.
          const factor = mod.source === 'VEL' ? 1 - a + a * (amt > 0 ? x : 1 - x) : Math.max(0, 1 + amt * x * 0.5);
          level.gain.value = fin(level.gain.value * factor, level.gain.value, 0, 4);
          return;
        }
        const targets = this.modTargets(voice, mod.dest, amt, false);
        if (!targets.length) return;
        const cs = c.createConstantSource();
        cs.offset.value = x;
        cs.start(t);
        sources.push(cs);
        nodes.push(cs);
        for (const [param, scale] of targets) {
          const g = c.createGain();
          g.gain.value = scale;
          nodes.push(g);
          cs.connect(g).connect(param);
        }
        return;
      }
      if (mod.dest === 'VOLUME' && mod.type !== 'LFO' && mod.type !== 'TRIG' && !volumeEnv) {
        volumeEnv = mod;
        const base = amt < 0 ? 1 : 0;
        const end = this.envelope(voice, env.gain, mod, t, base, amt, td);
        if ((mod.type === 'AHD' || mod.type === 'DRUM') && base === 0) naturalEnd = Math.min(naturalEnd, end);
        if (mod.type === 'ADSR') voice.volumeAdsr = true;
        voice.mods.push({ kind: 'ENV', mod, param: env.gain, base, peak: amt, volume: true });
        return;
      }
      const targets = this.modTargets(voice, mod.dest, amt, mod.type === 'LFO');
      if (!targets.length) return;
      if (mod.type === 'LFO' && mod.lfoTrig === 'FREE') {
        // FREE: one oscillator per track and slot keeps running, so the phase carries on
        // from note to note instead of restarting.
        const lfo = this.freeLfo(e.track, slot, mod, t, td).osc;
        const gains = targets.map(([param, scale]) => {
          const g = c.createGain();
          g.gain.value = mod.lfoShape === 'RAMP' ? -scale : scale;
          nodes.push(g);
          lfo.connect(g).connect(param);
          voice.detach.push(() => {
            try {
              lfo.disconnect(g);
            } catch {
              // Already gone.
            }
          });
          return g;
        });
        voice.mods.push({ kind: 'LFO', mod, slot, signal: null, gains, free: true });
        return;
      }
      let signal: AudioScheduledSourceNode;
      let envParam: AudioParam | null = null;
      if (mod.type === 'LFO' && (mod.lfoTrig === 'HOLD' || mod.lfoTrig === 'ONCE')) {
        const cs = c.createConstantSource();
        lfoCurve(cs.offset, mod, t, td, 0);
        signal = cs;
      } else if (mod.type === 'LFO') {
        signal = this.lfos.osc(mod.lfoShape, lfoHz(mod.freq, td), t);
      } else {
        const cs = c.createConstantSource();
        cs.offset.value = 0;
        // A TRIG envelope waits for its source; it fires here only if this note is it.
        if (mod.type !== 'TRIG' || trigMatches(mod.src, e)) this.envelope(voice, cs.offset, mod, t, 0, 1, td);
        envParam = cs.offset;
        signal = cs;
      }
      signal.start(t);
      sources.push(signal);
      nodes.push(signal);
      const gains = targets.map(([param, scale]) => {
        const g = c.createGain();
        // RAMP is an inverted saw on the oscillator paths; the HOLD/ONCE curve is already down.
        const invert = mod.type === 'LFO' && mod.lfoShape === 'RAMP' && mod.lfoTrig !== 'HOLD' && mod.lfoTrig !== 'ONCE';
        g.gain.value = invert ? -scale : scale;
        nodes.push(g);
        signal.connect(g).connect(param);
        return g;
      });
      if (envParam) voice.mods.push({ kind: 'ENV', mod, param: envParam, base: 0, peak: 1, volume: false, trig: mod.type === 'TRIG' });
      else voice.mods.push({ kind: 'LFO', mod, slot, signal, gains, free: false });
    });
    if (!volumeEnv) {
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.002);
    }

    if (Number.isFinite(naturalEnd)) this.stopAt(voice, naturalEnd);
    sources[0].onended = () => this.cleanup(voice);
    this.live.add(voice);
    if (!(c instanceof OfflineAudioContext) && Number.isFinite(voice.end)) {
      // onended can be lost if a node is collected early; never leak a voice.
      setTimeout(() => this.cleanup(voice), (voice.end - c.currentTime) * 1000 + 500);
    }
    return voice;
  }

  private makeSend(nodes: AudioNode[], from: AudioNode, track: number, key: 'SCH' | 'SDL' | 'SRV', level: number) {
    const tn = this.tracks[track];
    const g = this.ctx.createGain();
    g.gain.value = level;
    nodes.push(g);
    from.connect(g).connect(key === 'SCH' ? tn.cho : key === 'SDL' ? tn.del : tn.rev);
    return g;
  }

  /**
   * Main EQ from its slot (EQM override, else the mixer's MAIN EQ). Value changes retune
   * the running biquads, so editing the slot is heard at once; a change of shape (band type,
   * mode, a band switching on or off) rebuilds the chain.
   */
  private applyMainEq(time: number) {
    const slot = this.eqmOverride ?? this.lastMixerEq ?? null;
    const eq = slot != null ? (this.eqBank[slot] ?? null) : null;
    const shape = eqShape(eq);
    const key = eq ? JSON.stringify(eq) : '';
    if (shape !== this.mainEqShape) {
      this.mainEqShape = shape;
      this.sum.disconnect();
      if (this.mainEq) for (const n of this.mainEq.nodes) n.disconnect();
      this.mainEq = null;
      if (shape && eq) {
        const nodes: AudioNode[] = [];
        const chain = buildEq(this.ctx, eq, nodes);
        this.mainEq = { ...chain, nodes };
        this.sum.connect(chain.input);
        chain.output.connect(this.djLow);
      } else this.sum.connect(this.djLow);
      this.mainEqKey = key;
      return;
    }
    if (key === this.mainEqKey || !this.mainEq || !eq) return;
    this.mainEqKey = key;
    const nyq = this.ctx.sampleRate / 2 - 100;
    eq.bands.forEach((b, k) => {
      const f = this.mainEq!.biquads[k];
      if (!f) return;
      f.frequency.setTargetAtTime(Math.min(eqHz(b.freq), nyq), time, 0.015);
      f.Q.setTargetAtTime(eqQ(b.q), time, 0.015);
      f.gain.setTargetAtTime(eqDb(b.gain), time, 0.015);
    });
  }

  /** Schedule AHD/ADSR on `param` as base + peak·shape; returns when an AHD settles. */
  private envelope(v: Voice, param: AudioParam, mod: Mod, t: number, base: number, peak: number, td: number) {
    return scheduleEnvelope(param, mod, t, base, peak, td, v.adsr);
  }

  private modTargets(v: Voice, dest: ModDest, amt: number, lfo: boolean): [AudioParam, number][] {
    switch (dest) {
      case 'PITCH':
        return v.detunes.map((d) => [d, amt * (lfo ? 1200 : 2400)] as [AudioParam, number]);
      case 'CUTOFF':
      case 'RES':
        if (v.filter) return dest === 'CUTOFF' ? cutoffTargets(v.filter, amt) : resTargets(v.filter, amt);
        // WAV filter: the crossfade bank on CUTOFF (full amount ±6 octaves of harmonic, as
        // the biquad CUTOFF mod) or RES (full amount the whole range).
        if (!v.wav?.filter || (v.wav.bank && v.wav.bank.axis !== dest)) return [];
        {
          const b = wavBank(this.ctx, this.waves, v, dest, v.start);
          return b ? [[b.pos.offset, dest === 'CUTOFF' ? amt * 0.75 : amt]] : [];
        }
      case 'PAN':
        return v.pan ? [[v.pan.pan, amt]] : [];
      case 'AMP':
        return v.drive ? [[v.drive.gain, amt * v.drive.gain.value * 2]] : [];
      case 'VOLUME':
        return v.level ? [[v.level.gain, amt * 0.5 * v.level.gain.value]] : [];
      case 'CHO':
      case 'DEL':
      case 'REV': {
        const g = this.voiceSend(v, dest === 'CHO' ? 'SCH' : dest === 'DEL' ? 'SDL' : 'SRV');
        return g ? [[g.gain, amt * send(0xff)]] : [];
      }
      case 'SCAN':
      case 'WARP':
      case 'SIZE':
      case 'MULT': {
        // Full amount sweeps the whole 00–FF range of the parameter.
        if (!v.wav || (v.wav.bank && v.wav.bank.axis !== dest)) return [];
        const b = wavBank(this.ctx, this.waves, v, dest, v.start);
        return b ? [[b.pos.offset, amt]] : [];
      }
      case 'OP A':
      case 'OP B':
      case 'OP C':
      case 'OP D': {
        const op = v.ops?.[' ABCD'.indexOf(dest[3]) - 1];
        return op ? [[op.g.gain, amt * op.full]] : [];
      }
      case 'SWARM':
        // Full amount spreads the detuned voices ±50 cents further.
        return (v.swarm ?? []).map((s) => [s.detune, amt * s.k * 50] as [AudioParam, number]);
      case 'START':
      case 'LOOP':
      case 'LENGTH':
        // Read at note start (samplerPositions), not modulated while the note plays.
        return [];
    }
  }

  /** A voice's send gain, built on first use (at level 0) so a mod or command can drive it. */
  private voiceSend(v: Voice, key: 'SCH' | 'SDL' | 'SRV'): GainNode | null {
    if (!v.sends || !v.pan) return null;
    return (v.sends[key] ??= this.makeSend(v.nodes, v.pan, v.track, key, 0));
  }

  /**
   * Disconnect every voice that has finished by `time`. Offline rendering calls this at
   * each suspend: an OfflineAudioContext keeps processing connected nodes, so leaving dead
   * voices attached makes render time grow with the square of the song length.
   */
  collect(time: number) {
    for (const v of [...this.live]) if (v.end <= time && !v.midi) this.cleanup(v);
  }

  private freeLfo(track: number, slot: number, mod: Mod, t: number, td: number, restartPhase?: number): FreeLfo {
    const key = `${track}:${slot}`;
    let lfo = this.freeLfos.get(key);
    const hz = oscHz(mod.lfoShape, lfoHz(mod.freq, td));
    if (!lfo || lfo.shape !== mod.lfoShape || restartPhase != null) {
      if (lfo) {
        try {
          lfo.osc.stop(t);
        } catch {
          // Not started.
        }
      }
      const osc = this.lfos.osc(mod.lfoShape, lfoHz(mod.freq, td), t, restartPhase ?? 0);
      osc.start(t);
      lfo = { osc, shape: mod.lfoShape, rot: restartPhase ?? 0, t0: t, q0: 0, hz };
      this.freeLfos.set(key, lfo);
    }
    // Follow the oscillator's phase across rate changes, for mods read at note start.
    lfo.q0 = freePhase(lfo, t);
    lfo.t0 = t;
    lfo.hz = hz;
    lfo.osc.frequency.setValueAtTime(hz, t);
    return lfo;
  }

  /**
   * Sampler START / LOOP / LENGTH after their mods. A playing buffer source cannot be
   * re-cued, so these destinations are read once, when the note starts: each mod's value at
   * the trigger (see `startValue`: TRACK note/velocity, an envelope's first value, an LFO's
   * phase now) times its amount offsets the byte, full amount spanning 00–FF, before the
   * play region and loop are worked out.
   */
  private samplerPositions(e: Trigger): Instrument['sampler'] {
    const sp = e.inst.sampler;
    const off = { START: 0, LOOP: 0, LENGTH: 0 };
    let any = false;
    e.inst.mods.forEach((mod, slot) => {
      if (mod.type === 'OFF' || mod.amt === 0) return;
      if (mod.dest !== 'START' && mod.dest !== 'LOOP' && mod.dest !== 'LENGTH') return;
      let phase = 0;
      let rot = 0;
      if (mod.type === 'LFO' && mod.lfoTrig === 'FREE') {
        // Keeps the track's free-running LFO going, so the next note reads it further on.
        const lfo = this.freeLfo(e.track, slot, mod, e.time, e.tickDur);
        phase = freePhase(lfo, e.time);
        rot = lfo.rot;
      }
      off[mod.dest] += (toSigned(mod.amt & 0xff) / 127) * startValue(mod, e, phase, rot) * 255;
      any = true;
    });
    if (!any) return sp;
    const at = (v: number, d: number) => Math.max(0, Math.min(255, Math.round(v + d)));
    return { ...sp, start: at(sp.start, off.START), loop: at(sp.loop, off.LOOP), length: at(sp.length, off.LENGTH) };
  }

  /**
   * ET / LT: restart the n-th envelope or LFO of the voice playing on `track`. An ET on the
   * volume envelope retriggers the note itself, because its end is already scheduled.
   */
  retriggerMod(track: number, rawTime: number, kind: 'ENV' | 'LFO', n: number, phase: number) {
    guard('retriggerMod', () => {
      const time = fin(rawTime, this.ctx.currentTime);
      const v = this.voices[track];
      if (!v || v.midi || v.end <= time || v.released) return;
      const h = v.mods.filter((m) => m.kind === kind && !(m.kind === 'ENV' && m.trig))[Math.max(0, Math.round(fin(n, 0, 0, 3)))];
      if (!h) return;
      const td = v.trig.tickDur;
      if (h.kind === 'ENV') {
        if (h.volume) {
          this.startNote({ ...v.trig, time, glideFrom: null, glideTime: 0, legato: false });
          return;
        }
        h.param.cancelScheduledValues(time);
        this.envelope(v, h.param, h.mod, time, h.base, h.peak, td);
        return;
      }
      const ph = byte(phase, 0) / 256;
      if (h.free) {
        const osc = this.freeLfo(track, h.slot, h.mod, time, td, ph).osc;
        for (const g of h.gains) osc.connect(g);
        return;
      }
      if (h.signal instanceof ConstantSourceNode) {
        h.signal.offset.cancelScheduledValues(time);
        lfoCurve(h.signal.offset, h.mod, time, td, ph);
        return;
      }
      // A running oscillator cannot jump in phase: start a rotated one and hand over.
      const osc = this.lfos.osc(h.mod.lfoShape, lfoHz(h.mod.freq, td), time, ph);
      osc.start(time);
      for (const g of h.gains) osc.connect(g);
      try {
        h.signal?.stop(time);
      } catch {
        // Already stopped.
      }
      v.sources.push(osc);
      v.nodes.push(osc);
      if (Number.isFinite(v.end)) osc.stop(v.end);
      h.signal = osc;
    });
  }

  // ---------------------------------------------------------------- MIDI

  private midiTime(time: number) {
    const c = this.ctx;
    if ('getOutputTimestamp' in c) {
      const ts = (c as AudioContext).getOutputTimestamp();
      if (ts.contextTime != null && ts.performanceTime != null)
        return ts.performanceTime + (time - ts.contextTime) * 1000;
    }
    return performance.now() + (time - c.currentTime) * 1000;
  }

  private midiVoice(e: Trigger): Voice | null {
    const out = this.midiOut;
    if (!out || this.ctx instanceof OfflineAudioContext) return null;
    const ch = e.inst.midi.channel & 0xf;
    const note = Math.max(0, Math.min(127, Math.round(e.note + e.cents / 100)));
    const at = this.midiTime(e.time);
    const prog = e.inst.midi.program;
    if (prog != null && this.midiPrograms.get(ch) !== prog) {
      this.midiPrograms.set(ch, prog);
      out.send([0xc0 | ch, prog & 0x7f], at);
    }
    out.send([0x90 | ch, note, Math.max(1, Math.round(e.vel / 2))], at);
    const v: Voice = {
      track: e.track,
      inst: e.inst,
      start: e.time,
      end: Infinity,
      sources: [],
      detunes: [],
      nodes: [],
      filter: null,
      drive: null,
      env: null,
      level: null,
      fade: null,
      pan: null,
      sends: null,
      adsr: [],
      volumeAdsr: false,
      fine: 0,
      note: e.note,
      noteCents: 0,
      released: false,
      vib: null,
      midi: { channel: ch, note },
      detach: [],
      mods: [],
      trig: e,
      plainDrive: false,
      wav: null,
      ops: null,
      swarm: null,
      cents: 0,
    };
    this.live.add(v);
    return v;
  }

  private midiNoteOff(v: Voice, time: number) {
    if (!v.midi || !this.midiOut) return;
    this.midiOut.send([0x80 | v.midi.channel, v.midi.note, 0], this.midiTime(time));
    this.live.delete(v);
    if (this.voices[v.track] === v) this.voices[v.track] = null;
  }

}

/** A free-running LFO's oscillator phase (0–1) at `t`. */
const freePhase = (lfo: FreeLfo, t: number) => (((lfo.q0 + (t - lfo.t0) * lfo.hz) % 1) + 1) % 1;
