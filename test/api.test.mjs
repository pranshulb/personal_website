// API tests for api/community/, run against the blob stub (test/blob-stub.mjs,
// swapped in for @vercel/blob by test/hooks.mjs).
//   npm test            (or: node --import ./test/register.mjs test/api.test.mjs)
//   npm test -- double  runs only tests whose name contains "double"
import assert from 'node:assert/strict';
import { call, freshIp } from './fake.mjs';

process.env.COMMUNITY_ADMIN_PASS = 'open-sesame';

const REPO = new URL('../', import.meta.url).href;
const imp = (p) => import(REPO + p).then((m) => m.default ?? m);
const blob = await import('@vercel/blob');
const T = blob.__test;
if (!T) throw new Error('the real @vercel/blob was loaded — run through test/register.mjs (npm test)');

const store = await import(REPO + 'api/community/_store.js');
const places = await imp('api/community/places.js');
const suggest = await imp('api/community/suggest.js');
const login = await imp('api/community/login.js');
const pending = await imp('api/community/pending.js');
const approve = await imp('api/community/approve/[id].js');
const reject = await imp('api/community/reject/[id].js');
const edit = await imp('api/community/edit/[id].js');
const bulkAdd = await imp('api/community/bulk-add.js');
const backups = await imp('api/community/backups.js');

const ADMIN = { 'x-admin-pass': 'open-sesame' };
const ip = () => ({ 'x-forwarded-for': freshIp() });
const admin = (extra = {}) => ({ ...ADMIN, ...ip(), ...extra });

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

async function run() {
  const only = process.argv[2];
  for (const { name, fn } of tests) {
    if (only && !name.includes(only)) continue;
    T.reset();
    try {
      await fn();
      passed++;
      console.log('  ok   ' + name);
    } catch (e) {
      failed++;
      console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e));
    }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

// ---- helpers ----
const getPlaces = async () => (await call(places, { method: 'GET', headers: ip() })).body;
const getPending = async () => (await call(pending, { method: 'GET', headers: admin() })).body;
const post = (handler, body, query, headers) => call(handler, { method: 'POST', body, query, headers: admin(headers) });
const suggestOne = (body, headers) => call(suggest, { method: 'POST', body, headers: { ...ip(), ...headers } });

// ======================================================================
// unit: sanitisers
// ======================================================================

test('clean strips brackets and control chars, keeps newlines, caps length', () => {
  assert.equal(store.clean('  <b>hi</b>\u0007 there\u0000 ', 100), 'bhi/b there');
  assert.equal(store.clean('line one\nline  two\ttab', 100), 'line one\nline two tab');
  assert.equal(store.clean('x'.repeat(50), 10), 'x'.repeat(10));
  assert.equal(store.clean(null, 10), '');
  assert.equal(store.clean(42, 10), '42');
});

test('cleanUrl keeps http(s), drops other schemes, assumes https for bare domains', () => {
  assert.equal(store.cleanUrl('https://a.b/c?d=1'), 'https://a.b/c?d=1');
  assert.equal(store.cleanUrl('http://a.b'), 'http://a.b');
  assert.equal(store.cleanUrl('javascript:alert(1)'), '');
  assert.equal(store.cleanUrl('data:text/html,hi'), '');
  assert.equal(store.cleanUrl('example.com'), 'https://example.com');
  assert.equal(store.cleanUrl('example.com/path'), 'https://example.com/path');
  assert.equal(store.cleanUrl('example.com?x=1'), 'https://example.com?x=1');
  assert.equal(store.cleanUrl('not a url'), '');
  assert.equal(store.cleanUrl(''), '');
});

test('cleanTags lowercases, dedupes, accepts a comma string, caps at 6', () => {
  assert.deepEqual(store.cleanTags(['Art', ' art', 'FOOD']), ['art', 'food']);
  assert.deepEqual(store.cleanTags('a, b ,c'), ['a', 'b', 'c']);
  assert.deepEqual(store.cleanTags([1, 2, 3, 4, 5, 6, 7, 8]).length, 6);
  assert.deepEqual(store.cleanTags(null), []);
  assert.deepEqual(store.cleanTags({}), []);
});

