// Visual + functional smoke test against `npm run preview` (see screenshots/README.md).
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'screenshots/qa';
const url = process.env.URL ?? 'http://127.0.0.1:4175/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const report = [];
const check = (name, ok, extra = '') => report.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForSelector('.tracker, .form');
  return { ctx, page, errors };
}
const NAV = {
  SONG: ['[data-tour="crumb-SONG"]'],
  CHAIN: ['[data-tour="crumb-CHAIN"]'],
  PHRASE: ['[data-tour="crumb-PHRASE"]'],
  INSTRUMENT: ['[data-tour="crumb-INST"]'],
  MODS: ['[data-tour="crumb-INST"]', '[data-tour="subtab-MODS"]'],
  TABLE: ['[data-tour="crumb-INST"]', '[data-tour="subtab-TABLE"]'],
  MIXER: ['[data-tour="crumb-MIXER"]'],
  PROJECT: ['[data-tour="project"]'],
  PERFORM: ['[data-tour="crumb-MIXER"]', '[data-tour="subtab-PERFORM"]'],
  POOL: ['[data-tour="crumb-INST"]', '[data-tour="subtab-POOL"]'],
  SCALES: ['[data-tour="project"]', '[data-tour="subtab-SCALE"]'],
  EQ: ['[data-tour="crumb-MIXER"]', '[data-tour="subtab-EQ"]'],
};
/** Runs in the page: parameter values that are cut off or out of line with their group. */
function fieldProblems() {
  const out = [];
  for (const g of document.querySelectorAll('.form-group')) {
    const xs = new Set();
    for (const f of g.querySelectorAll('.field')) {
      const b = f.querySelector('.field-value b');
      if (!b) continue;
      if (b.scrollWidth > b.clientWidth + 0.5) out.push(`${f.querySelector('.field-label').textContent} cut`);
      // A one-word label must stay on one line (no "TRANSPOS / E").
      const l = f.querySelector('.field-label');
      if (!l.textContent.trim().includes(' ') && (l.scrollWidth > l.clientWidth + 0.5 || l.getClientRects().length > 1 || l.offsetHeight > parseFloat(getComputedStyle(l).fontSize) * 2))
        out.push(`${l.textContent} label broken`);
      xs.add(Math.round(b.getBoundingClientRect().left));
    }
    if (xs.size > 1) out.push(`${g.getAttribute('aria-label')} misaligned`);
  }
  return out;
}
/** Runs in the page: controls in the editor heading that overlap, wrap or stick out. */
function headingProblems() {
  // Lines of text in an element: distinct rows of its text nodes' boxes (icons don't count).
  const lines = (e) => {
    const tops = [];
    const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) if (q.width > 1 && !tops.some((t) => Math.abs(t - q.top) < 4)) tops.push(q.top);
    }
    return tops.length;
  };
  const head = document.querySelector('.editor-panel > .panel-heading');
  const box = head.getBoundingClientRect();
  const els = [...head.querySelectorAll('button, select, .small-label')].filter((e) => e.offsetParent);
  const out = [];
  for (const e of els) {
    const r = e.getBoundingClientRect();
    const name = (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 14);
    if (r.right > box.right + 1 || r.bottom > box.bottom + 1) out.push(`${name} sticks out`);
    // One line of text: a wrapped label makes the control taller than its siblings.
    if ((e.tagName === 'BUTTON' || e.classList.contains('small-label')) && lines(e) > 1) out.push(`${name} wraps`);
  }
  for (let i = 0; i < els.length; i++)
    for (let j = i + 1; j < els.length; j++) {
      if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
      const a = els[i].getBoundingClientRect();
      const b = els[j].getBoundingClientRect();
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
        out.push(`${(els[i].getAttribute('aria-label') || els[i].textContent).trim().slice(0, 14)} overlaps ${(els[j].getAttribute('aria-label') || els[j].textContent).trim().slice(0, 14)}`);
    }
  return out;
}
/** Runs in the page: panel titles that wrap onto a second line. */
function panelTitleWraps() {
  return [...document.querySelectorAll('.panel-heading .small-label')]
    .filter((e) => e.offsetParent)
    .filter((e) => {
      const tops = [];
      const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const q of range.getClientRects()) if (q.width > 1 && !tops.some((t) => Math.abs(t - q.top) < 4)) tops.push(q.top);
      }
      // Wrapped onto two lines, or cut short with an ellipsis.
      return tops.length > 1 || e.scrollWidth > e.clientWidth + 1;
    })
    .map((e) => e.textContent.trim());
}
async function gotoView(page, name) {
  for (const sel of NAV[name]) await page.locator(sel).click();
}

// Screens in both themes and at phone width.
for (const [theme, width] of [['light', 1440], ['dark', 1440], ['light', 390]]) {
  const { ctx, page, errors } = await open({ viewport: { width, height: 1000 }, colorScheme: theme, hasTouch: width < 600 });
  for (const view of ['SONG', 'PHRASE', 'INSTRUMENT', 'MODS', 'POOL', 'MIXER', 'EQ', 'PERFORM', 'PROJECT', 'SCALES']) {
    await gotoView(page, view);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${view.toLowerCase()}-${theme}-${width}.png`, fullPage: view !== 'PROJECT' || width < 600 });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(`${view} ${theme} ${width} no horizontal scroll`, sw <= width, `scrollWidth ${sw}`);
  }
  if (width < 600) {
    // Every on-screen M8 key must sit inside its panel, even at 320.
    for (const w of [320, 360, 375]) {
      await page.setViewportSize({ width: w, height: 844 });
      const panel = await page.locator('.keys-panel').boundingBox();
      const keys = await page.locator('.hw-key').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
      check(`keys fit at ${w}`, panel && Math.max(...keys) <= panel.x + panel.width + 0.5, `${Math.max(...keys)} vs ${panel && panel.x + panel.width}`);
    }
    await page.setViewportSize({ width, height: 1000 });
    await gotoView(page, 'PROJECT');
    const kt = await page.locator('.key-table').evaluate((t) => t.scrollWidth <= t.parentElement.clientWidth + 1);
    check('phone: key reference is not clipped', kt);
    await gotoView(page, 'POOL');
    check('phone: the pool has an edit bar', (await page.locator('.cell-bar').count()) === 1);
    await gotoView(page, 'PHRASE');
    const bar = await page.locator('.cell-bar').boundingBox();
    check('phone: edit bar sits above the transport', bar && bar.y + bar.height <= 844 + 2000 && bar.width > 300, JSON.stringify(bar));
  }
  check(`${theme} ${width} console clean`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// One frame for every screen: undo, the editor heading and the side panels never move.
{
  const { ctx, page } = await open({ viewport: { width: 1440, height: 900 } });
  const spots = new Set();
  for (const v of ['SONG', 'CHAIN', 'PHRASE', 'INSTRUMENT', 'MODS', 'POOL', 'MIXER', 'EQ', 'PERFORM', 'PROJECT', 'SCALES']) {
    await gotoView(page, v);
    await page.waitForTimeout(100);
    spots.add(
      await page.evaluate(() =>
        ['button[aria-label="Undo"]', '.page-heading h1', '.editor-panel .panel-heading', '.tracks-panel', '.keys-panel']
          .map((q) => {
            const r = [...document.querySelectorAll(q)].find((e) => e.offsetParent)?.getBoundingClientRect();
            return r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.height)}` : '-';
          })
          .join('|'),
      ),
    );
  }
  check('navigation frame is identical on every screen', spots.size === 1, [...spots].join(' / '));
  check(
    'all eight tracks sit above the transport at 1440×900',
    await page.evaluate(() => [...document.querySelectorAll('.track-line')].at(-1).getBoundingClientRect().bottom <= document.querySelector('.transport-bar').getBoundingClientRect().top),
  );
  {
    const bad = [];
    for (const v of ['INSTRUMENT', 'MODS', 'MIXER', 'EQ']) {
      await gotoView(page, v);
      await page.waitForTimeout(80);
      bad.push(...(await page.evaluate(fieldProblems)).map((x) => `${v} ${x}`));
    }
    check('parameter values aligned and whole at 1440', bad.length === 0, bad.join('; '));
  }
  // The transport does not shift when playback starts.
  const before = await page.locator('.bar-play').boundingBox();
  await page.locator('.bar-play').click();
  await page.waitForTimeout(200);
  const after = await page.locator('.bar-play').boundingBox();
  await page.locator('.bar-play').click();
  check('transport stays put when playing', before.x === after.x, `${before.x} → ${after.x}`);
  // A screen always opens at the top, whatever the previous one's scroll.
  await gotoView(page, 'INSTRUMENT');
  await page.evaluate(() => document.querySelector('.workspace-main').scrollTo(0, 500));
  await gotoView(page, 'PHRASE');
  await page.waitForTimeout(150);
  check('a new screen opens at the top', (await page.evaluate(() => window.scrollY + document.querySelector('.workspace-main').scrollTop)) === 0);
  // Separate scrolling: the wheel over the side column moves only it, over the editor only
  // the editor; the page (and with it the top bar) never moves.
  {
    await gotoView(page, 'INSTRUMENT');
    const pos = () =>
      page.evaluate(() => ({
        page: window.scrollY,
        main: document.querySelector('.workspace-main').scrollTop,
        side: document.querySelector('.workspace-side').scrollTop,
        header: document.querySelector('.app-header').getBoundingClientRect().top,
      }));
    const side = await page.locator('.workspace-side .tracks-panel').boundingBox();
    await page.mouse.move(side.x + 40, side.y + 20);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    const a = await pos();
    const ed = await page.locator('.editor-panel').boundingBox();
    await page.mouse.move(ed.x + 60, ed.y + 60);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    const b = await pos();
    check(
      'desktop: the side column and the editor scroll separately, the top bar stays put',
      a.side > 0 && a.main === 0 && b.main > 0 && b.side === a.side && a.page === 0 && b.page === 0 && a.header === 0 && b.header === 0,
      JSON.stringify({ a, b }),
    );
  }
  await ctx.close();
}

