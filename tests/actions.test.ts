import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyChain, emptyPhrase, newProject } from '../src/core/factory';
import { NOTE_OFF } from '../src/core/types';
import { keyDown, keyUp, moveTo, openView, peekIds, releaseAll, typeKey, type Key } from '../src/state/actions';
import { defaultInstrument } from '../src/core/factory';
import { getState, replaceProject, setState } from '../src/state/store';
import { poolPick } from '../src/state/pool';
import { formFor } from '../src/state/fields';

vi.mock('../src/state/transport', () => ({
  play: vi.fn(),
  stop: vi.fn(),
  preview: vi.fn(),
  queueRow: vi.fn(),
  queueStopTrack: vi.fn(),
  expectBusy: vi.fn(),
}));

function project() {
  const p = newProject();
  const ph = emptyPhrase();
  ph.steps[0] = { ...ph.steps[0], note: 60, inst: 0 };
  p.phrases[0] = ph;
  const ch = emptyChain();
  ch.rows[0] = { phrase: 0, tsp: 0 };
  p.chains[0] = ch;
  p.song[0][0] = 0;
  return p;
}

const press = (...keys: Key[]) => {
  for (const k of keys) keyDown(k);
  for (const k of [...keys].reverse()) keyUp(k);
};

beforeEach(() => {
  releaseAll();
  replaceProject(project());
  setState({ view: 'SONG', selection: null });
  moveTo('SONG', 0, 0);
});