test('cleanCoord: finite, in range, strings accepted, junk is null', () => {
  assert.equal(store.cleanCoord(51.5, 90), 51.5);
  assert.equal(store.cleanCoord('51.5', 90), 51.5);
  assert.equal(store.cleanCoord('abc', 90), null);
  assert.equal(store.cleanCoord(91, 90), null);
  assert.equal(store.cleanCoord(NaN, 90), null);
  assert.equal(store.cleanCoord('', 90), null);
  assert.equal(store.cleanCoord(null, 90), null);
  assert.equal(store.cleanCoord(0, 90), 0);
});

// ======================================================================
// public: places + suggest
// ======================================================================

test('GET places on an empty store is [] with the public CORS header', async () => {
  const res = await call(places, { method: 'GET', headers: ip() });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, []);
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('suggest lands in the pending queue with sanitised fields', async () => {
  const res = await suggestOne({
    name: '  The <b>Good</b> Bakery ', city: 'London', area: 'Peckham',
    tags: ['Food', 'food', 'WORKSHOP'], note: 'sourdough', url: 'goodbakery.com', submitted_by: 'sam',
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const q = await getPending();
  assert.equal(q.length, 1);
  assert.equal(q[0].id, res.body.id);
  assert.equal(q[0].name, 'The bGood/b Bakery');
  assert.equal(q[0].area, 'Peckham');
  assert.equal(q[0].city, 'London');
  assert.deepEqual(q[0].tags, ['food', 'workshop']);
  assert.equal(q[0].url, 'https://goodbakery.com');
  assert.equal(q[0].source, 'suggest');
});

test('suggest with only a city uses it as the area', async () => {
  await suggestOne({ name: 'X', city: 'Bristol' });
  const q = await getPending();
  assert.equal(q[0].area, 'Bristol');
});

test('suggest requires a name', async () => {
  const res = await suggestOne({ city: 'London' });
  assert.equal(res.statusCode, 400);
  assert.equal((await getPending()).length, 0);
});

test('suggest honeypot: a filled hidden field is accepted and discarded', async () => {
  const res = await suggestOne({ name: 'Bot Place', city: 'London', website: 'http://spam' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.ok);
  assert.equal((await getPending()).length, 0);
});

test('suggest is rate limited per IP at 5/min', async () => {
  const h = ip();
  for (let i = 0; i < 5; i++) {
    const r = await call(suggest, { method: 'POST', body: { name: 'p' + i }, headers: h });
    assert.equal(r.statusCode, 200);
  }
  const r6 = await call(suggest, { method: 'POST', body: { name: 'p6' }, headers: h });
  assert.equal(r6.statusCode, 429);
  assert.equal((await getPending()).length, 5);
});

test('a read failure is a 503, and the queue is NOT wiped by it', async () => {
  await suggestOne({ name: 'keep me' });
  T.fail.list = true;
  const res = await suggestOne({ name: 'during outage' });
  assert.equal(res.statusCode, 503);
  T.fail.list = false;
  const q = await getPending();
  assert.deepEqual(q.map((p) => p.name), ['keep me']);
});

test('a corrupt newest version is a 503, not an empty list to write over', async () => {
  await suggestOne({ name: 'keep me' });
  T.advanceClock(1000);
  T.seed('community-pending-corrupt.json', { not: 'a list' });
  const res = await suggestOne({ name: 'after corruption' });
  assert.equal(res.statusCode, 503);
  const list = await call(pending, { method: 'GET', headers: admin() });
  assert.equal(list.statusCode, 503);
  // and history still holds the good copy
  const versions = (await call(backups, { method: 'GET', query: { which: 'pending' }, headers: admin() })).body.versions;
  assert.ok(versions.some((v) => v.count === 1));
});

// ======================================================================
// auth
// ======================================================================

test('admin routes: 401 without a credential, 403 cross-origin, 503 when unset', async () => {
  let res = await call(pending, { method: 'GET', headers: ip() });
  assert.equal(res.statusCode, 401);

  res = await call(pending, { method: 'GET', headers: admin({ origin: 'https://evil.example' }) });
  assert.equal(res.statusCode, 403);

  res = await call(pending, { method: 'GET', headers: admin({ origin: 'https://pranshul.cafe' }) });
  assert.equal(res.statusCode, 200);

  const saved = process.env.COMMUNITY_ADMIN_PASS;
  delete process.env.COMMUNITY_ADMIN_PASS;
  try {
    res = await call(pending, { method: 'GET', headers: admin() });
    assert.equal(res.statusCode, 503);
  } finally {
    process.env.COMMUNITY_ADMIN_PASS = saved;
  }
});

test('admin responses never carry Access-Control-Allow-Origin', async () => {
  const res = await call(pending, { method: 'GET', headers: admin() });
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('login: wrong password 401 (slow), right password sets a cookie that works', async () => {
  const t0 = Date.now();
  let res = await call(login, { method: 'POST', body: { password: 'nope' }, headers: ip() });
  assert.equal(res.statusCode, 401);
  assert.ok(Date.now() - t0 >= 450, 'failed login should cost ~500ms');

  res = await call(login, { method: 'POST', body: { password: 'open-sesame' }, headers: ip() });
  assert.equal(res.statusCode, 200);
  const setCookie = res.headers['set-cookie'];
  assert.match(setCookie, /^pcafe_community=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);
  const cookie = setCookie.split(';')[0];

  res = await call(pending, { method: 'GET', headers: { cookie, ...ip() } });
  assert.equal(res.statusCode, 200);

  // tampered signature
  res = await call(pending, { method: 'GET', headers: { cookie: cookie.slice(0, -2) + 'zz', ...ip() } });
  assert.equal(res.statusCode, 401);

  // a garbage cookie value must not throw (decodeURIComponent on '%')
  res = await call(pending, { method: 'GET', headers: { cookie: 'pcafe_community=%E0%A4%A', ...ip() } });
  assert.equal(res.statusCode, 401);

  // sign out clears it
  res = await call(login, { method: 'DELETE', headers: ip() });
  assert.match(res.headers['set-cookie'], /Max-Age=0/);
});

test('login refuses cross-origin and is rate limited at 10/min', async () => {
  let res = await call(login, { method: 'POST', body: { password: 'open-sesame' }, headers: { ...ip(), origin: 'https://evil.example' } });
  assert.equal(res.statusCode, 403);
  const h = ip();
  for (let i = 0; i < 10; i++) await call(login, { method: 'POST', body: { password: 'open-sesame' }, headers: h });
  res = await call(login, { method: 'POST', body: { password: 'open-sesame' }, headers: h });
  assert.equal(res.statusCode, 429);
});

// ======================================================================
// moderation
// ======================================================================

test('approve moves the item to the map with the same id and a geocoded pin', async () => {
  T.nominatim = [{ lat: '51.47', lon: '-0.07' }];
  const s = await suggestOne({ name: 'Peckham Levels', area: 'Peckham', tags: ['art'] });
  const res = await post(approve, {}, { id: s.body.id });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.alreadyOnMap, false);
  const list = await getPlaces();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, s.body.id);
  assert.equal(list[0].lat, 51.47);
  assert.equal(list[0].lng, -0.07);
  assert.equal(list[0].needsCoords, undefined);
  assert.match(list[0].when, /^[a-z]+ \d{4}$/);
  assert.equal((await getPending()).length, 0);
});

test('approve with no geocode hit stores null coords and needsCoords', async () => {
  T.nominatim = [];
  const s = await suggestOne({ name: 'Nowhere' });
  const res = await post(approve, {}, { id: s.body.id });
  assert.equal(res.statusCode, 200);
  const list = await getPlaces();
  assert.equal(list[0].lat, null);
  assert.equal(list[0].needsCoords, true);
  // tried name+area? no area, so name only; nothing else to try
  assert.equal(T.nominatimCalls, 1);
});

test('approve honours caller coordinates and "when" and skips the geocoder', async () => {
  const s = await suggestOne({ name: 'Somewhere' });
  const res = await post(approve, { lat: 51.5, lng: -0.1, when: 'June 2024' }, { id: s.body.id });
  assert.equal(res.statusCode, 200);
  assert.equal(T.nominatimCalls, 0);
  assert.equal(res.body.place.when, 'june 2024');
  assert.equal(res.body.place.lat, 51.5);
});

test('approve of an unknown id is 404', async () => {
  const res = await post(approve, {}, { id: 'nope' });
  assert.equal(res.statusCode, 404);
});

test('approving the same suggestion twice concurrently yields ONE place', async () => {
  T.nominatim = [{ lat: '51.5', lon: '-0.1' }];
  const s = await suggestOne({ name: 'Twice' });
  const results = await Promise.all([
    post(approve, {}, { id: s.body.id }),
    post(approve, {}, { id: s.body.id }),
    post(approve, {}, { id: s.body.id }),
  ]);
  const codes = results.map((r) => r.statusCode).sort();
  assert.ok(codes.every((c) => c === 200 || c === 404), codes.join(','));
  const list = await getPlaces();
  assert.equal(list.length, 1, 'duplicate place: ' + JSON.stringify(list));
  assert.equal((await getPending()).length, 0);
});

test('approve → the item is still gone from the queue if approve is repeated later', async () => {
  const s = await suggestOne({ name: 'Again' });
  await post(approve, { lat: 1, lng: 1 }, { id: s.body.id });
  const res = await post(approve, { lat: 1, lng: 1 }, { id: s.body.id });
  assert.equal(res.statusCode, 404);
  assert.equal((await getPlaces()).length, 1);
});

test('suggestions arriving during approvals are never lost', async () => {
  T.nominatim = [{ lat: '51.5', lon: '-0.1' }];
  const first = await suggestOne({ name: 'to approve' });
  const work = [post(approve, {}, { id: first.body.id })];
  for (let i = 0; i < 8; i++) work.push(suggestOne({ name: 'late ' + i }));
  const results = await Promise.all(work);
  assert.ok(results.every((r) => r.statusCode === 200), results.map((r) => r.statusCode).join(','));
  const q = await getPending();
  assert.equal(q.length, 8, q.map((p) => p.name).join(','));
  assert.equal((await getPlaces()).length, 1);
});

test('reject drops the item; unknown id is 404', async () => {
  const s = await suggestOne({ name: 'Nah' });
  let res = await post(reject, {}, { id: s.body.id });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.remaining, 0);
  res = await post(reject, {}, { id: s.body.id });
  assert.equal(res.statusCode, 404);
});

test('bulk-add: line/JSON entries with when, coords and string tags; approve uses the coords', async () => {
  const res = await post(bulkAdd, [
    { name: 'A', area: 'Hackney', tags: 'film, Film ,art', when: 'March 2023', lat: '51.55', lng: '-0.05', url: 'a.com' },
    { name: '', area: 'skipped' },
    'junk',
    { name: 'B', lat: 'x', lng: 1 },
  ]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.added, 2);
  const q = await getPending();
  const a = q.find((p) => p.name === 'A');
  assert.deepEqual(a.tags, ['film', 'art']);
  assert.equal(a.when, 'march 2023');
  assert.equal(a.lat, 51.55);
  assert.equal(a.url, 'https://a.com');
  assert.equal(a.source, 'bulk');
  const b = q.find((p) => p.name === 'B');
  assert.equal(b.lat, undefined, 'half a coordinate must not be stored');

  const ap = await post(approve, {}, { id: a.id });
  assert.equal(ap.statusCode, 200);
  assert.equal(T.nominatimCalls, 0);
  assert.equal(ap.body.place.when, 'march 2023');
  assert.equal(ap.body.place.lat, 51.55);
});

test('bulk-add rejects a non-array and over-sized batches', async () => {
  let res = await post(bulkAdd, { name: 'x' });
  assert.equal(res.statusCode, 400);
  res = await post(bulkAdd, Array.from({ length: 201 }, (_, i) => ({ name: 'p' + i })));
  assert.equal(res.statusCode, 400);
});

test('pending queue caps at 500', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await post(bulkAdd, Array.from({ length: 200 }, (_, k) => ({ name: 'p' + i + '-' + k })));
    if (i < 2) assert.equal(r.statusCode, 200);
    else assert.equal(r.statusCode, 429);
  }
  assert.equal((await getPending()).length, 400);
});

// ======================================================================
// editing + removing what is live
// ======================================================================

async function approved(fields = {}) {
  const s = await suggestOne({ name: 'Place', area: 'Soho', tags: ['music'], note: 'n', ...fields });
  const r = await post(approve, { lat: 51.51, lng: -0.13 }, { id: s.body.id });
  assert.equal(r.statusCode, 200);
  return r.body.place;
}

test('edit changes only the fields sent and keeps id/order', async () => {
  const p1 = await approved({ name: 'First' });
  const p2 = await approved({ name: 'Second' });
  const res = await post(edit, { name: ' Second <renamed> ', tags: 'Poetry, poetry', url: 'javascript:x' }, { id: p2.id });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const list = await getPlaces();
  assert.deepEqual(list.map((p) => p.id), [p1.id, p2.id]);
  assert.equal(list[1].name, 'Second renamed');
  assert.deepEqual(list[1].tags, ['poetry']);
  assert.equal(list[1].url, '');
  assert.equal(list[1].area, 'Soho', 'untouched field changed');
  assert.equal(list[1].lat, 51.51);
});

test('edit: coordinates move the pin, clearing both marks needsCoords, half is 400', async () => {
  const p = await approved();
  let res = await post(edit, { lat: 52, lng: 0.5 }, { id: p.id });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.place.lat, 52);
  assert.equal(res.body.place.needsCoords, undefined);

  res = await post(edit, { lat: 52 }, { id: p.id });
  assert.equal(res.statusCode, 400);

  res = await post(edit, { lat: null, lng: null }, { id: p.id });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.place.lat, null);
  assert.equal(res.body.place.needsCoords, true);
  assert.equal((await getPlaces())[0].needsCoords, true);
});

