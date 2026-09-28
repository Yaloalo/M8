# Style Guide

The visual system behind this bass workstation, written so you can build a second music
app — a drum machine, a piano trainer, an ear-training tool — that looks like it came from
the same shop.

Everything below is the real system, read out of `src/styles.css`, `src/theme.css` and the
feature stylesheets. Where a number is quoted, it is the number the app actually ships.

**The two accents are turquoise and burnt orange.** Turquoise carries structure and
interaction; burnt orange carries the second voice — harmony, accents, the loud hit. They
are never interchangeable, and there is no third accent.

---

## 1 · Colour

### 1.1 Tokens

Every colour is a CSS custom property on `:root`. Components never hard-code a hex value
for anything that has a role — that is what makes one theme switch work everywhere.

| Token                           | Light     | Dark      | Role                                                                                                                       |
| ------------------------------- | --------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--accent`                      | `#0e7490` | `#79cddd` | **Turquoise.** The primary accent: active state, focus, links, selection, the brand mark.                                  |
| `--accent-light`                | `#dff3f7` | `#193a44` | Turquoise wash. Backgrounds behind an active or selected thing.                                                            |
| `--accent-border`               | `#bcdde4` | `#477888` | Turquoise hairline, softer than `--accent`, for panels that belong to an active area.                                      |
| `--chord`                       | `#b76500` | `#efbc71` | **Burnt orange.** The second voice: harmony, chord tones, the accented beat, warnings that are not errors.                 |
| `--chord-light`                 | `#fff0d5` | `#42341f` | Burnt-orange wash. Same job as `--accent-light`, for the second voice.                                                     |
| `--ink`                         | `#1d2733` | `#e1e9ef` | Body text and anything that must be read.                                                                                  |
| `--muted`                       | `#64717b` | `#a6b7c3` | Secondary text, labels, captions, axis ticks.                                                                              |
| `--line`                        | `#dce2e5` | `#344653` | Every border and divider.                                                                                                  |
| `--surface`                     | `#fff`    | `#1b2934` | Cards, panels, the header.                                                                                                 |
| `--surface-raised`              | `#fff`    | `#233440` | A surface sitting _on_ another surface. Identical in light, lighter in dark.                                               |
| `--surface-subtle`              | `#f4f8f9` | `#17242e` | Recessed areas: figure backgrounds, inset strips, table zebra.                                                             |
| `--green`                       | `#327a5b` | `#8bd2ad` | Correct, in tune, on target. Never decorative.                                                                             |
| `--danger`                      | `#b4392c` | `#f0a094` | Destructive actions and errors only.                                                                                       |
| `--danger-light`                | `#fbeae7` | `#3d211c` | Wash behind a destructive control.                                                                                         |
| `--tool-active-ink`             | `#fff`    | `#102a34` | Text **on** a filled accent. Do not use plain white — in dark mode the accent is light and white text on it is unreadable. |
| `--pad-off` / `--tool-grid-off` | `#f2f5f7` | `#253744` | An empty cell in a sequencer or grid.                                                                                      |
| `--rail-bg`                     | `#fff`    | `#1b2934` | Side rails and instrument lists.                                                                                           |
| `--scope-ink`                   | `#4b5a66` | `#9db0bd` | Text inside a scope/analyser, one step quieter than `--muted`.                                                             |
| `--header`                      | `124px`   | same      | Height of the fixed header. Used for `scroll-margin-top` and sticky offsets.                                               |

Light values live in `:root` in `src/styles.css`. Dark values live in
`:root[data-theme='dark']` in `src/theme.css`. `--danger` and `--danger-light` are defined
in `theme.css` for both themes.

### 1.2 Roughly how much of each you should use

Measured over the shipped stylesheets — use it as a sanity check on a new screen:

```
--accent        211 uses   ████████████████████
--muted         178        █████████████████
--line          143        ██████████████
--accent-light   40        ████
--chord          39        ███
--chord-light    15        █
--green          16        █
--danger          4        ▏
```

If `--chord` outnumbers `--accent` on your screen, the screen is shouting. Burnt orange is
a soloist, not a section.

### 1.3 Rules

- **Never colour alone.** Any state signalled by colour is also signalled by shape,
  weight, fill, border style or a mark. The sequencer's four velocities differ by fill
  height, mark size **and** border style; colour is the fourth cue, not the only one.
- **Text on a filled accent uses `--tool-active-ink`**, never `#fff`.
- **Add a token before adding a hex.** If you need a new colour, it has a role; give it a
  name and define it in both themes in the same commit.
