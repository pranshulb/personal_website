// GET /api/community/places — the public list behind the map.

import { readPlaces, checkRate, clientIp } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

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
