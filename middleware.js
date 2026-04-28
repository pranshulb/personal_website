// Edge middleware: cookie-based auth gate for /private and /pdfs.
// Cookie is signed (HMAC-SHA256) and lasts 1 year. Login form lives at /login.
// Set PRIVATE_PASS and PRIVATE_SECRET env vars in Vercel to override defaults.

export const config = {
  matcher: [
    '/private',
    '/pdfs',
    '/pdfs/:path*',
    '/london-events',
    '/london-events/:path*',
  ],
};

const DEFAULT_SECRET = 'pranshul-cafe-cherry-blossoms-2026-fallback-secret-please-override';
const COOKIE_NAME = 'pcafe_auth';

async function hmacSha256Hex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

function getCookie(req, name) {
  const header = req.headers.get('cookie') || '';
  const parts = header.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    if (p.slice(0, eq) === name) return decodeURIComponent(p.slice(eq + 1));
  }
  return null;
}

async function verifyCookie(val, secret) {
  if (!val) return null;
  const dot = val.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = val.slice(0, dot);
  const sig = val.slice(dot + 1);
  if (!payloadB64 || !sig) return null;

  const expectedSig = await hmacSha256Hex(secret, payloadB64);
  if (expectedSig !== sig) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch { return null; }

  if (payload.e && Math.floor(Date.now() / 1000) > payload.e) return null;
  return payload;
}

function redirectToLogin(req) {
  const url = new URL(req.url);
  const next = url.pathname + url.search;
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}/login?next=${encodeURIComponent(next)}`,
    },
  });
}

export default async function middleware(request) {
  const env = (typeof process !== 'undefined' && process.env) || {};
  const secret = env.PRIVATE_SECRET || DEFAULT_SECRET;

  const cookieVal = getCookie(request, COOKIE_NAME);
  const payload = await verifyCookie(cookieVal, secret);

  if (payload) return; // pass through

  return redirectToLogin(request);
}
