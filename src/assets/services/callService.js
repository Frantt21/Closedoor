import { supabase } from './supabaseclient';

/**
 * callService — Coordinación de llamadas de voz (LiveKit Cloud).
 *
 * La tabla `calls` guarda el estado del ring y el historial. El media
 * y el signaling los maneja LiveKit Cloud: el cliente obtiene un
 * AccessToken desde /api/livekit-token y se une a la sala room_name.
 *
 * Flujo:
 *  - caller:  startCall() → status 'ringing'
 *  - callee:  recibe el INSERT por Realtime → decide aceptar/rechazar
 *  - accept:  updateCallStatus(id, 'active') → ambos piden token y entran
 *  - fin:     updateCallStatus(id, 'ended' | 'missed' | 'declined')
 */

/**
 * Crear una llamada (status 'ringing').
 * @param {string} conversationId
 * @param {string} callerId
 * @param {string} calleeId
 * @returns {Promise<object>} la fila de calls creada
 */
export async function startCall(conversationId, callerId, calleeId) {
  if (!conversationId || !callerId || !calleeId) {
    throw new Error('Missing call parameters');
  }

  const callId = crypto.randomUUID();
  const roomName = `call-${callId}`;

  console.log('[CALL] startCall insert', { conversationId, callerId, calleeId, roomName });
  const { data, error } = await supabase
    .from('calls')
    .insert({
      id: callId,
      conversation_id: conversationId,
      caller_id: callerId,
      callee_id: calleeId,
      room_name: roomName,
      status: 'ringing',
    })
    .select()
    .single();

  console.log('[CALL] startCall result', { data, error });
  if (error) throw error;
  return data;
}

/**
 * Actualizar el estado de una llamada.
 * @param {string} callId
 * @param {'ringing'|'active'|'ended'|'missed'|'declined'} status
 */
export async function updateCallStatus(callId, status) {
  console.log('[CALL] updateCallStatus', { callId, status });
  const patch = { status };
  if (status === 'active') {
    patch.started_at = new Date().toISOString();
  }
  if (status === 'ended' || status === 'missed' || status === 'declined') {
    patch.ended_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('calls')
    .update(patch)
    .eq('id', callId);

  if (error) throw error;
}

/**
 * Obtener una llamada por id.
 */
export async function getCall(callId) {
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .eq('id', callId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Suscribirse a eventos de llamadas del usuario (ring entrante + cambios de estado).
 * @param {string} userId
 * @param {(call: object, eventType: string) => void} onCall
 * @returns {() => void} unsubscribe
 */
export function subscribeToCalls(userId, onCall) {
  console.log('[CALL] subscribeToCalls', userId);
  const channel = supabase
    .channel(`calls-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'calls',
        // OR: soy el caller O el callee (comma = AND en Realtime, por eso or=)
        filter: `or=(caller_id.eq.${userId},callee_id.eq.${userId})`,
      },
      (payload) => {
        console.log('[CALL] payload received', { eventType: payload.eventType, newRow: payload.new, oldRow: payload.old });
        const call = payload.new || payload.old;
        if (call) onCall(call, payload.eventType);
      }
    );
  channel.subscribe((status, err) => {
    console.log('[CALL] channel status', status, err ? JSON.stringify(err) : '');
  });
  return channel;
}

/**
 * Obtener un AccessToken de LiveKit para una sala.
 * @param {string} room — room_name de la llamada
 * @returns {Promise<{token: string, url: string}>}
 */
export async function getLiveKitToken(room) {
  const { data: session } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const res = await fetch('/api/livekit-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ room }),
  });

  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Failed to get LiveKit token');
  }
  return { token: json.token, url: json.url };
}
