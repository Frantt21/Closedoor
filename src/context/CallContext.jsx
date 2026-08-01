import React, { createContext, useState, useEffect, useCallback, useRef, useContext } from 'react';
import { supabase } from '../assets/services/supabaseclient';
import { startCall as apiStartCall, updateCallStatus, subscribeToCalls } from '../assets/services/callService';
import CallOverlay from '../assets/Resources/Components/CallOverlay';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../assets/services/i18n/useI18n';

/**
 * CallContext — Proveedor GLOBAL de llamadas de voz (LiveKit).
 *
 * Antes, la suscripción a eventos de llamadas vivía dentro de Chat.jsx,
 * por lo que el ring entrante SOLO llegaba si el callee estaba en /Chat.
 * Al moverla aquí (nivel App), el ring llega estando el usuario en
 * CUALQUIER ruta (Home, perfil, notificaciones, etc.), como una app
 * de mensajería real.
 *
 * Estado global:
 *  - callSession : la llamada en la que participo ({ call, role, status })
 *  - incomingCall: llamada entrante en ringing ({ ...call, caller_profile })
 *
 * Expone: startCall, acceptCall, declineCall, endCall, callSession, incomingCall
 */
const CallContext = createContext(null);

/** Hook de acceso al contexto de llamadas. */
export function useCall() {
  return useContext(CallContext) || {};
}

/** Helper: fetchea un perfil mínimo para el overlay. */
function fetchPeerProfile(userId) {
  if (!userId) return Promise.resolve(null);
  return supabase
    .from('profiles')
    .select('id, username, displayname, avatar_url')
    .eq('id', userId)
    .maybeSingle()
    .then(({ data }) => data)
    .catch(() => null);
}

