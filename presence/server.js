/* ================================================================
   PRESENCE — who else is under the tree

   A PartyKit server (Cloudflare underneath). Each page is a room; every
   open copy of the page keeps one WebSocket to it. The server only passes
   things along: where each visitor's pointer is, relative to the tree,
   a tap on the water, a shake of the tree, and how many are here. No
   names, no addresses, nothing written anywhere: when the last visitor
   leaves, the room is empty and forgets everything.

   Messages, all JSON, all small:
     visitor -> here   { t: 'm', x, y }       pointer moved (tree units, see index.html)
                       { t: 'away' }          pointer left / finger lifted
                       { t: 'tap', x, y }     tapped the water
                       { t: 'shake', d }      shook the tree (d = -1 or 1)
     here -> visitors  { t: 'hi', id, peers: [{ id, x, y }], n }   on arrival
                       the above, with the sender's id added
                       { t: 'gone', id }      someone left
                       { t: 'n', n }          how many are in the room now

   Everything that comes in is checked and clamped before it goes out
   again, and each visitor is held to a few messages a second, so a
   script can't use the room to flood other people's pages.
   ================================================================ */

// Pages allowed to connect. Origin is only a browser's word for where a
// page came from, so this stops other sites embedding the room, not a
// determined script; the checks below are what keep a room harmless.
const ORIGINS = [
  /^https:\/\/(www\.)?pranshul\.cafe$/,
  /^https:\/\/personal-website-[a-z0-9-]+-pranshulbs-projects\.vercel\.app$/,   // Vercel previews
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,                                  // testing
];
const MAX_IN_ROOM = 60;          // beyond this, new arrivals are turned away
const MAX_PER_SECOND = 20;       // messages from one visitor
const SHAKE_EVERY_MS = 1200;     // one shake per visitor in this long
const TAP_EVERY_MS = 250;

const num = (v, lim) => (typeof v === 'number' && Number.isFinite(v))
  ? Math.max(-lim, Math.min(lim, Math.round(v * 1000) / 1000)) : null;

export function clean(msg) {
  if (!msg || typeof msg !== 'object') return null;
  switch (msg.t) {
    case 'm': case 'tap': {
      const x = num(msg.x, 4), y = num(msg.y, 4);
      return x === null || y === null ? null : { t: msg.t, x, y };
    }
    case 'shake': return { t: 'shake', d: msg.d < 0 ? -1 : 1 };
    case 'away': return { t: 'away' };
    default: return null;
  }
}

export default class Presence {
  constructor(room) {
    this.room = room;
    this.state = new Map();   // connection id -> { x, y, win, count, shakeAt, tapAt }
  }

  static async onBeforeConnect(request) {
    const origin = request.headers.get('Origin') || '';
    if (!ORIGINS.some((re) => re.test(origin))) return new Response('not from here', { status: 403 });
    return request;
  }

  onConnect(conn) {
    // counted from our own list: a connection that is closing may still be
    // in the room's while it goes
    if (this.state.size >= MAX_IN_ROOM) { conn.close(1013, 'full'); return; }
    this.state.set(conn.id, { x: null, y: null, win: 0, count: 0, shakeAt: 0, tapAt: 0 });
    const peers = [];
    for (const [id, s] of this.state) if (id !== conn.id && s.x !== null) peers.push({ id, x: s.x, y: s.y });
    const n = this.state.size;
    conn.send(JSON.stringify({ t: 'hi', id: conn.id, peers, n }));
    this.room.broadcast(JSON.stringify({ t: 'n', n }), [conn.id]);
  }

  onMessage(raw, sender) {
    const s = this.state.get(sender.id);
    if (!s || typeof raw !== 'string' || raw.length > 200) return;
    const now = Date.now();
    const win = Math.floor(now / 1000);
    if (win !== s.win) { s.win = win; s.count = 0; }
    if (++s.count > MAX_PER_SECOND) return;
    let msg;
    try { msg = clean(JSON.parse(raw)); } catch (e) { return; }
    if (!msg) return;
    if (msg.t === 'shake') { if (now - s.shakeAt < SHAKE_EVERY_MS) return; s.shakeAt = now; }
    if (msg.t === 'tap') { if (now - s.tapAt < TAP_EVERY_MS) return; s.tapAt = now; }
    if (msg.t === 'm') { s.x = msg.x; s.y = msg.y; }
    if (msg.t === 'away') { s.x = null; s.y = null; }
    msg.id = sender.id;
    this.room.broadcast(JSON.stringify(msg), [sender.id]);
  }

  leave(conn) {
    if (!this.state.delete(conn.id)) return;
    this.room.broadcast(JSON.stringify({ t: 'gone', id: conn.id }));
    this.room.broadcast(JSON.stringify({ t: 'n', n: this.state.size }));
  }
  onClose(conn) { this.leave(conn); }
  onError(conn) { this.leave(conn); }
}
