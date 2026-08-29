// GET    /api/community/places — the public list behind the map.
// DELETE /api/community/places — admin. Removes one entry, or wipes the lot.

import {
  readPlaces, writePlaces, removePlace, requireAdmin, adminCors, checkRate, clientIp, fail,
} from './_store.js';

export default async function handler(req, res) {
  if (req.method === 'GET' || req.method === 'OPTIONS') {
    // The map list is deliberately a public read.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  } else {
    adminCors(res);
  }

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    if (!checkRate(clientIp(req), 'places', 60)) {
      return res.status(429).json({ error: 'too many requests' });
    }
    try {
      const places = await readPlaces();
      // Short at the edge: an approval should be visible on the public page
      // within a minute or so, not the five that a long stale window allowed.
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
      return res.status(200).json(places);
    } catch (e) {
      return fail(res, e, 'failed to load places');
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
      id: b.id !== undefined ? b.id : q.id,
      index: b.index !== undefined ? b.index : q.index,
      name: b.name !== undefined ? b.name : q.name,
    };

    try {
      if (body.all === true) {
        const places = await readPlaces();
        await writePlaces([]);
        return res.status(200).json({ ok: true, removed: places.length, remaining: 0 });
      }

      let id = typeof body.id === 'string' ? body.id : '';

      // The older client sends index + the name it thinks sits there. Resolve
      // that to an id, refusing if the list shifted since it loaded (another
      // tab approved something) rather than deleting the wrong entry.
      if (!id) {
        const places = await readPlaces();
        const index = Number(body.index);
        if (!Number.isInteger(index) || index < 0 || index >= places.length) {
          return res.status(400).json({ error: 'index out of range' });
        }
        if (typeof body.name !== 'string' || places[index].name !== body.name) {
          return res.status(409).json({
            error: 'list changed since you loaded it — reload and try again',
          });
        }
        id = places[index].id;
      }

      // Concurrency-safe: the old read-then-write here dropped any approval
      // that landed while the admin's click was in flight.
      const remaining = await removePlace(id);
      if (remaining === null) {
        return res.status(404).json({ error: 'not on the map (already removed?)' });
      }
      return res.status(200).json({ ok: true, removed: id, remaining: remaining.length });
    } catch (e) {
      return fail(res, e, 'failed to remove');
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
