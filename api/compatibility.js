// The compatibility form at /compatibility-form-of-questions: people Pranshul
// matched with on dating apps answer 62 questions, and he reads the answers
// at /compatibility-responses (behind the private login).
//
//   POST   /api/compatibility          { answers, website }  → { ok }      anyone
//   GET    /api/compatibility          → { responses: [...newest first] }  private login
//   DELETE /api/compatibility?id=...   remove one response                 private login
//
// Each response is its own blob, written once and never changed, so the
// CDN-cache trap in CLAUDE.md §4 can't bite (no fixed pathname is ever
// rewritten) and two people sending at once can't overwrite each other.
//
// The answers are personal (sex, drugs, religion, politics) and the site's
// Blob store is PUBLIC: anyone holding a blob's URL can fetch it. So each
// response is encrypted (AES-256-GCM) before it is stored, with a key derived
// from PRIVATE_SECRET. Consequences:
//   - without PRIVATE_SECRET nothing can be saved (503) or read;
//   - CHANGING PRIVATE_SECRET MAKES EVERY SAVED RESPONSE UNREADABLE. They show
//     as "couldn't be read" on the responses page rather than vanishing.

import { put, list, del } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { checkRate, clientIp, clean, sameOrigin } from './community/_store.js';
import { privateAuthed, seal, unseal } from './_private.js';
import morphNotes from './_morph-notes.js';

export { seal, unseal };

export const PREFIX = 'compatibility/';
const BASE = PREFIX + 'response.json';           // stored as compatibility/response-<suffix>.json
const ID_RE = /^compatibility\/response-[A-Za-z0-9_-]+\.json$/;
const MAX_FIELDS = 100;
const LONG_FIELDS = new Set(['blurb']);

function key() {
  const secret = process.env.PRIVATE_SECRET;
  if (!secret) return null;
  return createHash('sha256').update('compatibility-form:' + secret).digest();
}


// Keeps simple values under sane keys; text is stripped like every other form on the site.
export function cleanAnswers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[a-z0-9_]{1,40}$/.test(k)) continue;
    if (++n > MAX_FIELDS) break;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(-1000, Math.min(1000, v));
    else if (typeof v === 'string') {
      const s = clean(v, LONG_FIELDS.has(k) ? 2000 : 300);
      if (s) out[k] = s;
    }
  }
  return out;
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
  if (!checkRate(clientIp(req), 'compatibility', 5)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'too many at once — wait a minute and send again' });
  }
  const body = parseBody(req);
  if (!body) return res.status(400).json({ error: 'missing answers' });
  if (body.website) return res.status(200).json({ ok: true });    // honeypot: looks fine, keeps nothing

  const answers = cleanAnswers(body.answers);
  if (!answers || !answers.name || !answers.email) return res.status(400).json({ error: 'a name and an email are needed' });

  const k = key();
  if (!k) return res.status(503).json({ error: "answers can't be saved right now" });
  try {
    await put(BASE, JSON.stringify(seal({ submittedAt: new Date().toISOString(), answers }, k)), {
      access: 'public', addRandomSuffix: true, contentType: 'application/json',
    });
  } catch (e) {
    console.error('compatibility put failed:', e);
    return res.status(503).json({ error: "answers can't be saved right now" });
  }
  return res.status(200).json({ ok: true });
}

async function read(req, res) {
  if (!privateAuthed(req)) return res.status(401).json({ error: 'log in first' });
  const k = key();
  let blobs;
  try { blobs = await listAll(); } catch (e) {
    console.error('compatibility list failed:', e);
    return res.status(503).json({ error: 'storage is unreachable right now' });
  }
  const responses = await Promise.all(blobs.map(async (b) => {
    try {
      const r = await fetch(b.url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { submittedAt, answers } = unseal(await r.json(), k);
      return { id: b.pathname, submittedAt, answers };
    } catch (e) {
      console.error('compatibility read failed:', b.pathname, e);
      return { id: b.pathname, submittedAt: new Date(b.uploadedAt).toISOString(), unreadable: true };
    }
  }));
  responses.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  return res.status(200).json({ responses });
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
    console.error('compatibility delete failed:', e);
    return res.status(503).json({ error: 'storage is unreachable right now — nothing was changed' });
  }
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  // /api/morph-notes is served from here (a rewrite in vercel.json adds
  // ?form=morph-notes): the Hobby plan allows 12 functions a deployment.
  if (req.query && req.query.form === 'morph-notes') return morphNotes(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST') return submit(req, res);
  if (req.method === 'GET') return read(req, res);
  if (req.method === 'DELETE') return remove(req, res);
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'method not allowed' });
}
