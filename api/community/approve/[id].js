// POST /api/community/approve/<id> — admin. Moves one item from queue to map.

import {
  readPending, removePending, appendPlace,
  requireAdmin, adminCors, checkRate, clientIp, geocode,
} from '../_store.js';

export default async function handler(req, res) {
  adminCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  if (!checkRate(clientIp(req), 'approve', 30)) {
    return res.status(429).json({ error: 'too many requests' });
  }
  if (!requireAdmin(req, res)) return;

  const { id } = req.query;

  try {
    const pending = await readPending();
    const item = pending.find((p) => p.id === id);
    if (!item) return res.status(404).json({ error: 'not found' });

    // Coordinates can be supplied by the caller; otherwise look them up.
    const body = req.body || {};
    let lat = typeof body.lat === 'number' ? body.lat : null;
    let lng = typeof body.lng === 'number' ? body.lng : null;
    if (lat === null || lng === null) {
      ({ lat, lng } = await geocode(item.area, item.name));
    }

    const place = {
      name: item.name,
      area: item.area || '',
      tags: item.tags || [],
      note: item.note || '',
      url: item.url || '',
      when: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toLowerCase(),
      lat,
      lng,
    };
    // The map skips entries without coordinates rather than pinning them at 0,0.
    if (lat === null || lng === null) place.needsCoords = true;

    // Both concurrency-safe: rewriting the whole queue here used to drop any
    // suggestion that arrived while the geocode lookup above was in flight.
    await appendPlace(place);
    await removePending(id);

    return res.status(200).json({ ok: true, place });
  } catch (e) {
    console.error('POST approve failed:', e);
    return res.status(500).json({ error: 'failed to approve' });
  }
}
