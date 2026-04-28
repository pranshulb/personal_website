// Edge Middleware: HTTP basic auth for /private and /pdfs
// Override the default password by setting PRIVATE_PASS env var in Vercel.
// Default password (if env not set): "cherryblossoms2026", username: "pranshul"

export const config = {
  matcher: ['/private', '/pdfs', '/pdfs/:path*'],
};

const DEFAULT_USER = 'pranshul';
// SHA-256 of "cherryblossoms2026"
const DEFAULT_PASS_HASH = '8b8689fca7e3483e409efd20b3b97950151cfa286a5c23ad63417e3aeba0cea0';

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function unauthorized() {
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="pranshul.cafe / private", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export default async function middleware(request) {
  const auth = request.headers.get('authorization');
  if (!auth || !auth.startsWith('Basic ')) return unauthorized();

  let user = '';
  let pass = '';
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    if (idx < 0) return unauthorized();
    user = decoded.slice(0, idx);
    pass = decoded.slice(idx + 1);
  } catch {
    return unauthorized();
  }

  const expectedUser = (typeof process !== 'undefined' && process.env && process.env.PRIVATE_USER) || DEFAULT_USER;
  const envPass = (typeof process !== 'undefined' && process.env && process.env.PRIVATE_PASS) || null;

  if (user !== expectedUser) return unauthorized();

  if (envPass !== null) {
    if (pass === envPass) return; // pass through
    return unauthorized();
  }

  // fall back to hashed default
  const hash = await sha256Hex(pass);
  if (hash === DEFAULT_PASS_HASH) return; // pass through
  return unauthorized();
}
