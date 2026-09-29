// The pages /page shows: each /writings/*.svg drawn out at 700, 1100 and
// 1500px wide as WebP, so the book never has to shrink a 1860×2480 scan on
// every frame of a turn. Run it after adding or changing a writing's SVGs:
//
//   npm install --no-save playwright-core
//   node --import ./test/register.mjs test/server.mjs 4321 &
//   PW_BROWSER=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node writings/pages/make.mjs
//
// It only makes what's missing; pass --all to redo every page.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const DIR = new URL('../', import.meta.url).pathname;           // writings/
const OUT = new URL('./', import.meta.url).pathname;            // writings/pages/
const WIDTHS = [700, 1100, 1500];
const all = process.argv.includes('--all');
const base = process.env.SITE || 'http://localhost:4321';

const todo = fs.readdirSync(DIR).filter(f => f.endsWith('.svg')).sort()
  .filter(f => all || WIDTHS.some(w => !fs.existsSync(OUT + f.replace('.svg', '-' + w + '.webp'))));
if (!todo.length) { console.log('nothing to make'); process.exit(0); }

const browser = await chromium.launch(process.env.PW_BROWSER ? { executablePath: process.env.PW_BROWSER } : { channel: process.env.PW_CHANNEL || 'msedge' });
const page = await (await browser.newContext()).newPage();
await page.goto(base + '/writings');
for (const f of todo) {
  const out = await page.evaluate(async ({ url, widths }) => {
    const img = new Image(); img.src = url; await img.decode();
    const res = [];
    for (const w of widths) {
      const h = Math.round(w * img.naturalHeight / img.naturalWidth);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, w, h);
      const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.82));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      res.push({ w, type: blob.type, b64: btoa(s) });
    }
    return res;
  }, { url: '/writings/' + f, widths: WIDTHS });
  for (const r of out) {
    if (r.type !== 'image/webp') throw new Error('this browser made ' + r.type + ', not webp');
    fs.writeFileSync(OUT + f.replace('.svg', '-' + r.w + '.webp'), Buffer.from(r.b64, 'base64'));
  }
  console.log(f, '→', WIDTHS.map(w => w + 'w').join(' '));
}
await browser.close();
