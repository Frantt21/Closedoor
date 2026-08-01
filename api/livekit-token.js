/**
 * Vercel serverless function that issues a LiveKit access token for a voice call.
 *
 * POST /api/livekit-token
 * Body:  { room }            — LiveKit room name (call-{id})
 * Auth:  Authorization: Bearer <supabase-access-token>
 *
 * Verifica que el usuario autenticado sea participante de la conversación
 * asociada a la llamada (via RLS en `calls` + is_conversation_participant),
 * y devuelve un AccessToken JWT firmado con la API secret de LiveKit.
 *
 * Returns: { success: true, token, url }
 */
import { createClient } from '@supabase/supabase-js';
import { AccessToken } from 'livekit-server-sdk';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  if (!supabase || !LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    res.status(500).json({ success: false, error: 'LiveKit not configured' });
    return;
  }

  // ── Auth: verificar sesión de Supabase ──
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!accessToken) {
    res.status(401).json({ success: false, error: 'Missing auth token' });
    return;
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    res.status(401).json({ success: false, error: 'Invalid session' });
    return;
  }

  // ── Body: room name ──
  const room = req.body?.room;
  if (!room || typeof room !== 'string') {
    res.status(400).json({ success: false, error: 'Missing room' });
    return;
  }

  // ── Verificar participación: la llamada pertenece a una conversación ──
  const { data: call, error: callError } = await supabase
    .from('calls')
    .select('conversation_id, status')
    .eq('room_name', room)
    .maybeSingle();

  if (callError || !call) {
    res.status(404).json({ success: false, error: 'Call not found' });
    return;
  }

  // Solo permitir token en llamadas activas o en ringing
  if (!['ringing', 'active'].includes(call.status)) {
    res.status(409).json({ success: false, error: 'Call is not active' });
    return;
  }

  const { data: isParticipant, error: partError } = await supabase
    .rpc('is_conversation_participant', { conv_id: call.conversation_id });

  if (partError || !isParticipant) {
    res.status(403).json({ success: false, error: 'Not a participant' });
    return;
  }

  // ── Emitir AccessToken de LiveKit ──
  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: user.id,
      ttl: '2h',
    });
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    res.status(200).json({ success: true, token, url: LIVEKIT_URL });
  } catch (err) {
    console.warn('[livekit-token] Token error:', err.message);
    res.status(500).json({ success: false, error: 'Token generation failed' });
  }
}
