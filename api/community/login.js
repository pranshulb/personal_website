// POST   /api/community/login — exchange the password for a signed cookie.
// DELETE /api/community/login — sign out.
//
// The cookie is HttpOnly, so the admin page never has to keep the password
// anywhere a script (or anyone with the device) could read it back.

import {
  passwordMatches, makeAdminCookie, clearAdminCookie, sameOrigin, adminCors,
  checkRate, clientIp,
} from './_store.js';

export default async function handler(req, res) {
  adminCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearAdminCookie());
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  // Tighter than the other routes: this one is the thing worth guessing at.
  if (!checkRate(clientIp(req), 'login', 10)) {
    return res.status(429).json({ error: 'too many attempts, wait a minute' });
  }

  if (!sameOrigin(req)) {
    return res.status(403).json({ error: 'cross-origin request refused' });
  }

  if (!process.env.COMMUNITY_ADMIN_PASS) {
    return res.status(503).json({ error: 'admin disabled: COMMUNITY_ADMIN_PASS is not set' });
  }

  const given = (req.body && req.body.password) || req.headers['x-admin-pass'] || '';
  if (!passwordMatches(given)) {
    // The per-instance rate limit is weak on serverless — each cold instance
    // gets its own counter — so make every wrong guess cost real time too.
    await new Promise((r) => setTimeout(r, 500));
    return res.status(401).json({ error: 'unauthorized' });
  }

  res.setHeader('Set-Cookie', makeAdminCookie());
  return res.status(200).json({ ok: true });
}