- **Do not hard-code a light colour and patch it in dark mode.** See §8 for why.

---

## 2 · Theming

The theme is a data attribute on `<html>`, set from JavaScript:

```ts
document.documentElement.dataset.theme = 'light' | 'dark';
```

`src/lib/theme.ts` owns this. It reads `matchMedia('(prefers-color-scheme: dark)')`,
applies the theme **before React mounts**, listens for system changes, and also rewrites
`<meta name="theme-color">` so the browser chrome follows. Nothing is persisted — a fresh
tab always starts from the system setting.

Consequence for CSS: **write `:root[data-theme='dark']`, not
`@media (prefers-color-scheme: dark)`.** The media query would fight the manual override.
There is not one in the whole codebase.

```css
/* correct */
:root[data-theme='dark'] .my-panel {
  background: var(--surface-raised);
}

/* wrong — ignores the toggle */
@media (prefers-color-scheme: dark) { … }
```

Better still: don't write a dark rule at all. If the component is built from tokens, it
themes itself.

```tsx
import { useTheme } from '../lib/theme';
const theme = useTheme(); // 'light' | 'dark', for canvas/SVG that cannot read CSS vars
```

---

## 3 · Shape and depth

### 3.1 Border radius

One scale, picked by element size. Bigger box, bigger radius.

| Radius   | Use                                                      |
| -------- | -------------------------------------------------------- |
| `3px`    | Tiny marks, `kbd`, bar-chart caps                        |
| `4px`    | Inputs, selects, pads, pills, sequencer cells            |
| `5px`    | Buttons, notices, segmented controls                     |
| `6px`    | Chips, secondary buttons                                 |
| `7px`    | **Panels and cards** — the most common radius in the app |
| `8px`    | Figures, spectra strips, inset blocks                    |
| `9–10px` | Large containers with something interactive inside       |
| `50%`    | Dots, knobs, LEDs                                        |
| `999px`  | Full pills (rare — a tag, not a button)                  |

Partial radii are for joined pieces: a strip sitting directly on top of a bar uses
`8px 8px 0 0` above and `0 0 8px 8px` below.

### 3.2 Borders

**Almost everything is `1px solid var(--line)`** — 165 of 188 border declarations.

| Width | Meaning                                                                            |
| ----- | ---------------------------------------------------------------------------------- |
| `1px` | The default. Structure, without emphasis.                                          |
| `2px` | Selected, active, or the loudest state. Also `2px dashed` for a provisional value. |
| `3px` | A left accent bar on a callout, or a focus ring.                                   |

A border that changes to `var(--accent)` means _you are here_ or _this is on_. A border
that changes to `var(--chord)` means _this is the accented one_.

### 3.3 Elevation

There is **almost no drop shadow**. Depth comes from borders and surface tokens, which is
why the app survives dark mode without a repaint.

The four that exist:

```css
/* the sticky header — a hairline, not a shadow */
box-shadow: 0 1px 0 var(--line);
/* an element lifted off the page while it is dragged */
box-shadow: 0 6px 18px rgb(15 26 34 / 0.18);
/* a floating menu rendered into a portal */
box-shadow: 0 18px 44px rgb(15 26 34 / 0.24);
/* a ring on something that must not change size */
box-shadow: inset 0 0 0 2px var(--accent);
```

Both real shadows belong to something that has genuinely left the page: a dragged item and
a portalled menu. Nothing that merely sits on the page gets one. Use `inset 0 0 0 2px`
rather than a border whenever a 2px border would shift layout — on a grid cell, for
example.

---

## 4 · Typography

```css
font-family: Inter, 'Segoe UI', Arial, sans-serif;
```

Inter is **not bundled or fetched** — no `@font-face`, no Google Fonts link. It is used if
the reader has it installed, otherwise Segoe UI or Arial. Do not design anything that
breaks if Inter is absent, and if you add a webfont, add it to the offline precache too.

### 4.1 Scale

The app is label-dense, so the scale runs small. The most common sizes by a wide margin
are 12px, 11px and 13px.

| Size                  | Use                                                                          |
| --------------------- | ---------------------------------------------------------------------------- |
| `36px / 650 / -1.2px` | `h1` — one per page                                                          |
| `23px`                | Article chapter heading                                                      |
| `16px / 650`          | `h2` — section heading                                                       |
| `15px`                | Article body                                                                 |
| `14px / 1.7`          | `p` — default body, colour `--muted`                                         |
| `13px`                | Buttons, inputs, secondary body                                              |
| `12px`                | Captions, table cells, notices                                               |
| `11px`                | Chips, facts, table headers                                                  |
| `10px`                | **`.eyebrow` / `.small-label`** — uppercase, `letter-spacing: 1.55px`, `650` |
| `8–9px`               | Brand sub-label, key names on the piano                                      |

