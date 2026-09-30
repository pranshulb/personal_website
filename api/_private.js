// The private pages' login (/login → the pcafe_auth cookie that middleware.js
// checks for /typeshit, /pdfs, /london-events), for API routes that let the
// person behind it do things: removing guestbook entries from /typeshit.
//
// Fails closed without PRIVATE_SECRET. middleware.js and api/login.js fall
// back to a default secret written in this (public) repo, and a cookie signed
// with a secret anyone can read proves nothing.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const PRIVATE_COOKIE = 'pcafe_auth';

function readCookie(req, name) {
  const header = (req.headers && req.headers.cookie) || '';
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name) {
      try { return decodeURIComponent(part.slice(eq + 1)); } catch (e) { return null; }
    }
  }
  return null;
}

// The cookie is "<base64url JSON payload>.<hex HMAC-SHA256 of the payload>",
// the payload's `e` its expiry in seconds (see api/login.js).
export function privateAuthed(req) {
  const secret = process.env.PRIVATE_SECRET;
  if (!secret) return false;
  const val = readCookie(req, PRIVATE_COOKIE);
  if (!val) return false;
  const dot = val.indexOf('.');
  if (dot <= 0) return false;
  const payloadB64 = val.slice(0, dot), sig = val.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payloadB64).digest('hex');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (e) { return false; }
  if (!payload || typeof payload !== 'object') return false;
  if (payload.e && Math.floor(Date.now() / 1000) > payload.e) return false;
  return true;
}
