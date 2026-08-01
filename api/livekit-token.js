/**
 * Vercel serverless function that issues a LiveKit access token for a voice call.
 *
 * POST /api/livekit-token
 * Body:  { room }            — LiveKit room name (call-{id})
 * Auth:  Authorization: Bearer <supabase-access-token>
 *
 * Verifica que el usuario autenticado sea participante de la conversación
 * asociada a la llamada, y devuelve un AccessToken JWT firmado con la API
 * secret de LiveKit. La lógica vive en api/_livekit.js (compartida con
 * server.js y el plugin de dev de Vite).
 *
 * Returns: { success: true, token, url }
 */
import { issueLiveKitToken } from './_livekit.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  const result = await issueLiveKitToken({
    supabaseUrl,
    supabaseKey,
    livekitUrl: LIVEKIT_URL,
    livekitApiKey: LIVEKIT_API_KEY,
    livekitApiSecret: LIVEKIT_API_SECRET,
    accessToken,
    room: req.body?.room,
  });

  if (result.ok) {
    res.status(200).json({ success: true, token: result.token, url: result.url });
  } else {
    res.status(result.status).json({ success: false, error: result.error });
  }
}
