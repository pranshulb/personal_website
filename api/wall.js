import { put, list, del } from '@vercel/blob';

// The wall behind /examined: a list of { name, archetype, date, ts, scores?, answers?, path? }.
//
// Storage follows the same rules as api/community/_store.js, for the same reasons
// (see "Gotchas" in CLAUDE.md):
// - every write lands at a NEW pathname (addRandomSuffix), because blob URLs are
//   CDN-cached and a fixed pathname serves a stale copy on the next read;
// - reads take the newest by uploadedAt, listing by the extension-less base
//   (the suffix goes before ".json"; the base also matches the original
//   un-suffixed examined-wall.json, so the old wall is read until the first new write);
// - a failed read is an error, never an empty wall — the old code read a failure
//   as [] and the next signature overwrote everyone else;
// - old versions are kept as history and pruned only when old enough that no
//   write can still be in flight.
const BLOB_KEY = 'examined-wall.json';
const BLOB_BASE = BLOB_KEY.replace(/\.json$/, '');
const MAX_ENTRIES = 500;
const KEEP_VERSIONS = 30;
const PRUNE_GRACE_MS = 120000;

const ARCHETYPES = new Set([
  'The Examined Stoic', 'The Reluctant Utilitarian', 'The Existential Pragmatist',
  'The Relational Existentialist', 'The Radical Individualist', 'The Contemplative Mystic',
  'The Philosophical Warrior', 'The Practical Philosopher', 'The Poetic Empiricist',
  'The Communal Builder', 'The Philosophical Pluralist',
]);
const AXES = ['consequence', 'individual', 'stoic', 'pragmatist', 'agency', 'rationalist', 'transcendent'];
const PATHS = new Set(['essential', 'examined', 'deep']);

// Rate limiting (per warm instance; best effort)
const rateLimit = new Map();
const RATE_WINDOW = 60000;
const RATE_MAX_POST = 3;
const RATE_MAX_GET = 30;

function checkRate(ip, limit) {
  const now = Date.now();
  const entry = rateLimit.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimit.set(ip, entry);
  if (rateLimit.size > 1000) {
    for (const [k, v] of rateLimit) { if (now - v.start > RATE_WINDOW * 2) rateLimit.delete(k); }
  }
  return entry.count <= limit;
}

class WallReadError extends Error {}

const byNewest = (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt);

async function listVersions() {
  try {
    const { blobs } = await list({ prefix: BLOB_BASE });
    return blobs.filter(b => b.pathname.startsWith(BLOB_BASE) && b.pathname.endsWith('.json')).sort(byNewest);
  } catch (e) {
    console.error('wall list failed:', e);
    throw new WallReadError('list failed');
  }
}

async function readVersion(blob) {
  try {
    const res = await fetch(blob.url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.entries)) throw new Error('not a wall');
    return data.entries;
  } catch (e) {
    console.error('wall read failed:', blob.pathname, e);
    throw new WallReadError('read failed');
  }
}

// Returns { entries, blob } for the newest version; entries is [] only when nothing was ever written.
async function readWall() {
  const versions = await listVersions();
  if (versions.length === 0) return { entries: [], blob: null };
  return { entries: await readVersion(versions[0]), blob: versions[0] };
}

const keyOf = (e) => `${e.ts}|${e.name}`;

async function writeWall(entries) {
  await put(BLOB_KEY, JSON.stringify({ entries }), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: true,
  });
}

async function prune() {
  try {
    const versions = await listVersions();
    const cutoff = Date.now() - PRUNE_GRACE_MS;
    for (const b of versions.slice(KEEP_VERSIONS)) {
      if (new Date(b.uploadedAt).getTime() >= cutoff) continue;
      await del(b.url);
    }
  } catch (e) {
    // Harmless: reads take the newest, so leftovers are ignored.
    console.error('wall prune failed:', e);
  }
}

// Append one entry. If another signature landed while we were writing, merge it in
// rather than letting the later write silently drop it.
async function appendEntry(entry) {
  const { entries, blob } = await readWall();
  let merged = [...entries, entry].slice(-MAX_ENTRIES);
  await writeWall(merged);

  for (let attempt = 0; attempt < 3; attempt++) {
    const versions = await listVersions();
    const since = blob ? new Date(blob.uploadedAt).getTime() : 0;
    const concurrent = versions.filter(v => new Date(v.uploadedAt).getTime() > since);
    const have = new Set(merged.map(keyOf));
    const missing = [];
    for (const v of concurrent) {
      let theirs;
      try { theirs = await readVersion(v); } catch (e) { continue; }
      for (const e of theirs) if (!have.has(keyOf(e))) { have.add(keyOf(e)); missing.push(e); }
    }
    if (missing.length === 0) break;
    merged = [...merged, ...missing].sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(-MAX_ENTRIES);
    await writeWall(merged);
  }

  await prune();
  return merged.length;
}

const clean = (s) => s.replace(/[<>&"]/g, '').replace(/\s+/g, ' ').trim();

function validScores(scores) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return null;
  const out = {};
  for (const a of AXES) {
    const v = scores[a];
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 200) return null;
    out[a] = v;
  }
  return out;
}

function validAnswers(answers) {
  if (!Array.isArray(answers) || answers.length > 30) return null;
  const ok = answers.every(a => a && Number.isInteger(a.scenario) && a.scenario >= 0 && a.scenario < 30
    && Number.isInteger(a.choice) && a.choice >= 0 && a.choice <= 2);
  return ok ? answers.map(a => ({ scenario: a.scenario, choice: a.choice })) : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();

  if (req.method === 'GET') {
    if (!checkRate(ip, RATE_MAX_GET)) {
      return res.status(429).json({ error: 'too many requests' });
    }
    try {
      const { entries } = await readWall();
      return res.status(200).json({ entries });
    } catch (e) {
      return res.status(503).json({ error: 'wall unavailable, try again in a moment' });
    }
  }

  if (req.method === 'POST') {
    if (!checkRate(ip, RATE_MAX_POST)) {
      return res.status(429).json({ error: 'slow down' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { name, archetype, scores, answers, path } = body;
    if (typeof name !== 'string' || typeof archetype !== 'string') {
      return res.status(400).json({ error: 'name and archetype required' });
    }
    const cleanName = clean(name);
    if (!cleanName) return res.status(400).json({ error: 'name and archetype required' });
    if (cleanName.length > 40) return res.status(400).json({ error: 'input too long' });
    if (!ARCHETYPES.has(archetype)) return res.status(400).json({ error: 'unknown archetype' });

    const now = new Date();
    const entry = {
      name: cleanName,
      archetype,
      date: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      ts: now.getTime(),
    };
    const s = validScores(scores); if (s) entry.scores = s;
    const a = validAnswers(answers); if (a) entry.answers = a;
    if (typeof path === 'string' && PATHS.has(path)) entry.path = path;

    try {
      const count = await appendEntry(entry);
      return res.status(200).json({ ok: true, count });
    } catch (e) {
      console.error('POST wall error:', e);
      if (e instanceof WallReadError) return res.status(503).json({ error: 'wall unavailable, try again in a moment' });
      return res.status(500).json({ error: 'failed to save' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
