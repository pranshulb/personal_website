// Shared storage + auth for the community map API.
//
// Vercel's filesystem is read-only and ephemeral, so the Flask version's
// places.json / pending.json on disk can't work here. Both live in Vercel Blob
// instead, following the same read-modify-write pattern as api/wall.js.

import { put, list, del } from '@vercel/blob';
import { timingSafeEqual, createHmac, createHash, randomBytes, randomUUID } from 'node:crypto';
import SEED_PLACES from './_seed.js';

export const PLACES_KEY = 'community-places.json';
export const PENDING_KEY = 'community-pending.json';

// ---- blob helpers ----

// Every write lands at a NEW pathname and so a new URL, and reads always take
// the newest. That is deliberate: blob URLs are served through a CDN that
// caches aggressively (the default is a month), so writing to one fixed
// pathname hands back a stale copy on the next read — an edit appears to save
// and then undo itself. fetch's `cache` option can't help; it governs the
// runtime's own cache, not the blob CDN's. A fresh URL each time can never be
// stale, so the reads are correct by construction rather than by cache-busting.
const baseOf = (key) => key.replace(/\.json$/, '');

// Thrown when the store can't be read. Callers must NOT treat this as "empty":
// a mutate that read a transient failure as [] and wrote [] + one item back
// would replace the whole list with that one item. Recoverable from history,
// but silently, and only if someone noticed.
export class StoreReadError extends Error {
  constructor(key, cause) {
    super('could not read ' + key + (cause && cause.message ? ': ' + cause.message : ''));
    this.name = 'StoreReadError';
    this.cause = cause;
  }
}

// Returns `fallback` only when the store is genuinely empty (nothing has ever
// been written). Any failure to list, fetch or parse throws instead.
async function readBlob(key, fallback) {
  let blobs;
  try {
    // Prefix is the extension-less base, because addRandomSuffix inserts the
    // suffix before the extension: community-pending-XyZ123.json
    ({ blobs } = await list({ prefix: baseOf(key) }));
  } catch (e) {
    console.error('readBlob(' + key + ') list failed:', e);
    throw new StoreReadError(key, e);
  }
  if (blobs.length === 0) return fallback;

  const latest = blobs.slice().sort(byNewest)[0];
  let data;
  try {
    const res = await fetch(latest.url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + latest.pathname);
    data = await res.json();
  } catch (e) {
    console.error('readBlob(' + key + ') fetch failed:', e);
    throw new StoreReadError(key, e);
  }
  if (!Array.isArray(data)) {
    // A corrupt newest version. Don't fall back to [] — the next write would
    // bury the last good copy under an empty one. History still has it.
    throw new StoreReadError(key, new Error('newest version is not a list'));
  }
  return data;
}

// A write in flight elsewhere must never be deleted by our prune. Two writers
// that each delete "everything that isn't mine" delete each other, and the
// store falls back to empty — losing both writes rather than one. Only blobs
// older than this are candidates; reads take the newest, so extras are inert.
const PRUNE_GRACE_MS = 120000;

// Every write already leaves its predecessor behind as a complete file. Keeping
// them instead of deleting them turns that into free version history: any bad
// write, accidental wipe, or bug that empties the store can be rolled back to
// a known-good copy. Each version is a few KB, so 30 costs nothing.
export const KEEP_VERSIONS = 30;

const byNewest = (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt);

async function writeBlob(key, data) {
  // Write first, then prune — so a failed prune can't lose data.
  const fresh = await put(key, JSON.stringify(data, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: true,
    cacheControlMaxAge: 60,
  });
  try {
    const { blobs } = await list({ prefix: baseOf(key) });
    const ordered = blobs.slice().sort(byNewest);
    const keep = new Set(ordered.slice(0, KEEP_VERSIONS).map((b) => b.pathname));
    keep.add(fresh.pathname);
    const cutoff = Date.now() - PRUNE_GRACE_MS;

    for (const b of blobs) {
      if (keep.has(b.pathname)) continue;
      if (new Date(b.uploadedAt).getTime() >= cutoff) continue;
      await del(b.url);
    }
  } catch (e) {
    // Harmless: reads take the newest by uploadedAt, so leftovers are ignored.
  }
  return fresh;
}

