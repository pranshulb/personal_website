// POST /api/community/reject/<id> — admin. Drops one item from the queue.

import {
  removePending, requireAdmin, adminCors, checkRate, clientIp, fail,
} from '../_store.js';

export default async function handler(req, res) {
  adminCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  if (!checkRate(clientIp(req), 'reject', 30)) {
    return res.status(429).json({ error: 'too many requests' });
  }
  if (!requireAdmin(req, res)) return;

  const { id } = req.query;

  try {
    const remaining = await removePending(id);
    if (remaining === null) {
      return res.status(404).json({ error: 'not found' });
    }
    return res.status(200).json({ ok: true, remaining: remaining.length });
  } catch (e) {
    return fail(res, e, 'failed to reject');
  }
}
