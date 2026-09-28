import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../lib/theme';
import { allSamples, analyser } from '../state/transport';
import { commit, getState, setState, useStore } from '../state/store';
import { processSample, SAMPLE_OPS, type SampleOp } from '../audio/edit';
import { encodeWav } from '../audio/wav';
import { saveSample } from '../state/persist';
import { addUserSample } from '../state/transport';
import type { Instrument } from '../core/types';

/** Canvas cannot read CSS variables, so it takes the element's own computed colours. */
function colors(el: HTMLElement) {
  const cs = getComputedStyle(el);
  return { ink: cs.color, faint: cs.borderTopColor };
}

function sizeCanvas(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
  if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

/** Where the engine starts, loops and ends, as fractions of the whole sample. */
function markers(sp: Instrument['sampler']) {
  const s = sp.start / 255;
  const e = s + (1 - s) * (sp.length / 255);
  const l = Math.min(e, Math.max(s, sp.loop / 255));
  return { s, e, l };
}

/** The sampler screen's waveform with start, loop and end markers, as on both devices. */
export function SampleView({ inst, tools }: { inst: Instrument; tools?: React.ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [buf, setBuf] = useState<AudioBuffer | null>(null);
  const theme = useTheme();
  const id = inst.sampler.sample;
  useEffect(() => {
    let live = true;
    if (!id) return setBuf(null);
    void allSamples().then((m) => live && setBuf(m.get(id) ?? null));
    return () => {
      live = false;
    };
  }, [id]);
  const { start, loop, length, slices, play } = inst.sampler;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      const { g, w, h } = sizeCanvas(c);
      const { ink, faint } = colors(c);
      g.clearRect(0, 0, w, h);
      g.strokeStyle = faint;
      g.beginPath();
      g.moveTo(0, h / 2);
      g.lineTo(w, h / 2);
      g.stroke();
      if (!buf) return;
      const data = buf.getChannelData(0);
      const per = Math.max(1, Math.floor(data.length / w));
      g.fillStyle = ink;
      for (let x = 0; x < w; x++) {
        let lo = 1;
        let hi = -1;
        const from = Math.floor((x / w) * data.length);
        for (let i = from; i < from + per && i < data.length; i++) {
          const v = data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const y0 = ((1 - hi) / 2) * h;
        const y1 = ((1 - lo) / 2) * h;
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
      }
      const m = markers(inst.sampler);
      const at = (f: number) => Math.round(f * (w - 2)) + 1;
      // What never plays is veiled, so the region reads at a glance in both themes.
      g.save();
      g.globalAlpha = 0.55;
      g.fillStyle = getComputedStyle(c).backgroundColor;
      g.fillRect(0, 0, at(m.s), h);
      g.fillRect(at(m.e), 0, w - at(m.e), h);
      g.restore();
      const mark = (x: number, dash: number[], width: number, label: string) => {
        g.save();
        g.strokeStyle = ink;
        g.lineWidth = width;
        g.setLineDash(dash);
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
        g.restore();
        g.fillStyle = ink;
        g.font = '600 10px ui-monospace, monospace';
        g.fillText(label, Math.min(w - 30, x + 4), 11);
      };
      if (slices > 0) {
        g.save();
        g.strokeStyle = faint;
        g.setLineDash([2, 3]);
        for (let k = 1; k < slices; k++) {
          const x = Math.round((k / slices) * w);
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, h);
          g.stroke();
        }
        g.restore();
      }
      // Solid for start and end, dashed for loop: shape, not only position, tells them apart.
      mark(at(m.s), [], 2, 'S');
      if (play.includes('LOOP')) mark(at(m.l), [4, 3], 1.5, 'L');
      mark(at(m.e), [], 3, 'E');
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [buf, start, loop, length, slices, play, theme]);
  const drag = useRef<'s' | 'l' | 'e' | null>(null);
  const fraction = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  const setFrom = (which: 's' | 'l' | 'e', f: number) => {
    const id = getState().ids.inst;
    commit((d) => {
      const sp = d.instruments[id]?.sampler;
      if (!sp) return;
      const m = markers(sp);
      if (which === 's') {
        // Moving the start keeps the end where it is on screen.
        const s = Math.min(f, m.e - 0.004);
        sp.start = Math.round(s * 255);
        sp.length = Math.round(Math.min(1, (m.e - s) / Math.max(0.001, 1 - s)) * 255);
      } else if (which === 'e') {
        sp.length = Math.max(1, Math.round(((f - m.s) / Math.max(0.001, 1 - m.s)) * 255));
      } else sp.loop = Math.round(f * 255);
    }, `sample-drag:${which}`);
  };
  return (
    <section className="panel sample-view" aria-label="Sample waveform">
      <header className="panel-heading">
        <span className="small-label" title="Drag S, L or E on the waveform">Sample</span>
        <span className="panel-tools">
          {tools}
          {buf && <SampleEdit buf={buf} inst={inst} />}
          <span className="pill">{buf ? `${buf.duration.toFixed(2)} s · ${buf.numberOfChannels === 1 ? 'mono' : 'stereo'}` : 'no sample'}</span>
        </span>
      </header>
      <canvas
        ref={ref}
        className="waveform"
        role="img"
        aria-label="Waveform. Drag S, L or E to set start, loop and end; or edit START, LOOP ST and LENGTH."
        onPointerDown={(e) => {
          const f = fraction(e);
          const m = markers(inst.sampler);
          const near = (['s', 'l', 'e'] as const)
            .filter((k) => k !== 'l' || play.includes('LOOP'))
            .map((k) => [k, Math.abs(m[k] - f)] as const)
            .sort((a, b) => a[1] - b[1])[0];
          drag.current = near[0];
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setFrom(near[0], f);
        }}
        onPointerMove={(e) => drag.current && setFrom(drag.current, fraction(e))}
        onPointerUp={() => (drag.current = null)}
      />
    </section>
  );
}

/** The M8's oscilloscope, on the transport bar. */
export function Scope() {
  const ref = useRef<HTMLCanvasElement>(null);
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let raf = 0;
    const data = new Float32Array(512);
    const draw = () => {
      const { g, w, h } = sizeCanvas(c);
      const { ink, faint } = colors(c);
      g.clearRect(0, 0, w, h);
      const a = analyser();
      g.lineWidth = 1.25;
      if (!a || !playing) {
        g.strokeStyle = faint;
        g.beginPath();
        g.moveTo(0, h / 2);
        g.lineTo(w, h / 2);
        g.stroke();
        return;
      }
      a.getFloatTimeDomainData(data);
      // Start on a rising zero crossing so the trace stands still.
      let from = 0;
      for (let i = 1; i < data.length / 2; i++) {
        if (data[i - 1] < 0 && data[i] >= 0) {
          from = i;
          break;
        }
      }
      g.strokeStyle = ink;
      g.beginPath();
      const n = data.length / 2;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        const y = h / 2 - Math.max(-1, Math.min(1, data[from + i] * 1.6)) * (h / 2 - 1);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return <canvas ref={ref} className="scope" aria-hidden="true" />;
}

/**
 * The M8 sample editor's PROCESS list, applied to the S–E range. The result is saved as a
 * new sample and the instrument points at it, so Undo simply points it back.
 */
function SampleEdit({ buf, inst }: { buf: AudioBuffer; inst: Instrument }) {
  const [op, setOp] = useState<SampleOp>('NORMALIZE');
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    const s = getState();
    const id = s.ids.inst;
    const src = inst.sampler.sample;
    if (!src) return;
    setBusy(true);
    try {
      const m = markers(inst.sampler);
      const out = processSample(buf, op, m.s, m.e);
      const bytes = await encodeWav(out).arrayBuffer();
      const newId = `user:${Date.now().toString(36)}:edit`;
      const base = (s.project.samples[src]?.name ?? 'SAMPLE').replace(/\*+$/, '').slice(0, 10);
      await addUserSample(newId, bytes);
      await saveSample(newId, bytes).catch(() => {});
      // Whole-buffer results start from the top again; range edits keep the markers.
      const reset = op === 'CROP' || op === 'DELETE' || op === 'DUPLICATE' || op === 'DOWNSAMPLE';
      commit((d) => {
        d.samples[newId] = { name: `${base}*`, builtin: false };
        const sp = d.instruments[id]?.sampler;
        if (!sp) return;
        sp.sample = newId;
        if (reset) {
          sp.start = 0;
          sp.length = 0xff;
          sp.loop = 0;
        }
      });
      setState({ status: `${op} DONE · UNDO RESTORES` });
    } catch {
      setState({ status: `${op} FAILED` });
    }
    setBusy(false);
  };
  return (
    <span className="sample-edit">
      <label>
        <span className="visually-hidden">Process</span>
        <select value={op} onChange={(e) => setOp(e.target.value as SampleOp)}>
          {SAMPLE_OPS.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
      <button onClick={apply} disabled={busy} title="Apply to the range between S and E">
        {busy ? 'Working…' : 'Apply'}
      </button>
    </span>
  );
}