Weights: `550` buttons, `600` links and pills, `650` headings and labels, `700–750` brand.
There is no `400` and no `bold` keyword.

### 4.2 Two reusable label classes

```css
.eyebrow,
.small-label {
  font-size: 10px;
  letter-spacing: 1.55px;
  font-weight: 650;
  text-transform: uppercase;
  color: var(--muted);
}
```

`.eyebrow` adds `margin-bottom: 12px`. Inside `.page-heading` it turns
`color: var(--accent)` and drops to 9px. Use it above every heading and above every group
of controls — it is the single strongest signal that a screen belongs to this app.

### 4.3 Numbers

Anything that updates live gets `font-variant-numeric: tabular-nums`, so a readout does
not jitter as digits change. Tempo, frequency, cents, bar counts, timers.

---

## 5 · Components

### 5.1 Button

```css
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  padding: 8px 13px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: white;
  color: var(--ink);
  font-size: 13px;
  font-weight: 550;
  line-height: 1.25;
}
button:hover {
  border-color: #98a9b1;
  background: #f4f7f8;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
```

`min-height: 38px` is the touch target and applies to `select` too. Variants:

| Class          | What it is                                                                             |
| -------------- | -------------------------------------------------------------------------------------- |
| `.primary`     | Filled turquoise: `background`/`border-color: var(--accent)`, text `--tool-active-ink` |
| `.icon-button` | `padding: 8px; min-width: 38px` — square                                               |
| `.text-link`   | Borderless, 12px, `600`, `var(--accent)`, `gap: 9px`                                   |
| `.pill`        | 11px tag, `4px 8px`, radius 4, `--muted`. Not clickable.                               |

### 5.2 Toggle chip

The workhorse of every tool screen — instrument pickers, presets, modes, step counts.

```css
.chips button {
  padding: 7px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  font-size: 12.5px;
  font-weight: 650;
  color: var(--muted);
}
.chips button:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.chips button.active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--tool-active-ink);
}
```

Always mirror the visual state into `aria-pressed`. A chip may carry a `<small>` second
line (10px, `500`) for a subtitle.

### 5.3 Panel

```css
.panel {
  background: var(--surface); /* ships as `white` — see §8 */
  border: 1px solid var(--line);
  border-radius: 7px;
  margin-bottom: 22px;
  overflow: hidden;
}
.panel-heading {
  padding: 18px 22px;
  border-bottom: 1px solid var(--line); /* ships as #e8edf0 */
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
}
```

The heading holds a `.small-label` on the left and `.panel-tools` (flex, `gap: 18px`) on
the right. `overflow: hidden` is what lets a full-bleed grid sit inside a rounded panel.

There is also a `<Panel>` component in `src/components/UI.tsx` if you want the markup for
free, and `<Section>` for a collapsible `<details>` panel with an `<h2>` summary.

### 5.4 Notice / callout

```css
.notice {
  padding: 17px 20px;
  border: 1px solid var(--accent-border); /* ships as #bedae2 */
  border-left: 3px solid var(--accent);
  border-radius: 5px;
  background: var(--accent-light); /* ships as #edf7fa */
  font-size: 12px;
  line-height: 1.75;
  margin-bottom: 22px;
}
```

Swap `--accent*` for `--chord*` when the note is a caveat, `--danger*` when it is a
consequence. The 3px left bar is the constant.

### 5.5 Page heading

```tsx
<PageHeading
  eyebrow="MUSIKTHEORIE / GRUNDLAGEN"
  title="Woher unsere Töne kommen"
  description="One or two sentences, max-width 780px."
/>
```

Flex row, `gap: 25px`, `margin-bottom: 29px`, optional `.heading-actions` on the right with
`padding-top: 23px` so the buttons sit on the title's baseline.

### 5.6 Sequencer grid — read this before building a drum app

The pad grid is the most transferable piece here. It is one CSS grid per row, sharing a
column template so every row lines up:

```css
.sequencer {
  --rail: 222px;
  --step-min: 34px;
  --row-h: 40px;
}
.track-row {
  display: grid;
  grid-template-columns: var(--rail) repeat(var(--steps), minmax(var(--step-min), 1fr));
}
```

