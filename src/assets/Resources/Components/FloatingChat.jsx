import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { FaCommentDots, FaTimes, FaChevronLeft, FaPaperPlane, FaExpand, FaSpinner, FaComments } from 'react-icons/fa';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';
import { NotificationContext } from '../../../context/NotificationContext';
import { getSessionItem, setSessionItem } from '../../services/secureStorage';
import {
  getConversations,
  getMessages,
  decryptMessage,
  subscribeToMessages,
  sendMessage,
  markAsRead,
} from '../../services/chatService';
import { detectMediaFromContent, getTimeAgo } from '../../services/helpers';
import Avatar from './Avatar';
import './css/floatingChat.css';

const HIDDEN_ROUTES = ['/chat', '/login', '/register', '/auth/callback'];

function convCacheKey(userId) {
  return `chatConvsCache_${userId}`;
}

function readCachedConvs(userId) {
  if (!userId) return [];
  try {
    const cached = getSessionItem(convCacheKey(userId));
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

function peerName(conv) {
  return conv?.otherUser?.displayname || conv?.otherUser?.username || '…';
}

/**
 * FloatingChat — lanzador de chats recientes + ventana de chat flotante.
 *
 * - Abajo a la derecha (encima de la barra móvil): burbuja con el contador de
 *   no leídos y, apilados, los avatares de las conversaciones más recientes
 *   (estilo Instagram/Facebook). Al pulsar uno se abre ese chat al instante.
 * - La ventana NO saca al usuario de la página: lista de conversaciones y
 *   conversación completa (leer/enviar) con realtime, cifrado por usuario y
 *   markAsRead, igual que Chat.jsx pero en miniatura.
 * - Se oculta en /Chat (ahí ya está el chat completo) y en rutas de auth.
 * - Los datos de la lista salen del caché de sesión que mantiene
 *   NotificationContext; el fetch real sólo ocurre al abrir o al llegar un
 *   mensaje nuevo con la ventana abierta.
 */
export default function FloatingChat() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const notif = useContext(NotificationContext);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'thread'
  const [activeId, setActiveId] = useState(null);
  const [convs, setConvs] = useState(() => readCachedConvs(user?.id));
  const [listLoaded, setListLoaded] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const threadRef = useRef(null);
  const activeIdRef = useRef(null);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const userId = user?.id;
  const refreshVersion = notif.conversationRefreshVersion || 0;
  const unreadTotal = notif.unreadChatCount || 0;

  const route = String(pathname || '').toLowerCase();
  const hidden = !userId || HIDDEN_ROUTES.some((r) => route === r || route.startsWith(`${r}/`));

  const activeConv = useMemo(() => convs.find((c) => c.id === activeId) || null, [convs, activeId]);
  const recent = useMemo(() => convs.slice(0, 3), [convs]);

  // ── Al tener usuario (login/restauración de sesión), hidratar los recientes
  // desde el caché de sesión. Se hace en microtask para no encadenar renders
  // síncronos dentro del efecto. ──
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const cached = readCachedConvs(userId);
      if (cached.length) setConvs((prev) => (prev.length ? prev : cached));
    });
    return () => { cancelled = true; };
  }, [userId]);

  const loadConvs = useCallback(async () => {
    if (!userId) return;
    try {
      const list = await getConversations(userId);
      setConvs(list);
      setListLoaded(true);
      try { setSessionItem(convCacheKey(userId), list); } catch { /* quota */ }
    } catch (err) {
      console.warn('[FloatingChat] load conversations failed:', err);
      setListLoaded(true);
    }
  }, [userId]);

  // ── Con el panel abierto, refrescar la lista real al abrir o al llegar un
  // mensaje nuevo (NotificationContext sube conversationRefreshVersion) ──
  useEffect(() => {
    if (!userId || !open) return undefined;
    let cancelled = false;
    // Diferido un tick: el fetch es asíncrono y así no se encadena un render
    // síncrono dentro del propio efecto (regla set-state-in-effect).
    Promise.resolve().then(() => {
      if (!cancelled) loadConvs();
    });
    return () => { cancelled = true; };
  }, [userId, open, refreshVersion, loadConvs]);

  const loadThread = useCallback(async (convId) => {
    if (!convId || !userId) return;
    setLoadingThread(true);
    try {
      const raw = await getMessages(convId, 40);
      const visible = raw.filter((m) => !m.deleted_for?.includes(userId));
      const decrypted = await Promise.all(visible.map(async (m) => ({
        ...m,
        decryptedContent: await decryptMessage(m, userId),
      })));
      if (activeIdRef.current !== convId) return;
      setMessages(decrypted);
      markAsRead(convId, userId).catch(() => {});
      notif.refreshChatUnread?.();
      setConvs((prev) => prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c)));
    } catch (err) {
      console.warn('[FloatingChat] load messages failed:', err);
    } finally {
      setLoadingThread(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const openThread = useCallback((conv) => {
    if (!conv?.id) return;
    setOpen(true);
    setView('thread');
    setActiveId(conv.id);
    setMessages([]);
    setInput('');
    loadThread(conv.id);
  }, [loadThread]);

  // ── Abrir/cerrar panel (el fetch de la lista lo dispara el efecto de arriba) ──
  const toggleOpen = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    setView('list');
    setActiveId(null);
    setOpen(true);
    notif.refreshChatUnread?.();
  }, [open, notif]);

  // ── Realtime de la conversación abierta ──
  useEffect(() => {
    if (!open || view !== 'thread' || !activeId || !userId) return;
    const channel = subscribeToMessages(
      activeId,
      async (msg, eventType) => {
        if (activeIdRef.current !== activeId) return;
        const content = await decryptMessage(msg, userId);
        if (eventType === 'UPDATE') {
          setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg, decryptedContent: content } : m)));
          return;
        }
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, { ...msg, decryptedContent: content }];
        });
        if (msg.sender_id !== userId) markAsRead(activeId, userId).catch(() => {});
      },
      (deletedId) => setMessages((prev) => prev.filter((m) => m.id !== deletedId))
    );
    return () => {
      try { channel?.unsubscribe(); } catch { /* ya cerrado */ }
    };
  }, [open, view, activeId, userId]);

  // ── Scroll al final al llegar/abrir mensajes ──
  useEffect(() => {
    if (!open || view !== 'thread') return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, view, loadingThread]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !activeId || !userId || sending || !activeConv?.otherUser?.id) return;
    const tempId = crypto.randomUUID();
    const optimistic = {
      id: tempId,
      conversation_id: activeId,
      sender_id: userId,
      decryptedContent: text,
      created_at: new Date().toISOString(),
      _optimistic: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    setSending(true);
    try {
      const sent = await sendMessage(activeId, userId, text, [activeConv.otherUser.id]);
      // El INSERT de realtime puede llegar antes que esta respuesta: se quita
      // el mensaje optimista y no se duplica el que ya esté en la lista.
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        if (withoutTemp.some((m) => m.id === sent.id)) return withoutTemp;
        return [...withoutTemp, { ...sent, decryptedContent: text }];
      });
      const preview = text.length > 80 ? `${text.slice(0, 80)}...` : text;
      setConvs((prev) => prev
        .map((c) => (c.id === activeId ? { ...c, last_message_text: preview, last_message_at: sent.created_at || new Date().toISOString() } : c)));
    } catch (err) {
      console.warn('[FloatingChat] send failed:', err);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [input, activeId, userId, sending, activeConv]);

  if (hidden) return null;

  const goFullChat = () => {
    setOpen(false);
    navigate('/Chat');
  };

  const renderBubbleContent = (content) => {
    if (!content) return null;
    const { imageUrl } = detectMediaFromContent(content) || {};
    if (imageUrl) {
      const rest = content.replace(imageUrl, '').trim();
      return (
        <>
          <img className="fc-msg-img" src={imageUrl} alt="" loading="lazy" />
          {rest ? <span>{rest}</span> : null}
        </>
      );
    }
    return <span>{content}</span>;
  };

  return createPortal(
    <div className={`fc-dock${open ? ' fc-dock--open' : ''}`}>
      {/* ── Ventana flotante ── */}
      {open && (
        <div className="fc-panel" role="dialog" aria-label={t('chat.title') || 'Chat'}>
          <div
            className="fc-panel-header"
            style={{ '--fc-user-accent': activeConv?.otherUser?.accent_color || undefined }}
          >
            {view === 'thread' ? (
              <>
                <button
                  type="button"
                  className="fc-panel-icon-btn"
                  onClick={() => { setView('list'); setActiveId(null); }}
                  title={t('chat.dock_back') || 'Back'}
                >
                  <FaChevronLeft />
                </button>
                <Avatar
                  src={activeConv?.otherUser?.avatar_url}
                  alt={peerName(activeConv)}
                  className="fc-panel-peer-avatar"
                  userId={activeConv?.otherUser?.id}
                />
                <div className="fc-panel-peer">
                  <span className="fc-panel-peer-name">{peerName(activeConv)}</span>
                  {activeConv?.otherUser?.username && (
                    <span className="fc-panel-peer-handle">@{activeConv.otherUser.username}</span>
                  )}
                </div>
              </>
            ) : (
              <>
                <span className="fc-panel-icon-static"><FaComments /></span>
                <span className="fc-panel-title">{t('chat.title') || 'Chat'}</span>
              </>
            )}
            <div className="fc-panel-header-actions">
              <button
                type="button"
                className="fc-panel-icon-btn"
                onClick={goFullChat}
                title={t('chat.dock_open_full') || 'Open in Chat'}
              >
                <FaExpand />
              </button>
              <button
                type="button"
                className="fc-panel-icon-btn"
                onClick={() => setOpen(false)}
                title={t('chat.dock_close') || 'Close'}
              >
                <FaTimes />
              </button>
            </div>
          </div>

          {view === 'list' ? (
            <div className="fc-list" ref={listRef}>
              {!listLoaded && convs.length === 0 ? (
                <div className="fc-list-state"><FaSpinner className="fc-spin" /></div>
              ) : convs.length === 0 ? (
                <div className="fc-list-state">
                  <p className="fc-list-state-title">{t('chat.empty') || 'No conversations yet'}</p>
                  <p className="fc-list-state-sub">{t('chat.empty_sub') || ''}</p>
                </div>
              ) : (
                convs.map((conv) => (
                  <button
                    type="button"
                    key={conv.id}
                    className="fc-item"
                    style={{ '--fc-user-accent': conv.otherUser?.accent_color || undefined }}
                    onClick={() => openThread(conv)}
                  >
                    <Avatar
                      src={conv.otherUser?.avatar_url}
                      alt={peerName(conv)}
                      className="fc-item-avatar"
                      userId={conv.otherUser?.id}
                    />
                    <div className="fc-item-body">
                      <span className="fc-item-top">
                        <span className="fc-item-name">{peerName(conv)}</span>
                        <span className="fc-item-time">
                          {getTimeAgo(t, locale, conv.last_message_at || conv.updated_at)}
                        </span>
                      </span>
                      <span className="fc-item-preview">{conv.last_message_text || ''}</span>
                    </div>
                    {conv.unreadCount > 0 && (
                      <span className="fc-item-unread">{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="fc-thread" ref={threadRef}>
                {loadingThread && messages.length === 0 ? (
                  <div className="fc-list-state"><FaSpinner className="fc-spin" /></div>
                ) : messages.length === 0 ? (
                  <div className="fc-list-state">
                    <p className="fc-list-state-sub">{t('chat.no_messages') || 'No messages yet'}</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const own = msg.sender_id === userId;
                    return (
                      <div
                        key={msg.id}
                        className={`fc-msg${own ? ' fc-msg--own' : ''}${msg._optimistic ? ' fc-msg--pending' : ''}`}
                      >
                        <div className="fc-msg-bubble">{renderBubbleContent(msg.decryptedContent)}</div>
                        <span className="fc-msg-time">{getTimeAgo(t, locale, msg.created_at)}</span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="fc-compose">
                <textarea
                  className="fc-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={t('chat.input_placeholder') || 'Write a message...'}
                  rows={1}
                  maxLength={2000}
                />
                <button
                  type="button"
                  className="fc-send"
                  onClick={send}
                  disabled={!input.trim() || sending}
                  title={t('chat.dock_send') || 'Send'}
                >
                  {sending ? <FaSpinner className="fc-spin" /> : <FaPaperPlane />}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Lanzador + chats recientes ── */}
      {!open && recent.length > 0 && (
        <div className="fc-dock-recents">
          {recent.map((conv) => (
            <button
              type="button"
              key={conv.id}
              className="fc-dock-recent"
              style={{ '--fc-user-accent': conv.otherUser?.accent_color || undefined }}
              onClick={() => openThread(conv)}
              title={peerName(conv)}
            >
              <Avatar
                src={conv.otherUser?.avatar_url}
                alt={peerName(conv)}
                className="fc-dock-recent-avatar"
                userId={conv.otherUser?.id}
              />
              {conv.unreadCount > 0 && (
                <span className="fc-dock-recent-badge">{conv.unreadCount > 9 ? '9+' : conv.unreadCount}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className="fc-dock-launcher"
        onClick={toggleOpen}
        title={open ? (t('chat.dock_close') || 'Close') : (t('chat.title') || 'Chat')}
        aria-expanded={open}
      >
        {open ? <FaTimes /> : <FaCommentDots />}
        {!open && unreadTotal > 0 && (
          <span className="fc-dock-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
        )}
      </button>
    </div>,
    document.body
  );
}
