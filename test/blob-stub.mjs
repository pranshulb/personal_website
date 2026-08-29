// Test stub for @vercel/blob. test/hooks.mjs resolves the real specifier to
// this file, so the API handlers are imported exactly as written.
//
// It is deliberately unforgiving. The handover notes record three bugs that
// reached production because a stub was kinder than the real service, so this
// one models the behaviour that actually bites:
//   - addRandomSuffix puts the suffix BEFORE the extension
//   - put() on an existing pathname without addRandomSuffix throws
//   - blob URLs are served through a CDN that caches per URL: the first body
//     fetched for a URL is what every later fetch of that URL returns
//   - list/fetch can be made to fail on demand
//   - a little random latency, so concurrent callers interleave

import { randomBytes } from 'node:crypto';

const store = new Map();       // pathname -> { url, uploadedAt, body }
const cdn = new Map();         // url -> body as first served
let clockOffset = 0;           // ms added to "now" — for prune tests
let seq = 0;

export const __test = {
  fail: { list: false, fetch: false, put: false },
  nominatim: [],               // hits returned by the geocoder stub
  nominatimCalls: 0,
  fetchLog: [],
  latencyMs: 3,
  reset() {
    store.clear(); cdn.clear(); clockOffset = 0; seq = 0;
    this.fail = { list: false, fetch: false, put: false };
    this.nominatim = []; this.nominatimCalls = 0; this.fetchLog = [];
  },
  advanceClock(ms) { clockOffset += ms; },
  now() { return Date.now() + clockOffset; },
  // Plant a blob directly, bypassing put's suffix — for legacy-shaped data.
  seed(pathname, data) {
    const url = 'https://blob.test/' + pathname;
    store.set(pathname, { url, uploadedAt: new Date(this.now() + (++seq)).toISOString(), body: JSON.stringify(data) });
    return url;
  },
  // Overwrite the stored body of a URL WITHOUT touching the CDN copy — the
  // real service does exactly this when you put() to a fixed pathname.
  pathnames() { return [...store.keys()]; },
  bodies() { return [...store.entries()].map(([p, b]) => [p, b.body]); },
};

const latency = () => new Promise((r) => setTimeout(r, Math.random() * __test.latencyMs));

export async function put(pathname, body, opts = {}) {
  await latency();
  if (__test.fail.put) throw new Error('stub: put failed');
  if (opts.access !== 'public') throw new Error('stub: access must be "public"');
  let final = pathname;
  if (opts.addRandomSuffix) {
    const suffix = '-' + randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, 'x');
    final = pathname.replace(/(\.[a-z0-9]+)$/i, suffix + '$1');
    if (final === pathname) final = pathname + suffix;
  } else if (store.has(pathname)) {
    throw new Error('stub: blob already exists at ' + pathname + ' (use addRandomSuffix or allowOverwrite)');
  }
  const url = 'https://blob.test/' + final;
  const rec = { url, uploadedAt: new Date(__test.now() + (++seq)).toISOString(), body: String(body) };
  store.set(final, rec);
  return { url, downloadUrl: url, pathname: final, contentType: opts.contentType, contentDisposition: '' };
}

export async function list({ prefix = '' } = {}) {
  await latency();
  if (__test.fail.list) throw new Error('stub: list failed');
  const blobs = [];
  for (const [pathname, rec] of store) {
    if (pathname.startsWith(prefix)) {
      blobs.push({ pathname, url: rec.url, downloadUrl: rec.url, uploadedAt: rec.uploadedAt, size: rec.body.length });
    }
  }
  return { blobs, hasMore: false, cursor: undefined };
}

export async function del(urlOrUrls) {
  await latency();
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  for (const url of urls) {
    for (const [pathname, rec] of store) if (rec.url === url) store.delete(pathname);
  }
}

// ---- global fetch patch: blob CDN + Nominatim ----

const realFetch = globalThis.fetch;
globalThis.fetch = async function stubFetch(input, init) {
  const url = typeof input === 'string' ? input : input.url;
  __test.fetchLog.push(url);

  if (url.startsWith('https://blob.test/')) {
    await latency();
    if (__test.fail.fetch) throw new Error('stub: fetch failed');
    if (!cdn.has(url)) {
      const pathname = url.slice('https://blob.test/'.length);
      const rec = store.get(pathname);
      if (!rec) return new Response('not found', { status: 404 });
      cdn.set(url, rec.body);   // cached for a month, in effect forever here
    }
    return new Response(cdn.get(url), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (url.startsWith('https://nominatim.openstreetmap.org/')) {
    __test.nominatimCalls++;
    if (init && init.signal && init.signal.aborted) throw new Error('aborted');
    if (__test.nominatimDelayMs) await new Promise((r) => setTimeout(r, __test.nominatimDelayMs));
    return new Response(JSON.stringify(__test.nominatim), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  return realFetch(input, init);
};
