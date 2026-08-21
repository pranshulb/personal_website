// Shared storage + auth for the community map API.
//
// Vercel's filesystem is read-only and ephemeral, so the Flask version's
// places.json / pending.json on disk can't work here. Both live in Vercel Blob
// instead, following the same read-modify-write pattern as api/wall.js.

import { put, list, del } from '@vercel/blob';
import { timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
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

async function readBlob(key, fallback) {
  try {
    // Prefix is the extension-less base, because addRandomSuffix inserts the
    // suffix before the extension: community-pending-XyZ123.json
    const { blobs } = await list({ prefix: baseOf(key) });
    if (blobs.length === 0) return fallback;
    const latest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
    const res = await fetch(latest.url, { cache: 'no-store' });
    if (!res.ok) return fallback;
    const data = await res.json();
    return Array.isArray(data) ? data : fallback;
  } catch (e) {
    console.error('readBlob(' + key + ') failed:', e);
    return fallback;
  }
}

// A write in flight elsewhere must never be deleted by our prune. Two writers
// that each delete "everything that isn't mine" delete each other, and the
// store falls back to empty — losing both writes rather than one. Only blobs
// older than this are candidates; reads take the newest, so extras are inert.
const PRUNE_GRACE_MS = 120000;

async function writeBlob(key, data) {
  // Write first, then prune older versions — so a failed prune can't lose data.
  const fresh = await put(key, JSON.stringify(data, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: true,
    cacheControlMaxAge: 60,
  });
  try {
    const { blobs } = await list({ prefix: baseOf(key) });
    const newest = blobs
      .slice()
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
    const cutoff = Date.now() - PRUNE_GRACE_MS;
    for (const b of blobs) {
      if (b.pathname === fresh.pathname) continue;
      if (newest && b.pathname === newest.pathname) continue;
      if (new Date(b.uploadedAt).getTime() >= cutoff) continue;
      await del(b.url);
    }
  } catch (e) {
    // Harmless: reads take the newest by uploadedAt, so leftovers are ignored.
  }
}

// Read-modify-write with a check afterwards. Two requests that read the same
// version both write on top of it, and the loser's change vanishes — which for
// a suggestion arriving mid-approval means silently dropping someone's
// submission. `mutator` must be pure so replaying it on fresh data is safe.
async function mutate(key, fallback, mutator, isApplied, attempts = 4) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    const current = await readBlob(key, fallback);
    const next = mutator(current);
    if (next === null) return null;          // nothing to do (e.g. id not found)
    await writeBlob(key, next);
    last = await readBlob(key, fallback);
    if (isApplied(last)) return last;
    // Someone landed between our read and our write; replay on what's there now.
  }
  console.error('mutate(' + key + ') did not converge after ' + attempts + ' attempts');
  return last;
}

// places.json is seeded on first read so the map isn't empty on a fresh deploy.
export const readPlaces = () => readBlob(PLACES_KEY, SEED_PLACES);
export const writePlaces = (data) => writeBlob(PLACES_KEY, data);
export const readPending = () => readBlob(PENDING_KEY, []);
export const writePending = (data) => writeBlob(PENDING_KEY, data);

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

export function appendPlace(place) {
  return mutate(
    PLACES_KEY, SEED_PLACES,
    (current) => current.concat([place]),
    (after) => after.some((p) => p.name === place.name && p.when === place.when),
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
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
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
export function requireAdmin(req, res) {
  if (!process.env.COMMUNITY_ADMIN_PASS) {
    res.status(503).json({ error: 'admin disabled: COMMUNITY_ADMIN_PASS is not set' });
    return false;
  }

  if (cookieValid(req) || passwordMatches(req.headers['x-admin-pass'])) return true;

  res.status(401).json({ error: 'unauthorized' });
  return false;
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

export const clean = (s, max) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, max);

export function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => clean(t, 30).toLowerCase()).filter(Boolean).slice(0, 6);
}

// Turn "Peckham" into coordinates so approved suggestions land on the map.
// The Flask version left a `lat: 0.0` TODO here, which would pin every
// approval into the Atlantic; null is honest and the map skips it instead.
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
      const res = await fetch(url, {
        headers: { 'User-Agent': 'pranshul.cafe community map (pranshulbohra@gmail.com)' },
      });
      if (!res.ok) continue;
      const hits = await res.json();
      if (Array.isArray(hits) && hits.length > 0) {
        return { lat: parseFloat(hits[0].lat), lng: parseFloat(hits[0].lon) };
      }
    } catch (e) {
      console.error('geocode failed for', query, e);
    }
  }
  return { lat: null, lng: null };
}