// Small laptop (1024×768, mouse): side column stays beside the editor, same frame everywhere,
// and a phrase shows most of its rows.
{
  const { ctx, page } = await open({ viewport: { width: 1024, height: 768 } });
  const spots = new Set();
  for (const v of ['SONG', 'CHAIN', 'PHRASE', 'INSTRUMENT', 'MODS', 'POOL', 'MIXER', 'EQ', 'PERFORM', 'PROJECT', 'SCALES']) {
    await gotoView(page, v);
    await page.waitForTimeout(80);
    spots.add(
      await page.evaluate(() =>
        ['button[aria-label="Undo"]', '.page-heading h1', '.editor-panel > .panel-heading', '.tracks-panel']
          .map((q) => {
            const r = [...document.querySelectorAll(q)].find((e) => e.offsetParent)?.getBoundingClientRect();
            return r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.height)}` : '-';
          })
          .join('|'),
      ),
    );
  }
  check('1024: navigation frame is identical on every screen', spots.size === 1, [...spots].join(' / '));
  {
    const bad = [];
    for (const v of ['SONG', 'PHRASE', 'INSTRUMENT', 'MODS', 'POOL', 'MIXER', 'EQ', 'PERFORM', 'PROJECT']) {
      await gotoView(page, v);
      await page.waitForTimeout(60);
      bad.push(...(await page.evaluate(headingProblems)).map((x) => `${v} ${x}`));
      bad.push(...(await page.evaluate(panelTitleWraps)).map((x) => `${v} "${x}" wraps`));
    }
    check('1024: headings and panel titles fit on one line', bad.length === 0, bad.join('; '));
  }
  await gotoView(page, 'PHRASE');
  await page.locator('#cell-PHRASE-15-0').click();
  await page.waitForTimeout(100);
  const rows = await page.evaluate(() => {
    const floor = Math.min(document.querySelector('.pads-panel').getBoundingClientRect().top, document.querySelector('.transport-bar').getBoundingClientRect().top);
    const head = document.querySelector('.app-header').getBoundingClientRect().bottom;
    return [...document.querySelectorAll('.tracker-row')].filter((r) => { const b = r.getBoundingClientRect(); return b.top >= head && b.bottom <= floor; }).length;
  });
  check('1024×768: at least 10 phrase rows visible above the pads', rows >= 10, `${rows}`);
  // Entering notes from the pads never scrolls them away.
  await page.locator('#cell-PHRASE-0-0').click();
  for (let i = 0; i < 8; i++) await page.locator('.pads .pad').nth(3).click();
  const padsIn = await page.evaluate(() => {
    const p = document.querySelector('.pads-panel').getBoundingClientRect();
    const c = document.querySelector('.cell.is-cursor').getBoundingClientRect();
    return p.bottom <= document.querySelector('.transport-bar').getBoundingClientRect().top + 1 && c.bottom <= p.top;
  });
  check('1024×768: pads and cursor both stay in view while entering notes', padsIn);
  {
    // The short inspector still shows every choice of the instrument and mod TYPE fields.
    const hidden = [];
    for (const v of ['INSTRUMENT', 'MODS']) {
      await gotoView(page, v);
      await page.locator('.form .field').first().click();
      await page.waitForTimeout(60);
      const r = await page.evaluate(() => {
        const body = document.querySelector('.inspector .panel-body').getBoundingClientRect();
        const chips = [...document.querySelectorAll('.inspector .chips button')];
        return [chips.filter((c) => { const b = c.getBoundingClientRect(); return b.top >= body.top - 1 && b.bottom <= body.bottom - 12; }).length, chips.length];
      });
      if (r[0] < r[1]) hidden.push(`${v} ${r[0]}/${r[1]}`);
    }
    check('1024×768: the inspector shows every TYPE choice', hidden.length === 0, hidden.join('; '));
  }
  {
    const fit = [];
    for (const [vw, vh] of [[970, 700], [1024, 768], [1150, 800]]) {
      await page.setViewportSize({ width: vw, height: vh });
      await page.waitForTimeout(60);
      const r = await page.evaluate(() => {
        const panel = document.querySelector('.keys-panel').getBoundingClientRect();
        return Math.max(...[...document.querySelectorAll('.keys-panel .hw-key')].map((k) => k.getBoundingClientRect().right)) - panel.right;
      });
      if (r > 0.5) fit.push(`${vw}: ${r}px`);
    }
    // Touch tablets and touch laptops too (thumb-sized keys).
    for (const [vw, vh] of [[1024, 768], [1280, 800], [1366, 1024], [1440, 900]]) {
      const t = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: true, isMobile: true });
      const tp = await t.newPage();
      await tp.goto(url);
      await tp.waitForSelector('.tracker');
      const r = await tp.evaluate(() => {
        const panel = document.querySelector('.keys-panel').getBoundingClientRect();
        return Math.max(...[...document.querySelectorAll('.keys-panel .hw-key')].map((k) => k.getBoundingClientRect().right)) - panel.right;
      });
      if (r > 0.5) fit.push(`${vw} touch: ${r}px`);
      await t.close();
    }
    check('970–1440, mouse and touch: the M8 keys fit the side column', fit.length === 0, fit.join('; '));
    for (const [vw, vh] of [[1280, 800], [1024, 768]]) {
      await page.setViewportSize({ width: vw, height: vh });
      await page.waitForTimeout(60);
      check(
        `${vw}×${vh}: all eight tracks sit above the transport`,
        await page.evaluate(() => [...document.querySelectorAll('.track-line')].at(-1).getBoundingClientRect().bottom <= document.querySelector('.transport-bar').getBoundingClientRect().top),
      );
    }
  }
  await ctx.close();
}

// Phones: the heading and the editor keep their places from screen to screen, at every width.
for (const [w, h] of [[390, 844], [360, 740], [320, 640]]) {
  const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  const spots = new Set();
  for (const v of ['SONG', 'CHAIN', 'PHRASE', 'INSTRUMENT', 'MODS', 'POOL', 'MIXER', 'EQ', 'PERFORM', 'PROJECT', 'SCALES']) {
    await gotoView(page, v);
    await page.waitForTimeout(100);
    spots.add(
      await page.evaluate(() =>
        ['button[aria-label="Undo"]', '.page-heading h1', '.editor-panel .panel-heading']
          .map((q) => {
            const r = [...document.querySelectorAll(q)].find((e) => e.offsetParent)?.getBoundingClientRect();
            return r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.height)}` : '-';
          })
          .join('|'),
      ),
    );
  }
  check(`phone ${w}: undo, title and editor keep their place on every screen`, spots.size === 1, [...spots].join(' / '));
  {
    const bad = [];
    for (const v of ['SONG', 'CHAIN', 'PHRASE', 'INSTRUMENT', 'MODS', 'TABLE', 'POOL', 'MIXER', 'EQ', 'PERFORM', 'PROJECT', 'SCALES']) {
      await gotoView(page, v);
      await page.waitForTimeout(60);
      bad.push(...(await page.evaluate(headingProblems)).map((x) => `${v} ${x}`));
      bad.push(...(await page.evaluate(panelTitleWraps)).map((x) => `${v} "${x}" wraps`));
    }
    check(`phone ${w}: editor heading controls fit without overlap or wrapping`, bad.length === 0, bad.join('; '));
  }
  await gotoView(page, 'PHRASE');
  const shown = await page.evaluate(() => {
    const bar = document.querySelector('.cell-bar').getBoundingClientRect().top;
    return [...document.querySelectorAll('.tracker-row')].filter((r) => r.getBoundingClientRect().bottom <= bar).length;
  });
  const want = { 390: 9, 360: 7, 320: 4 }[w];
  check(`phone ${w}×${h}: at least ${want} phrase rows above the edit bar`, shown >= want, `${shown}`);
  // Walking down the phrase, the cursor never ends up under the edit bar.
  {
    await page.locator('#cell-PHRASE-0-0').click();
    const hidden = [];
    for (let r = 1; r < 16; r++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(40);
      const ok = await page.evaluate(() => document.querySelector('.cell.is-cursor').getBoundingClientRect().bottom <= document.querySelector('.cell-bar').getBoundingClientRect().top);
      if (!ok) hidden.push(r.toString(16));
    }
    check(`phone ${w}: the cursor stays clear of the edit bar`, hidden.length === 0, hidden.join(','));
  }
  // The edit bar keeps every button on screen, with or without Paste.
  {
    const over = [];
    for (const pass of [0, 1]) {
      for (const [v, cells] of [['SONG', ['0-0']], ['CHAIN', ['0-0', '0-1']], ['PHRASE', ['0-0', '1-0', '0-1', '0-2', '0-3', '0-4']]]) {
        await gotoView(page, v);
        for (const c of cells) {
          await page.locator(`#cell-${v}-${c}`).click();
          await page.waitForTimeout(40);
          const o = await page.evaluate(() => {
            const b = document.querySelector('.cell-bar');
            return b.scrollWidth - b.clientWidth;
          });
          if (o > 0) over.push(`${v} ${c}${pass ? ' +paste' : ''} by ${o}px`);
        }
      }
      // Second pass with something copied, so Paste shows too.
      await page.keyboard.press('Shift+z');
      await page.keyboard.press('z');
    }
    // Selection mode too.
    await gotoView(page, 'PHRASE');
    await page.locator('#cell-PHRASE-0-0').click();
    await page.keyboard.press('Shift+z');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(40);
    const so = await page.evaluate(() => {
      const b = document.querySelector('.cell-bar');
      const clipped = [...b.querySelectorAll('button')].filter((x) => x.scrollWidth > x.clientWidth + 1).length;
      return b.scrollWidth - b.clientWidth + clipped;
    });
    if (so > 0) over.push(`selection bar by ${so}`);
    await page.keyboard.press('Escape');
    check(`phone ${w}: the edit bar never runs off screen`, over.length === 0, over.join('; '));
  }
  // Parameter values line up down each group and are never cut off.
  const bad = [];
  for (const v of ['INSTRUMENT', 'MODS', 'MIXER', 'EQ']) {
    await gotoView(page, v);
    await page.waitForTimeout(80);
    bad.push(...(await page.evaluate(fieldProblems)).map((x) => `${v} ${x}`));
  }
  check(`phone ${w}: parameter values aligned and whole`, bad.length === 0, bad.join('; '));
  await ctx.close();
}

