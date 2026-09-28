import { describe, expect, it } from 'vitest';
import { defaultInstrument, emptyChain, emptyPhrase, emptyTable, newProject } from '../src/core/factory';
import { Sequencer, type Output, type Trigger } from '../src/core/sequencer';
import { NOTE_OFF, type Project } from '../src/core/types';
import { euclid, fillSteps } from '../src/core/fill';
import { noteName } from '../src/core/format';

function recorder() {
  const log: { type: string; track: number; tick: number; data?: unknown }[] = [];
  let tick = 0;
  const out: Output = {
    trigger: (e: Trigger) => log.push({ type: 'trigger', track: e.track, tick, data: e }),
    release: (track) => log.push({ type: 'release', track, tick }),
    kill: (track) => log.push({ type: 'kill', track, tick }),
    param: (track, _t, p, v) => log.push({ type: 'param', track, tick, data: [p, v] }),
    pitch: (track, _t, cents) => log.push({ type: 'pitch', track, tick, data: cents }),
    vibrato: () => {},
    master: () => {},
    stopAll: () => {},
  };
  return { log, out, setTick: (t: number) => (tick = t) };
}

function project(): Project {
  const p = newProject();
  p.instruments[0] = { ...defaultInstrument(), type: 'WAVSYNTH' };
  const ph = emptyPhrase();
  ph.steps[0] = { ...ph.steps[0], note: 60, inst: 0 };
  ph.steps[4] = { ...ph.steps[4], note: 62 };
  p.phrases[0] = ph;
  const ch = emptyChain();
  ch.rows[0] = { phrase: 0, tsp: 0 };
  p.chains[0] = ch;
  p.song[0][0] = 0;
  return p;
}

function run(p: Project, ticks: number, start = { mode: 'SONG' as const, songRow: 0 }, rng?: () => number) {
  const r = recorder();
  const seq = new Sequencer(p, r.out, rng);
  seq.start(start);
  for (let i = 0; i < ticks; i++) {
    r.setTick(i);
    seq.processTick(i);
  }
  return { ...r, seq };
}

const triggers = (log: ReturnType<typeof recorder>['log']) =>
  log.filter((e) => e.type === 'trigger').map((e) => ({ tick: e.tick, note: (e.data as Trigger).note, vel: (e.data as Trigger).vel }));