// ---- version history / restore ----

// Newest first. Each entry is a full snapshot of the list at that moment.
export async function listVersions(key) {
  const { blobs } = await list({ prefix: baseOf(key) });
  const ordered = blobs.slice().sort(byNewest);

  return Promise.all(ordered.slice(0, KEEP_VERSIONS).map(async (b, i) => {
    let count = null;
    try {
      const res = await fetch(b.url, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) count = data.length;
      }
    } catch (e) { /* count stays null — the entry is still restorable */ }
    return { pathname: b.pathname, uploadedAt: b.uploadedAt, count, current: i === 0 };
  }));
}

// Restores by writing the old contents forward as a new version, so the
// restore is itself undoable rather than rewriting history.
export async function restoreVersion(key, pathname) {
  const { blobs } = await list({ prefix: baseOf(key) });
  const target = blobs.find((b) => b.pathname === pathname);
  if (!target) return null;

  const res = await fetch(target.url, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data)) return null;

  await overwrite(key, data);
  return data;
}

// ---- the write lock ----
//
// Blob has no compare-and-swap, so read-modify-write on its own cannot be
// made safe: two writers that read the same version both write on top of it,
// and the loser's change vanishes. "Check after writing and replay" (the
// previous fix) narrows that but does not close it — a check can pass and the
// list still be overwritten a moment later by a writer that read before us.
// The test harness produced exactly that: a removal reported as done, then
// undone by a concurrent approval.
//
// What Blob does give us is that put() to an existing pathname throws. That is
// a mutex. Every writer takes the lock, does its read-modify-write, and drops
// it. The check-after-write stays as a belt to the braces.
//
// The lock file's prefix must NOT match the data prefix, or list() would hand
// it back as the newest version of the list.
export class StoreBusyError extends Error {
  constructor(key) {
    super('could not apply the change to ' + key + ' — too many concurrent writes');
    this.name = 'StoreBusyError';
  }
}

const LOCK_TTL_MS = 10000;        // a writer that died holding the lock is ignored after this
const LOCK_WAIT_MS = 8000;        // how long a writer will queue for the lock before giving up
const lockName = (key) => 'lock-' + baseOf(key) + '.txt';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquireLock(key) {
  const name = lockName(key);
  const deadline = Date.now() + LOCK_WAIT_MS;
  let wait = 30;
  while (true) {
    try {
      const held = await put(name, String(Date.now()), {
        access: 'public', contentType: 'text/plain', addRandomSuffix: false, cacheControlMaxAge: 60,
      });
      return async () => { try { await del(held.url); } catch (e) { /* the TTL will clear it */ } };
    } catch (e) {
      // Somebody has it — or it is a leftover from a writer that died. A lock
      // older than the TTL is broken; a live one is waited for.
      try {
        const { blobs } = await list({ prefix: name });
        const existing = blobs.find((b) => b.pathname === name);
        if (existing && Date.now() - new Date(existing.uploadedAt).getTime() > LOCK_TTL_MS) {
          await del(existing.url);
          continue;
        }
      } catch (e2) { /* fall through to the wait */ }
      if (Date.now() > deadline) throw new StoreBusyError(key);
      await sleep(wait + Math.random() * wait);
      wait = Math.min(wait * 2, 500);
    }
  }
}

async function withLock(key, fn) {
  const release = await acquireLock(key);
  try {
    return await fn();
  } finally {
    await release();
  }
}

// Replaces the list wholesale (wipe, restore). Under the lock like everything
// else, so it cannot interleave with a mutate.
export function overwrite(key, data) {
  return withLock(key, () => writeBlob(key, data));
}