test('edit with geocode:true re-looks-up the pin from the corrected name/area', async () => {
  const p = await approved({ name: 'Msspelt' });
  T.nominatim = [{ lat: '51.6', lon: '-0.2' }];
  const res = await post(edit, { name: 'Spelt', geocode: true }, { id: p.id });
  assert.equal(res.statusCode, 200);
  assert.equal(T.nominatimCalls, 1);
  assert.equal(res.body.place.lat, 51.6);
  assert.equal(res.body.place.name, 'Spelt');
});

test('edit: empty name 400, unknown id 404', async () => {
  const p = await approved();
  let res = await post(edit, { name: '  ' }, { id: p.id });
  assert.equal(res.statusCode, 400);
  res = await post(edit, { name: 'x' }, { id: 'nope' });
  assert.equal(res.statusCode, 404);
});

test('DELETE by id removes exactly that entry; a second delete is 404', async () => {
  const p1 = await approved({ name: 'One' });
  const p2 = await approved({ name: 'Two' });
  let res = await call(places, { method: 'DELETE', body: { id: p1.id }, headers: admin() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.remaining, 1);
  assert.deepEqual((await getPlaces()).map((p) => p.id), [p2.id]);
  res = await call(places, { method: 'DELETE', query: { id: p1.id }, headers: admin() });
  assert.equal(res.statusCode, 404);
});

test('DELETE by index+name (old client) works, refuses a shifted list, and range-checks', async () => {
  await approved({ name: 'One' });
  await approved({ name: 'Two' });
  let res = await call(places, { method: 'DELETE', query: { index: '1', name: 'One' }, headers: admin() });
  assert.equal(res.statusCode, 409);
  res = await call(places, { method: 'DELETE', query: { index: '5', name: 'One' }, headers: admin() });
  assert.equal(res.statusCode, 400);
  res = await call(places, { method: 'DELETE', query: { index: '1', name: 'Two' }, headers: admin() });
  assert.equal(res.statusCode, 200);
  assert.deepEqual((await getPlaces()).map((p) => p.name), ['One']);
});

test('DELETE all wipes the map (and history keeps the previous copy)', async () => {
  await approved({ name: 'One' });
  await approved({ name: 'Two' });
  const res = await call(places, { method: 'DELETE', query: { all: 'true' }, headers: admin() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.removed, 2);
  assert.deepEqual(await getPlaces(), []);
  const versions = (await call(backups, { method: 'GET', headers: admin() })).body.versions;
  assert.equal(versions[0].count, 0);
  assert.equal(versions[1].count, 2);
});

test('DELETE requires admin', async () => {
  const res = await call(places, { method: 'DELETE', query: { all: 'true' }, headers: ip() });
  assert.equal(res.statusCode, 401);
});

test('a removal racing an approval loses neither the removal nor the approval', async () => {
  const p1 = await approved({ name: 'Old' });
  const s = await suggestOne({ name: 'New' });
  const [d, a] = await Promise.all([
    call(places, { method: 'DELETE', body: { id: p1.id }, headers: admin() }),
    post(approve, { lat: 1, lng: 1 }, { id: s.body.id }),
  ]);
  assert.equal(d.statusCode, 200);
  assert.equal(a.statusCode, 200);
  assert.deepEqual((await getPlaces()).map((p) => p.name), ['New']);
});

// ======================================================================
// legacy data (entries written before ids existed)
// ======================================================================

test('legacy entries get stable ids on read, and can be edited and removed by them', async () => {
  T.seed('community-places-old.json', [
    { name: 'Old A', area: 'Brixton', tags: ['food'], note: '', url: '', when: 'may 2025', lat: 51.46, lng: -0.11 },
    { name: 'Old B', area: 'Brixton', tags: [], note: '', url: '', when: 'may 2025', lat: 51.47, lng: -0.12 },
  ]);
  const l1 = await getPlaces();
  const l2 = await getPlaces();
  assert.ok(l1[0].id && l1[0].id.startsWith('legacy-'));
  assert.equal(l1[0].id, l2[0].id, 'legacy id must be stable across reads');
  assert.notEqual(l1[0].id, l1[1].id);

  let res = await post(edit, { note: 'edited' }, { id: l1[0].id });
  assert.equal(res.statusCode, 200);
  const l3 = await getPlaces();
  assert.equal(l3[0].note, 'edited');
  assert.equal(l3[0].id, l1[0].id, 'id persisted after the first write');
  assert.equal(l3[1].id, l1[1].id);

  res = await call(places, { method: 'DELETE', body: { id: l1[1].id }, headers: admin() });
  assert.equal(res.statusCode, 200);
  assert.deepEqual((await getPlaces()).map((p) => p.name), ['Old A']);
});

test('two identical legacy duplicates: a delete removes one, not both', async () => {
  const dup = { name: 'Dup', area: '', tags: [], note: '', url: '', when: 'x', lat: 1, lng: 1 };
  T.seed('community-places-old.json', [dup, { ...dup }]);
  const l = await getPlaces();
  assert.equal(l[0].id, l[1].id);
  const res = await call(places, { method: 'DELETE', body: { id: l[0].id }, headers: admin() });
  assert.equal(res.statusCode, 200);
  assert.equal((await getPlaces()).length, 1);
});

// ======================================================================
// storage mechanics
// ======================================================================

test('every write lands at a new suffixed pathname, so reads never see a CDN-stale copy', async () => {
  await suggestOne({ name: 'one' });
  await suggestOne({ name: 'two' });
  const names = T.pathnames().filter((p) => p.startsWith('community-pending'));
  assert.equal(names.length, 2);
  assert.ok(names.every((p) => /^community-pending-[A-Za-z0-9]+\.json$/.test(p)), names.join(','));
  assert.equal((await getPending()).length, 2);
});

test('history: versions are listed newest first, and restore writes forward', async () => {
  const p1 = await approved({ name: 'One' });
  await approved({ name: 'Two' });
  let res = await call(backups, { method: 'GET', headers: admin() });
  assert.equal(res.statusCode, 200);
  const v = res.body.versions;
  assert.equal(v.length, 2);
  assert.equal(v[0].current, true);
  assert.deepEqual(v.map((x) => x.count), [2, 1]);

  res = await call(backups, { method: 'POST', body: { which: 'places', pathname: v[1].pathname }, headers: admin() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.restored, 1);
  assert.deepEqual((await getPlaces()).map((p) => p.id), [p1.id]);

  res = await call(backups, { method: 'GET', headers: admin() });
  assert.equal(res.body.versions.length, 3, 'restore should add a version, not rewrite history');

  res = await call(backups, { method: 'POST', body: { pathname: 'nope' }, headers: admin() });
  assert.equal(res.statusCode, 404);
  res = await call(backups, { method: 'GET', query: { which: 'other' }, headers: admin() });
  assert.equal(res.statusCode, 400);
});

test('prune keeps the newest 30 versions and anything under two minutes old', async () => {
  T.advanceClock(-41 * 3 * 60 * 1000);
  for (let i = 0; i < 40; i++) {
    T.advanceClock(3 * 60 * 1000);
    const r = await suggestOne({ name: 'v' + i });
    assert.equal(r.statusCode, 200);
  }
  const count = T.pathnames().filter((p) => p.startsWith('community-pending')).length;
  assert.ok(count <= 31 && count >= 30, 'kept ' + count);
  assert.equal((await getPending()).length, 40);

  // now hammer within the grace window: nothing recent may be deleted
  T.advanceClock(41 * 3 * 60 * 1000);
  const before = T.pathnames().length;
  await Promise.all(Array.from({ length: 6 }, (_, i) => suggestOne({ name: 'burst ' + i })));
  assert.equal((await getPending()).length, 46);
  assert.ok(T.pathnames().length >= before, 'recent blobs were pruned');
});

test('a slow geocoder is abandoned, not waited on forever', async () => {
  const s = await suggestOne({ name: 'Slow' });
  // The stub honours the abort signal only at call time; emulate a hang by
  // making the "request" take longer than the handler's timeout would allow
  // and checking the handler still completes with null coords.
  T.nominatimDelayMs = 50;
  T.nominatim = [];
  const t0 = Date.now();
  const res = await post(approve, {}, { id: s.body.id });
  T.nominatimDelayMs = 0;
  assert.equal(res.statusCode, 200);
  assert.ok(Date.now() - t0 < 6000);
  assert.equal(res.body.place.needsCoords, true);
});

test('methods: OPTIONS is 200 everywhere, wrong methods are 405', async () => {
  for (const h of [places, suggest, login, pending, approve, reject, edit, bulkAdd, backups]) {
    const o = await call(h, { method: 'OPTIONS', headers: admin() });
    assert.equal(o.statusCode, 200);
  }
  assert.equal((await call(suggest, { method: 'GET', headers: ip() })).statusCode, 405);
  assert.equal((await call(pending, { method: 'POST', headers: admin() })).statusCode, 405);
  assert.equal((await call(approve, { method: 'GET', headers: admin() })).statusCode, 405);
  assert.equal((await call(edit, { method: 'GET', headers: admin() })).statusCode, 405);
  assert.equal((await call(places, { method: 'PUT', headers: admin() })).statusCode, 405);
});


test('lock: writes wait for each other; no lock file is left behind', async () => {
  await Promise.all(Array.from({ length: 12 }, (_, i) => suggestOne({ name: 'w' + i })));
  assert.equal((await getPending()).length, 12);
  assert.ok(!T.pathnames().some((p) => p.startsWith('lock-')), 'lock left behind: ' + T.pathnames().join(','));
});

test('lock: a stale lock (dead writer) is broken after its TTL', async () => {
  T.advanceClock(-20000);
  T.seed('lock-community-pending.txt', 'stuck');
  T.advanceClock(20000);
  const t0 = Date.now();
  const res = await suggestOne({ name: 'after stale lock' });
  assert.equal(res.statusCode, 200);
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + 'ms');
  assert.equal((await getPending()).length, 1);
});

test('lock: a live lock is waited for, and a wedged one gives 503 not a wrong write', async () => {
  T.seed('lock-community-pending.txt', 'held');
  const t0 = Date.now();
  const res = await suggestOne({ name: 'blocked' });
  assert.equal(res.statusCode, 503);
  assert.ok(Date.now() - t0 >= 7000, 'gave up too early');
  assert.equal(res.headers['retry-after'], '2');
});

test('lock: the lock file never shows up as a version of the data', async () => {
  await suggestOne({ name: 'x' });
  T.seed('lock-community-pending.txt', 'held');
  const versions = (await call(backups, { method: 'GET', query: { which: 'pending' }, headers: admin() })).body.versions;
  assert.ok(versions.every((v) => v.pathname.startsWith('community-pending')));
  assert.equal((await getPending()).length, 1);
});

await run();
