// Vercel serverless function — wall entries stored in Vercel Blob Storage
// No expiry, no third-party dependency, persistent

import { put, list } from '@vercel/blob';

const BLOB_KEY = 'wall/entries.json';

async function getEntries() {
  try {
    const { blobs } = await list({ prefix: 'wall/' });
    const match = blobs.find(b => b.pathname === BLOB_KEY);
    if (!match) return [];
    const res = await fetch(match.url);
    const data = await res.json();
    return data.entries || [];
  } catch (e) {
    return [];
  }
}

async function saveEntries(entries) {
  await put(BLOB_KEY, JSON.stringify({ entries }), {
    access: 'public',
    addRandomSuffix: false,
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const entries = await getEntries();
      return res.status(200).json({ entries });
    } catch (e) {
      return res.status(500).json({ error: 'failed to fetch wall' });
    }
  }

  if (req.method === 'POST') {
    try {
      const entries = await getEntries();

      const { name, archetype } = req.body;
      if (!name || !archetype || typeof name !== 'string' || typeof archetype !== 'string') {
        return res.status(400).json({ error: 'name and archetype required' });
      }
      if (name.length > 40 || archetype.length > 100) {
        return res.status(400).json({ error: 'input too long' });
      }

      const clean = (s) => s.replace(/[<>&"']/g, '');

      const now = new Date();
      entries.push({
        name: clean(name),
        archetype: clean(archetype),
        date: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        ts: now.getTime()
      });

      // Cap at 500 entries
      const trimmed = entries.slice(-500);
      await saveEntries(trimmed);

      return res.status(200).json({ ok: true, count: trimmed.length });
    } catch (e) {
      return res.status(500).json({ error: 'failed to save' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