// Read-modify-write under the lock, with a check afterwards.
// `mutator` must be pure so replaying it on fresh data is safe.
//
// `mutator` returns null for "nothing to do" (id not found, already present);
// that is also what the caller gets back. A read failure throws — it must
// never be mistaken for an empty list and written over.
//
// Giving up must throw too. This used to return whatever was there after the
// last attempt, and the handler turned that into a 200 — so under a burst of
// simultaneous writers some writes were lost AND their senders were told they
// had gone through.
const MUTATE_ATTEMPTS = 4;

async function mutate(key, fallback, mutator, isApplied, normalise = (x) => x, attempts = MUTATE_ATTEMPTS) {
  return withLock(key, async () => {
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(20 + Math.random() * 60);
      const current = normalise(await readBlob(key, fallback));
      const next = mutator(current);
      if (next === null) return null;          // nothing to do (e.g. id not found)
      await writeBlob(key, next);
      const after = normalise(await readBlob(key, fallback));
      if (isApplied(after)) return after;
      // Should not happen under the lock; would mean a stale lock was broken
      // out from under us. Replay on what's there now.
      console.error('mutate(' + key + ') write was not visible afterwards; retrying');
    }
    throw new StoreBusyError(key);
  });
}

// ---- places ----

// Entries written before ids existed get a stable one derived from their
// content, so the same entry gets the same id on every read and the admin can
// address it. The id is persisted the first time the list is written back.
function legacyId(p) {
  return 'legacy-' + createHash('sha1')
    .update([p.name, p.area, p.when, p.lat, p.lng].map((v) => String(v ?? '')).join('|'))
    .digest('hex').slice(0, 16);
}

export function withIds(places) {
  return places.map((p) => (p && typeof p === 'object' && !p.id ? { ...p, id: legacyId(p) } : p));
}

export const newId = () => randomUUID();

// places.json is seeded on first read so the map isn't empty on a fresh deploy.
export const readPlaces = async () => withIds(await readBlob(PLACES_KEY, SEED_PLACES));
export const writePlaces = (data) => overwrite(PLACES_KEY, data);
export const readPending = () => readBlob(PENDING_KEY, []);
export const writePending = (data) => overwrite(PENDING_KEY, data);

// Concurrency-safe queue operations. Use these rather than read/write pairs:
// a suggestion arriving while an approval is in flight must not disappear.
const MAX_PENDING = 500;

export function appendPending(items) {
  const ids = items.map((i) => i.id);
  return mutate(
    PENDING_KEY, [],
    (current) => (current.length + items.length > MAX_PENDING ? null : current.concat(items)),
    (after) => ids.every((id) => after.some((p) => p.id === id)),
  );
}

export function removePending(id) {
  return mutate(
    PENDING_KEY, [],
    (current) => (current.some((p) => p.id === id) ? current.filter((p) => p.id !== id) : null),
    (after) => !after.some((p) => p.id === id),
  );
}

// Keyed on the place's id, so approving the same suggestion twice — two tabs,
// a double tap, a retry after a timeout — lands one entry, not two. Resolves
// null when it was already there.
export function appendPlace(place) {
  if (!place.id) throw new Error('appendPlace: place needs an id');
  return mutate(
    PLACES_KEY, SEED_PLACES,
    (current) => (current.some((p) => p.id === place.id) ? null : current.concat([place])),
    (after) => after.some((p) => p.id === place.id),
    withIds,
  );
}

// Replaces the entry wholesale (the caller has already merged the patch), so
// the check afterwards is simply "is that exact object there now".
export function replacePlace(next) {
  if (!next.id) throw new Error('replacePlace: place needs an id');
  const want = JSON.stringify(next);
  return mutate(
    PLACES_KEY, SEED_PLACES,
    (current) => {
      const i = current.findIndex((p) => p.id === next.id);
      if (i === -1) return null;
      const copy = current.slice();
      copy[i] = next;
      return copy;
    },
    (after) => after.some((p) => p.id === next.id && JSON.stringify(p) === want),
    withIds,
  );
}

