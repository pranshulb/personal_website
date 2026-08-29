// Drives the three community pages in a real browser against the in-process
// server (test/server.mjs), which runs the real handlers over the blob stub.
//   npm run test:pages            (needs: npm install --no-save playwright-core)
//   PW_CHANNEL=chrome … / PW_BROWSER=/path/to/chromium … to pick the browser
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { start, stop, T } from './server.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('playwright-core is not installed. Run:  npm install --no-save playwright-core');
  process.exit(2);
}

const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
fs.mkdirSync(SHOTS, { recursive: true });

const PORT = await start();
const BASE = 'http://127.0.0.1:' + PORT;

const SAMPLE = [
  { id: 'p1', name: 'Peckham Levels', area: 'Peckham', tags: ['art', 'community'], note: 'a car park turned into studios, and the view from the top is the whole of london', url: 'https://peckhamlevels.org', when: 'march 2026', lat: 51.4715, lng: -0.0693 },
  { id: 'p2', name: 'The Prince Charles', area: 'Soho', tags: ['film'], note: 'sing-along screenings. no notes.', url: 'https://princecharlescinema.com', when: 'april 2026', lat: 51.5116, lng: -0.1301 },
  { id: 'p3', name: 'Hackney Wick swap', area: 'Hackney', tags: ['community', 'making'], note: 'bring a thing, leave with a thing', url: '', when: 'may 2026', lat: 51.5432, lng: -0.0225 },
  { id: 'p4', name: 'Round Chapel poetry night', area: 'Hackney', tags: ['poetry'], note: 'people read things they wrote on the bus', url: '', when: 'june 2026', lat: 51.5540, lng: -0.0556 },
  { id: 'p5', name: 'Mending circle', area: 'Peckham', tags: ['making', 'workshop'], note: 'someone taught me to darn a sock', url: '', when: 'june 2026', lat: null, lng: null, needsCoords: true },
  { name: 'Old legacy entry', area: 'Brixton', tags: ['food'], note: 'pre-id era', url: '', when: 'january 2025', lat: 51.4613, lng: -0.1156 },
  { id: 'p7', name: 'No tags at all', area: 'Soho', note: 'an entry with no tags field', when: 'july 2026', lat: 51.5130, lng: -0.1350 },
];

function seed() {
  T.reset();
  T.nominatim = [{ lat: '51.50', lon: '-0.12' }];
  T.seed('community-places-seed.json', SAMPLE);
  T.seed('community-pending-seed.json', [
    { id: 'q1', name: 'Genesis Cinema', area: 'Stepney', city: 'London', tags: ['film'], note: 'cheap tuesdays', url: 'https://genesiscinema.co.uk', submitted_by: 'sam', submitted_at: '2026-08-01T10:00:00Z', source: 'suggest' },
    { id: 'q2', name: 'PROBE test entry', area: '', tags: [], note: '', url: 'javascript:alert(1)', submitted_by: '', submitted_at: '2026-08-02T10:00:00Z', source: 'suggest' },
  ]);
}

const browser = await chromium.launch(
  process.env.PW_BROWSER
    ? { executablePath: process.env.PW_BROWSER, headless: true }
    : { channel: process.env.PW_CHANNEL || 'msedge', headless: true },
);
let passed = 0, failed = 0;

async function page(viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  p._errors = [];
  p.on('pageerror', (e) => p._errors.push('pageerror: ' + e.message));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p._errors.push('console: ' + m.text());
  });
  p.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 500 && !T.fail.list) p._errors.push('response ' + r.status() + ' ' + u);
    if (r.status() === 404 && !/favicon/.test(u)) p._errors.push('response 404 ' + u);
  });
  return p;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------- map
