// POST /api/community/bulk-add — admin. Pastes a JSON array into the queue.

import {
  appendPending, requireAdmin, adminCors, checkRate, clientIp, fail,
  clean, cleanTags, cleanUrl, cleanWhen, cleanCoord, newId,
} from './_store.js';

const MAX_BATCH = 200;

export default async function handler(req, res) {
  adminCors(res);

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
      if (!entry || typeof entry !== 'object') continue;
      const name = clean(entry.name, 120);
      if (!name) continue;

      const item = {
        id: newId(),
        name,
        area: clean(entry.area, 80),
        tags: cleanTags(entry.tags),
        note: clean(entry.note, 500),
        url: cleanUrl(entry.url),
        submitted_by: 'pranshul (bulk)',
        submitted_at: new Date().toISOString(),
        source: 'bulk',
      };
      // Backfilling old favourites: "when" is when it was visited, not today,
      // and known coordinates skip the geocode on approval.
      const when = cleanWhen(entry.when);
      if (when) item.when = when;
      const lat = cleanCoord(entry.lat, 90);
      const lng = cleanCoord(entry.lng, 180);
      if (lat !== null && lng !== null) { item.lat = lat; item.lng = lng; }
      added.push(item);
    }

    if (added.length > 0 && (await appendPending(added)) === null) {
      return res.status(429).json({ error: 'queue is full' });
    }
    return res.status(200).json({ ok: true, added: added.length, items: added });
  } catch (e) {
    return fail(res, e, 'failed to queue entries');
  }
}