// Removes exactly one entry — two legacy duplicates share an id, so a filter
// would take both, and a check of "is the id gone" would keep retrying until
// it had. The check is on the count instead.
export function removePlace(id) {
  const count = (list) => list.filter((p) => p.id === id).length;
  let expect = 0;
  return mutate(
    PLACES_KEY, SEED_PLACES,
    (current) => {
      const i = current.findIndex((p) => p.id === id);
      if (i === -1) return null;
      expect = count(current) - 1;
      return current.slice(0, i).concat(current.slice(i + 1));
    },
    (after) => count(after) <= expect,
    withIds,
  );
}

// ---- admin auth ----

export const COOKIE_NAME = 'pcafe_community';
const COOKIE_DAYS = 30;

// Signed with the admin password itself, so there's no second env var to set
// — and changing the password invalidates every cookie already issued, which
// is the behaviour you'd want anyway.
const cookieSecret = () =>
  process.env.PRIVATE_SECRET || process.env.COMMUNITY_ADMIN_PASS || '';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payloadB64) =>
  createHmac('sha256', cookieSecret()).update(payloadB64).digest('hex');

function constantEquals(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passwordMatches(given) {
  const expected = process.env.COMMUNITY_ADMIN_PASS;
  return Boolean(expected) && constantEquals(given ?? '', expected);
}

export function makeAdminCookie() {
  const exp = Math.floor(Date.now() / 1000) + COOKIE_DAYS * 86400;
  // jti only exists so two cookies minted in the same second still differ
  const payload = b64url(JSON.stringify({ e: exp, jti: randomBytes(8).toString('hex') }));
  const value = payload + '.' + sign(payload);
  return [
    COOKIE_NAME + '=' + value,
    'Path=/',
    'Max-Age=' + COOKIE_DAYS * 86400,
    'HttpOnly',            // page scripts can't read it, unlike a stored password
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

export const clearAdminCookie = () =>
  COOKIE_NAME + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name) {
      try { return decodeURIComponent(part.slice(eq + 1)); } catch (e) { return null; }
    }
  }
  return null;
}

function cookieValid(req) {
  const raw = readCookie(req, COOKIE_NAME);
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot < 1) return false;

  const payloadB64 = raw.slice(0, dot);
  if (!constantEquals(raw.slice(dot + 1), sign(payloadB64))) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return !(payload.e && Math.floor(Date.now() / 1000) > payload.e);
  } catch (e) {
    return false;
  }
}

// Accepts a signed cookie or the X-Admin-Pass header. No fallback password: if
// COMMUNITY_ADMIN_PASS is unset the admin endpoints stay shut rather than
// accepting a value baked into the repo.
// SameSite=Lax already stops the admin cookie riding along on a cross-site
// write, but that's one browser default standing between a hostile page and a
// wipe. Checked explicitly here too. A missing Origin (curl, server-to-server)
// is allowed: those carry no ambient credentials, so there's nothing to ride.
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch (e) {
    return false;
  }
}

export function requireAdmin(req, res) {
  if (!process.env.COMMUNITY_ADMIN_PASS) {
    res.status(503).json({ error: 'admin disabled: COMMUNITY_ADMIN_PASS is not set' });
    return false;
  }

  if (!sameOrigin(req)) {
    res.status(403).json({ error: 'cross-origin request refused' });
    return false;
  }

  if (cookieValid(req) || passwordMatches(req.headers['x-admin-pass'])) return true;

  res.status(401).json({ error: 'unauthorized' });
  return false;
}

// Admin responses are same-origin only; there is no reason to advertise them
// to other sites. Public GETs keep their permissive header.
export function adminCors(res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Pass');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
}

