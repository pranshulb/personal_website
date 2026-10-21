// "wanna come next time?" on /morph: people leave a name, an email and what
// they'd bring to the house, and Pranshul reads them at /morph-notes (behind
// the private login).
//
//   POST   /api/morph-notes          { name, email, bring, website }  → { ok }  anyone
//   GET    /api/morph-notes          → { notes: [...newest first] }           private login
//   DELETE /api/morph-notes?id=...   remove one note                          private login
//
// Stored exactly as the compatibility form's answers are (api/compatibility.js):
// each note its own blob, written once, and encrypted with a key derived from
// PRIVATE_SECRET, because the Blob store is public and these carry people's
// emails. So without PRIVATE_SECRET nothing is saved (503), and changing it
// leaves earlier notes "unreadable" (shown as such, not lost).

import { put, list, del } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { checkRate, clientIp, clean, sameOrigin } from './community/_store.js';
import { privateAuthed } from './_private.js';
import { seal, unseal } from './compatibility.js';

export const PREFIX = 'morph-notes/';
const BASE = PREFIX + 'note.json';               // stored as morph-notes/note-<suffix>.json
const ID_RE = /^morph-notes\/note-[A-Za-z0-9_-]+\.json$/;

function key() {
  const secret = process.env.PRIVATE_SECRET;
  if (!secret) return null;
  return createHash('sha256').update('morph-notes:' + secret).digest();
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  return body && typeof body === 'object' ? body : null;
}

async function listAll() {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs.filter((b) => ID_RE.test(b.pathname));
}

async function submit(req, res) {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'cross-origin requests are refused' });
  if (!checkRate(clientIp(req), 'morph-notes', 5)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'too many at once. wait a minute and send it again' });
  }
  const body = parseBody(req);
  if (!body) return res.status(400).json({ error: 'the note was empty' });
  if (body.website) return res.status(200).json({ ok: true });    // honeypot: looks fine, keeps nothing

  const note = { name: clean(body.name, 100), email: clean(body.email, 200), bring: clean(body.bring, 2000) };
  if (!note.name || !note.email || !note.bring) return res.status(400).json({ error: 'a name, an email and what you’d bring, please' });

  const k = key();
  if (!k) return res.status(503).json({ error: "notes can't be saved right now. try again later?" });
  try {
    await put(BASE, JSON.stringify(seal({ submittedAt: new Date().toISOString(), note }, k)), {
      access: 'public', addRandomSuffix: true, contentType: 'application/json',
    });
  } catch (e) {
    console.error('morph-notes put failed:', e);
    return res.status(503).json({ error: "notes can't be saved right now. try again later?" });
  }
  return res.status(200).json({ ok: true });
}

async function read(req, res) {
  if (!privateAuthed(req)) return res.status(401).json({ error: 'log in first' });
  const k = key();
  let blobs;
  try { blobs = await listAll(); } catch (e) {
    console.error('morph-notes list failed:', e);
    return res.status(503).json({ error: 'storage is unreachable right now' });
  }
  const notes = await Promise.all(blobs.map(async (b) => {
    try {
      const r = await fetch(b.url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { submittedAt, note } = unseal(await r.json(), k);
      return { id: b.pathname, submittedAt, ...note };
    } catch (e) {
      console.error('morph-notes read failed:', b.pathname, e);
      return { id: b.pathname, submittedAt: new Date(b.uploadedAt).toISOString(), unreadable: true };
    }
  }));
  notes.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  return res.status(200).json({ notes });
}

async function remove(req, res) {
  if (!privateAuthed(req)) return res.status(401).json({ error: 'log in first' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'cross-origin requests are refused' });
  const id = String((req.query && req.query.id) || '');
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad id' });
  try {
    const hit = (await listAll()).find((b) => b.pathname === id);
    if (!hit) return res.status(404).json({ error: 'already gone' });
    await del(hit.url);
  } catch (e) {
    console.error('morph-notes delete failed:', e);
    return res.status(503).json({ error: 'storage is unreachable right now — nothing was changed' });
  }
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST') return submit(req, res);
  if (req.method === 'GET') return read(req, res);
  if (req.method === 'DELETE') return remove(req, res);
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'method not allowed' });
}