`--steps` is set inline from React (`style={{ '--steps': pattern.steps }}`). The rail is
the instrument name; every step is a `<button>`.

Pad states — note that each one changes **three** things, not just colour:

| State        | Fill  | Border                                     | Mark          | Colour     |
| ------------ | ----- | ------------------------------------------ | ------------- | ---------- |
| off          | —     | `1px solid var(--line)`                    | 4px dot, 35 % | `--muted`  |
| soft `v-1`   | 26 %  | `1px **dashed** var(--accent)`             | 11px **ring** | `--accent` |
| normal `v-2` | 52 %  | `1px solid var(--accent)`                  | 13px dot      | `--accent` |
| accent `v-3` | 100 % | `2px solid var(--chord)` + `inset 0 3px 0` | 13px dot      | `--chord`  |

The fill is a `::before` at `height: var(--fill)` with `opacity: 0.18` in `currentColor`,
so one rule serves all four states. Bar lines are `border-left: 2px solid var(--muted)` on
every `.is-bar` cell.

Touch sizing bumps the same variables — including the rail, which gives the steps back
their width on a narrow screen:

```css
@media (pointer: coarse), (max-width: 1100px) {
  .sequencer {
    --rail: 200px;
    --row-h: 44px;
    --step-min: 44px;
  }
}
@media (max-width: 600px) {
  .sequencer {
    --rail: 164px;
    --step-min: 42px;
  }
}
```

### 5.7 Icons

```tsx
<Icon name="play" size={14} />
```

`src/components/UI.tsx`, default `size = 18`. Inline SVG using `currentColor`, so an icon
inherits its button's state colour for free. 14px inside buttons, 18px standalone.

---

## 6 · Layout

| Value             | Meaning                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `--header: 124px` | Header height. Sticky things offset by it; anchors use `scroll-margin-top: calc(var(--header) + 20px)`. |
| `73px`            | Top bar row inside the header                                                                           |
| `222px`           | Chapter sidebar width                                                                                   |
| `1800px`          | Max content width on wide screens                                                                       |
| `1180px`          | Max width for a reading column page                                                                     |
| `76ch`            | Max width for prose                                                                                     |
| `38px 42px 90px`  | Main content padding (top, sides, bottom)                                                               |

Gaps: `6px` inside a control cluster, `12px` between controls, `18–24px` between groups,
`22px` between panels, `30px` between article sections.

### Breakpoints

```
1450px  wide desktop reflow
1150px  sidebar and multi-column layouts collapse
1050px  tool panels stack
 900px  two columns become one
 700px  compact controls
 600px  phone — 22 rules, the one you must actually test
```

Plus `@media (pointer: coarse), (max-width: 1100px)` for touch sizing, which is a
capability query and not a width breakpoint. Test at **390 px**; the app must never
scroll horizontally.

---

## 7 · Accessibility — non-negotiable

These are load-bearing. A new screen that breaks one of them is a bug.

**Focus ring.** Global, high contrast, offset so it never touches the control:

```css
:is(button, a, input, select, textarea, [tabindex]):focus-visible {
  outline: 3px solid #299ab3;
  outline-offset: 3px;
}
```

Inside dense grids where 3px would collide, the pad pattern substitutes
`outline: 2px solid var(--accent); outline-offset: 1px; box-shadow: 0 0 0 4px var(--accent-light)`.

**Reduced motion.** Honoured globally — respect it in anything you add:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    scroll-behavior: auto !important;
    transition: none !important;
    animation: none !important;
  }
}
```

**Also true of this app, and worth keeping:**

- Every control has a visible label or an `aria-label`; sliders state their unit and give
  an `aria-valuetext`.
- State is in the DOM (`aria-pressed`, `aria-current`), not only in a class.
- Touch targets are ≥ 38px, ≥ 44px on coarse pointers.
- Colour is never the only carrier of meaning (§1.3).
- Audio only ever starts from a user gesture, and there is always one visible control that
  stops everything.

---

## 8 · Conventions

**Formatting.** Prettier: 2 spaces, single quotes, `printWidth: 100`. Run
`npx prettier --write` before committing; CI checks it.

**File layout.** `src/styles.css` holds tokens, element defaults and the shell. Each
feature gets its own stylesheet (`drums.css`, `piano.css`, `tuner.css`, …) imported by the
page that needs it. A new tool = a new stylesheet, not more lines in `styles.css`.

**Class names.** Plain kebab-case, no BEM, no CSS modules, no utility classes. Block-ish
prefixes namespace a feature (`.pad`, `.pad-mark`, `.track-row`). States use `is-` or
`v-N` (`.is-bar`, `.is-wolf`, `.v-3`); `.active` is the exception, used for chips.

**Comments.** The codebase explains _why_, never _what_. Keep that:

```css
/* Four velocities differ by fill height, mark shape AND border, never colour alone. */
```

**Prefer tokens and layout over overrides.** There is one `!important` in the sequencer,
for a genuine specificity conflict. Adding a second needs a reason in a comment.

### The one mistake this codebase already made

Several of the oldest components — `.panel`, `.panel-heading`, `.notice`, `.topbar`,
`.app-header`, the card classes — hard-code light colours (`white`, `#e8edf0`, `#edf7fa`).
They work in dark mode only because `src/theme.css` carries a long patch list that repaints
them:

```css
:root[data-theme='dark']
  :is(
    .app-header,
    .mega-menu,
    .panel,
    .quick-card,
    .formula-strip,
    .timer,
    .exercise-card,
    .program-card,
    .search-dialog,
    .book-cover,
    .skip-link
  ) {
  background: var(--surface);
  color: var(--ink);
  border-color: var(--line);
}
```

That list is a liability. Every new component has to be remembered and appended, a missed
entry is an invisible bug that only shows in one theme, and the rule is a single multi-line
selector that text-editing tools love to mangle.

**In a new app, don't start that list.** Write `var(--surface)` the first time and the
patch block never needs to exist. Everything written since — the article, the labs, the
tuner, the circle — is built that way and has no dark-mode rules at all.

Treat a `/* ships as … */` comment in this guide as "the shipped file is on the old
pattern; write the token version".

---

## 9 · Starting a second app

A drum app in this system, in order:

1. Copy `src/styles.css` (tokens + element defaults + shell) and `src/theme.css`
   (dark values) unchanged. Copy `src/lib/theme.ts` and call `initializeTheme()` before
   `createRoot`. You now have both themes, focus rings, reduced motion and the type scale.
2. Copy `src/components/UI.tsx`. It carries `Icon`, `PageHeading`, `usePageTitle`,
   `Panel`, `Section`, `Segmented`, `Pill`, `ReferenceTable` and `ItemLink` — the whole
   chrome vocabulary, already themed.
3. Build screens from `.panel` + `.panel-heading` + `.eyebrow`. Do not invent a container.
4. Turquoise is _on / selected / here_. Burnt orange is the _accented_ one — the loud hit,
   the downbeat, the chord tone. Keep the ratio from §1.2.
5. For any grid, copy the `--steps` / `--step-min` / `--row-h` pattern from §5.6 rather
   than writing a new one, and give every state three cues.
6. Keep the PWA parts: `manifest.webmanifest`, `scripts/build-sw.mjs`, and the
   registration in `src/main.tsx`. Offline is part of the product, not an extra.
7. Test at 390 px, in both themes, with the keyboard only, before calling it done.

### A minimal new component

```tsx
import '../mytool.css';

export function StepPanel({ steps, on, toggle }: Props) {
  return (
    <section className="panel">
      <header className="panel-heading">
        <span className="small-label">Pattern</span>
        <div className="panel-tools">
          <button type="button" className="primary">
            Start
          </button>
        </div>
      </header>
      <div className="step-grid" style={{ '--steps': steps } as React.CSSProperties}>
        {Array.from({ length: steps }, (_, i) => (
          <button
            key={i}
            type="button"
            className={`step ${on.has(i) ? 'is-on' : ''} ${i % 4 === 0 ? 'is-bar' : ''}`}
            aria-pressed={on.has(i)}
            aria-label={`Schritt ${i + 1}`}
            onClick={() => toggle(i)}
          />
        ))}
      </div>
    </section>
  );
}
```

```css
.step-grid {
  display: grid;
  grid-template-columns: repeat(var(--steps), minmax(34px, 1fr));
  gap: 4px;
  padding: 14px 18px;
}
.step {
  min-height: 40px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--pad-off);
}
.step.is-on {
  border-color: var(--accent);
  background: var(--accent-light);
  color: var(--accent);
}
.step.is-bar {
  border-left: 2px solid var(--muted);
}
@media (pointer: coarse) {
  .step {
    min-height: 44px;
  }
}
```

That component needs no dark-mode rule, no focus rule and no reduced-motion rule. It
inherits all three. That is the point of the system.
