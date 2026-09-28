// The presence server (presence/server.js) against a fake PartyKit room.
// Plain node:assert, like the rest of test/. Run: npm run test:presence
import assert from 'node:assert/strict';
import Presence, { clean } from '../presence/server.js';

function makeRoom() {
  const conns = new Map();
  const room = {
    getConnections: () => conns.values(),
    broadcast(msg, without = []) { for (const c of conns.values()) if (!without.includes(c.id)) c.got.push(JSON.parse(msg)); },
  };
  const server = new Presence(room);
  let n = 0;
  const join = () => {
    const c = { id: 'c' + (++n), got: [], closed: null, send(m) { this.got.push(JSON.parse(m)); }, close(code) { this.closed = code; } };
    conns.set(c.id, c); server.onConnect(c);
    if (c.closed) conns.delete(c.id);
    return c;
  };
  const leave = (c) => { conns.delete(c.id); server.onClose(c); };
  return { server, join, leave };
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('only well-formed messages get through, clamped', () => {
  assert.deepEqual(clean({ t: 'm', x: 0.1234567, y: -9 }), { t: 'm', x: 0.123, y: -4 });
  assert.equal(clean({ t: 'm', x: '<b>', y: 1 }), null);
  assert.equal(clean({ t: 'm', x: NaN, y: 1 }), null);
  assert.equal(clean({ t: 'hello' }), null);
  assert.deepEqual(clean({ t: 'shake', d: -5, extra: 'x' }), { t: 'shake', d: -1 });
  assert.deepEqual(clean({ t: 'away', x: 1 }), { t: 'away' });
});

test('other sites are turned away, the site and local testing are let in', async () => {
  const req = (o) => new Request('https://x/party/home', { headers: { Origin: o } });
  for (const o of ['https://evil.example', '', 'https://pranshul.cafe.evil.example', 'http://pranshul.cafe'])
    assert.ok((await Presence.onBeforeConnect(req(o))) instanceof Response, o);
  for (const o of ['https://pranshul.cafe', 'https://www.pranshul.cafe', 'http://localhost:8930',
                   'https://personal-website-abc123-pranshulbs-projects.vercel.app'])
    assert.ok((await Presence.onBeforeConnect(req(o))) instanceof Request, o);
});

test('arrivals hear who is here; everyone hears the count; leaving is heard', () => {
  const { server, join, leave } = makeRoom();
  const a = join();
  server.onMessage(JSON.stringify({ t: 'm', x: 0.5, y: -0.5 }), a);
  const b = join();
  const hi = b.got.find((m) => m.t === 'hi');
  assert.equal(hi.n, 2);
  assert.deepEqual(hi.peers, [{ id: a.id, x: 0.5, y: -0.5 }]);
  assert.deepEqual(a.got.at(-1), { t: 'n', n: 2 });
  leave(b);
  assert.ok(a.got.some((m) => m.t === 'gone' && m.id === b.id));
  assert.deepEqual(a.got.at(-1), { t: 'n', n: 1 });
});

test('a message goes to everyone else, with the sender\'s id, never back to the sender', () => {
  const { server, join } = makeRoom();
  const a = join(), b = join();
  a.got.length = 0; b.got.length = 0;
  server.onMessage(JSON.stringify({ t: 'tap', x: 1, y: 0.1 }), a);
  assert.deepEqual(b.got, [{ t: 'tap', x: 1, y: 0.1, id: a.id }]);
  assert.equal(a.got.length, 0);
});

test('a flood is cut to 20 a second, shakes to one per 1.2s, junk dropped', () => {
  const { server, join } = makeRoom();
  const a = join(), b = join();
  b.got.length = 0;
  for (let i = 0; i < 100; i++) server.onMessage(JSON.stringify({ t: 'm', x: 0, y: 0 }), a);
  assert.ok(b.got.length <= 20, String(b.got.length));
  const c = join(), d = join();
  d.got.length = 0;
  for (let i = 0; i < 5; i++) server.onMessage(JSON.stringify({ t: 'shake', d: 1 }), c);
  server.onMessage('not json', c);
  server.onMessage('x'.repeat(500), c);
  assert.equal(d.got.filter((m) => m.t === 'shake').length, 1);
  assert.equal(d.got.filter((m) => m.t !== 'shake' && m.t !== 'n').length, 0);
});

test('a full room turns the next arrival away', () => {
  const { join } = makeRoom();
  for (let i = 0; i < 60; i++) assert.equal(join().closed, null);
  assert.equal(join().closed, 1013);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n', e); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
