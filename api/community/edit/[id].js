// POST /api/community/edit/<id> — admin. Changes one entry that is already on
// the map. Before this the only way to fix a typo was remove-and-re-add,
// which also lost the entry's place in the order and its "when".
//
// Body: any of name, area, tags, note, url, when, lat, lng. Fields not sent
// are left alone. Send lat and lng together to move the pin, `null` for both
// to clear it, or `"geocode": true` to look the pin up again from the
// (possibly just corrected) name and area.

import {
  readPlaces, replacePlace, requireAdmin, adminCors, checkRate, clientIp, fail,
  clean, cleanTags, cleanUrl, cleanWhen, cleanCoord, geocode,
} from '../_store.js';

export default async function handler(req, res) {
  adminCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  if (!checkRate(clientIp(req), 'edit', 30)) {
    return res.status(429).json({ error: 'too many requests' });
  }
  if (!requireAdmin(req, res)) return;

  const { id } = req.query;
  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  try {
    const places = await readPlaces();
    const current = places.find((p) => p.id === id);
    if (!current) return res.status(404).json({ error: 'not on the map' });

    const next = { ...current, id: current.id };
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

    if (has('name')) {
      const name = clean(body.name, 120);
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      next.name = name;
    }
    if (has('area')) next.area = clean(body.area, 80);
    if (has('tags')) next.tags = cleanTags(body.tags);
    if (has('note')) next.note = clean(body.note, 500);
    if (has('url')) next.url = cleanUrl(body.url);
    if (has('when')) next.when = cleanWhen(body.when);

    if (body.geocode === true) {
      const found = await geocode(next.area, next.name);
      next.lat = found.lat;
      next.lng = found.lng;
    } else if (has('lat') || has('lng')) {
      const lat = cleanCoord(body.lat, 90);
      const lng = cleanCoord(body.lng, 180);
      if ((lat === null) !== (lng === null)) {
        return res.status(400).json({ error: 'lat and lng go together' });
      }
      next.lat = lat;
      next.lng = lng;
    }

    if (next.lat === null || next.lng === null) next.needsCoords = true;
    else delete next.needsCoords;

    const result = await replacePlace(next);
    if (result === null) {
      return res.status(404).json({ error: 'not on the map (removed while you were editing?)' });
    }
    return res.status(200).json({ ok: true, place: next });
  } catch (e) {
    return fail(res, e, 'failed to edit');
  }
}