describe('M8 keys', () => {
  it('SHIFT + OPTION, then EDIT clones the chain (and never cuts it)', () => {
    keyDown('SHIFT');
    keyDown('OPTION');
    keyDown('EDIT');
    keyUp('EDIT');
    keyUp('OPTION');
    keyUp('SHIFT');
    const p = getState().project;
    expect(p.song[0][0]).toBe(1);
    expect(p.chains[1].rows[0].phrase).toBe(0);
    expect(p.chains[0].rows[0].phrase).toBe(0);
  });

  it('a second EDIT makes it a deep clone with copied phrases', () => {
    keyDown('SHIFT');
    keyDown('OPTION');
    keyDown('EDIT');
    keyUp('EDIT');
    keyDown('EDIT');
    keyUp('EDIT');
    keyUp('OPTION');
    keyUp('SHIFT');
    const p = getState().project;
    expect(p.song[0][0]).toBe(1);
    expect(p.chains[1].rows[0].phrase).toBe(1);
    expect(p.phrases[1].steps[0].note).toBe(60);
  });

  it('EDIT twice on a chain cell makes a new, empty chain', () => {
    press('EDIT');
    press('EDIT');
    expect(getState().project.song[0][0]).toBe(1);
  });

  it('OPTION + EDIT on an empty note writes OFF; on a note it deletes', () => {
    openView('CHAIN');
    openView('PHRASE');
    moveTo('PHRASE', 1, 0);
    press('OPTION', 'EDIT');
    expect(getState().project.phrases[0].steps[1].note).toBe(NOTE_OFF);
    moveTo('PHRASE', 0, 0);
    press('OPTION', 'EDIT');
    expect(getState().project.phrases[0].steps[0].note).toBe(null);
    // EDIT on the empty cell brings the deleted note back.
    press('EDIT');
    expect(getState().project.phrases[0].steps[0].note).toBe(60);
  });

  it('SHIFT + → carries the chain and phrase under the cursor along the view map', () => {
    keyDown('SHIFT');
    keyDown('RIGHT');
    keyUp('RIGHT');
    expect(getState().view).toBe('CHAIN');
    keyDown('RIGHT');
    keyUp('RIGHT');
    keyDown('UP');
    keyUp('UP');
    keyUp('SHIFT');
    // Groove sits above the phrase screen, as on the M8.
    expect(getState().view).toBe('GROOVE');
  });

  it('groove values accept 00 (skip step)', () => {
    setState({ view: 'GROOVE' });
    moveTo('GROOVE', 1, 0);
    typeKey('0');
    typeKey('0');
    expect(getState().project.grooves[0].steps[1]).toBe(0);
  });

  it('SHIFT + EDIT on a one-column selection interpolates', () => {
    openView('CHAIN');
    openView('PHRASE');
    moveTo('PHRASE', 0, 1);
    typeKey('1');
    typeKey('0');
    moveTo('PHRASE', 4, 1);
    typeKey('5');
    typeKey('0');
    moveTo('PHRASE', 0, 1);
    keyDown('SHIFT');
    keyDown('OPTION');
    keyUp('OPTION');
    keyUp('SHIFT');
    for (let i = 0; i < 4; i++) press('DOWN');
    press('SHIFT', 'EDIT');
    expect(getState().project.phrases[0].steps.slice(0, 5).map((s) => s.vel)).toEqual([0x10, 0x20, 0x30, 0x40, 0x50]);
  });

  it('OPTION + SHIFT mutes while held; releasing OPTION first latches it', () => {
    keyDown('OPTION');
    keyDown('SHIFT');
    expect(getState().project.mixer.mute[0]).toBe(true);
    keyUp('SHIFT');
    keyUp('OPTION');
    expect(getState().project.mixer.mute[0]).toBe(false);
    keyDown('OPTION');
    keyDown('SHIFT');
    keyUp('OPTION');
    keyUp('SHIFT');
    expect(getState().project.mixer.mute[0]).toBe(true);
  });

  it('OPTION + ← in a note selection fills every row with the last note', () => {
    openView('CHAIN');
    openView('PHRASE');
    moveTo('PHRASE', 0, 0);
    keyDown('SHIFT');
    keyDown('OPTION');
    keyUp('OPTION');
    keyUp('SHIFT');
    for (let i = 0; i < 3; i++) press('DOWN');
    keyDown('OPTION');
    keyDown('LEFT');
    keyUp('LEFT');
    keyUp('OPTION');
    expect(getState().project.phrases[0].steps.slice(0, 5).map((s) => s.note)).toEqual([60, 60, 60, 60, null]);
  });

  it('OPTION + SHIFT + PLAY clears every mute and nothing springs back', () => {
    setState({ view: 'SONG' });
    moveTo('SONG', 0, 2);
    keyDown('OPTION');
    keyDown('SHIFT');
    keyUp('OPTION');
    keyUp('SHIFT');
    expect(getState().project.mixer.mute[2]).toBe(true);
    keyDown('OPTION');
    keyDown('SHIFT');
    keyDown('PLAY');
    keyUp('PLAY');
    keyUp('SHIFT');
    keyUp('OPTION');
    expect(getState().project.mixer.mute.some(Boolean)).toBe(false);
  });

  it('OPTION three times bookmarks the chain', () => {
    press('OPTION');
    press('OPTION');
    press('OPTION');
    expect(getState().project.bookmarks).toEqual([0]);
  });

  it('UP UP on row 00 enters track reorder; EDIT + → moves the track', () => {
    press('UP');
    press('UP');
    expect(getState().reorder).toBe(true);
    keyDown('EDIT');
    keyDown('RIGHT');
    keyUp('RIGHT');
    keyUp('EDIT');
    expect(getState().project.song[0][0]).toBe(null);
    expect(getState().project.song[0][1]).toBe(0);
    press('DOWN');
    expect(getState().reorder).toBe(false);
  });

  it('EDIT twice on a TBL value makes a new, unused table', () => {
    openView('CHAIN');
    openView('PHRASE');
    moveTo('PHRASE', 0, 3);
    for (const k of 'tbl') typeKey(k);
    moveTo('PHRASE', 0, 4);
    press('EDIT');
    press('EDIT');
    expect(getState().project.phrases[0].steps[0].fx[0].val).toBe(0x80);
  });

  it('picking from the pool writes the instrument back into the phrase cell', () => {
    const p = getState().project;
    replaceProject({ ...p, instruments: { 0: defaultInstrument(), 2: { ...defaultInstrument(), type: 'WAVSYNTH', name: 'TWO' } } });
    openView('CHAIN');
    openView('PHRASE');
    moveTo('PHRASE', 0, 2);
    keyDown('EDIT');
    keyDown('DOWN');
    keyUp('DOWN');
    keyUp('EDIT');
    expect(getState().view).toBe('POOL');
    moveTo('POOL', 2, 0);
    press('EDIT');
    expect(getState().view).toBe('PHRASE');
    expect(getState().project.phrases[0].steps[0].inst).toBe(2);
    expect(getState().last.inst).toBe(2);
  });

  it('pool: X + → edits a mixer column, X + ↓ moves the slot, a bare X picks', () => {
    const p = getState().project;
    const ph = structuredClone(p.phrases[0]);
    ph.steps[0].inst = 1;
    replaceProject({ ...p, phrases: { 0: ph }, instruments: { 1: { ...defaultInstrument(), type: 'WAVSYNTH', name: 'ONE' } } });
    openView('POOL');
    moveTo('POOL', 1, 1);
    keyDown('EDIT');
    keyDown('RIGHT');
    keyUp('RIGHT');
    keyUp('EDIT');
    expect(getState().view).toBe('POOL');
    expect(getState().project.instruments[1].dry).toBe(0xc1);
    moveTo('POOL', 1, 0);
    keyDown('EDIT');
    keyDown('DOWN');
    keyUp('DOWN');
    keyUp('EDIT');
    expect(getState().project.instruments[2]?.name).toBe('ONE');
    expect(getState().project.phrases[0].steps[0].inst).toBe(2);
    press('EDIT');
    expect(getState().view).toBe('INST');
    expect(getState().ids.inst).toBe(2);
  });

  it('pool: Z + X on a mixer column resets that value, on the number column clears the slot', () => {
    const p = getState().project;
    replaceProject({ ...p, instruments: { 1: { ...defaultInstrument(), type: 'WAVSYNTH', cho: 0x40 } } });
    openView('POOL');
    moveTo('POOL', 1, 2);
    press('OPTION', 'EDIT');
    expect(getState().project.instruments[1]?.cho).toBe(0);
    moveTo('POOL', 1, 0);
    press('OPTION', 'EDIT');
    expect(getState().project.instruments[1]).toBeUndefined();
  });

  it('holding X + ↑ on a command opens the effect list; arrows move; letting go of X places it', () => {
    openView('CHAIN');
    openView('PHRASE');
    moveTo('PHRASE', 0, 3);
    keyDown('EDIT');
    keyDown('UP');
    keyUp('UP');
    expect(getState().fxPick).not.toBe(null);
    const start = getState().fxPick!;
    keyDown('DOWN');
    keyUp('DOWN');
    expect(getState().fxPick).toBe(start + 1);
    keyUp('EDIT');
    expect(getState().fxPick).toBe(null);
    expect(getState().project.phrases[0].steps[0].fx[0].cmd).toBeTruthy();
  });

  it('breadcrumb ids are what a click opens (the chain under the song cursor)', () => {
    const p = getState().project;
    const song = p.song.map((r) => [...r]);
    song[1][0] = 3;
    replaceProject({ ...p, song, chains: { ...p.chains, 3: p.chains[0] } });
    moveTo('SONG', 1, 0);
    expect(peekIds('CHAIN').ids.chain).toBe(3);
  });

  it('mixer: Shift + Z stores a snapshot, Shift + X recalls it', () => {
    openView('MIXER');
    keyDown('SHIFT');
    keyDown('OPTION');
    keyUp('OPTION');
    keyUp('SHIFT');
    const p = getState().project;
    replaceProject({ ...p, mixer: { ...p.mixer, master: 0x10 }, tempo: 90 });
    openView('MIXER');
    press('SHIFT', 'EDIT');
    expect(getState().project.mixer.master).toBe(0xe0);
    expect(getState().project.tempo).toBe(120);
  });

  it('pool: clearing a used slot says how many steps went silent', () => {
    const p = getState().project;
    replaceProject({ ...p, instruments: { 0: defaultInstrument() } });
    openView('POOL');
    moveTo('POOL', 0, 0);
    press('OPTION', 'EDIT');
    expect(getState().status).toMatch(/1 STEP NOW SILENT/);
  });

  it('commands with X or Z in them can be typed', () => {
    openView('CHAIN');
    openView('PHRASE');
    moveTo('PHRASE', 0, 3);
    for (const k of 'nxt') typeKey(k);
    expect(getState().project.phrases[0].steps[0].fx[0].cmd).toBe('NXT');
  });

  it('OPTION + → in the phrase view skips tracks with no chain on the song row', () => {
    const p = project();
    const ch = emptyChain();
    ch.rows[0] = { phrase: 1, tsp: 0 };
    p.chains[1] = ch;
    p.phrases[1] = emptyPhrase();
    p.song[0][2] = 1;
    replaceProject(p);
    setState({ view: 'SONG', track: 0 });
    moveTo('SONG', 0, 0);
    openView('PHRASE');
    press('OPTION', 'RIGHT');
    expect(getState().track).toBe(2);
    expect(getState().ids.phrase).toBe(1);
    press('OPTION', 'RIGHT');
    expect(getState().track).toBe(2);
    expect(getState().status).toMatch(/NO CHAIN/);
  });

  it('a pool pick sets the instrument that new notes get (M8 Instrument Pool, Shift + ←)', () => {
    const p = project();
    p.instruments[4] = { ...defaultInstrument(), type: 'WAVSYNTH' };
    replaceProject(p);
    setState({ instPinned: false });
    openView('POOL');
    moveTo('POOL', 4, 0);
    poolPick(true);
    openView('PHRASE');
    moveTo('PHRASE', 3, 0);
    press('EDIT');
    const step = getState().project.phrases[getState().ids.phrase].steps[3];
    expect(step.note).not.toBeNull();
    expect(step.inst).toBe(4);
  });

  it('Shift + ← / → from Mods go to Phrase and Table, as from the instrument', () => {
    openView('MODS');
    press('SHIFT', 'LEFT');
    expect(getState().view).toBe('PHRASE');
    openView('MODS');
    press('SHIFT', 'RIGHT');
    expect(getState().view).toBe('TABLE');
  });

  it('EQ: Shift + → on the EQ field opens the editor; OPTION and Shift + ← lead back', () => {
    const p = project();
    p.instruments[0] = { ...defaultInstrument(), type: 'WAVSYNTH' };
    replaceProject(p);
    setState({ ids: { ...getState().ids, inst: 0 } });
    openView('INST');
    const row = formFor(getState(), 'INST').fields.findIndex((f) => f.key.endsWith('.eq'));
    moveTo('INST', row, 0);
    press('SHIFT', 'RIGHT');
    expect(getState().view).toBe('EQ');
    expect(getState().project.instruments[0].eq).not.toBeNull();
    press('OPTION');
    expect(getState().view).toBe('INST');
    moveTo('INST', row, 0);
    press('SHIFT', 'RIGHT');
    press('SHIFT', 'LEFT');
    expect(getState().view).toBe('INST');
  });

  it('Scales: Shift + ← goes back to the project screen', () => {
    openView('SCALE');
    press('SHIFT', 'LEFT');
    expect(getState().view).toBe('PROJECT');
  });

  it('EQ field: EDIT + → steps the slot, a bare EDIT tap opens the editor', () => {
    replaceProject(project());
    openView('MIXER');
    const row = formFor(getState(), 'MIXER').fields.findIndex((f) => f.key === 'MASTER.eq');
    moveTo('MIXER', row, 0);
    keyDown('EDIT');
    press('RIGHT');
    keyUp('EDIT');
    expect(getState().view).toBe('MIXER');
    expect(getState().project.mixer.eq).toBe(0);
    press('EDIT');
    expect(getState().view).toBe('EQ');
    expect(getState().ids.eq).toBe(0);
  });

  it('a third EDIT right after EDIT EDIT does not make yet another chain', () => {
    press('EDIT');
    press('EDIT');
    const made = getState().project.song[0][0];
    press('EDIT');
    expect(getState().project.song[0][0]).toBe(made);
  });

  it('a deep clone keeps a repeated phrase as one copy used twice', () => {
    const p = project();
    p.chains[0].rows[1] = { phrase: 0, tsp: 0 };
    replaceProject(p);
    moveTo('SONG', 0, 0);
    keyDown('SHIFT');
    keyDown('OPTION');
    press('EDIT');
    press('EDIT');
    keyUp('OPTION');
    keyUp('SHIFT');
    const q = getState().project;
    const c = q.chains[q.song[0][0]!];
    expect(c.rows[0].phrase).not.toBe(0);
    expect(c.rows[1].phrase).toBe(c.rows[0].phrase);
  });
});