// One place to turn a thrown error into a response, so a store read failure
// says so (rather than "failed to X") and shows up as such in the logs.
export function fail(res, e, message) {
  console.error(message + ':', e);
  if (e instanceof StoreReadError) {
    return res.status(503).json({ error: 'storage is unreachable right now — nothing was changed' });
  }
  if (e instanceof StoreBusyError) {
    res.setHeader('Retry-After', '2');
    return res.status(503).json({ error: 'too many changes at once — try again in a moment' });
  }
  return res.status(500).json({ error: message });
}

// ---- misc ----

const rateLimit = new Map();

// Buckets are per route as well as per IP — this module is shared, so a single
// counter would measure every endpoint's traffic against each one's own limit.
export function checkRate(ip, bucket, max, windowMs = 60000) {
  const key = ip + '|' + bucket;
  const now = Date.now();
  const entry = rateLimit.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimit.set(key, entry);
  if (rateLimit.size > 1000) {
    for (const [k, v] of rateLimit) if (now - v.start > windowMs * 2) rateLimit.delete(k);
  }
  return entry.count <= max;
}

export function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown')
    .split(',')[0].trim();
}

// Strips angle brackets (the pages build DOM nodes, but belt and braces) and
// control characters, collapses runs of whitespace within a line, and caps
// the length.
export const clean = (s, max) => String(s ?? '')
  .replace(/[<>]/g, '')
  .replace(/[^\P{Cc}\n\t]/gu, '')
  .replace(/[ \t]+/g, ' ')
  .trim()
  .slice(0, max);

// Links go straight into an <a href>. clean() only strips angle brackets, so
// "javascript:..." survived it intact — a stored XSS anyone could plant through
// the public form, and one the approval card never showed. Only http(s) links
// are kept; anything else is dropped rather than rendered.
export function cleanUrl(s, max = 300) {
  const raw = clean(s, max);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? raw : '';
  } catch (e) {
    // Bare "example.com" is a reasonable thing to type; assume https.
    if (/^[\w.-]+\.[a-z]{2,}([/?#]|$)/i.test(raw)) return 'https://' + raw;
    return '';
  }
}

export function cleanTags(tags) {
  if (typeof tags === 'string') tags = tags.split(',');
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const v = clean(t, 30).toLowerCase();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out.slice(0, 6);
}

// "june 2024", free text. Lowercased to match the rest of the site's voice.
export const cleanWhen = (s) => clean(s, 40).toLowerCase();

// A coordinate is a finite number inside the range, or nothing. Strings from a
// form ("51.5") are accepted; anything else is null rather than NaN or 0.
export function cleanCoord(v, limit) {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return n;
}

// Turn "Peckham" into coordinates so approved suggestions land on the map.
// The Flask version left a `lat: 0.0` TODO here, which would pin every
// approval into the Atlantic; null is honest and the map skips it instead.
const GEOCODE_TIMEOUT_MS = 6000;

export async function geocode(area, name) {
  // Tried most specific first. A venue name pins the dot exactly when Nominatim
  // knows it, but over-constrains the query when it doesn't ("Mending Circle,
  // Peckham" finds nothing), so fall back to the area on its own.
  const queries = [
    name && area ? `${name}, ${area}, London, UK` : null,
    name ? `${name}, London, UK` : null,
    area ? `${area}, London, UK` : null,
  ].filter(Boolean);

  for (const query of queries) {
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
        + encodeURIComponent(query);
      // Bounded: a slow upstream used to hold the whole approval open until the
      // function was killed, and the admin saw a failure for a lookup that was
      // never going to matter that much.
      const res = await fetch(url, {
        headers: { 'User-Agent': 'pranshul.cafe community map (pranshulbohra@gmail.com)' },
        signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const hits = await res.json();
      if (Array.isArray(hits) && hits.length > 0) {
        const lat = cleanCoord(hits[0].lat, 90);
        const lng = cleanCoord(hits[0].lon, 180);
        if (lat !== null && lng !== null) return { lat, lng };
      }
    } catch (e) {
      console.error('geocode failed for', query, e);
    }
  }
  return { lat: null, lng: null };
}
