// Vercel serverless function — stores wall entries in the blob store
// Uses a simple JSON file approach via Vercel KV-like pattern
// For simplicity, we use jsonblob as backend but proxy through this to avoid CORS

const BLOB_URL = 'https://jsonblob.com/api/jsonBlob/019cbe7f-bfe6-77bf-9e60-d2f0c5aabdba';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const response = await fetch(BLOB_URL);
      const data = await response.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: 'failed to fetch wall' });
    }
  }

  if (req.method === 'POST') {
    try {
      // Get current entries
      const current = await fetch(BLOB_URL);
      const data = await current.json();
      const entries = data.entries || [];

      // Validate input
      const { name, archetype } = req.body;
      if (!name || !archetype || typeof name !== 'string' || typeof archetype !== 'string') {
        return res.status(400).json({ error: 'name and archetype required' });
      }
      if (name.length > 40 || archetype.length > 100) {
        return res.status(400).json({ error: 'input too long' });
      }

      // Sanitize
      const clean = (s) => s.replace(/[<>&"']/g, '');

      const now = new Date();
      entries.push({
        name: clean(name),
        archetype: clean(archetype),
        date: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        ts: now.getTime()
      });

      // Cap at 200 entries
      const trimmed = entries.slice(-200);

      // Save back
      await fetch(BLOB_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: trimmed })
      });

      return res.status(200).json({ ok: true, count: trimmed.length });
    } catch (e) {
      return res.status(500).json({ error: 'failed to save' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