export function CallProvider({ children }) {
  const { user } = useAuth();
  const { t } = useI18n();

  const [callSession, setCallSession] = useState(null); // { call, role, status }
  const [incomingCall, setIncomingCall] = useState(null); // fila de calls entrante

  const callSessionRef = useRef(null);
  useEffect(() => { callSessionRef.current = callSession; }, [callSession]);
  const incomingCallRef = useRef(null);
  useEffect(() => { incomingCallRef.current = incomingCall; }, [incomingCall]);

  // ── Iniciar una llamada (caller) ──
  const handleStartCall = useCallback(async (conversationId, calleeId) => {
    console.log('[CALL] CallProvider.handleStartCall', { me: user?.id, conversationId, calleeId });
    if (!user?.id || !conversationId || !calleeId) return null;
    if (callSessionRef.current || incomingCallRef.current) {
      console.log('[CALL] startCall blocked — already in a call', { callSession: callSessionRef.current, incomingCall: incomingCallRef.current });
      return null;
    }
    try {
      const call = await apiStartCall(conversationId, user.id, calleeId);
      // Precargar el perfil del callee para el overlay del caller
      const calleeProfile = await fetchPeerProfile(calleeId);
      console.log('[CALL] startCall ok → set callSession', call.id, call.room_name);
      setCallSession({ call: { ...call, callee_profile: calleeProfile }, role: 'caller', status: 'ringing' });
      return call;
    } catch (err) {
      console.warn('[CALL] Error starting call:', err);
      throw err;
    }
  }, [user?.id]);

  // ── Aceptar (callee) ──
  const handleAcceptCall = useCallback(async () => {
    const call = incomingCallRef.current;
    console.log('[CALL] acceptCall', call?.id);
    if (!call) return;
    try {
      await updateCallStatus(call.id, 'active');
      setCallSession({ call, role: 'callee', status: 'active' });
    } catch (err) {
      console.warn('[CALL] Error accepting call:', err);
    } finally {
      setIncomingCall(null);
    }
  }, []);

  // ── Rechazar (callee) ──
  const handleDeclineCall = useCallback(async () => {
    const call = incomingCallRef.current;
    console.log('[CALL] declineCall', call?.id);
    if (!call) return;
    try {
      await updateCallStatus(call.id, 'declined');
    } catch (err) {
      console.warn('[CALL] Error declining call:', err);
    }
    setIncomingCall(null);
  }, []);

  // ── Colgar (ambos) ──
  const handleEndCall = useCallback(() => {
    const session = callSessionRef.current;
    console.log('[CALL] endCall', session?.call?.id);
    if (session) {
      updateCallStatus(session.call.id, 'ended').catch(() => {});
    }
    setCallSession(null);
    setIncomingCall(null);
  }, []);

  // ── Sanity check: verificar que RLS permite leer las llamadas del usuario ──
  // Realtime solo entrega eventos si el callee puede SELECT sobre la fila nueva.
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('calls')
      .select('id, status, caller_id, callee_id')
      .eq('callee_id', user.id)
      .limit(5)
      .then(({ data, error }) => {
        console.log('[CALL] RLS sanity check (select calls where callee=me):', { data, error });
      });
  }, [user?.id]);

  // ── Suscripción GLOBAL a eventos de llamadas ──
  useEffect(() => {
    if (!user?.id) return;
    console.log('[CALL] CallProvider subscribing (global) for user', user.id);
    const unsub = subscribeToCalls(user.id, (call, eventType) => {
      console.log('[CALL] CallProvider event', { eventType, callId: call.id, status: call.status, caller: call.caller_id, callee: call.callee_id, me: user.id });
      // Ring entrante: soy el callee y la llamada está en ringing
      if (eventType === 'INSERT' && call.status === 'ringing' && call.callee_id === user.id) {
        if (callSessionRef.current) {
          // Ya en una llamada → rechazar automáticamente
          console.log('[CALL] incoming ring auto-declined (already in a call)');
          updateCallStatus(call.id, 'declined').catch(() => {});
          return;
        }
        fetchPeerProfile(call.caller_id).then((callerProfile) => {
          console.log('[CALL] setting incomingCall', call.id, 'caller_profile:', callerProfile?.username);
          setIncomingCall({ ...call, caller_profile: callerProfile });
        }).catch(() => setIncomingCall(call));
        return;
      }
      // Cambios en la llamada actual (aceptada/colgada por el otro lado)
      const cur = callSessionRef.current;
      if (cur && cur.call.id === call.id) {
        console.log('[CALL] status change on my active call', cur.status, '→', call.status);
        if (call.status === 'active' && cur.status !== 'active') {
          setCallSession({ ...cur, status: 'active' });
        } else if (['ended', 'missed', 'declined'].includes(call.status) && cur.status !== call.status) {
          setCallSession({ ...cur, status: call.status });
          setTimeout(() => setCallSession(null), 1200);
        }
      }
      // Si la llamada entrante terminó (el caller colgó antes de contestar)
      const inc = incomingCallRef.current;
      if (inc && inc.id === call.id && ['ended', 'missed', 'declined'].includes(call.status)) {
        console.log('[CALL] clearing incomingCall (call ended/declined/missed)');
        setIncomingCall(null);
      }
    });
    return () => {
      console.log('[CALL] CallProvider unsubscribing');
      unsub?.unsubscribe();
    };
  }, [user?.id]);

  // ── Timeout: el caller cuelga automáticamente tras 30s de ring sin respuesta ──
  useEffect(() => {
    if (!callSession || callSession.role !== 'caller' || callSession.status !== 'ringing') return;
    const t = setTimeout(() => {
      const cur = callSessionRef.current;
      if (cur && cur.role === 'caller' && cur.status === 'ringing') {
        updateCallStatus(cur.call.id, 'missed').catch(() => {});
        setCallSession(null);
      }
    }, 30000);
    return () => clearTimeout(t);
  }, [callSession?.call?.id, callSession?.role, callSession?.status]);

  return (
    <CallContext.Provider value={{
      callSession,
      incomingCall,
      startCall: handleStartCall,
      acceptCall: handleAcceptCall,
      declineCall: handleDeclineCall,
      endCall: handleEndCall,
    }}>
      {children}

      {/* ── Overlay global de llamadas (portal a document.body) ── */}
      {incomingCall && !callSession && (
        <CallOverlay
          call={incomingCall}
          role="callee"
          peer={incomingCall.caller_profile || null}
          status="ringing"
          onAccept={handleAcceptCall}
          onDecline={handleDeclineCall}
          onClose={handleDeclineCall}
          t={t}
        />
      )}
      {callSession && (
        <CallOverlay
          call={callSession.call}
          role={callSession.role}
          peer={callSession.role === 'caller' ? (callSession.call.callee_profile || null) : (callSession.call.caller_profile || null)}
          status={callSession.status}
          onAccept={handleAcceptCall}
          onDecline={handleDeclineCall}
          onClose={handleEndCall}
          t={t}
        />
      )}
    </CallContext.Provider>
  );
}
