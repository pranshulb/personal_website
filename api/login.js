// POST /api/login — verify creds, set signed cookie, redirect.
export const config = { runtime: 'edge' };

const DEFAULT_USER = 'pman';
// SHA-256 of "typeshitskibidi"
const DEFAULT_PASS_HASH = '3e1be62019d0c11581aa249614227533429ecd90d471130e6dd0a0674456dafa';
const DEFAULT_SECRET = 'pranshul-cafe-cherry-blossoms-2026-fallback-secret-please-override';
const COOKIE_NAME = 'pcafe_auth';
const ONE_YEAR = 60 * 60 * 24 * 365;

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

  let valid = (user === expectedUser);
  if (valid) {
    if (envPass !== null) {
      valid = (pass === envPass);
    } else {
      const hash = await sha256Hex(pass);
      valid = (hash === DEFAULT_PASS_HASH);
    }
  }

  const url = new URL(req.url);
  if (!valid) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/login?err=1&next=${encodeURIComponent(next)}`,
      },
    });
  }

  const exp = Math.floor(Date.now() / 1000) + ONE_YEAR;
  const payload = JSON.stringify({ u: user, e: exp });
  const payloadB64 = b64urlEncode(payload);
  const sig = await hmacSha256Hex(secret, payloadB64);
  const cookieVal = `${payloadB64}.${sig}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}${next}`,
      'Set-Cookie': `${COOKIE_NAME}=${cookieVal}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ONE_YEAR}`,
    },
  });
}
