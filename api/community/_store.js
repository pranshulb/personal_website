// Shared storage + auth for the community map API.
//
// Vercel's filesystem is read-only and ephemeral, so the Flask version's
// places.json / pending.json on disk can't work here. Both live in Vercel Blob
// instead, following the same read-modify-write pattern as api/wall.js.

import { put, list, del } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';
import SEED_PLACES from './_seed.js';

export const PLACES_KEY = 'community-places.json';
export const PENDING_KEY = 'community-pending.json';

// ---- blob helpers ----

async function readBlob(key, fallback) {
  try {
    const { blobs } = await list({ prefix: key });
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

async function writeBlob(key, data) {
  // Write first, then prune older versions — so a failed prune can't lose data.
  //
  // No addRandomSuffix: it inserts the suffix before the extension
  // ("community-pending.json" -> "community-pending-XyZ123.json"), which the
  // exact-pathname prefix in readBlob would never match, so every read would
  // silently fall through to the default. Writing to the fixed pathname needs
  // allowOverwrite, since we deliberately put before pruning.
  await put(key, JSON.stringify(data, null, 2), {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
  });
  try {
    // Prune on the extension-less base ("community-pending"), not the exact
    // key, so this also sweeps up any suffixed strays — reads only ever look
    // at the exact pathname, so anything else is dead weight.
    const base = key.replace(/\.json$/, '');
    const { blobs } = await list({ prefix: base });
    for (const b of blobs) {
      if (b.pathname !== key) await del(b.url);
    }
  } catch (e) {
    // Failing to prune is harmless — reads target the exact pathname.
  }
}

// places.json is seeded on first read so the map isn't empty on a fresh deploy.
export const readPlaces = () => readBlob(PLACES_KEY, SEED_PLACES);
export const writePlaces = (data) => writeBlob(PLACES_KEY, data);
export const readPending = () => readBlob(PENDING_KEY, []);
export const writePending = (data) => writeBlob(PENDING_KEY, data);

// ---- admin auth ----

// No fallback password: if COMMUNITY_ADMIN_PASS is unset the admin endpoints
// stay shut rather than accepting a value baked into the repo.
export function requireAdmin(req, res) {
  const expected = process.env.COMMUNITY_ADMIN_PASS;
  if (!expected) {
    res.status(503).json({ error: 'admin disabled: COMMUNITY_ADMIN_PASS is not set' });
    return false;
  }

  const given = req.headers['x-admin-pass'] || '';
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);

  if (!ok) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
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
