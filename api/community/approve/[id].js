// POST /api/community/approve/<id> — admin. Moves one item from queue to map.

import {
  readPending, removePending, appendPlace,
  requireAdmin, adminCors, checkRate, clientIp, geocode, cleanCoord, cleanWhen, fail,
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

    // Coordinates can be supplied by the caller, or carried on the item (a
    // bulk add that knew them); otherwise look them up.
    const body = req.body || {};
    let lat = cleanCoord(body.lat ?? item.lat, 90);
    let lng = cleanCoord(body.lng ?? item.lng, 180);
    if (lat === null || lng === null) {
      ({ lat, lng } = await geocode(item.area, item.name));
    }

    const place = {
      // Same id as the suggestion. That is what makes approval idempotent:
      // a second approve of the same item finds it already on the map.
      id: item.id,
      name: item.name,
      area: item.area || '',
      tags: item.tags || [],
      note: item.note || '',
      url: item.url || '',
      when: cleanWhen(body.when) || item.when
        || new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toLowerCase(),
      lat,
      lng,
    };
    // The map skips entries without coordinates rather than pinning them at 0,0.
    if (lat === null || lng === null) place.needsCoords = true;

    // Map first, queue second — the other way round, a crash in between loses
    // the suggestion; this way round it is merely still in the queue, and
    // approving it again is a no-op on the map. Both are concurrency-safe:
    // rewriting the whole queue here used to drop any suggestion that arrived
    // while the geocode lookup above was in flight.
    const added = await appendPlace(place);
    await removePending(id);

    return res.status(200).json({ ok: true, place, alreadyOnMap: added === null });
  } catch (e) {
    return fail(res, e, 'failed to approve');
  }
}
