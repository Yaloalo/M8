# screenshots

A scratch folder for UI work: before/after shots, theme comparisons, phone-width checks,
anything you capture while changing how the app looks.

**Nothing in here is committed.** `.gitignore` ignores the whole folder except this file,
so you can drop images in freely without ever touching a diff. Paste them into a PR or a
message instead — that is where they belong.

Suggested naming, so a folder full of them still reads:

```
<area>-<state>-<width>.png      drums-dark-390.png
                                 fundamentals-light-1440.png
                                 sequencer-pad-velocities.png
```

## What is here right now

A set captured from the production build, as a baseline to compare against:

| Files                                             | What they show                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `<area>-light-1440.png`, `<area>-dark-1440.png`   | Every main area at desktop width in both themes — `home`, `fundamentals`, `drums`, `piano`, `chords`, `circle`, `programs`, `ear`, `tuner` |
| `<area>-light-390.png`                            | The same areas at phone width                                                                                                              |
| `fundamentals-full-1440.png`                      | The whole theory article in one strip, top to bottom                                                                                       |
| `sequencer-pad-velocities-light.png`, `-dark.png` | The four pad states side by side: off, ghost (dashed + ring), normal (teal), accent (orange) — the pattern `style.md` §5.6 describes       |
| `scale-builder-5-notes.png`, `-7-`, `-12-`        | The article's scale builder at its three landmarks                                                                                         |

## Capturing one

The QA scripts already drive a real browser. `scripts/qa-browser.mjs` renders the visual
pass, and `scripts/qa-functional.mjs` takes shots at phone width in both themes; both
currently write to `/tmp/bass-qa/`, so copy what you need out of there.

For a one-off, run the preview server and point Playwright at it:

```bash
npm run build && npx vite preview --port 4175 --host 127.0.0.1
```

```js
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
for (const [theme, width] of [
  ['light', 1440],
  ['dark', 1440],
  ['light', 390],
]) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    colorScheme: theme,
  });
  await page.goto('http://127.0.0.1:4175/drums');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `screenshots/drums-${theme}-${width}.png`, fullPage: true });
  await page.close();
}
await browser.close();
```

Check every UI change at **1440 light, 1440 dark and 390 px** before calling it done —
see `style.md` §7.
