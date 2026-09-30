// The visitors' book on the home page: people sign their name, the page writes
// it out by hand (a handwriting network running in their browser), and every
// signature is kept and shown to everyone.
//
//   GET    /api/guestbook            → { entries: [...newest first], canRemove }
//   POST   /api/guestbook            { name, strokes? }  → { ok, entry }
//   GET    /api/guestbook?history=1  the last 30 copies of the book, newest first  } both need
//   POST   /api/guestbook?restore=1  { pathname } → roll back to one of them       } the login below
//   DELETE /api/guestbook?id=...     the private pages' login (/typeshit lists the
//                                    book with remove buttons) or the community admin
//
// Storage is Vercel Blob through the community store's `mutate` / `readBlob`
// (api/community/_store.js), so it gets the same write lock, check-after-write,
// 30 versions of history and "a failed read is an error, never an empty list".
//
// Each entry keeps the pen strokes the visitor saw being written, so everyone
// sees the same signature. The server can't check that the strokes spell the
// name — anyone can POST — so they are bounded tightly (a name's worth of ink,
// no more) and the admin can remove any entry from the book itself.

import {
  readBlob, mutate, fail, checkRate, clientIp, clean, newId, isAdmin, sameOrigin, adminCors,
  listVersions, restoreVersion,
} from './community/_store.js';
import { privateAuthed } from './_private.js';

// Who may remove entries: whoever is logged in to the private pages (the
// book is managed from /typeshit), or the community admin.
const canManage = (req) => privateAuthed(req) || isAdmin(req);

export const BOOK_KEY = 'guestbook.json';
const MAX_ENTRIES = 3000;
const MAX_NAME = 40;

// Strokes are flat integer arrays [x0, y0, x1, y1, ...] in quarter units of
// the handwriting model (a written line comes out about 125 tall, a letter
// about 40 wide), y pointing down, the whole signature starting near 0,0.
export function cleanStrokes(strokes, name) {
  if (!Array.isArray(strokes) || strokes.length < 1 || strokes.length > 200) return null;
  const letters = Math.max(1, [...name].filter((ch) => ch.trim()).length);
  const maxPoints = Math.min(2500, 45 * letters + 120);
  const maxW = 160 * letters + 300, maxH = 1200;
  let points = 0, w = 0, h = 0;
  const out = [];
  for (const s of strokes) {
    if (!Array.isArray(s) || s.length < 2 || s.length % 2 !== 0 || s.length > 2 * maxPoints) return null;
    for (let i = 0; i < s.length; i++) {
      const v = s[i];
      if (!Number.isInteger(v) || v < 0) return null;
      if (i % 2 === 0) { if (v > maxW) return null; w = Math.max(w, v); }
      else { if (v > maxH) return null; h = Math.max(h, v); }
    }
    points += s.length / 2;
    if (points > maxPoints) return null;
    out.push(s.slice());
  }
  if (w < 5 || h < 5) return null;
  return { strokes: out, w, h };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const ip = clientIp(req);

  // Every signature and every removal leaves the book as it was before
  // behind as a full copy (the store keeps the last 30): nothing signed is
  // lost to a bad write or a slip, it can be rolled back from /typeshit.
  const q = req.query || {};
  if ((req.method === 'GET' && q.history) || (req.method === 'POST' && q.restore)) {
    adminCors(res);
    if (!checkRate(ip, 'guestbook-history', 30)) return res.status(429).json({ error: 'too many requests' });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'cross-origin request refused' });
    if (!canManage(req)) return res.status(401).json({ error: 'unauthorized' });
    try {
      if (req.method === 'GET') return res.status(200).json({ versions: await listVersions(BOOK_KEY) });
      const pathname = req.body && req.body.pathname;
      if (typeof pathname !== 'string' || !pathname) return res.status(400).json({ error: 'which copy?' });
      const restored = await restoreVersion(BOOK_KEY, pathname);
      if (restored === null) return res.status(404).json({ error: 'no such copy' });
      return res.status(200).json({ ok: true, count: restored.length });
    } catch (e) {
      return fail(res, e, 'failed to reach the book\'s history');
    }
  }

  if (req.method === 'GET') {
    if (!checkRate(ip, 'guestbook-read', 60)) return res.status(429).json({ error: 'too many requests' });
    try {
      const book = await readBlob(BOOK_KEY, []);
      return res.status(200).json({ entries: book.slice().reverse(), canRemove: canManage(req) });
    } catch (e) {
      return fail(res, e, 'failed to read the visitors\' book');
    }
  }

  if (req.method === 'POST') {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // honeypot: a field people never see. Bots fill it in; pretend it worked.
    if (body.website) return res.status(200).json({ ok: true });
    if (!checkRate(ip, 'guestbook-sign', 3) || !checkRate(ip, 'guestbook-sign-day', 20, 86400000)) {
      return res.status(429).json({ error: 'you have signed a lot already — try again later' });
    }
    const name = clean(body.name, MAX_NAME + 20).replace(/\n/g, ' ');
    if (!name || !/[\p{L}\p{N}]/u.test(name)) return res.status(400).json({ error: 'a name, please' });
    if ([...name].length > MAX_NAME) return res.status(400).json({ error: 'that name is too long' });
    // No strokes is allowed: the network only writes the Latin alphabet, so a
    // name in another script is shown as typed, in the page's own font.
    let ink = null;
    if (body.strokes != null) {
      ink = cleanStrokes(body.strokes, name);
      if (!ink) return res.status(400).json({ error: 'the handwriting did not come through — try writing it again' });
    }

    const now = new Date();
    const entry = {
      id: newId(),
      name,
      ...(ink ? { strokes: ink.strokes, w: ink.w, h: ink.h } : {}),
      date: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      ts: now.getTime(),
    };
    try {
      const after = await mutate(
        BOOK_KEY, [],
        (book) => (book.length >= MAX_ENTRIES ? null : book.concat([entry])),
        (book) => book.some((e) => e.id === entry.id),
      );
      if (after === null) return res.status(409).json({ error: 'the book is full' });
      return res.status(200).json({ ok: true, entry, count: after.length });
    } catch (e) {
      return fail(res, e, 'failed to sign the visitors\' book');
    }
  }

  if (req.method === 'DELETE') {
    adminCors(res);
    if (!sameOrigin(req)) return res.status(403).json({ error: 'cross-origin request refused' });
    if (!canManage(req)) return res.status(401).json({ error: 'unauthorized' });
    const id = String((req.query && req.query.id) || '');
    if (!id) return res.status(400).json({ error: 'which entry?' });
    try {
      const after = await mutate(
        BOOK_KEY, [],
        (book) => (book.some((e) => e.id === id) ? book.filter((e) => e.id !== id) : null),
        (book) => !book.some((e) => e.id === id),
      );
      if (after === null) return res.status(404).json({ error: 'not found' });
      return res.status(200).json({ ok: true, count: after.length });
    } catch (e) {
      return fail(res, e, 'failed to remove the entry');
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
  return res.status(405).json({ error: 'method not allowed' });
}
