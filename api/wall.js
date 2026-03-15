import { put, list, del } from '@vercel/blob';

const BLOB_KEY = 'examined-wall.json';

// Rate limiting
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

async function getWallData() {
  try {
    const { blobs } = await list({ prefix: BLOB_KEY });
    if (blobs.length === 0) return { entries: [] };
    // Get the most recent blob
    const latest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
    const response = await fetch(latest.url);
    return await response.json();
  } catch (e) {
    console.error('getWallData error:', e);
    return { entries: [] };
  }
}

async function saveWallData(data) {
  // Delete old blobs first to avoid accumulation
  try {
    const { blobs } = await list({ prefix: BLOB_KEY });
    for (const blob of blobs) {
      await del(blob.url);
    }
  } catch (e) {
    // ok if delete fails
  }
  
  // Write new blob
  await put(BLOB_KEY, JSON.stringify(data), {
    access: 'public',
    contentType: 'application/json',
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();

  if (req.method === 'GET') {
    if (!checkRate(ip, RATE_MAX_GET)) {
      return res.status(429).json({ error: 'too many requests' });
    }
    try {
      const data = await getWallData();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: 'failed to fetch wall' });
    }
  }

  if (req.method === 'POST') {
    if (!checkRate(ip, RATE_MAX_POST)) {
      return res.status(429).json({ error: 'slow down' });
    }
    try {
      const data = await getWallData();
      const entries = data.entries || [];

      const { name, archetype, scores, answers, path } = req.body;
      if (!name || !archetype || typeof name !== 'string' || typeof archetype !== 'string') {
        return res.status(400).json({ error: 'name and archetype required' });
      }
      if (name.length > 40 || archetype.length > 100) {
        return res.status(400).json({ error: 'input too long' });
      }

      const clean = (s) => s.replace(/[<>&"']/g, '');
      const now = new Date();
      const entry = {
        name: clean(name),
        archetype: clean(archetype),
        date: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        ts: now.getTime()
      };

      if (scores && typeof scores === 'object') entry.scores = scores;
      if (answers && Array.isArray(answers)) entry.answers = answers;
      if (path && typeof path === 'string') entry.path = clean(path);

      entries.push(entry);
      const trimmed = entries.slice(-500);

      await saveWallData({ entries: trimmed });

      return res.status(200).json({ ok: true, count: trimmed.length });
    } catch (e) {
      console.error('POST wall error:', e);
      return res.status(500).json({ error: 'failed to save', detail: e.message });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
