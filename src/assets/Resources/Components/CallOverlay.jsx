import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant } from '@livekit/components-react';
import { FaPhone, FaPhoneSlash, FaMicrophone, FaMicrophoneSlash, FaSpinner } from 'react-icons/fa';
import Avatar from './Avatar';
import { getLiveKitToken } from '../../services/callService';

/**
 * CallOverlay — UI de llamada de voz (LiveKit Cloud).
 *
 * Estados:
 *  - ringing + role=caller : "Llamando..." + botón colgar
 *  - ringing + role=callee : "te está llamando" + aceptar/rechazar
 *  - connecting            : pidiendo token a /api/livekit-token
 *  - active                : LiveKitRoom con audio, mute, timer y colgar
 *
 * Props:
 *  - call    : fila de la tabla `calls`
 *  - role    : 'caller' | 'callee'
 *  - peer    : perfil del otro usuario (avatar/nombre)
 *  - status  : 'ringing' | 'active' | 'ended' | 'missed' | 'declined'
 *  - onAccept, onDecline, onClose
 */
export default function CallOverlay({ call, role, peer, status, onAccept, onDecline, onClose, t }) {
  const [conn, setConn] = useState(null); // { token, url }
  const [tokenError, setTokenError] = useState(false);

  // ── Al pasar a 'active', pedir el token de LiveKit ──
  useEffect(() => {
    if (status !== 'active' || conn || !call?.room_name) return;
    let cancelled = false;
    setTokenError(false);
    getLiveKitToken(call.room_name)
      .then((data) => { if (!cancelled) setConn(data); })
      .catch(() => { if (!cancelled) setTokenError(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, call?.room_name]);

  const displayName = peer?.displayname || peer?.username || '…';
  const isRinging = status === 'ringing';

  return createPortal(
    <div className="chat-call-overlay">
      {conn ? (
        <LiveKitRoom
          serverUrl={conn.url}
          token={conn.token}
          connect={true}
          audio={true}
          options={{ adaptiveStream: true, dynacast: true }}
          onDisconnected={onClose}
          style={{ height: '100%', width: '100%' }}
        >
          <RoomAudioRenderer />
          <CallActiveControls peer={peer} onClose={onClose} t={t} />
        </LiveKitRoom>
      ) : (
        <div className="chat-call-card">
          <div className={`chat-call-avatar-wrap${isRinging ? ' chat-call-avatar-wrap--ringing' : ''}`}>
            <Avatar src={peer?.avatar_url} alt={displayName} className="chat-call-avatar" />
          </div>
          <span className="chat-call-name">{displayName}</span>
          <span className="chat-call-status">
            {status === 'active' && !conn && !tokenError && (
              <>
                <FaSpinner className="chat-call-spin" /> {t('chat.call_connecting') || 'Connecting…'}
              </>
            )}
            {tokenError && (t('chat.call_error') || 'Could not start the call')}
            {isRinging && role === 'caller' && (t('chat.call_calling') || 'Calling…')}
            {isRinging && role === 'callee' && (t('chat.call_incoming') || 'Incoming call…')}
            {status === 'ended' && (t('chat.call_ended') || 'Call ended')}
            {status === 'missed' && (t('chat.call_missed') || 'Missed call')}
            {status === 'declined' && (t('chat.call_declined') || 'Call declined')}
          </span>

          {isRinging && role === 'caller' && (
            <button className="chat-call-btn chat-call-btn--end chat-call-btn--big" onClick={onClose} title={t('chat.call_hangup') || 'Hang up'}>
              <FaPhoneSlash />
            </button>
          )}

          {isRinging && role === 'callee' && (
            <div className="chat-call-actions">
              <button
                className="chat-call-btn chat-call-btn--decline chat-call-btn--big"
                onClick={onDecline}
                title={t('chat.call_decline') || 'Decline'}
              >
                <FaPhoneSlash />
              </button>
              <button
                className="chat-call-btn chat-call-btn--accept chat-call-btn--big"
                onClick={onAccept}
                title={t('chat.call_accept') || 'Accept'}
              >
                <FaPhone />
              </button>
            </div>
          )}

          {status === 'active' && !conn && !tokenError && (
            <button className="chat-call-btn chat-call-btn--end chat-call-btn--big" onClick={onClose} title={t('chat.call_hangup') || 'Hang up'}>
              <FaPhoneSlash />
            </button>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}

// ── Controles de la sala activa — usa useLocalParticipant dentro del LiveKitRoom ──
function CallActiveControls({ peer, onClose, t }) {
  const { localParticipant } = useLocalParticipant();
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // Timer del transcurso de la llamada
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const format = (total) => {
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const displayName = peer?.displayname || peer?.username || '…';

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localParticipant?.setMicrophoneEnabled(!next).catch(() => {});
  };

  return (
    <div className="chat-call-card chat-call-card--active">
      <div className="chat-call-avatar-wrap">
        <Avatar src={peer?.avatar_url} alt={displayName} className="chat-call-avatar" />
      </div>
      <span className="chat-call-name">{displayName}</span>
      <span className="chat-call-timer">{format(seconds)}</span>
      <div className="chat-call-actions">
        <button
          className={`chat-call-btn chat-call-btn--mute${muted ? ' chat-call-btn--active' : ''}`}
          onClick={toggleMute}
          title={muted ? (t('chat.call_unmute') || 'Unmute') : (t('chat.call_mute') || 'Mute')}
        >
          {muted ? <FaMicrophoneSlash /> : <FaMicrophone />}
        </button>
        <button className="chat-call-btn chat-call-btn--end chat-call-btn--big" onClick={onClose} title={t('chat.call_hangup') || 'Hang up'}>
          <FaPhoneSlash />
        </button>
      </div>
    </div>
  );
}
