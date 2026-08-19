// POST /api/community/suggest — public. Lands in the pending queue, never live.

import {
  readPending, writePending, checkRate, clientIp, clean, cleanTags,
} from './_store.js';

const MAX_PENDING = 500;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  if (!checkRate(clientIp(req), 'suggest', 5)) {
    return res.status(429).json({ error: 'slow down' });
  }

  const data = req.body || {};
  const name = clean(data.name, 120);
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const pending = await readPending();
    if (pending.length >= MAX_PENDING) {
      return res.status(429).json({ error: 'queue is full, try again later' });
    }

    const item = {
      id: crypto.randomUUID(),
      name,
      area: clean(data.area || data.city, 80),
      tags: cleanTags(data.tags),
      note: clean(data.note, 500),
      url: clean(data.url, 300),
      submitted_by: clean(data.submitted_by, 80),
      submitted_at: new Date().toISOString(),
      source: 'suggest',
    };

    pending.push(item);
    await writePending(pending);

    return res.status(200).json({ ok: true, id: item.id });
  } catch (e) {
    console.error('POST suggest failed:', e);
    return res.status(500).json({ error: 'failed to save suggestion' });
  }
}