describe('sequencer', () => {
  it('plays phrase steps at 6 ticks per step and loops the song block', () => {
    const { log } = run(project(), 96 * 2);
    expect(triggers(log).map((t) => t.tick)).toEqual([0, 24, 96, 120]);
    expect(triggers(log)[1].note).toBe(62);
  });

  it('keeps the last instrument when a row has only a note', () => {
    const { log } = run(project(), 30);
    expect((log.filter((e) => e.type === 'trigger')[1].data as Trigger).instId).toBe(0);
  });

  it('applies chain transpose and walks chain rows', () => {
    const p = project();
    p.chains[0].rows[1] = { phrase: 0, tsp: 12 };
    const t = triggers(run(p, 192).log);
    expect(t.map((x) => x.note)).toEqual([60, 62, 72, 74]);
  });

  it('lets tracks drift when chains differ in length (polymeter)', () => {
    const p = project();
    p.chains[1] = emptyChain();
    p.chains[1].rows[0] = { phrase: 0, tsp: 0 };
    p.chains[1].rows[1] = { phrase: 0, tsp: 0 };
    p.song[0][1] = 1;
    p.song[1][0] = 0;
    // Track 0: two one-phrase chains in a block; track 1: one two-phrase chain. Same length,
    // so both restart together at tick 192.
    const { log } = run(p, 200);
    const starts = (tr: number) => log.filter((e) => e.type === 'trigger' && e.track === tr && (e.data as Trigger).note === 60).map((e) => e.tick);
    expect(starts(0)).toEqual([0, 96, 192]);
    expect(starts(1)).toEqual([0, 96, 192]);
  });

  it('respects groove ticks (swing)', () => {
    const p = project();
    p.grooves[0] = { steps: [8, 4, ...Array(14).fill(null)] };
    p.phrases[0].steps[1] = { ...p.phrases[0].steps[1], note: 64 };
    const t = triggers(run(p, 30).log);
    expect(t.map((x) => x.tick)).toEqual([0, 8, 24]);
  });

  it('delays a row with DEL and skips it with CHA 00', () => {
    const p = project();
    p.phrases[0].steps[4].fx[0] = { cmd: 'DEL', val: 3 };
    expect(triggers(run(p, 40).log).map((t) => t.tick)).toEqual([0, 27]);
    p.phrases[0].steps[4].fx[0] = { cmd: 'CHA', val: 0 };
    expect(triggers(run(p, 40).log).map((t) => t.tick)).toEqual([0]);
  });

  it('RET: x 0–7 lowers the volume each hit, 8–F raises it; y = 0 is a single retrigger', () => {
    const p = project();
    p.phrases[0].steps[0].fx[0] = { cmd: 'RET', val: 0x22 };
    const down = triggers(run(p, 6).log);
    expect(down.map((x) => x.tick)).toEqual([0, 2, 4]);
    expect(down[1].vel).toBeLessThan(down[0].vel);
    p.phrases[0].steps[0].vel = 0x40;
    p.phrases[0].steps[0].fx[0] = { cmd: 'RET', val: 0xa2 };
    const up = triggers(run(p, 6).log);
    expect(up[1].vel).toBeGreaterThan(up[0].vel);
    p.phrases[0].steps[0].fx[0] = { cmd: 'RET', val: 0x30 };
    expect(triggers(run(p, 6).log).map((x) => x.tick)).toEqual([0, 3]);
  });

  it('HOP y jumps to row y of the next phrase; HOP FF stops the track', () => {
    const p = project();
    const ph = emptyPhrase();
    ph.steps[4] = { ...ph.steps[4], note: 72, inst: 0 };
    p.phrases[1] = ph;
    p.chains[0].rows[1] = { phrase: 1, tsp: 0 };
    p.phrases[0].steps[0].fx[0] = { cmd: 'HOP', val: 0x04 };
    const t = triggers(run(p, 12).log);
    expect(t.map((x) => [x.tick, x.note])).toEqual([[0, 60], [6, 72]]);
    p.phrases[0].steps[0].fx[0] = { cmd: 'HOP', val: 0xff };
    const r = run(p, 40);
    expect(triggers(r.log).length).toBe(1);
    expect(r.seq.playing).toBe(false);
  });

  it('a note without an instrument is legato; with one it retriggers', () => {
    const { log } = run(project(), 30);
    const tr = log.filter((e) => e.type === 'trigger').map((e) => (e.data as Trigger).legato);
    expect(tr).toEqual([false, true]);
  });

  it('CHA xy gates the note (x) and the commands (y) separately', () => {
    const p = project();
    p.phrases[0].steps[4] = { ...p.phrases[0].steps[4], inst: 0, fx: [{ cmd: 'CHA', val: 0x0f }, { cmd: 'VOL', val: 0x10 }, { cmd: null, val: 0 }] };
    const { log } = run(p, 30);
    expect(triggers(log).map((x) => x.tick)).toEqual([0]);
    expect(log.some((e) => e.type === 'param' && e.tick === 24)).toBe(true);
  });

  it('VOL and CUT are relative and reset on the next note with an instrument', () => {
    const p = project();
    p.instruments[0].cutoff = 0x80;
    p.phrases[0].steps[1].fx[0] = { cmd: 'CUT', val: 0x10 };
    p.phrases[0].steps[2].fx[0] = { cmd: 'CUT', val: 0x10 };
    p.phrases[0].steps[3].fx[0] = { cmd: 'CUT', val: 0xf0 };
    const cuts = run(p, 24).log.filter((e) => e.type === 'param').map((e) => e.data);
    expect(cuts).toEqual([['CUT', 0x90], ['CUT', 0xa0], ['CUT', 0x90]]);
  });

  it('TSP transposes the whole song from then on', () => {
    const p = project();
    p.phrases[0].steps[0].fx[0] = { cmd: 'TSP', val: 0x0c };
    p.song[0][1] = 0;
    const t = triggers(run(p, 30).log);
    expect(t.map((x) => x.note)).toEqual([72, 72, 74, 74]);
  });

  it('a groove value of 00 skips the step', () => {
    const p = project();
    p.grooves[0] = { steps: [6, 0, ...Array(14).fill(null)] };
    p.phrases[0].steps[1] = { ...p.phrases[0].steps[1], note: 64, inst: 0 };
    p.phrases[0].steps[2] = { ...p.phrases[0].steps[2], note: 65, inst: 0 };
    const t = triggers(run(p, 13).log);
    expect(t.map((x) => [x.tick, x.note])).toEqual([[0, 60], [6, 65], [12, 62]]);
  });

  it('NTH plays the left side on the first of every x passes', () => {
    const p = project();
    p.phrases[0].steps[4].fx[0] = { cmd: 'NTH', val: 0x20 };
    const t = triggers(run(p, 96 * 3).log);
    expect(t.filter((x) => x.note === 62).map((x) => x.tick)).toEqual([24, 216]);
  });

  it('REP repeats the last command, adding each row, until RTO', () => {
    const p = project();
    p.phrases[0].steps[0].fx[0] = { cmd: 'CUT', val: 0x10 };
    p.phrases[0].steps[1].fx[0] = { cmd: 'REP', val: 0x10 };
    p.phrases[0].steps[1].fx[1] = { cmd: 'RTO', val: 0x30 };
    const cuts = run(p, 30).log.filter((e) => e.type === 'param').map((e) => e.data);
    expect(cuts.slice(0, 4)).toEqual([['CUT', 0xff], ['CUT', 0xff], ['CUT', 0xff], ['CUT', 0xff]]);
  });

  it('table HOP xy loops x times, TIC 00 steps one row per note, V scales velocity', () => {
    const p = project();
    const tb = emptyTable();
    tb.rows[0] = { ...tb.rows[0], tsp: 0 };
    tb.rows[1] = { ...tb.rows[1], tsp: 12, fx: [{ cmd: 'HOP', val: 0x20 }, { cmd: null, val: 0 }, { cmd: null, val: 0 }] };
    tb.rows[2] = { ...tb.rows[2], tsp: 7, vel: 0x40 };
    p.tables[0] = tb;
    const pitch = run(p, 8).log.filter((e) => e.type === 'pitch').map((e) => e.data);
    expect(pitch.slice(0, 5)).toEqual([1200, 0, 1200, 0, 1200]);
    p.instruments[0].tableTic = 0;
    p.phrases[0].steps[4].inst = 0;
    const perNote = run(p, 30).log.filter((e) => e.type === 'trigger').map((e) => (e.data as Trigger).cents);
    expect(perNote).toEqual([0, 1200]);
    // Row 2's V 40 halves the note's velocity.
    p.instruments[0].tableTic = 1;
    const vol = run(p, 8).log.filter((e) => e.type === 'param').map((e) => e.data);
    expect(vol).toContainEqual(['VOL', 129]);
  });

  it('sends OFF notes and OFF xx as releases and KIL as a kill', () => {
    const p = project();
    p.phrases[0].steps[2] = { ...p.phrases[0].steps[2], note: NOTE_OFF };
    p.phrases[0].steps[0].fx[1] = { cmd: 'KIL', val: 2 };
    p.phrases[0].steps[4].fx[0] = { cmd: 'OFF', val: 3 };
    const { log } = run(p, 30);
    expect(log.find((e) => e.type === 'kill')?.tick).toBe(2);
    expect(log.filter((e) => e.type === 'release').map((e) => e.tick)).toEqual([12, 27]);
  });

  it('runs the instrument table at its tick rate', () => {
    const p = project();
    p.instruments[0].tableTic = 2;
    const tb = emptyTable();
    tb.rows[1] = { ...tb.rows[1], tsp: 12 };
    p.tables[0] = tb;
    const { log } = run(p, 6);
    const pitch = log.filter((e) => e.type === 'pitch');
    expect(pitch[0]).toMatchObject({ tick: 2, data: 1200 });
    expect(pitch[1]).toMatchObject({ tick: 4, data: 0 });
  });

  it('loops a single chain in CHAIN mode and a phrase in PHRASE mode', () => {
    const p = project();
    p.song[0][0] = null;
    const c = run(p, 100, { mode: 'CHAIN', songRow: 0, track: 3, chain: 0 } as never);
    expect(triggers(c.log).map((x) => x.tick)).toEqual([0, 24, 96]);
    expect(c.log[0].track).toBe(3);
    const ph = run(p, 100, { mode: 'PHRASE', songRow: 0, track: 0, phrase: 0 } as never);
    expect(triggers(ph.log).length).toBe(3);
  });

  it('live mode: a queued row takes over when the chain ends; idle tracks join on a bar', () => {
    const p = project();
    const ph = emptyPhrase();
    ph.steps[0] = { ...ph.steps[0], note: 72, inst: 0 };
    p.phrases[1] = ph;
    p.chains[1] = emptyChain();
    p.chains[1].rows[0] = { phrase: 1, tsp: 0 };
    p.song[2][0] = 1;
    p.song[2][1] = 1;
    const r = recorder();
    const seq = new Sequencer(p, r.out);
    seq.start({ mode: 'SONG', songRow: 0 });
    for (let i = 0; i < 200; i++) {
      r.setTick(i);
      if (i === 10) {
        seq.queue(0, 2);
        seq.queue(1, 2);
      }
      seq.processTick(i);
    }
    const t0 = r.log.filter((e) => e.type === 'trigger' && e.track === 0).map((e) => [e.tick, (e.data as Trigger).note]);
    const t1 = r.log.filter((e) => e.type === 'trigger' && e.track === 1).map((e) => e.tick);
    expect(t0).toEqual([[0, 60], [24, 62], [96, 72], [192, 72]]);
    expect(t1).toEqual([96, 192]);
  });

  it('beat repeat loops every track over its next steps', () => {
    const p = project();
    const r = recorder();
    const seq = new Sequencer(p, r.out);
    seq.start({ mode: 'SONG', songRow: 0 });
    for (let i = 0; i < 60; i++) {
      r.setTick(i);
      if (i === 20) seq.setRepeat(1);
      seq.processTick(i);
    }
    // Step 4 (tick 24) is the first one after the press; it repeats every step from then on.
    const t = triggers(r.log).map((x) => x.tick);
    expect(t).toEqual([0, 24, 30, 36, 42, 48, 54]);
  });

  it('RND re-runs the previously active command with a random value', () => {
    const p = project();
    p.instruments[0].cutoff = 0x80;
    p.phrases[0].steps[0].fx[0] = { cmd: 'CUT', val: 0x10 };
    p.phrases[0].steps[2].fx[0] = { cmd: 'RND', val: 0x0f };
    const cuts = run(p, 13, undefined, () => 0.99).log.filter((e) => e.type === 'param').map((e) => e.data);
    // 0x10 + up to 0x0F on the low digit: 0x1F, added relatively to 0x90.
    expect(cuts).toEqual([['CUT', 0x90], ['CUT', 0xaf]]);
  });

  it('SCA snaps the track to a scale', () => {
    const p = project();
    p.phrases[0].steps[0].fx[0] = { cmd: 'SCA', val: 0x01 };
    p.phrases[0].steps[4] = { ...p.phrases[0].steps[4], note: 61, inst: 0 };
    const t = triggers(run(p, 30).log);
    expect(t.map((x) => x.note)).toEqual([60, 62]);
  });

  it('SLI aims a sliced sample at a slice', () => {
    const p = project();
    p.instruments[0] = { ...p.instruments[0], type: 'SAMPLER', sampler: { ...p.instruments[0].sampler, slices: 8 } };
    p.phrases[0].steps[0].fx[0] = { cmd: 'SLI', val: 3 };
    expect(triggers(run(p, 2).log)[0].note).toBe(27); // C-1 (24) + slice 3
  });

  it('a user scale snaps notes and plays its tuning', () => {
    const p = project();
    p.scales[0].notes = p.scales[0].notes.map((_, i) => i === 0 || i === 4 || i === 7);
    p.scales[0].tune[4] = -14;
    p.settings.scale = 'USER 0';
    p.phrases[0].steps[0].fx[0] = { cmd: 'SCA', val: 0x0a };
    p.phrases[0].steps[4] = { ...p.phrases[0].steps[4], note: 62, inst: 0 };
    const t = run(p, 30).log.filter((e) => e.type === 'trigger').map((e) => [(e.data as Trigger).note, (e.data as Trigger).cents]);
    expect(t).toEqual([[60, 0], [64, -14]]);
  });

  it('RMX sends the tracks to the left to a row of their phrase', () => {
    const p = project();
    p.song[0][1] = 1;
    p.chains[1] = emptyChain();
    p.chains[1].rows[0] = { phrase: 1, tsp: 0 };
    p.phrases[1] = emptyPhrase();
    p.phrases[1].steps[2] = { ...p.phrases[1].steps[2], fx: [{ cmd: 'RMX', val: 0x0c }, { cmd: null, val: 0 }, { cmd: null, val: 0 }] };
    const r = run(p, 20);
    // Track 1 jumps from step 3 to step 0C after the RMX on track 2's step 2.
    expect(r.seq.position(0).step).toBe(0x0c);
  });

  it('LIVE QUANT BAR switches a cued track on the next bar, not at chain end', () => {
    const p = project();
    p.chains[0].rows[1] = { phrase: 0, tsp: 0 };
    p.chains[0].rows[2] = { phrase: 0, tsp: 0 };
    p.chains[1] = emptyChain();
    p.chains[1].rows[0] = { phrase: 0, tsp: 12 };
    p.song[2][0] = 1;
    p.settings.liveQuant = 'BAR';
    const rec = recorder();
    const seq = new Sequencer(p, rec.out);
    seq.start({ mode: 'SONG', songRow: 0 });
    for (let i = 0; i < 100; i++) {
      rec.setTick(i);
      if (i === 10) seq.queue(0, 2);
      seq.processTick(i);
    }
    const t = triggers(rec.log);
    expect(t.find((x) => x.tick === 96)?.note).toBe(72);
  });

  it('a table keeps one row per tick across step boundaries (TIC 01)', () => {
    const p = project();
    p.instruments[0].tableTic = 1;
    const tb = emptyTable();
    for (let r = 1; r < 16; r++) tb.rows[r] = { ...tb.rows[r], tsp: r };
    p.tables[0] = tb;
    // Only step 0 has a note: steps 1–3 are empty rows, and the table must not lose a tick
    // at each of them.
    p.phrases[0].steps[4] = { ...p.phrases[0].steps[4], note: null };
    const { log } = run(p, 16);
    const pitch = log.filter((e) => e.type === 'pitch').map((e) => [e.tick, (e.data as number) / 100]);
    expect(pitch.slice(0, 15)).toEqual(Array.from({ length: 15 }, (_, i) => [i + 1, i + 1]));
  });

  it('ARP runs on through an empty row without a held tick', () => {
    const p = project();
    p.phrases[0].steps[0].fx[0] = { cmd: 'ARP', val: 0x37 };
    p.phrases[0].steps[4] = { ...p.phrases[0].steps[4], note: null };
    const { log } = run(p, 13);
    const ticks = log.filter((e) => e.type === 'pitch').map((e) => e.tick);
    // One pitch step per tick from tick 1 on, including ticks 6 and 12 (new steps).
    expect(ticks.slice(0, 12)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('GRV on row 0 swings from that row, and the groove follows the phrase steps', () => {
    const p = project();
    p.grooves[1] = { steps: [7, 5, ...Array(14).fill(null)] };
    const ph = p.phrases[0];
    for (let r = 0; r < 16; r++) ph.steps[r] = { ...ph.steps[r], note: 60, inst: 0 };
    ph.steps[0].fx[0] = { cmd: 'GRV', val: 1 };
    const t = triggers(run(p, 96 * 2).log).map((x) => x.tick);
    // 7 + 5 per pair of steps: a bar of 16 steps is 96 ticks, like the straight groove.
    expect(t.slice(0, 6)).toEqual([0, 7, 12, 19, 24, 31]);
    expect(t[16]).toBe(96);
  });

  it('GGR keeps every track in phase, whichever track sends it', () => {
    for (const from of [0, 1]) {
      const p = project();
      p.grooves[1] = { steps: [7, 5, ...Array(14).fill(null)] };
      const ph = p.phrases[0];
      for (let r = 0; r < 16; r++) ph.steps[r] = { ...ph.steps[r], note: 60, inst: 0 };
      const other = structuredClone(ph);
      (from === 0 ? ph : other).steps[0].fx[0] = { cmd: 'GGR', val: 1 };
      p.phrases[1] = other;
      p.chains[1] = { ...structuredClone(p.chains[0]), rows: p.chains[0].rows.map((r, i) => (i === 0 ? { phrase: 1, tsp: 0 } : r)) };
      p.song[0][1] = 1;
      const log = run(p, 96 * 2).log.filter((e) => e.type === 'trigger');
      const a = log.filter((e) => e.track === 0).map((e) => e.tick);
      const b = log.filter((e) => e.track === 1).map((e) => e.tick);
      expect(b.slice(0, 20)).toEqual(a.slice(0, 20));
      expect(a.slice(0, 4)).toEqual([0, 7, 12, 19]);
    }
  });

  it('GGR from a later track onto a 00 groove row keeps earlier tracks in phase', () => {
    const p = project();
    p.grooves[2] = { steps: [8, 8, 8, 0, ...Array(12).fill(null)] };
    const ph = p.phrases[0];
    for (let r = 0; r < 16; r++) ph.steps[r] = { ...ph.steps[r], note: 60, inst: 0 };
    const other = structuredClone(ph);
    other.steps[3].fx[0] = { cmd: 'GGR', val: 2 };
    p.phrases[1] = other;
    p.chains[1] = { ...structuredClone(p.chains[0]), rows: p.chains[0].rows.map((r, i) => (i === 0 ? { phrase: 1, tsp: 0 } : r)) };
    p.song[0][1] = 1;
    const log = run(p, 96 * 2).log.filter((e) => e.type === 'trigger');
    const a = log.filter((e) => e.track === 0).map((e) => e.tick);
    const b = log.filter((e) => e.track === 1).map((e) => e.tick);
    expect(b.slice(0, 16)).toEqual(a.slice(0, 16));
  });

  it('a groove loops at its first empty row', () => {
    const p = project();
    p.grooves[1] = { steps: [7, null, 5, ...Array(13).fill(null)] };
    const ph = p.phrases[0];
    for (let r = 0; r < 16; r++) ph.steps[r] = { ...ph.steps[r], note: 60, inst: 0 };
    ph.steps[0].fx[0] = { cmd: 'GRV', val: 1 };
    expect(triggers(run(p, 30).log).map((x) => x.tick).slice(0, 4)).toEqual([0, 7, 14, 21]);
  });

  it('a GRV behind a failing CHA gate does not apply', () => {
    const p = project();
    p.grooves[1] = { steps: [9, 3, ...Array(14).fill(null)] };
    const ph = p.phrases[0];
    for (let r = 0; r < 16; r++) ph.steps[r] = { ...ph.steps[r], note: 60, inst: 0 };
    // CHA 0F: the left side (row 0's note) never plays, the right side (GRV) always does.
    ph.steps[0].fx[0] = { cmd: 'CHA', val: 0x0f };
    ph.steps[0].fx[1] = { cmd: 'GRV', val: 1 };
    const on = triggers(run(p, 20).log).map((x) => x.tick);
    expect(on.slice(0, 2)).toEqual([9, 12]);
    // CHA F0: the note plays, the GRV on the right side does not: straight sixes.
    ph.steps[0].fx[0] = { cmd: 'CHA', val: 0xf0 };
    const off = triggers(run(p, 20).log).map((x) => x.tick);
    expect(off.slice(0, 3)).toEqual([0, 6, 12]);
  });

  it('arpeggiates with ARP', () => {
    const p = project();
    p.phrases[0].steps[0].fx[0] = { cmd: 'ARP', val: 0x47 };
    const { log } = run(p, 4);
    expect(log.filter((e) => e.type === 'pitch').map((e) => e.data)).toEqual([400, 700, 0]);
  });
});

describe('helpers', () => {
  it('spreads euclidean hits', () => {
    expect(euclid(4, 8).map(Number).join('')).toBe('10101010');
    expect(euclid(5, 8).filter(Boolean).length).toBe(5);
    expect(euclid(3, 8).map(Number).join('')).toBe('10010010');
  });
  it('fills every 4th step with a from-to ramp', () => {
    const steps = emptyPhrase().steps;
    const out = fillSteps(steps, {
      target: 'NOTE', where: 'ALL', pattern: 'EVERY', amount: 4, value: 'FROM-TO',
      from: 48, to: 60, fxSlot: 0, fxCmd: 'VOL', scale: 'CHROMATIC', root: 0, inst: 1,
    });
    expect(out.map((s) => s.note)).toEqual([48, null, null, null, 52, null, null, null, 56, null, null, null, 60, null, null, null]);
    expect(out[0].inst).toBe(1);
  });
  it('names notes like the M8', () => {
    expect(noteName(60)).toBe('C-4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(NOTE_OFF)).toBe('OFF');
  });
});
