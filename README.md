# Eight · Tracker

An eight-track tracker in the browser, after the Dirtywave M8 workflow, with a few Polyend
Tracker conveniences. Installable, works offline, black and white on the visual system in
`style.md`. The plan behind it is in `PLAN.md`.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # sequencer + fill-tool unit tests
npm run build        # typecheck, bundle, offline worker
npm run preview      # http://127.0.0.1:4175
npm run qa           # screenshots (1440 light/dark, 390) + keyboard, playback, offline checks
```

## How it is organised

| M8 idea    | Here                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| Song       | 256 rows × 8 tracks of chain numbers. Each track walks its own column.                 |
| Chain      | 16 rows of phrase + transpose; ends at the first empty row.                            |
| Phrase     | 16 steps: note, velocity, instrument, three commands.                                  |
| Instrument | WAVSYNTH, FMSYNTH (4 ops, 12 M8 algorithms), SAMPLER, HYPERSYNTH, MIDI OUT; filter, sends. |
| Mods       | 4 per instrument: AHD, ADSR, LFO → volume, pitch, cutoff, res, pan, amp.               |
| Table      | Restarts with every note, runs at TBL TIC; same number as the instrument.              |
| Groove     | Ticks per step (24 ticks per beat). `06 06` straight, `07 05` swing.                   |

From the Polyend Tracker: the **Fill** tool (every N / Euclidean / random, constant /
from–to / random values, scale filter), **step jump**, **pads** for note entry,
**reverse**, **decimal display** (Project → NUMBERS), undo/redo and WAV **render**.

## Getting around

The top bar is the M8 path, not a row of tabs: **Song › Chain › Phrase › Instrument**, each
showing the number it currently points at, plus **Mixer**. Clicking along the path carries
what is under the cursor (like Shift + →). Side screens live inside their place: Groove
under Phrase, Mods and Table under Instrument, Effects under Mixer. The project name opens
Project. **Teach** (next to it) starts a 15-step tour that points at one thing at a time and
waits for you to try it. **LIVE** (or Shift + ← on the song screen) is the M8 live mode: while
the song plays, Space cues the chain under the cursor and it starts when the track's current
chain ends; Space on a playing chain stops that track; ← + Space cues a whole row; Shift +
Space stops everything. **Perform** (under Mixer) holds Polyend-style momentary moves: DJ
filter, reverb freeze, delay throw, beat repeat, track mutes.

All M8 filter types (LP, HP, BP, BS, LP>HP, ZDF LP/HP, and on the Wavsynth WAV LP/HP/BP/BS,
which filter inside the wave and follow the note); sampler PLAY modes up to OSC REV, OSC PP
and REPITCH (STEPS against the song tempo), DETUNE and DEGRADE; Hypersynth with six chord
notes, SHIFT and SUBOSC.

Also on the M8 model: **user scales** (Project › Scales: 16 scales with per-note on/off and
tuning, used by note entry, pads, fill, SCA/SCG and playback), DRUM and TRIG envelopes,
mod destinations per type (Wavsynth SCAN/WARP/SIZE — wave-table sweeps —, FM operator levels,
Hypersynth SWARM, the three sends), mixer snapshots (Shift + Z / Shift + X), reverb
modulation (XRM/XRF), a render view with row range, track choice and stems, an
**instrument pool** (Instrument › Pool, above Mods on the view map: all 128 slots, mixer
columns, reorder; picking writes back into the phrase), an **EQ bank** (Mixer › EQ: 128 slots
of three bands with type, frequency, gain, Q and stereo/mid/side/left/right mode, shared by
instruments and the main mix, switched with EQI/EQM), **TRACKING** mods (note or velocity to a parameter), tempo-synced LFOs
(FREQ in steps), LIVE QUANTIZE (chain / bar / beat), bookmarks, track reorder, render
selection to instrument, a sample editor (crop, delete, duplicate, normalize, silence,
reverse, invert, fades, mono, downsample, 8-bit) on the sampler's S–E range, a **sample
recorder**, WAVETABLE and GRANULAR sampler modes (Polyend), the M8's 12 FM algorithms and 12
operator shapes with feedback, the **effect list** (X + ↑↓ on a command) and **live
recording** (● REC on the phrase screen: notes land at the playhead, timing kept as DEL).

## Keys (m8c layout)

Arrows move · **Shift + arrows** walk the view map · **X** = EDIT · **Z** = OPTION ·
**Space** = PLAY. X on an empty cell inserts the last value, X X makes a new chain/phrase/
instrument, X + arrows edits, Z + X deletes (on an empty note: OFF), Shift + Z selects,
Shift + X pastes, Shift + Z then X clones, Z + arrows jump between chains/phrases/tracks,
Z + Shift mutes (momentary; release Z first to latch), Z + Space solos, X + Space previews,
Z + arrows in a note selection fill or randomise. On the note column Q 2 W 3 E R … play
and write notes. A note without an instrument number is a legato pitch change, as on the M8.
The full list is on the Project screen. On a touch screen use the on-screen keys (hold one,
press another), the inspector and the pads. Hold a grid cell for a moment, then drag, to
select a block; the edit bar under the grid then offers copy, cut, clear, reverse and ±1. On a phone the
keyboard button next to undo / redo docks the eight M8 keys in the edit bar, right under the
grid. Two tabs on the same project stay in step: a save in one is picked up by the other.

## Commands

Sequencer: `ARP ARC CHA DEL GRV GGR HOP INS KIL OFF NTH NXT RET REP RTO RND RNL PSL PBN PVB
PVX SED SNG TBL TBX THO TIC TPO TSP`. Instrument (relative, as on the M8): `VOL PIT FIN CUT
RES AMP PAN SCH SDL SRV EA1 AT1 HO1 DE1 ET1 EA2 AT2 HO2 DE2 ET2 LA1 LF1 LT1 LA2 LF2 LT2 EQI`
and per type `SIZ MUL WRP STA LEN LOP SLI FMA–FMD SWM WID`. Mixer: `VMV EQM DJF DJC DJR DJT VCH
VDE VRE VT1–VT8 XCM XCF XCW XCR XDT XDF XDW XDR XRS XRD XRM XRF XRW XRZ`. Also `RMX SCA SCG`. Envelope times are in ticks. Hold the cursor on a
command to read its help in the inspector.

## Layout

```
src/core    pure TS: model, sequencer (tick state machine), grids, forms, fill
src/audio   WebAudio engine, built-in samples, offline render, WAV
src/state   store + undo, actions (key semantics), transport, persistence, demo
src/ui      screens and panels
```

Projects autosave to IndexedDB on this device; **Export** writes a JSON file that also
carries your own samples.
