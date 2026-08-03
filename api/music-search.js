/**
 * Vercel serverless function — proxy de búsqueda de música.
 *
 * Uso:  GET /api/music-search?q=radiohead&provider=deezer&limit=10
 *
 * Devuelve: JSON { success: true, provider, results: [...] }
 *           o JSON { success: false, error: "..." }
 *
 * Motivo: la API pública de Deezer no envía headers CORS, así que el navegador
 * no puede consultarla directamente; iTunes sí (se usa directo desde el
 * frontend) y este proxy sirve como fallback / para Deezer.
 */
import { searchMusicServer, resolveTrackPreview } from './_music.js';

export default async function handler(req, res) {
  // CORS (por si algún cliente externo la consume)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const provider = req.query?.provider === 'itunes' ? 'itunes' : 'deezer';

  // ── Modo track: resolver preview FRESCO (los de Deezer expiran) ──
  // Uso: GET /api/music-search?track=<id>&provider=deezer (no requiere ?q)
  const trackId = req.query?.track;
  if (trackId) {
    try {
      const previewUrl = await resolveTrackPreview(trackId, provider);
      res.status(200).json({ success: true, provider, previewUrl });
    } catch (err) {
      console.warn('[music-search]', err.message);
      res.status(502).json({ success: false, error: err.message });
    }
    return;
  }

  const q = (req.query?.q || '').trim();
  if (!q) {
    res.status(400).json({ success: false, error: 'Missing ?q parameter' });
    return;
  }

  try {
    const results = await searchMusicServer(q, provider, req.query?.limit);
    res.status(200).json({ success: true, provider, results });
  } catch (err) {
    console.warn('[music-search]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
}
