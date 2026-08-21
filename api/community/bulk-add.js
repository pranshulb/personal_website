// POST /api/community/bulk-add — admin. Pastes a JSON array into the queue.

import {
  appendPending, requireAdmin, checkRate, clientIp, clean, cleanTags,
} from './_store.js';

const MAX_BATCH = 200;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Pass');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  if (!checkRate(clientIp(req), 'bulk', 30)) {
    return res.status(429).json({ error: 'too many requests' });
  }
  if (!requireAdmin(req, res)) return;

  const entries = req.body;
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'expected a JSON array' });
  }
  if (entries.length > MAX_BATCH) {
    return res.status(400).json({ error: 'too many entries, max ' + MAX_BATCH });
  }

  try {
    const added = [];

    for (const entry of entries) {
      const name = clean(entry?.name, 120);
      if (!name) continue;

      const item = {
        id: crypto.randomUUID(),
        name,
        area: clean(entry.area, 80),
        tags: cleanTags(entry.tags),
        note: clean(entry.note, 500),
        url: clean(entry.url, 300),
        submitted_by: 'pranshul (bulk)',
        submitted_at: new Date().toISOString(),
        source: 'bulk',
      };
      added.push(item);
    }

    if (added.length > 0 && (await appendPending(added)) === null) {
      return res.status(429).json({ error: 'queue is full' });
    }
    return res.status(200).json({ ok: true, added: added.length, items: added });
  } catch (e) {
    console.error('POST bulk-add failed:', e);
    return res.status(500).json({ error: 'failed to queue entries' });
  }
}
