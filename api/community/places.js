// GET    /api/community/places — the public list behind the map.
// DELETE /api/community/places — admin. Removes one entry, or wipes the lot.

import {
  readPlaces, writePlaces, requireAdmin, checkRate, clientIp,
} from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Pass');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    if (!checkRate(clientIp(req), 'places', 60)) {
      return res.status(429).json({ error: 'too many requests' });
    }
    try {
      const places = await readPlaces();
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
      return res.status(200).json(places);
    } catch (e) {
      console.error('GET places failed:', e);
      return res.status(500).json({ error: 'failed to load places' });
    }
  }

  if (req.method === 'DELETE') {
    if (!checkRate(clientIp(req), 'places-delete', 30)) {
      return res.status(429).json({ error: 'too many requests' });
    }
    if (!requireAdmin(req, res)) return;

    // Body parsing on DELETE isn't guaranteed across runtimes, so accept the
    // same params from the query string. Body wins where both are present.
    const q = req.query || {};
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    const body = {
      all: b.all !== undefined ? b.all === true : q.all === 'true',
      index: b.index !== undefined ? b.index : q.index,
      name: b.name !== undefined ? b.name : q.name,
    };

    try {
      const places = await readPlaces();

      if (body.all === true) {
        await writePlaces([]);
        return res.status(200).json({ ok: true, removed: places.length, remaining: 0 });
      }

      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0 || index >= places.length) {
        return res.status(400).json({ error: 'index out of range' });
      }

      // The client sends the name it thinks sits at that index. If the list
      // shifted since it loaded (another tab approved something), the names
      // won't line up and we refuse rather than delete the wrong entry.
      if (typeof body.name !== 'string' || places[index].name !== body.name) {
        return res.status(409).json({
          error: 'list changed since you loaded it — reload and try again',
        });
      }

      const [removed] = places.splice(index, 1);
      await writePlaces(places);
      return res.status(200).json({ ok: true, removed: removed.name, remaining: places.length });
    } catch (e) {
      console.error('DELETE places failed:', e);
      return res.status(500).json({ error: 'failed to remove' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