test('map: renders every entry, dots for the pinned ones, no errors', async () => {
  seed();
  const p = await page();
  await p.goto(BASE + '/community');
  await p.waitForSelector('.place');
  await p.waitForTimeout(800);
  const cards = await p.$$('.place');
  assert.equal(cards.length, 7);
  const dots = await p.$$('.ink-dot-marker');
  assert.equal(dots.length, 6, 'one entry has no coords');
  // every dot at its own spot — they used to stack at the map origin on
  // first render because the filter code overwrote Leaflet's transform
  const spots = await p.$$eval('.ink-dot-marker', (els) => els.map((e) => {
    const r = e.getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top);
  }));
  assert.equal(new Set(spots).size, 6, 'dots stacked: ' + spots.join(' | '));
  const mapBox = await p.$eval('#map', (e) => e.getBoundingClientRect());
  const inside = await p.$$eval('.ink-dot-marker', (els, box) => els.every((e) => {
    const r = e.getBoundingClientRect();
    return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom;
  }), mapBox);
  assert.ok(inside, 'a dot is outside the map: ' + spots.join(' | '));
  // and tiles actually arrive from the tile server
  const tileOk = await p.evaluate(() => [...document.querySelectorAll('.leaflet-tile-loaded')].length > 0);
  assert.ok(tileOk, 'no tiles loaded');
  const tally = await p.textContent('#tally');
  assert.match(tally, /7 places · 4 corners of london · \d+ subjects/);
  assert.ok((await p.textContent('#places-container')).includes('no dot for this one yet'));
  // a sort bar shows once there are enough entries
  assert.equal(await p.isVisible('#sortbar'), true);
  // filter chips: 'everything' + each tag
  const chips = await p.$$eval('.filter-link', (els) => els.map((e) => e.dataset.tag));
  assert.ok(chips.includes('all') && chips.includes('community') && chips.includes('film'));
  await p.screenshot({ path: SHOTS + 'map-desktop.png', fullPage: false });
  assert.deepEqual(p._errors.filter((e) => !/favicon|analytics|umami/.test(e)), []);
  await p.context().close();
});

test('map: filtering hides cards and dots, and area grouping shows headings', async () => {
  seed();
  const p = await page();
  await p.goto(BASE + '/community');
  await p.waitForSelector('.place');
  await p.click('.filter-link[data-tag="film"]');
  await p.waitForTimeout(700);
  const visible = await p.$$eval('.place', (els) => els.filter((e) => !e.classList.contains('hidden')).length);
  assert.equal(visible, 1);
  const hiddenDots = await p.$$eval('.ink-dot-marker', (els) => els.filter((e) => e.style.opacity === '0').length);
  assert.equal(hiddenDots, 5);

  await p.click('.filter-link[data-tag="all"]');
  await p.waitForTimeout(500);
  await p.click('#sort-area');
  await p.waitForTimeout(500);
  const heads = await p.$$eval('.area-head', (els) => els.map((e) => e.textContent.trim()));
  assert.equal(heads.length, 4);
  assert.match(heads[0], /^(hackney|peckham|soho) \d$/i);
  // filtering under grouping hides empty headings
  await p.click('.filter-link[data-tag="poetry"]');
  await p.waitForTimeout(700);
  const shownHeads = await p.$$eval('.area-head', (els) => els.filter((e) => e.style.display !== 'none').length);
  assert.equal(shownHeads, 1);
  await p.screenshot({ path: SHOTS + 'map-grouped-filtered.png' });
  assert.deepEqual(p._errors.filter((e) => !/favicon|analytics|umami/.test(e)), []);
  await p.context().close();
});

test('map: clicking a card opens its popup and lights the dot, then puts it out; keyboard works', async () => {
  seed();
  const p = await page();
  await p.goto(BASE + '/community');
  await p.waitForSelector('.place');
  await p.waitForTimeout(600);
  await p.click('.place:not(.unpinned)');
  await p.waitForTimeout(400);
  assert.equal(await p.isVisible('.leaflet-popup'), true);
  assert.equal(await p.$$eval('.ink-dot-marker.active', (els) => els.length), 1);
  await p.waitForTimeout(3800);
  assert.equal(await p.$$eval('.ink-dot-marker.active', (els) => els.length), 0, 'dot stayed lit');

  // unpinned card does nothing (and doesn't throw)
  await p.click('.place.unpinned');
  await p.waitForTimeout(200);
  // keyboard: focus a card and press Enter
  await p.focus('.place:not(.unpinned)');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  assert.equal(await p.$$eval('.ink-dot-marker.active', (els) => els.length), 1);
  assert.deepEqual(p._errors.filter((e) => !/favicon|analytics|umami/.test(e)), []);
  await p.context().close();
});

