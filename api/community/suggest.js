// POST /api/community/suggest — public. Lands in the pending queue, never live.

import {
  appendPending, checkRate, clientIp, clean, cleanTags, cleanUrl, newId, fail,
} from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  if (!checkRate(clientIp(req), 'suggest', 5)) {
    return res.status(429).json({ error: 'slow down' });
  }

  const data = (req.body && typeof req.body === 'object') ? req.body : {};

  // The form carries a field no person can see. Anything that fills it in is
  // a script, and gets a cheerful 200 and nothing in the queue.
  if (typeof data.website === 'string' && data.website.trim()) {
    return res.status(200).json({ ok: true, id: newId() });
  }

  const name = clean(data.name, 120);
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const item = {
      id: newId(),
      name,
      // The map groups by area; the city is kept so a non-London suggestion
      // is still legible in the queue rather than quietly mislabelled.
      area: clean(data.area || data.city, 80),
      city: clean(data.city, 80),
      tags: cleanTags(data.tags),
      note: clean(data.note, 500),
      url: cleanUrl(data.url),
      submitted_by: clean(data.submitted_by, 80),
      submitted_at: new Date().toISOString(),
      source: 'suggest',
    };

    // Concurrency-safe: a suggestion arriving while an approval is mid-flight
    // used to be silently dropped.
    const result = await appendPending([item]);
    if (result === null) {
      return res.status(429).json({ error: 'queue is full, try again later' });
    }

    return res.status(200).json({ ok: true, id: item.id });
  } catch (e) {
    return fail(res, e, 'failed to save suggestion');
  }
}
