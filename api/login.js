// POST /api/login — verify creds, set signed cookie, redirect.
export const config = { runtime: 'edge' };

const DEFAULT_USER = 'pman';
// SHA-256 of "typeshitskibidi"
const DEFAULT_PASS_HASH = '3e1be62019d0c11581aa249614227533429ecd90d471130e6dd0a0674456dafa';
const DEFAULT_SECRET = 'pranshul-cafe-cherry-blossoms-2026-fallback-secret-please-override';
const COOKIE_NAME = 'pcafe_auth';
const FAIL_COOKIE = 'pcafe_fails';
const ONE_YEAR = 60 * 60 * 24 * 365;
const MAX_FAILS = 5;
const LOCKOUT_SECS = 15 * 60; // 15 minutes

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeNext(n) {
  if (!n || typeof n !== 'string') return '/typeshit';
  if (!n.startsWith('/') || n.startsWith('//')) return '/typeshit';
  return n;
}

function parseCookies(req) {
  const header = req.headers.get('cookie') || '';
  return Object.fromEntries(
    header.split(';').map((c) => {
      const i = c.indexOf('=');
      return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
    })
  );
}

async function getFailState(cookies, secret) {
  const raw = cookies[FAIL_COOKIE];
  if (!raw) return { count: 0, lockedUntil: 0 };
  try {
    const parts = raw.split('.');
    if (parts.length !== 3) return { count: 0, lockedUntil: 0 };
    const [countStr, lockedStr, sig] = parts;
    const expected = await hmacSha256Hex(secret, `${countStr}.${lockedStr}`);
    if (expected !== sig) return { count: 0, lockedUntil: 0 };
    return { count: parseInt(countStr, 10) || 0, lockedUntil: parseInt(lockedStr, 10) || 0 };
  } catch {
    return { count: 0, lockedUntil: 0 };
  }
}

async function makeFailCookie(count, lockedUntil, secret) {
  const sig = await hmacSha256Hex(secret, `${count}.${lockedUntil}`);
  return `${FAIL_COOKIE}=${count}.${lockedUntil}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${LOCKOUT_SECS * 2}`;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const env = (typeof process !== 'undefined' && process.env) || {};
  const expectedUser = DEFAULT_USER;
  const envPass = null;
  const secret = env.PRIVATE_SECRET || DEFAULT_SECRET;

  let user = '', pass = '', next = '/typeshit';
  try {
    const fd = await req.formData();
    user = (fd.get('user') || '').toString();
    pass = (fd.get('pass') || '').toString();
    next = safeNext((fd.get('next') || '/typeshit').toString());
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const url = new URL(req.url);
  const cookies = parseCookies(req);
  const { count, lockedUntil } = await getFailState(cookies, secret);
  const now = Math.floor(Date.now() / 1000);

  // Check if currently locked out
  if (lockedUntil > now) {
    const minsLeft = Math.ceil((lockedUntil - now) / 60);
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/login?err=locked&mins=${minsLeft}&next=${encodeURIComponent(next)}`,
      },
    });
  }

  let valid = (user === expectedUser);
  if (valid) {
    if (envPass !== null) {
      valid = (pass === envPass);
    } else {
      const hash = await sha256Hex(pass);
      valid = (hash === DEFAULT_PASS_HASH);
    }
  }

  if (!valid) {
    const newCount = (lockedUntil > 0 && lockedUntil <= now) ? 1 : count + 1; // reset after expired lockout
    const newLockedUntil = newCount >= MAX_FAILS ? now + LOCKOUT_SECS : 0;
    const failCookie = await makeFailCookie(newCount, newLockedUntil, secret);

    const errParam = newLockedUntil > 0
      ? `err=locked&mins=${Math.ceil(LOCKOUT_SECS / 60)}`
      : `err=1&tries=${MAX_FAILS - newCount}`;

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/login?${errParam}&next=${encodeURIComponent(next)}`,
        'Set-Cookie': failCookie,
      },
    });
  }

  // Success — clear fail cookie, set auth cookie
  const exp = Math.floor(Date.now() / 1000) + ONE_YEAR;
  const payload = JSON.stringify({ u: user, e: exp });
  const payloadB64 = b64urlEncode(payload);
  const sig = await hmacSha256Hex(secret, payloadB64);
  const cookieVal = `${payloadB64}.${sig}`;

  return new Response(null, {
    status: 302,
    headers: new Headers([
      ['Location', `${url.origin}${next}`],
      ['Set-Cookie', `${COOKIE_NAME}=${cookieVal}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ONE_YEAR}`],
      ['Set-Cookie', `${FAIL_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`],
    ]),
  });
}
