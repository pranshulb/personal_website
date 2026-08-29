// Serves the repo like Vercel would (cleanUrls + the community rewrites) and
// routes /api/community/* to the real handlers, backed by the blob stub.
//   node --import ./test/register.mjs test/server.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

process.env.COMMUNITY_ADMIN_PASS = process.env.COMMUNITY_ADMIN_PASS || 'open-sesame';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const RUN_DIRECT = Boolean(process.argv[1] && process.argv[1].endsWith('server.mjs'));
const PORT = Number(process.env.PORT || (RUN_DIRECT && process.argv[2]) || 4321);
const imp = (p) => import(pathToFileURL(REPO + p).href).then((m) => m.default);

const blob = await import('@vercel/blob');
export const T = blob.__test;
if (!T) throw new Error('the real @vercel/blob was loaded — run through test/register.mjs');

const handlers = {
  places: await imp('api/community/places.js'),
  suggest: await imp('api/community/suggest.js'),
  login: await imp('api/community/login.js'),
  pending: await imp('api/community/pending.js'),
  'bulk-add': await imp('api/community/bulk-add.js'),
  backups: await imp('api/community/backups.js'),
  approve: await imp('api/community/approve/[id].js'),
  reject: await imp('api/community/reject/[id].js'),
  edit: await imp('api/community/edit/[id].js'),
};

let ipSeq = 1;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const REWRITES = { '/community': 'community/index.html', '/community/suggest': 'community/suggest.html', '/community/admin': 'community/admin/index.html' };

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) { try { return resolve(JSON.parse(raw)); } catch (e) { return resolve(raw); } }
      resolve(raw);
    });
  });
}

// Vercel's res helpers on top of node's ServerResponse
function wrap(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  res.send = (s) => { res.end(s); return res; };
  return res;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + req.headers.host);
  const m = url.pathname.match(/^\/api\/community\/([a-z-]+)(?:\/([^/]+))?$/);
  if (m) {
    if (process.env.LOG) console.log('REQ', req.method, url.pathname + url.search);
    const handler = handlers[m[1]];
    if (!handler) { res.statusCode = 404; return res.end('no such function'); }
    req.query = Object.fromEntries(url.searchParams);
    if (m[2]) req.query.id = decodeURIComponent(m[2]);
    // Everything here comes from 127.0.0.1, which would put every test into
    // one rate-limit bucket. Each request gets its own IP unless a test pins
    // one (T.ip) to exercise the limiter on purpose.
    if (!req.headers['x-forwarded-for']) {
      req.headers['x-forwarded-for'] = T.ip || ('10.' + (ipSeq >> 16 & 255) + '.' + (ipSeq >> 8 & 255) + '.' + (ipSeq++ & 255));
    }
    req.body = await readBody(req);
    try {
      await handler(req, wrap(res));
    } catch (e) {
      console.error('handler threw:', e);
      res.statusCode = 500; res.end('handler threw');
    }
    return;
  }

  let rel = REWRITES[url.pathname] || url.pathname.replace(/^\//, '');
  if (rel === '') rel = 'index.html';
  let file = path.join(REPO, rel);
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file = file + '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

export function start() {
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(PORT)));
}
export function stop() { return new Promise((r) => server.close(r)); }

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  await start();
  console.log('serving on http://127.0.0.1:' + PORT);
}
