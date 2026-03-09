// Vercel serverless function — wall entries proxied through jsonblob
// Pings the blob weekly to prevent expiry

const BLOB_URL = 'https://jsonblob.com/api/jsonBlob/019ccfe8-62ea-77c6-9365-621dbecdbdf8';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

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
      const current = await fetch(BLOB_URL);
      const data = await current.json();
      const entries = data.entries || [];

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

      const trimmed = entries.slice(-500);

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
