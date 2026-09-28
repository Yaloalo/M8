# M8-style tracker as a PWA — plan

A browser recreation of the Dirtywave M8 workflow with a few Polyend Tracker conveniences,
built on the visual system in `style.md`, rendered in black and white.

## What is being recreated

**M8 (core model, kept literally)**

- 8 monophonic tracks. **Song** = 256 rows × 8 tracks, each cell a chain number.
- **Chain** = 16 rows of `PHRASE` + `TSP` (transpose). Ends at the first empty row.
- **Phrase** = 16 steps of `N` (note/OFF), `V` (velocity), `I` (instrument), `FX1–FX3`
  (3-letter command + byte value).
- Each track walks its own song column independently: a chain finishes → next song row;
  an empty song row → back to the top of that track's block. Chains of different lengths
  drift against each other — that is the M8's polymeter.
- **Instruments** (128): WAVSYNTH, FMSYNTH, SAMPLER, HYPERSYNTH, MIDI OUT, plus common
  filter / amp / limiter / pan / sends. **Mods**: 4 slots per instrument (AHD, ADSR, LFO).
- **Tables** (one per instrument by default): 16 rows of transpose, volume, 3 FX; run at
  the instrument's `TBL TIC` speed alongside the phrase.
- **Grooves**: ticks per step, looping (default `06 06`; swing = `07 05`). 24 ticks/beat.
- **Mixer** + **effects** (chorus, delay, reverb sends, DJ filter, limiter).
- **View map** navigated with SHIFT + arrows:

  ```
            PROJECT
  SONG  ·  CHAIN  ·  PHRASE  ·  INST  ·  TABLE
  MIXER            GROOVE     MODS
  EFFECTS
  ```

- **Keys**: ← ↑ ↓ →, OPTION (Z), EDIT (X), SHIFT (Shift), PLAY (Space) — the m8c defaults.
  EDIT inserts the last value, EDIT + arrows edits, OPTION + EDIT deletes, EDIT EDIT
  creates a new unused chain/phrase, SHIFT + OPTION starts a selection, SHIFT + EDIT pastes,
  OPTION + SHIFT mutes, OPTION + PLAY solos.
- Sequencer FX: ARP CHA DEL GRV HOP KIL RET RND PSL PBN PVB TBL THO TIC TPO TSP OFF, and
  instrument/mixer FX VOL PIT CUT RES AMP PAN SCH SDL SRV DJF VMV.

**Polyend Tracker (borrowed where the web benefits)**

- **Fill tool** on a selection: where (all / empty / existing), pattern (every N /
  Euclidean / random density), value (constant / from–to / random), scale filter.
- **Step jump** (cursor advances N rows after note entry).
- **Pad keyboard** for touch note entry, scale-highlighted.
- **Undo / redo**, **reverse** and **transpose** on selections.
- **Decimal / hex** display switch (Polyend defaults to decimal, M8 to hex).
- **Render** to WAV (M8 render view / Polyend render selection).

## Web adaptations

- Mouse/touch: click a cell to move the cursor; on-screen M8 key cluster for touch;
  inspector with +/- and help for the cell under the cursor; drag to select.
- Direct entry: hex digits on value columns, piano row (Q2W3ER5T6Y7U…) on note columns,
  Delete clears, Ctrl+Z / Ctrl+Shift+Z, Ctrl+C / X / V.
- Autosave to IndexedDB, import/export JSON, a demo song on first launch.
- Offline via service worker; installable via manifest.

## Architecture

```
src/core     pure TS: types, defaults, formatting, fx table, sequencer state machine, fill
src/audio    WebAudio: engine (graph, voices, instruments, effects), built-in samples, render
src/state    store (immutable updates, undo), persistence (IndexedDB)
src/ui       views (song, chain, phrase, inst, mods, table, groove, mixer, effects, project),
             grid, form, keys, inspector, transport, view map
```

- The sequencer is a tick state machine with no WebAudio in it — it calls an `Output`
  interface with timestamps, so the same code drives live playback (lookahead scheduler)
  and offline render, and it is unit-testable.
- UI follows playback through a timestamped event queue drained in `requestAnimationFrame`.

## Styling (style.md, black and white)

- Tokens copied from the bass workstation, with `--accent` and `--chord` mapped to greys
  — *on / here* is black-on-white fill, *accented* is a heavier 2px border + inset bar.
  Every state keeps three non-colour cues (fill, border style, mark).
- `data-theme` on `<html>`, no `prefers-color-scheme` media query in CSS.
- Panels, `.panel-heading`, `.eyebrow`, chips, the dark bottom transport bar.
- Grid cells in a monospace stack with `tabular-nums`; 390 px without horizontal scroll.

## Order of work

1. Scaffold (Vite + React + TS), tokens, theme, shell, PWA files.
2. Core model + sequencer + tests.
3. Audio engine, instruments, effects, built-in samples, render.
4. Store, undo, persistence, demo song.
5. Views + key handling + inspector + fill tool.
6. QA: typecheck, unit tests, Playwright screenshots (1440 light/dark, 390), offline.
