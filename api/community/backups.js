// GET  /api/community/backups — admin. Snapshots of the map, newest first.
// POST /api/community/backups — admin. Roll back to one of them.
//
// Every write leaves its predecessor in the blob store; these just expose that
// history so a bad write or an accidental wipe is recoverable.

import {
  listVersions, restoreVersion, requireAdmin, adminCors, checkRate, clientIp,
  PLACES_KEY, PENDING_KEY,
} from './_store.js';

const KEYS = { places: PLACES_KEY, pending: PENDING_KEY };

export default async function handler(req, res) {
  adminCors(res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!checkRate(clientIp(req), 'backups', 30)) {
    return res.status(429).json({ error: 'too many requests' });
  }
  if (!requireAdmin(req, res)) return;

  const which = (req.query?.which || req.body?.which || 'places');
  const key = KEYS[which];
  if (!key) return res.status(400).json({ error: 'which must be "places" or "pending"' });

  if (req.method === 'GET') {
    try {
      return res.status(200).json({ which, versions: await listVersions(key) });
    } catch (e) {
      console.error('GET backups failed:', e);
      return res.status(500).json({ error: 'failed to list backups' });
    }
  }

  if (req.method === 'POST') {
    const pathname = req.body?.pathname || req.query?.pathname;
    if (typeof pathname !== 'string' || !pathname) {
      return res.status(400).json({ error: 'pathname is required' });
    }
    try {
      const restored = await restoreVersion(key, pathname);
      if (restored === null) {
        return res.status(404).json({ error: 'no such snapshot' });
      }
      return res.status(200).json({ ok: true, restored: restored.length });
    } catch (e) {
      console.error('POST backups failed:', e);
      return res.status(500).json({ error: 'failed to restore' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