test('map: empty list and failed load say different things', async () => {
  T.reset();
  const p = await page();
  await p.goto(BASE + '/community');
  await p.waitForSelector('#no-results', { state: 'visible' });
  assert.match(await p.textContent('#no-results'), /nothing here yet/);
  await p.context().close();

  T.fail.list = true;
  const p2 = await page();
  await p2.goto(BASE + '/community');
  await p2.waitForSelector('#no-results', { state: 'visible' });
  assert.match(await p2.textContent('#no-results'), /couldn.t load the list/);
  T.fail.list = false;
  assert.deepEqual(p2._errors.filter((e) => !/favicon|analytics|umami|503/.test(e)), []);
  await p2.context().close();
});

test('map: narrow screen — sticky map, area heads sit below it', async () => {
  seed();
  const p = await page({ width: 390, height: 780 });
  await p.goto(BASE + '/community');
  await p.waitForSelector('.place');
  await p.waitForTimeout(600);
  await p.click('#sort-area');
  await p.waitForTimeout(400);
  const mapH = await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--map-h')));
  assert.ok(mapH > 100, '--map-h not set: ' + mapH);
  await p.evaluate(() => window.scrollTo(0, 900));
  await p.waitForTimeout(700);
  const rects = await p.evaluate(() => {
    const map = document.querySelector('.map-col').getBoundingClientRect();
    const heads = [...document.querySelectorAll('.area-head')].map((h) => h.getBoundingClientRect());
    const stuck = heads.find((r) => r.top >= 0 && r.top < 400);
    return { mapBottom: map.bottom, stuckTop: stuck ? stuck.top : null };
  });
  assert.ok(rects.stuckTop === null || rects.stuckTop >= rects.mapBottom - 1, 'heading under the map: ' + JSON.stringify(rects));
  await p.screenshot({ path: SHOTS + 'map-mobile-scrolled.png' });
  assert.deepEqual(p._errors.filter((e) => !/favicon|analytics|umami/.test(e)), []);
  await p.context().close();
});

// ------------------------------------------------------------ suggest
test('suggest: Enter in a field submits (no page reload), and it lands in the queue', async () => {
  seed();
  const p = await page();
  await p.goto(BASE + '/community/suggest');
  await p.fill('#name', 'Genesis');
  await p.fill('#city', 'London');
  await p.click('.tag-word:has-text("film")');
  await p.press('#city', 'Enter');
  await p.waitForSelector('#thank-you.visible', { timeout: 5000 });
  assert.equal(new URL(p.url()).search, '', 'the form did a GET to itself');
  const q = JSON.parse((await (await fetch(BASE + '/api/community/pending', { headers: { 'x-admin-pass': 'open-sesame' } })).text()));
  const mine = q.find((x) => x.name === 'Genesis');
  assert.ok(mine, 'not queued');
  assert.deepEqual(mine.tags, ['film']);
  assert.equal(mine.area, 'London');
  await p.screenshot({ path: SHOTS + 'suggest-thanks.png' });
  assert.deepEqual(p._errors.filter((e) => !/favicon|analytics|umami/.test(e)), []);
  await p.context().close();
});

