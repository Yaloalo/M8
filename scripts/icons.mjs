// Renders the PNG app icons from the SVGs with the system Chromium (run once after editing them).
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium' });
for (const [src, out, size] of [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['maskable.svg', 'maskable-512.png', 512],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const svg = readFileSync(`public/icons/${src}`, 'utf8');
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.screenshot({ path: `public/icons/${out}`, omitBackground: true });
  await page.close();
}
await browser.close();