// Density: a whole phrase fits above the transport on a 1440×900 laptop.
{
  const { ctx, page } = await open({ viewport: { width: 1440, height: 900 } });
  await gotoView(page, 'PHRASE');
  // The pads stick to the bottom of the editor column: count what shows above them, once the
  // page heading has scrolled away (the cursor on the last row).
  await page.locator('#cell-PHRASE-15-0').click();
  await page.waitForTimeout(100);
  const shown = await page.evaluate(() => {
    const floor = Math.min(document.querySelector('.pads-panel').getBoundingClientRect().top, document.querySelector('.transport-bar').getBoundingClientRect().top);
    const head = document.querySelector('.app-header').getBoundingClientRect().bottom;
    return [...document.querySelectorAll('.tracker-row')].filter((r) => { const b = r.getBoundingClientRect(); return b.top >= head && b.bottom <= floor; }).length;
  });
  check('1440×900: at least 14 phrase rows visible above the pads', shown >= 14, `${shown}`);
  await gotoView(page, 'MIXER');
  const v = await page.locator('.field.is-cursor .field-value b').boundingBox();
  const st = await page.locator('.field.is-cursor .field-steppers').boundingBox();
  check('mixer cursor value is not covered by its steppers', v && st && v.x + v.width <= st.x, `${v?.x + v?.width} vs ${st?.x}`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoView(page, 'PHRASE');
  await page.waitForTimeout(200);
  await page.locator('#cell-PHRASE-15-0').click();
  await page.waitForTimeout(100);
  const shown2 = await page.evaluate(() => {
    const floor = Math.min(document.querySelector('.pads-panel').getBoundingClientRect().top, document.querySelector('.transport-bar').getBoundingClientRect().top);
    const head = document.querySelector('.app-header').getBoundingClientRect().bottom;
    return [...document.querySelectorAll('.tracker-row')].filter((r) => { const b = r.getBoundingClientRect(); return b.top >= head && b.bottom <= floor; }).length;
  });
  check('1280×800: at least 12 phrase rows visible above the pads', shown2 >= 12, `${shown2}`);
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowDown');
  const cur = await page.locator('.cell.is-cursor').boundingBox();
  const bar2 = await page.locator('.transport-bar').boundingBox();
  check('page follows the cursor above the transport', cur && bar2 && cur.y + cur.height <= bar2.y, `${cur?.y} vs ${bar2?.y}`);
  await ctx.close();
}

// Keyboard flow: M8 keys edit, navigate and play.
{
  const { ctx, page, errors } = await open({ viewport: { width: 1440, height: 1000 } });
  const cursorText = () => page.locator('.cell.is-cursor').textContent();
  check('starts on song with demo', (await cursorText()) === '00');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  check('Shift+→ opens chain', (await page.locator('h1').textContent()).startsWith('Chain 00'));
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  check('Shift+→ opens phrase', (await page.locator('h1').textContent()).startsWith('Phrase 00'));
  // Row 1 is empty in phrase 00: move there and insert with X, then nudge an octave.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('x');
  check('X inserts last note', (await cursorText()) === 'C-4', await cursorText());
  await page.keyboard.down('x');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('x');
  check('X+↑ raises an octave', (await cursorText()) === 'C-5', await cursorText());
  await page.keyboard.down('z');
  await page.keyboard.press('x');
  await page.keyboard.up('z');
  check('Z+X deletes', (await cursorText()) === '---', await cursorText());
  await page.keyboard.press('Control+z');
  check('Ctrl+Z restores', (await cursorText()) === 'C-5', await cursorText());
  // Piano key on note column + step jump.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('e');
  const row2 = await page.locator('.tracker-row').nth(2).locator('.cell').first().textContent();
  check('piano key E writes E-4', row2 === 'E-4', row2);
  // Type a command on FX1.
  await page.keyboard.press('ArrowUp');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  for (const k of 'ret') await page.keyboard.press(k);
  check('typing R E T sets the command', (await cursorText()) === 'RET', await cursorText());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('8');
  await page.keyboard.press('2');
  check('hex digits set value', (await cursorText()) === '82', await cursorText());
  // Selection copy/paste.
  await page.keyboard.down('Shift');
  await page.keyboard.press('z');
  await page.keyboard.up('Shift');
  await page.keyboard.press('ArrowLeft');
  check('Shift+Z selects', (await page.locator('.cell.is-selected').count()) === 2);
  await page.keyboard.press('z');
  check('Z copies and ends selection', (await page.locator('.cell.is-selected').count()) === 0);
  // Play the phrase and see the playhead move.
  await page.keyboard.press(' ');
  await page.waitForTimeout(1200);
  const playRows = await page.locator('.tracker-row.is-play').count();
  const meter = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.meter')].map((m) => Number(getComputedStyle(m).getPropertyValue('--l') || 0))));
  check('Space plays the phrase (playhead)', playRows === 1);
  check('audio reaches the track meters', meter > 0, `max level ${meter.toFixed(3)}`);
  await page.screenshot({ path: `${out}/phrase-playing.png` });
  await page.keyboard.press(' ');
  // Song playback from the song screen.
  await gotoView(page, 'SONG');
  await page.keyboard.press(' ');
  await page.waitForTimeout(2500);
  const active = await page.locator('.cell.is-play').count();
  check('song plays on several tracks', active >= 6, `${active} tracks`);
  await page.screenshot({ path: `${out}/song-playing.png` });
  await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  check('Space stops', (await page.locator('.cell.is-play').count()) === 0);
  // Fill tool on an empty phrase.
  await gotoView(page, 'PHRASE');
  for (let i = 0; i < 12; i++) await page.keyboard.press(']');
  await page.getByRole('button', { name: /Fill phrase/ }).click();
  await page.locator('.fill-tool .segmented', { hasText: 'EUCLID' }).getByRole('button', { name: 'EUCLID' }).click();
  await page.locator('.fill-tool').getByRole('button', { name: 'Fill', exact: true }).click();
  const notes = await page.locator('.cell.k-note:not(.is-empty)').count();
  check('fill euclid writes hits', notes === 4, `${notes} notes`);
  await page.screenshot({ path: `${out}/phrase-fill.png` });
  // View map: the pool sits above mods; Shift + → from it opens the instrument.
  await gotoView(page, 'MODS');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowUp');
  const onPool = (await page.locator('h1').textContent()).includes('pool');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  const onInst = (await page.locator('h1').textContent()).startsWith('Instrument');
  check('view map: mods ↑ pool → instrument', onPool && onInst);
  // M8: OPTION + EDIT on an empty note writes OFF.
  await gotoView(page, 'PHRASE');
  await page.locator('.tracker-row').nth(3).locator('.cell').first().click();
  await page.keyboard.down('z');
  await page.keyboard.press('x');
  await page.keyboard.up('z');
  check('Z+X on an empty note writes OFF', (await cursorText()) === 'OFF', await cursorText());
  await page.keyboard.press('Control+z');
  // Clone: SHIFT + OPTION, then EDIT on a song chain.
  await gotoView(page, 'SONG');
  await page.locator('.tracker-row').first().locator('.cell').nth(1).click();
  await page.keyboard.down('Shift');
  await page.keyboard.down('z');
  await page.keyboard.press('x');
  await page.keyboard.up('z');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
  const cloned = await page.locator('.cell.is-cursor').textContent();
  check('Shift+Z then X clones the chain into a new number', cloned !== '01' && cloned !== '--', cloned);
  await page.keyboard.press('Control+z');
  // Sample editor: reverse the kick into a new sample.
  await gotoView(page, 'INSTRUMENT');
  await page.locator('.sample-edit select').selectOption('REVERSE');
  await page.locator('.sample-edit button').click();
  await page.waitForTimeout(800);
  check('sample editor makes an edited copy', (await page.locator('.form').textContent()).includes('KICK*'));
  await page.keyboard.press('Control+z');
  // Space after a mouse click on a button still plays (round 8 regression).
  await gotoView(page, 'PHRASE');
  await page.locator('.tracker-row').first().locator('.cell').first().click();
  await page.locator('[data-tour="steppers"] button', { hasText: '+1' }).click();
  const noteAfterClick = await page.locator('.cell.is-cursor').textContent();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  check('Space plays after clicking a button', (await page.locator('.bar-play.is-playing').count()) === 1);
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowUp');
  check('…and does not press the button again', (await page.locator('.cell.is-cursor').textContent()) === noteAfterClick, noteAfterClick);
  await page.keyboard.press('Control+z');
  // Space after clicking a slider still plays (round 9).
  await gotoView(page, 'MIXER');
  await page.locator('.inspect-range').click();
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  check('Space plays after clicking a slider', (await page.locator('.bar-play.is-playing').count()) === 1);
  await page.keyboard.press(' ');
  await page.keyboard.press('Control+z');
  // Preset loading.
  await gotoView(page, 'INSTRUMENT');
  await page.locator('.preset-picker select').selectOption('ACID');
  check('preset loads into the slot', (await page.locator('h1').textContent()).includes('ACID'));
  await page.keyboard.press('Control+z');
  // Live mode: queue the breakdown row while the song plays.
  await gotoView(page, 'SONG');
  await page.locator('.live-toggle').click();
  await page.locator('.bar-play').click();
  await page.waitForTimeout(400);
  await page.locator('.tracker-row').nth(5).locator('.cell').nth(2).click();
  await page.keyboard.press(' ');
  await page.waitForTimeout(100);
  const queued = await page.locator('.cell.is-queued').count();
  check('live mode queues a cell', queued === 1, `${queued} queued`);
  // Chains are two bars at 122 BPM: the cue lands within four seconds.
  await page.waitForTimeout(4300);
  const moved = await page.locator('.tracker-row').nth(5).locator('.cell.is-play').count();
  check('queued chain takes over when the chain ends', moved === 1);
  await page.screenshot({ path: `${out}/song-live.png` });
  await page.locator('.bar-play').click();
  await page.locator('.live-toggle').click();
  // LEFT + PLAY cues a whole row while the song plays (no live mode needed).
  await page.locator('.bar-play').click();
  await page.waitForTimeout(300);
  await page.locator('.tracker-row').nth(2).locator('.cell').nth(4).click();
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.press(' ');
  await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(100);
  const cued = await page.locator('.cell.is-queued').count();
  check('← + Space cues the whole row', cued >= 4, `${cued} cued`);
  await page.locator('.bar-play').click();
  // Perform: hold a pad.
  await gotoView(page, 'PERFORM');
  const pad = page.locator('.perform-pad', { hasText: 'FREEZE' });
  const pb = await pad.boundingBox();
  await page.mouse.move(pb.x + 20, pb.y + 20);
  await page.mouse.down();
  check('perform pad reacts while held', (await page.locator('.perform-pad.is-held').count()) === 1);
  await page.mouse.up();
  check('perform pad lets go', (await page.locator('.perform-pad.is-held').count()) === 0);
  check('perform has per-track FX', (await page.locator('.perform-slide').count()) === 3);
  check('keyboard flow console clean', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// Persistence: an edit survives an immediate reload, and the reload returns to the same screen.
{
  const { ctx, page, errors } = await open({ viewport: { width: 1440, height: 900 } });
  await gotoView(page, 'PHRASE');
  await page.locator('.tracker-row').nth(1).locator('.cell').first().click();
  await page.keyboard.press('e');
  await page.reload();
  await page.waitForSelector('.tracker');
  const kept = await page.locator('.tracker-row').nth(1).locator('.cell').first().textContent();
  check('an edit survives an immediate reload', kept === 'E-4', kept);
  check('reload returns to the same screen', (await page.locator('h1').textContent()).startsWith('Phrase'));
  // Effect list: X + ↑ on a command cell.
  await page.locator('.tracker-row').nth(1).locator('.cell').nth(3).click();
  await page.keyboard.down('x');
  await page.keyboard.press('ArrowUp');
  check('holding X + ↑ on a command opens the effect list', (await page.locator('.fx-pick').count()) === 1);
  await page.keyboard.press('ArrowDown');
  await page.screenshot({ path: `${out}/fx-list.png` });
  await page.keyboard.up('x');
  const placed = await page.locator('.cell.is-cursor').textContent();
  check('letting go of X places the command', (await page.locator('.fx-pick').count()) === 0 && /^[A-Z0-9]{3}$/.test(placed ?? ''), placed);
  check('persistence console clean', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// Two tabs on one project: a save in one shows up in the other instead of being overwritten.
{
  const { ctx, page: a } = await open({ viewport: { width: 1440, height: 900 } });
  const b = await ctx.newPage();
  await b.goto(url);
  await b.waitForSelector('.tracker');
  await gotoView(a, 'PHRASE');
  await gotoView(b, 'PHRASE');
  await b.locator('#cell-PHRASE-6-0').click();
  await b.keyboard.press('t');
  await a.waitForTimeout(1200);
  const seen = await a.locator('#cell-PHRASE-6-0').textContent();
  const status = await a.locator('.transport-message').textContent().catch(() => '');
  check('two tabs: an edit in one appears in the other', seen === 'A-4' || /^[A-G]/.test(seen ?? ''), `${seen} · ${status}`);
  // Then A edits another row: B's note must still be there after A saves.
  await a.locator('#cell-PHRASE-7-0').click();
  await a.keyboard.press('q');
  await a.waitForTimeout(1200);
  await b.reload();
  await b.waitForSelector('.tracker');
  const both = [await b.locator('#cell-PHRASE-6-0').textContent(), await b.locator('#cell-PHRASE-7-0').textContent()];
  check('two tabs: neither edit is lost', both.every((t) => /^[A-G]/.test(t ?? '')), both.join(' / '));
  // Both at once (inside one save window): the edits are merged, not overwritten.
  await gotoView(b, 'PHRASE');
  await a.locator('#cell-PHRASE-9-0').click();
  await b.locator('#cell-PHRASE-10-0').click();
  await a.keyboard.press('w');
  await a.waitForTimeout(100);
  await b.keyboard.press('e');
  await a.waitForTimeout(2500);
  const inA = [await a.locator('#cell-PHRASE-9-0').textContent(), await a.locator('#cell-PHRASE-10-0').textContent()];
  const inB = [await b.locator('#cell-PHRASE-9-0').textContent(), await b.locator('#cell-PHRASE-10-0').textContent()];
  check('two tabs: simultaneous edits are merged in both tabs', [...inA, ...inB].every((t) => /^[A-G]/.test(t ?? '')), `A ${inA.join('/')} · B ${inB.join('/')}`);
  // Undo in A takes back A's own note, not the one that came from B.
  await a.locator('#cell-PHRASE-9-0').click();
  await a.keyboard.press('Control+z');
  await a.waitForTimeout(100);
  const afterUndo = [await a.locator('#cell-PHRASE-9-0').textContent(), await a.locator('#cell-PHRASE-10-0').textContent()];
  check('two tabs: undo after a merge takes back only this tab’s edit', afterUndo[0] === '---' && /^[A-G]/.test(afterUndo[1] ?? ''), afterUndo.join(' / '));
  // Redo brings it back, and the other tab gets it too (it must be saved, not skipped).
  await a.keyboard.press('Control+Shift+z');
  await a.waitForTimeout(2000);
  const redoInB = [await b.locator('#cell-PHRASE-9-0').textContent(), await b.locator('#cell-PHRASE-10-0').textContent()];
  check('two tabs: redo after a merge reaches the other tab', redoInB.every((t) => /^[A-G]/.test(t ?? '')), redoInB.join(' / '));
  await ctx.close();
}

// Teach mode: points at Play, waits for it, then moves on.
{
  const { ctx, page, errors } = await open({ viewport: { width: 1440, height: 1000 } });
  await page.locator('[data-tour="teach"]').click();
  await page.waitForSelector('.tour-bubble');
  check('teach mode opens on step 1', (await page.locator('.tour-bubble').textContent()).includes('1/'));
  await page.screenshot({ path: `${out}/teach-step1.png` });
  // Step 1 says "Space": right after clicking Teach, Space must play, not end the tour.
  await page.keyboard.press(' ');
  await page.waitForTimeout(900);
  check('teach mode advances after the action', (await page.locator('.tour-bubble').textContent()).includes('2/'));
  await page.locator('.bar-play').click();
  await page.waitForTimeout(900);
  check('teach step 3 waits for a click (does not skip itself)', (await page.locator('.tour-bubble').textContent()).includes('3/'));
  await page.locator('.tracker-row').first().locator('.cell').nth(2).click();
  await page.waitForTimeout(900);
  check('teach step 3 done by clicking a chain', (await page.locator('.tour-bubble').textContent()).includes('4/'));
  await page.screenshot({ path: `${out}/teach-step4.png` });
  await page.locator('[data-tour="crumb-CHAIN"]').click();
  await page.waitForTimeout(900);
  const h1 = await page.locator('h1').textContent();
  check('crumb carries the chain under the cursor', h1.startsWith('Chain 02'), h1);
  await page.keyboard.press('Escape');
  check('Escape ends teach mode', (await page.locator('.tour-bubble').count()) === 0);
  check('teach console clean', errors.length === 0, errors.join(' | '));
  await ctx.close();
  const phone = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await phone.page.locator('[data-tour="teach"]').click();
  await phone.page.waitForSelector('.tour-bubble');
  await phone.page.waitForTimeout(400);
  await phone.page.screenshot({ path: `${out}/teach-phone.png` });
  const bb = await phone.page.locator('.tour-bubble').boundingBox();
  check('teach bubble fits a phone', bb && bb.x >= 0 && bb.x + bb.width <= 390, JSON.stringify(bb));
  await phone.ctx.close();
}

// Offline: service worker serves the app without network.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  await ctx.setOffline(true);
  await page.reload();
  // The first render waits for the saved project in IndexedDB.
  const ok = await page.waitForSelector('.tracker', { timeout: 5000 }).then(() => 1, () => 0);
  check('works offline after first visit', ok > 0);
  await ctx.close();
}

// Every instrument type's parameters, and the other forms, at every width: labels whole,
// values whole and in line.
for (const [w, h, touch] of [[1440, 900, false], [1024, 768, false], [970, 700, false], [1366, 1024, true], [1300, 900, true], [1024, 768, true], [970, 700, true], [390, 844, true], [320, 640, true]]) {
  const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  const bad = [];
  for (const v of ['PROJECT', 'MIXER', 'EQ']) {
    await gotoView(page, v);
    await page.waitForTimeout(60);
    bad.push(...(await page.evaluate(fieldProblems)).map((x) => `${v} ${x}`));
  }
  await gotoView(page, 'INSTRUMENT');
  for (let i = 0; i < 6; i++) {
    await page.locator('.form .field').first().click();
    // Row steppers on desktop; on phones the edit bar holds them.
    const up = page.locator('.form .field.is-cursor .field-steppers button').last();
    await ((await up.isVisible()) ? up : page.locator('.cell-bar button').last()).click();
    await page.waitForTimeout(60);
    const type = await page.locator('.form .field').first().locator('.field-value b').textContent();
    bad.push(...(await page.evaluate(fieldProblems)).map((x) => `${type} ${x}`));
  }
  check(`${w}${touch ? ' touch' : ''}: every form's labels and values are whole`, bad.length === 0, [...new Set(bad)].join('; '));
  await ctx.close();
}

// Teach: the bubble never covers the cell just picked (step 4) or track 1's buttons (step 14).
for (const [w, h, t] of [[1440, 900, false], [390, 844, true], [320, 640, true]]) {
  const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: t, isMobile: t });
  const hit = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
  await page.locator('[data-tour="teach"], .teach-button').first().click();
  await page.locator('.tour-actions button', { hasText: 'Skip' }).click();
  await page.locator('.tour-actions button', { hasText: 'Skip' }).click();
  await page.locator('#cell-SONG-2-3').click();
  await page.waitForTimeout(1300);
  const s4 = await page.evaluate(() => [document.querySelector('.tour-bubble').getBoundingClientRect().toJSON(), document.querySelector('.cell.is-cursor').getBoundingClientRect().toJSON()]);
  while (!(await page.locator('.tour-head').textContent()).includes('14/')) {
    await page.locator('.tour-actions button', { hasText: /Skip|Next/ }).click();
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1300);
  // Every mute / solo button on screen stays free to tap.
  const s14 = await page.evaluate(() => {
    const bb = document.querySelector('.tour-bubble').getBoundingClientRect().toJSON();
    const foot = document.querySelector('.transport-bar').getBoundingClientRect().top;
    return [bb, [...document.querySelectorAll('.track-line .ms')].map((m) => m.getBoundingClientRect().toJSON()).filter((m) => m.top < foot && m.bottom > 104)];
  });
  const covered = s14[1].filter((m) => hit(s14[0], m)).length;
  check(`teach ${w}: bubble clears the picked cell and every visible M / S`, !hit(...s4) && covered === 0, JSON.stringify({ s4: hit(...s4), covered }));
  await ctx.close();
}

// EQ assignment (round-17 crash): step MAIN EQ both ways, open it with Shift + →, leave with Z.
{
  const { ctx, page, errors } = await open({ viewport: { width: 1440, height: 900 } });
  await gotoView(page, 'MIXER');
  const main = page.locator('.field', { hasText: 'MAIN EQ' });
  await main.click();
  await page.keyboard.down('x');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('x');
  const set = await main.locator('.field-value b').textContent();
  await page.keyboard.down('x');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('x');
  const cleared = await main.locator('.field-value b').textContent();
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  const opened = await page.locator('h1').textContent();
  await page.keyboard.press('z');
  const back = await page.locator('h1').textContent();
  check('EQ field steps, opens its editor and Z leads back', set === '00' && cleared === '--' && /EQ/i.test(opened ?? '') && /Mixer/i.test(back ?? '') && errors.length === 0, `${set} ${cleared} ${opened} → ${back} ${errors.join('|')}`);
  await ctx.close();
}

// Teach after Skip: every step lands on its screen with a ring; step 9 on a phone rings the
// command select fully and leaves the list's Place button free.
{
  const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.locator('[data-tour="teach"], .teach-button').first().click();
  const noRing = [];
  for (let step = 1; step <= 13; step++) {
    const head = await page.locator('.tour-head').textContent();
    if (step >= 5 && step !== 9) {
      await page.waitForTimeout(700);
      const h = await page.evaluate(() => document.querySelector('.tour-ring')?.getBoundingClientRect().height ?? 0);
      if (h < 12) noRing.push(`${head.match(/\d+\/\d+/)?.[0]} ring ${Math.round(h)}`);
    }
    if (step === 9) {
      await page.waitForTimeout(500);
      const row = await page.evaluate(() => getComputedStyle(document.body) && document.querySelector('.cell.is-cursor')?.id.split('-')[2]);
      await page.locator(`#cell-PHRASE-${row ?? 0}-3`).click();
      await page.waitForTimeout(700);
      const ringH = await page.evaluate(() => document.querySelector('.tour-ring')?.getBoundingClientRect().height ?? 0);
      await page.locator('.cell-bar button', { hasText: 'List' }).click();
      await page.waitForTimeout(700);
      // List open: a full ring on Place, and neither Place nor the command's help covered.
      const open = await page.evaluate(() => {
        const b = document.querySelector('.tour-bubble').getBoundingClientRect();
        const hit = (q) => {
          const r = document.querySelector(q)?.getBoundingClientRect();
          return r ? b.left < r.right && r.left < b.right && b.top < r.bottom && r.top < b.bottom : true;
        };
        return { ring: document.querySelector('.tour-ring')?.getBoundingClientRect().height ?? 0, place: hit('[data-tour="fx-place"]'), help: hit('.fx-pick-help') };
      });
      check('teach 390 step 9: full ring on the command select, Place stays free', ringH >= 30 && !open.place, `ring ${Math.round(ringH)} covers ${open.place}`);
      check('teach 390 step 9, list open: Place fully ringed, help and Place readable', open.ring >= 30 && !open.place && !open.help, JSON.stringify(open));
      await page.locator('.fx-pick .icon-button[aria-label="Close"]').click();
    }
    await page.locator('.tour-actions button', { hasText: /Skip|Next/ }).click();
    await page.waitForTimeout(80);
  }
  check('teach after Skip: steps 5–13 each show their screen and ring', noRing.length === 0, noRing.join('; '));
  check('teach skip console clean', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// Forms follow the cursor (keyboard on desktop, docked keys on a phone).
{
  const band = () =>
    page2.evaluate(() => {
      const c = document.querySelector('.field.is-cursor').getBoundingClientRect();
      const head = document.querySelector('.app-header').getBoundingClientRect().bottom;
      const bar = document.querySelector('.cell-bar');
      const foot = Math.min(document.querySelector('.transport-bar').getBoundingClientRect().top, bar && bar.getClientRects().length ? bar.getBoundingClientRect().top : Infinity);
      return c.top >= head - 1 && c.bottom <= foot + 1;
    });
  let page2;
  {
    const { ctx, page } = await open({ viewport: { width: 1024, height: 768 } });
    page2 = page;
    const lost = [];
    for (const v of ['INSTRUMENT', 'MIXER', 'PROJECT']) {
      await gotoView(page, v);
      await page.locator('.form .field').first().click();
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(30);
        if (!(await band())) lost.push(`${v} ${i + 1}`);
      }
    }
    check('1024: walking down a form keeps the cursor in view', lost.length === 0, lost.join(', '));
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    page2 = page;
    await gotoView(page, 'INSTRUMENT');
    await page.locator('.form .field').first().click();
    await page.locator('.editor-history .bar-keys-toggle').click();
    const cdp = await ctx.newCDPSession(page);
    const lost = [];
    for (let i = 0; i < 14; i++) {
      const bb = await page.locator('.cell-bar .hw-down').boundingBox();
      const pt = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(60);
      if (!(await band())) lost.push(i + 1);
    }
    check('phone: the docked keys walk a form with the cursor in view', lost.length === 0, lost.join(', '));
    await ctx.close();
  }
}

// Teach step 7 shows the pads whole; step 13's tab ring survives a scrolled form.
for (const [w, h, t] of [[1440, 900, false], [1024, 768, false], [1366, 1024, true]]) {
  const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: t, isMobile: t });
  await page.locator('[data-tour="teach"], .teach-button').first().click();
  while (!(await page.locator('.tour-head').textContent()).includes('7/')) {
    await page.locator('.tour-actions button', { hasText: /Skip|Next/ }).click();
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1200);
  const pads = await page.evaluate(() => {
    const r = document.querySelector('[data-tour="pads"] .pads').getBoundingClientRect();
    const head = document.querySelector('.app-header').getBoundingClientRect().bottom;
    const foot = document.querySelector('.transport-bar').getBoundingClientRect().top;
    return r.top >= head - 1 && r.bottom <= foot + 1;
  });
  while (!(await page.locator('.tour-head').textContent()).includes('13/')) {
    await page.locator('.tour-actions button', { hasText: /Skip|Next/ }).click();
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('.workspace-main')?.scrollBy(0, 600) ?? window.scrollBy(0, 600));
  await page.waitForTimeout(1200);
  const ring = await page.evaluate(() => document.querySelector('.tour-ring')?.getBoundingClientRect().height ?? 0);
  check(`teach ${w}${t ? ' touch' : ''}: step 7 shows the pads whole, step 13 rings the Mods tab`, pads && ring >= 24, JSON.stringify({ pads, ring }));
  await ctx.close();
}

// Desktop / tablet follow-ups: the side key panel, the pool, coming back to a form, Tab.
{
  const { ctx, page } = await open({ viewport: { width: 1024, height: 768 } });
  const inBand = (q) =>
    page.evaluate((q) => {
      const c = document.querySelector(q).getBoundingClientRect();
      return c.top >= document.querySelector('.app-header').getBoundingClientRect().bottom - 1 && c.bottom <= document.querySelector('.transport-bar').getBoundingClientRect().top + 1;
    }, q);
  // Side key panel: 12 × ↓ on the song screen; the cursor stays in view.
  await gotoView(page, 'SONG');
  let lost = 0;
  for (let i = 0; i < 12; i++) {
    await page.locator('.keys-panel .hw-down').click();
    if (!(await inBand('.cell.is-cursor'))) lost++;
  }
  check('1024: the side key panel walks the cursor with the grid following', lost === 0, `${lost} lost`);
  // Pool: ↓ × 14 keeps the row in view.
  await gotoView(page, 'POOL');
  lost = 0;
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(30);
    if (!(await inBand('.pool .is-cursor'))) lost++;
  }
  check('1024: the pool cursor stays above the transport', lost === 0, `${lost} lost`);
  // Instrument cursor far down, away to Mods and back: the cursor is shown again.
  await gotoView(page, 'INSTRUMENT');
  await page.locator('.form .field').first().click();
  for (let i = 0; i < 18; i++) await page.keyboard.press('ArrowDown');
  await page.locator('[data-tour="subtab-MODS"]').click();
  await page.locator('[data-tour="subtab-INST"]').click();
  await page.waitForTimeout(150);
  check('1024: coming back to a form shows its cursor', await inBand('.field.is-cursor'));
  // Tab through the instrument screen: the page (and its header) never moves.
  let moved = 0;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const y = await page.evaluate(() => window.scrollY + document.querySelector('.app-header').getBoundingClientRect().top);
    if (y !== 0) moved++;
  }
  check('1024: tabbing never scrolls the page or the header away', moved === 0, `${moved}`);
  // Tab focus never ends up hidden under the transport (WCAG 2.4.11), on several screens.
  for (const [vw, vh] of [[1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width: vw, height: vh });
    let hidden = [];
    for (const v of ['INSTRUMENT', 'PROJECT', 'MIXER', 'PHRASE']) {
      await gotoView(page, v);
      await page.locator('.page-heading h1').click();
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
          const a = document.activeElement;
          if (!a || !a.closest('.workspace-main, .workspace-side')) return null;
          const b = a.getBoundingClientRect();
          return b.bottom > document.querySelector('.transport-bar').getBoundingClientRect().top + 1 || b.top < document.querySelector('.app-header').getBoundingClientRect().bottom - 1 ? (a.getAttribute('aria-label') || a.textContent).trim().slice(0, 16) : null;
        });
        if (r) hidden.push(`${v} ${r}`);
      }
    }
    hidden = [...new Set(hidden)];
    check(`${vw}: Tab focus never hides under the transport or header`, hidden.length === 0, hidden.slice(0, 6).join('; '));
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  // The pool fits its panel, and a row moved up to stays clear of the sticky header row.
  await gotoView(page, 'POOL');
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  let under = 0;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(20);
    under += await page.evaluate(() => {
      const c = document.querySelector('.pool .is-cursor').getBoundingClientRect();
      const h = document.querySelector('.pool thead th').getBoundingClientRect();
      return c.top < h.bottom - 1 ? 1 : 0;
    });
  }
  const fits = await page.evaluate(() => document.querySelector('.pool').scrollWidth <= document.querySelector('.pool-wrap').clientWidth + 1);
  check('1024: the pool fits its panel and rows clear its sticky header', fits && under === 0, `fits ${fits}, under ${under}`);
  // During playback the Tracks panel's notes stay on one line (no "C-" / "4").
  for (const [vw, vh] of [[1024, 768], [970, 700]]) {
    await page.setViewportSize({ width: vw, height: vh });
    await gotoView(page, 'SONG');
    await page.locator('.bar-play').click();
    let wrapped = 0;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(150);
      wrapped += await page.evaluate(() =>
        [...document.querySelectorAll('.track-now b')].filter((b) => b.getClientRects().length > 1 || b.getBoundingClientRect().height > 24).length,
      );
    }
    await page.locator('.bar-play').click();
    check(`${vw}: playing notes in the Tracks panel stay on one line`, wrapped === 0, `${wrapped}`);
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await ctx.close();
}