test('suggest: validation copy, rate-limit copy, and the honeypot', async () => {
  seed();
  const p = await page();
  await p.goto(BASE + '/community/suggest');
  await p.click('#submit-link');
  assert.match(await p.textContent('#error-msg'), /name and the city/);
  await p.screenshot({ path: SHOTS + 'suggest-validation.png' });

  // 6 quick sends from one IP: the 6th gets the rate-limit wording
  T.ip = '1.2.3.4';
  for (let i = 0; i < 5; i++) {
    await fetch(BASE + '/api/community/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'r' + i }) });
  }
  await p.fill('#name', 'Sixth');
  await p.fill('#city', 'London');
  await p.click('#submit-link');
  await p.waitForFunction(() => document.getElementById('error-msg').style.display === 'block');
  assert.match(await p.textContent('#error-msg'), /a lot at once/);

  // honeypot: fill the hidden field via script, send → thank-you, but nothing queued
  T.reset();
  T.ip = null;
  await p.evaluate(() => { document.getElementById('website').value = 'http://spam'; });
  await p.click('#submit-link');
  await p.waitForSelector('#thank-you.visible');
  const q = JSON.parse(await (await fetch(BASE + '/api/community/pending', { headers: { 'x-admin-pass': 'open-sesame' } })).text());
  assert.equal(q.length, 0);
  await p.context().close();
});

// -------------------------------------------------------------- admin
async function login(p) {
  await p.goto(BASE + '/community/admin');
  await p.fill('#pass-input', 'open-sesame');
  await p.press('#pass-input', 'Enter');
  await p.waitForSelector('#deck-section', { state: 'visible' });
  await p.waitForSelector('.live-row');
}

test('admin: login, queue renders, approve puts it on the map, live list shows it', async () => {
  seed();
  const p = await page();
  await login(p);
  assert.match(await p.textContent('#deck-counter'), /1 of 2 pending/);
  const TOP = '.swipe-card:not(.behind-1):not(.behind-2)';
  assert.ok((await p.textContent(TOP)).includes('Genesis Cinema'));
  assert.ok((await p.textContent(TOP)).includes('Stepney · London'), 'city should show next to area');
  await p.screenshot({ path: SHOTS + 'admin-deck.png' });

  await p.click('#btn-approve');
  await p.waitForFunction(() => document.getElementById('deck-counter').textContent.startsWith('2 of'));
  await p.waitForFunction(() => document.getElementById('live-list').textContent.includes('Genesis Cinema'));
  const live = JSON.parse(await (await fetch(BASE + '/api/community/places')).text());
  const g = live.find((x) => x.name === 'Genesis Cinema');
  assert.equal(g.id, 'q1');
  assert.equal(g.lat, 51.5);

  // the hostile-link one shows a warning and can be rejected
  assert.ok((await p.textContent('.swipe-card:not(.behind-1):not(.behind-2)')).includes('non-web link'));
  await p.click('#btn-reject');
  await p.waitForSelector('#deck-empty', { state: 'visible' });
  const q = JSON.parse(await (await fetch(BASE + '/api/community/pending', { headers: { 'x-admin-pass': 'open-sesame' } })).text());
  assert.equal(q.length, 0);
  assert.deepEqual(p._errors.filter((e) => !/favicon|analytics|umami/.test(e)), []);
  await p.context().close();
});

test('admin: approve of an item handled elsewhere refreshes the queue with a message', async () => {
  seed();
  const p = await page();
  await login(p);
  // reject q1 behind the page's back
  await fetch(BASE + '/api/community/reject/q1', { method: 'POST', headers: { 'x-admin-pass': 'open-sesame' } });
  await p.click('#btn-approve');
  await p.waitForFunction(() => document.getElementById('deck-status').textContent.includes('already handled'));
  await p.waitForFunction(() => document.getElementById('deck-counter').textContent.startsWith('1 of 1'));
  await p.context().close();
});

test('admin: edit an entry inline, then look the pin up again for the one without', async () => {
  seed();
  const p = await page();
  await login(p);
  const rows = await p.$$('.live-row');
  assert.equal(rows.length, 7);
  // legacy entry got an id, so it has an edit button too
  const editButtons = await p.$$('.live-edit-btn');
  assert.equal(editButtons.length, 7);

  // edit the first entry
  await editButtons[0].click();
  await p.waitForSelector('.live-edit');
  await p.fill('.live-edit [data-key="name"]', 'Peckham Levels (renamed)');
  await p.fill('.live-edit [data-key="tags"]', 'Art, community, ART');
  await p.fill('.live-edit [data-key="when"]', 'February 2026');
  await p.screenshot({ path: SHOTS + 'admin-edit.png' });
  await p.click('.live-edit .edit-actions .text-link:has-text("save")');
  await p.waitForFunction(() => document.getElementById('live-status').textContent.includes('saved'));
  await p.waitForFunction(() => document.getElementById('live-list').textContent.includes('(renamed)'));
  let live = JSON.parse(await (await fetch(BASE + '/api/community/places')).text());
  assert.equal(live[0].name, 'Peckham Levels (renamed)');
  assert.deepEqual(live[0].tags, ['art', 'community']);
  assert.equal(live[0].when, 'february 2026');
  assert.equal(live[0].lat, 51.4715, 'coords must survive an edit that did not touch them');

  // the no-pin entry: save + geocode
  const noPinRow = await p.$('.live-row:has-text("Mending circle")');
  assert.ok((await noPinRow.textContent()).includes('no pin'));
  await (await noPinRow.$('.live-edit-btn')).click();
  await p.click('.live-edit .edit-actions .text-link:has-text("look the pin up")');
  await p.waitForFunction(() => document.getElementById('live-status').textContent.includes('saved'));
  await p.waitForFunction(() => {
    const row = [...document.querySelectorAll('.live-row')].find((r) => r.textContent.includes('Mending circle'));
    return row && !row.textContent.includes('no pin');
  });
  live = JSON.parse(await (await fetch(BASE + '/api/community/places')).text());
  const m = live.find((x) => x.name === 'Mending circle');
  assert.equal(m.lat, 51.5);
  assert.equal(m.needsCoords, undefined);

  // half a coordinate is refused client-side
  await (await (await p.$('.live-row:has-text("Mending circle")')).$('.live-edit-btn')).click();
  await p.fill('.live-edit [data-key="lng"]', '');
  await p.click('.live-edit .edit-actions .text-link:has-text("save")');
  assert.match(await p.textContent('#live-status'), /both be numbers/);
  await p.keyboard.press('Escape');
  assert.equal(await p.$$eval('.live-edit', (els) => els.length), 0, 'editor still open after Escape');
  assert.deepEqual(p._errors.filter((e) => !/favicon|analytics|umami/.test(e)), []);
  await p.context().close();
});

test('admin: remove by id, wipe with confirm, and history restore', async () => {
  seed();
  const p = await page();
  await login(p);
  const row = await p.$('.live-row:has-text("The Prince Charles")');
  await (await row.$('.live-remove:not(.live-edit-btn)')).click();
  await p.waitForFunction(() => document.getElementById('live-status').textContent.includes('removed "The Prince Charles"'));
  let live = JSON.parse(await (await fetch(BASE + '/api/community/places')).text());
  assert.equal(live.length, 6);
  assert.ok(!live.some((x) => x.name === 'The Prince Charles'));

  await p.click('#btn-wipe');
  await p.click('#btn-wipe-confirm');
  await p.waitForFunction(() => document.getElementById('live-status').textContent.includes('wiped 6'));
  live = JSON.parse(await (await fetch(BASE + '/api/community/places')).text());
  assert.equal(live.length, 0);

  await p.click('#btn-history');
  await p.waitForSelector('#history-list .live-row');
  const hist = await p.$$eval('#history-list .live-row', (els) => els.map((e) => e.textContent));
  assert.ok(hist[0].includes('0 entries') && hist[0].includes('current'));
  assert.ok(hist[1].includes('6 entries'));
  await p.screenshot({ path: SHOTS + 'admin-history.png' });
  await (await p.$('#history-list .live-row:nth-child(2) button')).click();
  await p.waitForFunction(() => document.getElementById('history-status').textContent.includes('restored 6'));
  live = JSON.parse(await (await fetch(BASE + '/api/community/places')).text());
  assert.equal(live.length, 6);
  assert.deepEqual(p._errors.filter((e) => !/favicon|analytics|umami/.test(e)), []);
  await p.context().close();
});

test('admin: bulk add parses links and dates out of the line format, queues, and the deck refreshes', async () => {
  seed();
  const p = await page();
  await login(p);
  await p.fill('#bulk-text', [
    'The Good Bakery — Peckham — food, workshop — incredible sourdough — goodbakery.com — June 2024',
    'Some Cinema — Hackney — film — arthouse double features — with a dash — in the note',
    ' — nothing',
  ].join('\n'));
  await p.click('#btn-parse');
  await p.waitForSelector('#bulk-preview', { state: 'visible' });
  assert.match(await p.textContent('#bulk-status'), /2 places parsed/);
  const preview = await p.textContent('#bulk-preview');
  assert.ok(preview.includes('june 2024') && preview.includes('goodbakery.com'));
  await p.screenshot({ path: SHOTS + 'admin-bulk.png' });
  await p.click('#btn-queue');
  await p.waitForFunction(() => document.getElementById('bulk-status').textContent.includes('queued up'));
  await p.waitForFunction(() => document.getElementById('deck-counter').textContent.includes('of 4 pending'));
  const q = JSON.parse(await (await fetch(BASE + '/api/community/pending', { headers: { 'x-admin-pass': 'open-sesame' } })).text());
  const gb = q.find((x) => x.name === 'The Good Bakery');
  assert.equal(gb.url, 'https://goodbakery.com');
  assert.equal(gb.when, 'june 2024');
  assert.equal(gb.note, 'incredible sourdough');
  const sc = q.find((x) => x.name === 'Some Cinema');
  assert.equal(sc.note, 'arthouse double features — with a dash — in the note');

  // JSON path
  await p.fill('#bulk-text', JSON.stringify([{ name: 'JSON place', area: 'Soho', tags: 'talk, TALK', when: 'May 2025', lat: '51.51', lng: '-0.13' }]));
  await p.click('#btn-parse');
  await p.waitForFunction(() => document.getElementById('bulk-status').textContent.includes('1 place parsed'));
  assert.ok((await p.textContent('#bulk-preview')).includes('pin 51.51, -0.13'));
  await p.click('#btn-queue');
  await p.waitForFunction(() => document.getElementById('deck-counter').textContent.includes('of 5 pending'));
  assert.deepEqual(p._errors.filter((e) => !/favicon|analytics|umami/.test(e)), []);
  await p.context().close();
});

test('admin: mobile layout — login button visible, deck fits, actions not covered', async () => {
  seed();
  const p = await page({ width: 390, height: 780 });
  await p.goto(BASE + '/community/admin');
  assert.equal(await p.isVisible('#login-btn'), true);
  await p.fill('#pass-input', 'open-sesame');
  await p.click('#login-btn');
  await p.waitForSelector('#deck-section', { state: 'visible' });
  await p.waitForSelector('.swipe-card');
  await p.waitForTimeout(300);
  const geo = await p.evaluate(() => {
    const card = document.querySelector('.swipe-card:not(.behind-1):not(.behind-2)').getBoundingClientRect();
    const actions = document.getElementById('card-actions').getBoundingClientRect();
    return { cardBottom: card.bottom, actionsTop: actions.top };
  });
  assert.ok(geo.actionsTop >= geo.cardBottom - 1, 'card covers the buttons: ' + JSON.stringify(geo));
  await p.screenshot({ path: SHOTS + 'admin-mobile.png', fullPage: true });
  await p.context().close();
});

const only = process.argv[2];
for (const { name, fn } of tests) {
  if (only && !name.includes(only)) continue;
  try {
    await fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n       '));
  }
}
await browser.close();
await stop();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
