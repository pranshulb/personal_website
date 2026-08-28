// GET /api/community/pending — admin. The review queue.

import { readPending, requireAdmin, adminCors, checkRate, clientIp } from './_store.js';

export default async function handler(req, res) {
  adminCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  // Rate-limited before the password check so this isn't a brute-force oracle.
  if (!checkRate(clientIp(req), 'pending', 30)) {
    return res.status(429).json({ error: 'too many requests' });
  }
  if (!requireAdmin(req, res)) return;

  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(await readPending());
  } catch (e) {
    console.error('GET pending failed:', e);
    return res.status(500).json({ error: 'failed to load queue' });
  }
}