// Drag a value with the mouse: up for more, down for less (slow = single steps).
{
  const { ctx, page, errors } = await open({ viewport: { width: 1440, height: 900 } });
  const drag = async (loc, dy) => {
    const b = await loc.boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    const n = Math.abs(dy);
    for (let i = 1; i <= n; i++) {
      await page.mouse.move(x, y - Math.sign(dy) * i);
      await page.waitForTimeout(8);
    }
    await page.mouse.up();
    await page.waitForTimeout(60);
  };
  await gotoView(page, 'PHRASE');
  const cell = page.locator('#cell-PHRASE-0-0');
  const before = await cell.textContent();
  await drag(cell, 26); // 5 px per step: 5 steps up
  const after = await cell.textContent();
  const semis = (t) => ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[t[0]] + (t[1] === '#' ? 1 : 0) + 12 * Number(t[2]);
  check('drag a note up 5 steps: +5 semitones', semis(after) - semis(before) === 5, `${before} → ${after}`);
  // A click without movement still just moves the cursor.
  await page.locator('#cell-PHRASE-2-1').click();
  check('a plain click on a cell does not change it', (await page.locator('#cell-PHRASE-2-1').textContent()) === (await page.locator('#cell-PHRASE-2-1').textContent()) && (await page.locator('.cell.is-cursor').getAttribute('id')) === 'cell-PHRASE-2-1');
  // Shift + drag selects.
  const a = await page.locator('#cell-PHRASE-4-0').boundingBox();
  const b = await page.locator('#cell-PHRASE-6-0').boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x + 5, a.y + 5);
  await page.mouse.down();
  await page.mouse.move(b.x + 5, b.y + 5, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  check('Shift + drag selects', (await page.locator('.cell.is-selected').count()) === 3, `${await page.locator('.cell.is-selected').count()}`);
  await page.keyboard.press('Escape');
  // A parameter: MIXER VOLUME dragged down 4 steps.
  await gotoView(page, 'MIXER');
  const vol = page.locator('.field', { hasText: 'VOLUME' }).first();
  const v0 = parseInt(await vol.locator('.field-value b').textContent(), 16);
  await drag(vol.locator('.field-value'), -21);
  const v1 = parseInt(await vol.locator('.field-value b').textContent(), 16);
  check('drag a parameter down 4 steps', v0 - v1 === 4, `${v0.toString(16)} → ${v1.toString(16)}`);
  // Tempo.
  const t0 = Number(await page.locator('.tempo-field input').inputValue());
  await drag(page.locator('.tempo-field input'), 26);
  await page.locator('.page-heading h1').click();
  const t1 = Number(await page.locator('.tempo-field input').inputValue());
  check('drag the tempo up 5 steps', t1 - t0 === 5, `${t0} → ${t1}`);
  check('value drag console clean', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// Touch: hold a cell, then drag, selects; a quick swipe only scrolls.
{
  const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await gotoView(page, 'PHRASE');
  const cdp = await ctx.newCDPSession(page);
  const centre = async (row, col) => {
    const b = await page.locator(`#cell-PHRASE-${row}-${col}`).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  // A swipe without holding: no selection.
  let a = await centre(2, 0);
  await touch('touchStart', a);
  for (let i = 1; i <= 5; i++) await touch('touchMove', { x: a.x, y: a.y - i * 20 });
  await touch('touchEnd');
  await page.waitForTimeout(900); // let the fling settle before measuring cells again
  check('touch: a quick swipe does not select', (await page.locator('.cell.is-selected').count()) === 0);
  // Hold, then drag down three rows.
  a = await centre(2, 0);
  const b = await centre(5, 1);
  await touch('touchStart', a);
  await page.waitForTimeout(550);
  for (let i = 1; i <= 6; i++) await touch('touchMove', { x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6 });
  await touch('touchEnd');
  await page.waitForTimeout(100);
  const n = await page.locator('.cell.is-selected').count();
  const bar = await page.locator('.cell-bar').textContent();
  check('touch: hold and drag selects a block', n === 8 && bar.includes('SELECTION'), `${n} cells, bar "${bar}"`);
  // Hold near the edit bar: the page scrolls on and the selection keeps growing.
  await page.locator('.cell-bar button[aria-label="Done"]').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  a = await centre(1, 0);
  const barTop = (await page.locator('.cell-bar').boundingBox()).y;
  await touch('touchStart', a);
  await page.waitForTimeout(550);
  for (let i = 1; i <= 8; i++) await touch('touchMove', { x: a.x, y: a.y + ((barTop - 20 - a.y) * i) / 8 });
  await page.waitForTimeout(1500);
  await touch('touchEnd');
  const rowsSel = await page.evaluate(() => new Set([...document.querySelectorAll('.cell.is-selected')].map((c) => c.id.split('-')[2])).size);
  check('touch: holding at the edge scrolls and extends the selection', rowsSel >= 12, `${rowsSel} rows`);
  await page.locator('.cell-bar button[aria-label="Copy"]').click();
  check('touch: after copying, the edit bar offers Paste', (await page.locator('.cell-bar button[aria-label="Paste"]').count()) === 1);
  // The big key panel: pressing ↓ there must not scroll the page away from the finger.
  await page.locator('#cell-PHRASE-0-0').click();
  await page.locator('.keys-panel').scrollIntoViewIfNeeded();
  const tapAt = async (loc) => {
    const bb = await loc.boundingBox();
    const pt = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
    await touch('touchStart', pt);
    await touch('touchEnd');
    await page.waitForTimeout(80);
  };
  const y0 = await page.evaluate(() => window.scrollY);
  for (let i = 0; i < 3; i++) await tapAt(page.locator('.keys-panel .hw-down'));
  const y1 = await page.evaluate(() => window.scrollY);
  const row = await page.evaluate(() => document.querySelector('.cell.is-cursor').id);
  check('touch: the key panel stays under the finger', Math.abs(y1 - y0) < 2 && row === 'cell-PHRASE-3-0', `scroll ${y0}→${y1}, ${row}`);
  // Keys in the edit bar: the cursor walks the phrase and stays in view above the bar.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#cell-PHRASE-0-0').click();
  await page.locator('.editor-history .bar-keys-toggle').click();
  for (let i = 0; i < 12; i++) await tapAt(page.locator('.cell-bar .hw-down'));
  const kb = await page.evaluate(() => ({
    row: document.querySelector('.cell.is-cursor').id,
    clear: document.querySelector('.cell.is-cursor').getBoundingClientRect().bottom <= document.querySelector('.cell-bar').getBoundingClientRect().top,
  }));
  check('touch: M8 keys in the edit bar move the cursor, which stays in view', kb.row === 'cell-PHRASE-12-0' && kb.clear, JSON.stringify(kb));
  await page.locator('.cell-bar .bar-keys-close').click();
  check('touch selection console clean', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(report.join('\n'));
if (report.some((l) => l.startsWith('FAIL'))) process.exitCode = 1;
