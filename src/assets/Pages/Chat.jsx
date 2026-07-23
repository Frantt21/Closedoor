import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../services/i18n/useI18n';
import {
  getConversations,
  getMessages,
  sendMessage,
  decryptMessage,
  markAsRead,
  getOrCreateConversation,
  deleteConversation,
  deleteMessage,
  deleteMessageForMe,
  editMessage,
  pinMessage,
  addReaction,
  subscribeToMessages,
  subscribeToConversations,
} from '../services/chatService';
import { searchProfiles } from '../services/userService';
import { getFollowing } from '../services/followService';
import { isBlocked, getCachedBlockStatus, cacheBlockStatus } from '../services/blockService';
import ModalShell from '../Resources/Components/ModalShell';
import { FaComment, FaSearch, FaPaperPlane, FaArrowLeft, FaPlus, FaTimes, FaUserPlus, FaUsers, FaTrash, FaThumbtack, FaCopy, FaEdit, FaCheck, FaSmile } from 'react-icons/fa';
import Avatar from '../Resources/Components/Avatar';
import Badge from '../Resources/Components/Badge';
import Tooltip from '../Resources/Components/Tooltip';
import { getTimeAgo } from '../services/helpers';
import { toast } from 'react-toastify';
import { supabase } from '../services/supabaseclient';
import usePageTitle from '../../hooks/usePageTitle';
import '../Resources/Styles/chat.css';

export default function Chat() {
  const { t, locale } = useI18n();
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  usePageTitle(t('chat.title'));

  // ── Redirect if not authenticated (wait for auth to finish loading) ──
  useEffect(() => {
    if (authLoading) return;
    if (!user) navigate('/Login?redirect=/Chat');
  }, [user, authLoading, navigate]);

  // ── State ──
  const [conversations, setConversations] = useState([]);
  const [convsLoading, setConvsLoading] = useState(true);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);

  // New conversation
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchingUser, setSearchingUser] = useState(false);
  const [showFollowersModal, setShowFollowersModal] = useState(false);
  const [followers, setFollowers] = useState([]);
  const [followersLoading, setFollowersLoading] = useState(false);

  // Mobile: show conversation list or messages
  const [showList, setShowList] = useState(true);

  // Context menu state (conversation list)
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0, convId: null });
  const contextMenuRef = useRef(null);

  // Message context menu state
  const [msgMenu, setMsgMenu] = useState({ open: false, x: 0, y: 0, msg: null });
  const msgMenuRef = useRef(null);

  // Edit message state
  const [editMsgId, setEditMsgId] = useState(null);
  const [editText, setEditText] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const editRef = useRef(null);
  // Preserve content during modal close animation (ref survives state clears)
  const editContentRef = useRef('');

  // Emoji picker state
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState(null);
  const emojiPickerRef = useRef(null);

  // Common emojis for reactions
  const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

  // Smart context menu positioning — flips if menu would overflow viewport
  const getSmartMenuPosition = useCallback((clientX, clientY, menuWidth = 180, menuHeight = 220) => {
    let x = clientX;
    let y = clientY;

    // Check right edge
    if (x + menuWidth > window.innerWidth) {
      x = clientX - menuWidth;
    }
    // Check bottom edge
    if (y + menuHeight > window.innerHeight) {
      y = clientY - menuHeight;
    }
    // Clamp to viewport
    x = Math.max(4, Math.min(x, window.innerWidth - menuWidth - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - menuHeight - 4));

    return { x, y };
  }, []);

  // Close context menus on click outside
  useEffect(() => {
    const handleClick = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu({ open: false, x: 0, y: 0, convId: null });
      }
      if (msgMenuRef.current && !msgMenuRef.current.contains(e.target)) {
        setMsgMenu({ open: false, x: 0, y: 0, msg: null });
      }
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setEmojiPickerMsgId(null);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Focus edit input when entering edit mode
  useEffect(() => {
    if (showEditModal && editMsgId && editRef.current) {
      editRef.current.focus();
      const len = editRef.current.value.length;
      editRef.current.setSelectionRange(len, len);
    }
  }, [showEditModal, editMsgId]);

  // Refs
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const messagesCacheRef = useRef({});
  const prevConvIdRef = useRef(null);

  // ── useLayoutEffect: runs BEFORE browser paint — garantiza que no haya flash de mensajes viejos ──
  useLayoutEffect(() => {
    if (!activeConvId) return;
    if (prevConvIdRef.current === activeConvId) return; // misma conversación, no hacer nada

    // Limpiar/restaurar mensajes inmediatamente ANTES del paint
    const cached = messagesCacheRef.current[activeConvId];
    if (cached) {
      setMessages(cached);
      setMsgsLoading(false);
    } else {
      setMessages([]);
      setMsgsLoading(true);
    }
    prevConvIdRef.current = activeConvId;
  }, [activeConvId]);

  // ── Load conversations ──
  const loadConvs = useCallback(async () => {
    if (!user?.id) return;
    try {
      const convs = await getConversations(user.id);
      setConversations(convs);
    } catch (err) {
      console.warn('Error loading conversations:', err);
    } finally {
      setConvsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadConvs();
  }, [loadConvs]);

  // Real-time subscription to conversation updates
  useEffect(() => {
    if (!user?.id) return;
    const unsub = subscribeToConversations(user.id, loadConvs);
    return () => unsub?.unsubscribe();
  }, [user?.id, loadConvs]);

  // ── Load messages when active conversation changes ──
  useEffect(() => {
    if (!activeConvId) return;

    markAsRead(activeConvId, user.id);

    const currentConv = activeConvId;
    getMessages(activeConvId)
      .then(async (msgs) => {
        // Guard: if the user switched conversation while loading, discard stale data
        if (currentConv !== activeConvId) return;
        // Filter out messages deleted for me
        const filtered = msgs.filter(m => !m.deleted_for?.includes(user.id));
        // Decrypt each message
        const decrypted = await Promise.all(
          filtered.map(async (msg) => {
            const content = await decryptMessage(msg, user.id);
            return { ...msg, decryptedContent: content };
          })
        );
        // Update cache
        messagesCacheRef.current[activeConvId] = decrypted;
        setMessages(decrypted);
      })
      .catch((err) => console.warn('Error loading messages:', err))
      .finally(() => setMsgsLoading(false));

    // Real-time subscription
    const unsub = subscribeToMessages(activeConvId, async (newMsg, eventType) => {
      const content = await decryptMessage(newMsg, user.id);
      if (eventType === 'UPDATE') {
        setMessages((prev) => prev.map((msg) => msg.id === newMsg.id ? { ...msg, ...newMsg, decryptedContent: content } : msg));        } else {
        setMessages((prev) => {
          // Evitar duplicados: si el mensaje ya fue agregado por el optimistic send
          const exists = prev.some(m => m.id === newMsg.id);
          if (exists) {
            return prev.map(m => m.id === newMsg.id ? { ...m, ...newMsg, decryptedContent: content } : m);
          }
          return [...prev, { ...newMsg, decryptedContent: content }];
        });
        // column-reverse: scroll to top (visual bottom) to show new message
        setTimeout(() => messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 50);
      }
      markAsRead(activeConvId, user.id);
    });

    return () => {
      unsub?.unsubscribe();
    };
  }, [activeConvId, user?.id]);

  // ── Debug: log flash when switching conversations ──
  useLayoutEffect(() => {
    if (!activeConvId) return;
    console.log('[CHAT FLASH DEBUG] useLayoutEffect fired for conv:', activeConvId, 'prevConvRef:', prevConvIdRef.current);
    const cached = messagesCacheRef.current[activeConvId];
    console.log('[CHAT FLASH DEBUG] Cache hit:', !!cached, '| cached msgs count:', cached?.length || 0);
    if (cached) {
      console.log('[CHAT FLASH DEBUG] Setting messages from cache:', cached.map(m => ({ id: m.id, text: (m.decryptedContent || '').slice(0, 20), sender: m.sender_id })));
    } else {
      console.log('[CHAT FLASH DEBUG] Setting messages to [] (no cache)');
    }
  });

  // Log on main message loading effect
  useEffect(() => {
    if (!activeConvId) return;
    console.log('[CHAT FLASH DEBUG] Main messages useEffect fired for conv:', activeConvId);
    console.trace('[CHAT FLASH DEBUG] Trace for main messages useEffect');
    const currentConv = activeConvId;
    const checkId = setInterval(() => {
      if (currentConv !== activeConvId) {
        console.log('[CHAT FLASH DEBUG] ⚠️ User switched conversation while messages were loading! currentConv:', currentConv, 'activeConvId:', activeConvId);
        clearInterval(checkId);
      }
    }, 50);
    // Clear after 2 seconds
    setTimeout(() => clearInterval(checkId), 2000);
  }, [activeConvId]);

  // Sync messages cache on every update (realtime, delete, edit, etc.)
  useEffect(() => {
    if (!activeConvId) return;
    messagesCacheRef.current[activeConvId] = messages;
  }, [messages, activeConvId]);

  // ── Select conversation ──
  const selectConversation = (convId) => {
    setActiveConvId(convId);
    setShowList(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const goBackToList = () => {
    setActiveConvId(null);
    setShowList(true);
  };

  // ── Send message (optimistic — no delay) ──
  const handleSend = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || !activeConvId || !user?.id || sending) return;

    // ── Block check: verificar que el otro usuario no esté bloqueado ──
    if (otherUser) {
      const cachedBlocked = getCachedBlockStatus(user.id, otherUser.id);
      if (cachedBlocked === true) {
        toast.error(t('chat.blocked_cannot_send'), { className: 'fc-toast' });
        return;
      }
      const cachedBlockedByThem = getCachedBlockStatus(otherUser.id, user.id);
      if (cachedBlockedByThem === true) {
        toast.error(t('chat.blocked_by_them'), { className: 'fc-toast' });
        return;
      }
    }

    // Optimistic message: create a temp message and show immediately
    const tempId = crypto.randomUUID();
    const optimisticMsg = {
      id: tempId,
      conversation_id: activeConvId,
      sender_id: user.id,
      decryptedContent: trimmed,
      created_at: new Date().toISOString(),
      edited_at: null,
      is_pinned: false,
      reactions: {},
      deleted_for: null,
      // Mark as optimistic so it can be removed on error
      _optimistic: true,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setInputValue('');
    setSending(true);
    // column-reverse: scroll to top (visual bottom) to show new message
    setTimeout(() => messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 10);

    try {
      const { data: participants } = await supabase
        .from('chat_participants')
        .select('user_id')
        .eq('conversation_id', activeConvId);

      const participantIds = (participants || []).map(p => p.user_id).filter(id => id !== user.id);

      const sentMsg = await sendMessage(activeConvId, user.id, trimmed, participantIds);

      // Replace optimistic message with real one (real-time will also update it)
      setMessages((prev) => {
        // Step 1: Replace optimistic message with real one
        const replaced = prev.map(m =>
          m.id === tempId
            ? { ...sentMsg, decryptedContent: trimmed, _optimistic: false }
            : m
        );
        // Step 2: Deduplicate by ID (previene duplicado si real-time llegó antes que la respuesta HTTP)
        const seen = new Set();
        return replaced.filter(m => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
      });

      loadConvs();
    } catch (err) {
      // Remove optimistic message on error
      setMessages((prev) => prev.filter(m => m.id !== tempId));
      console.error('Error sending message:', err);
      toast.error(t('chat.send_error'), { className: 'fc-toast' });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Start new conversation ──
  const handleSearchChange = useCallback(async (e) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchingUser(true);
    try {
      const results = await searchProfiles(q.trim(), user?.id);
      setSearchResults(results.filter(r => r.id !== user?.id));
    } catch (err) {
      console.warn('Search error:', err);
    } finally {
      setSearchingUser(false);
    }
  }, [user?.id]);

  const startConversation = async (otherUser) => {
    if (!user?.id || !otherUser?.id) return;

    // ── Block check: both directions ──
    const cachedBlocked = getCachedBlockStatus(user.id, otherUser.id);
    if (cachedBlocked === true) {
      toast.error(t('chat.blocked_cannot_send'), { className: 'fc-toast' });
      return;
    }
    const cachedBlockedByThem = getCachedBlockStatus(otherUser.id, user.id);
    if (cachedBlockedByThem === true) {
      toast.error(t('chat.blocked_by_them'), { className: 'fc-toast' });
      return;
    }

    // Double-check with server (cache might be stale)
    try {
      const blockedByMe = await isBlocked(user.id, otherUser.id);
      if (blockedByMe) {
        cacheBlockStatus(user.id, otherUser.id, true);
        toast.error(t('chat.blocked_cannot_send'), { className: 'fc-toast' });
        return;
      }
      const blockedByThem = await isBlocked(otherUser.id, user.id);
      if (blockedByThem) {
        cacheBlockStatus(otherUser.id, user.id, true);
        toast.error(t('chat.blocked_by_them'), { className: 'fc-toast' });
        return;
      }
    } catch {}

    try {
      const convId = await getOrCreateConversation(user.id, otherUser.id);
      setSearchQuery('');
      setSearchResults([]);
      await loadConvs();
      selectConversation(convId);
    } catch (err) {
      console.error('Error creating conversation:', err);
    }
  };

  // ── Context menu handlers (conversation list) ──
  const handleContextMenu = useCallback((e, convId) => {
    e.preventDefault();
    const pos = getSmartMenuPosition(e.clientX, e.clientY, 160, 80);
    setContextMenu({ open: true, x: pos.x, y: pos.y, convId });
  }, [getSmartMenuPosition]);

  const handleDeleteConversation = useCallback(async () => {
    const convId = contextMenu.convId;
    if (!convId) return;
    setContextMenu({ open: false, x: 0, y: 0, convId: null });
    try {
      await deleteConversation(convId);
      setConversations((prev) => prev.filter(c => c.id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
      }
    } catch (err) {
      console.error('Error deleting conversation:', err);
    }
  }, [contextMenu.convId, activeConvId]);

  // ── Message context menu handlers ──
  const handleMsgContextMenu = useCallback((e, msg) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getSmartMenuPosition(e.clientX, e.clientY, 180, 260);
    setMsgMenu({ open: true, x: pos.x, y: pos.y, msg });
  }, [getSmartMenuPosition]);

  const handleCopyMessage = useCallback(async () => {
    const msg = msgMenu.msg;
    setMsgMenu({ open: false, x: 0, y: 0, msg: null });
    if (!msg?.decryptedContent) return;
    try {
      await navigator.clipboard.writeText(msg.decryptedContent);
      toast.success(t('chat.copied'), { className: 'fc-toast' });
    } catch (err) {
      console.warn('Copy failed:', err);
    }
  }, [msgMenu.msg]);

  const handleDeleteMessage = useCallback(async () => {
    const msg = msgMenu.msg;
    setMsgMenu({ open: false, x: 0, y: 0, msg: null });
    if (!msg) return;
    try {
      await deleteMessage(msg.id);
      setMessages((prev) => prev.filter(m => m.id !== msg.id));
    } catch (err) {
      console.error('Error deleting message:', err);
    }
  }, [msgMenu.msg]);

  const handleDeleteMessageForMe = useCallback(async () => {
    const msg = msgMenu.msg;
    setMsgMenu({ open: false, x: 0, y: 0, msg: null });
    if (!msg || !user?.id) return;
    try {
      await deleteMessageForMe(msg.id, user.id);
      setMessages((prev) => prev.filter(m => m.id !== msg.id));
    } catch (err) {
      console.error('Error hiding message:', err);
    }
  }, [msgMenu.msg, user?.id]);

  const handlePinMessage = useCallback(async () => {
    const msg = msgMenu.msg;
    setMsgMenu({ open: false, x: 0, y: 0, msg: null });
    if (!msg) return;
    const newPinned = !msg.is_pinned;
    try {
      await pinMessage(msg.id, newPinned);
      setMessages((prev) => prev.map(m => m.id === msg.id ? { ...m, is_pinned: newPinned } : m));
    } catch (err) {
      console.error('Error pinning message:', err);
    }
  }, [msgMenu.msg]);

  const handleStartEdit = useCallback(() => {
    const msg = msgMenu.msg;
    setMsgMenu({ open: false, x: 0, y: 0, msg: null });
    if (!msg?.decryptedContent) return;
    editContentRef.current = msg.decryptedContent;
    setEditMsgId(msg.id);
    setEditText(msg.decryptedContent);
    setShowEditModal(true);
  }, [msgMenu.msg]);

  const handleCancelEdit = useCallback(() => {
    setEditMsgId(null);
    setEditText('');
    setShowEditModal(false);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editMsgId || !editText.trim() || !user?.id) return;
    try {
      // Get participant IDs
      const { data: participants } = await supabase
        .from('chat_participants')
        .select('user_id')
        .eq('conversation_id', activeConvId);
      const participantIds = (participants || []).map(p => p.user_id).filter(id => id !== user.id);

      await editMessage(editMsgId, user.id, editText.trim(), participantIds);
      // Update local state with edited content (will be re-decrypted on next load)
      // For now, just update decryptedContent and edited_at locally
      setMessages((prev) => prev.map(m =>
        m.id === editMsgId
          ? { ...m, decryptedContent: editText.trim(), edited_at: new Date().toISOString() }
          : m
      ));
      setEditMsgId(null);
      setEditText('');
      setShowEditModal(false);
    } catch (err) {
      console.error('Error editing message:', err);
    }
  }, [editMsgId, editText, user?.id, activeConvId]);

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    }
    if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const handleReact = useCallback(async (emoji, msgIdOverride) => {
    const msgId = msgIdOverride || emojiPickerMsgId || msgMenu.msg?.id;
    if (!msgId || !user?.id) return;
    setEmojiPickerMsgId(null);
    setMsgMenu({ open: false, x: 0, y: 0, msg: null });

    // Optimistic update: apply to local state immediately, no waiting for API
    const prevMessages = messages;
    const toggleReaction = (prev) => prev.map(m => {
      if (m.id !== msgId) return m;
      const reactions = { ...(m.reactions || {}) };
      if (reactions[user.id] === emoji) {
        delete reactions[user.id];
      } else {
        reactions[user.id] = emoji;
      }
      return { ...m, reactions };
    });
    setMessages(toggleReaction);

    try {
      await addReaction(msgId, user.id, emoji);
    } catch (err) {
      // Revert on error
      setMessages(prevMessages);
      console.error('Error reacting:', err);
    }
  }, [emojiPickerMsgId, msgMenu.msg, user?.id, messages]);

  const toggleEmojiPicker = useCallback((msgId) => {
    setEmojiPickerMsgId(prev => prev === msgId ? null : msgId);
    setMsgMenu({ open: false, x: 0, y: 0, msg: null });
  }, []);

  // ── Get active conversation's other user ──
  const activeConv = conversations.find((c) => c.id === activeConvId);
  const otherUser = activeConv?.otherUser;

  // ── Compute message grouping (based on chronological order) ──
  const messageGroupMap = React.useMemo(() => {
    const map = {};
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const prev = i > 0 ? messages[i - 1] : null;
      const next = i < messages.length - 1 ? messages[i + 1] : null;
      const isFirst = !prev || prev.sender_id !== msg.sender_id || (new Date(msg.created_at) - new Date(prev.created_at)) > 300000;
      const isLast = !next || next.sender_id !== msg.sender_id || (new Date(next.created_at) - new Date(msg.created_at)) > 300000;
      const isSolo = isFirst && isLast;
      let groupClass;
      let isGrouped = false;
      if (isSolo) groupClass = 'chat-message-bubble--solo';
      else if (isFirst) { groupClass = 'chat-message-bubble--first'; isGrouped = true; }
      else if (isLast) { groupClass = 'chat-message-bubble--last'; isGrouped = true; }
      else { groupClass = 'chat-message-bubble--middle'; isGrouped = true; }
      map[msg.id] = { groupClass, showAvatar: isFirst, isGrouped };
    }
    return map;
  }, [messages]);

  // ── Reversed messages for column-reverse render (newest first in DOM) ──
  const reversedMessages = React.useMemo(() => [...messages].reverse(), [messages]);
  // ── Navigate to profile from header ──
  const goToProfile = useCallback(() => {
    if (otherUser?.username) {
      navigate(`/profile/${otherUser.username}`);
    }
  }, [otherUser?.username, navigate]);

  // ── Open followers modal ──
  const openFollowersModal = useCallback(async () => {
    if (!user?.id) return;
    setShowFollowersModal(true);
    setFollowersLoading(true);
    try {
      const data = await getFollowing(user.id);
      // Filter out users who have blocked the current user or are blocked by the current user
      const filtered = (data || []).filter(u => {
        const blockedByMe = getCachedBlockStatus(user.id, u.id);
        const blockedByThem = getCachedBlockStatus(u.id, user.id);
        return blockedByMe !== true && blockedByThem !== true;
      });
      setFollowers(filtered);
    } catch (err) {
      console.warn('Error fetching following:', err);
      setFollowers([]);
    } finally {
      setFollowersLoading(false);
    }
  }, [user?.id]);

  // ── Followers modal ──
  const renderFollowersModal = () => (
    <ModalShell isOpen={showFollowersModal} onClose={() => setShowFollowersModal(false)} onEscape={() => setShowFollowersModal(false)} className="chat-followers-modal">
      <div className="chat-followers-modal-header">
        <h3 className="fc-modal-title">{t('following.title')}</h3>
        <button type="button" className="chat-followers-modal-close" onClick={() => setShowFollowersModal(false)}>
          <FaTimes />
        </button>
      </div>

      {followersLoading ? (
        <div className="chat-followers-modal-status">{t('common.loading')}</div>
      ) : followers.length === 0 ? (
        <div className="chat-followers-modal-status">
          <FaUsers className="chat-followers-modal-empty-icon" />
          <p>{t('following.empty')}</p>
        </div>
      ) : (
        <div className="chat-followers-modal-grid">
          {followers.map((u) => (
            <button key={u.id} className="chat-followers-modal-card" onClick={() => { setShowFollowersModal(false); startConversation(u); }}>
              <Avatar src={u.avatar_url} alt={u.username} className="chat-followers-modal-card-avatar" />
              <span className="chat-followers-modal-card-name">{u.username}</span>
              {Array.isArray(u.roles) && u.roles.some(r => r !== 'user') && (
                <span className="chat-followers-modal-card-badges">
                  <Badge roles={u.roles} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  );

  if (!user) return null;

  // ── Render conversation list content ──
  const renderConversationListContent = () => (
    <div className="chat-list">
      <div className="chat-list-header">
        <h2 className="chat-list-title">{t('chat.title')}</h2>
        <Tooltip text={t('chat.new')} placement="bottom">
          <button className="chat-list-new-btn" onClick={openFollowersModal}>
            <FaPlus />
          </button>
        </Tooltip>
      </div>

      {/* Persistent search bar */}
      <div className="chat-search-bar">
        <div className="chat-search-bar-wrap">
          <FaSearch className="chat-search-bar-icon" />
          <input
            className="chat-search-bar-input"
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder={t('chat.search_placeholder')}
          />
          {searchQuery && (
            <button className="chat-search-bar-clear" onClick={() => { setSearchQuery(''); setSearchResults([]); }}>
              <FaTimes />
            </button>
          )}
        </div>
        {searchingUser && <div className="chat-search-bar-status">{t('common.loading')}</div>}
        {searchQuery && searchResults.length > 0 && (
          <div className="chat-search-results">
            {searchResults.map((u) => (
              <button key={u.id} className="chat-search-result" onClick={() => startConversation(u)}>
                <Avatar src={u.avatar_url} alt={u.username} className="chat-search-result-avatar" />
                <span className="chat-search-result-name">@{u.username}</span>
              </button>
            ))}
          </div>
        )}
        {searchQuery && searchQuery.length >= 2 && searchResults.length === 0 && !searchingUser && (
          <div className="chat-search-bar-status chat-search-bar-status--empty">{t('explore.no_results')}</div>
        )}
      </div>

      {/* Conversations */}
      <div className="chat-list-items">
        {convsLoading ? (
          <div className="chat-list-loading">{t('common.loading')}</div>
        ) : conversations.length === 0 ? (
          <div className="chat-list-empty">
            <div className="chat-list-empty-icon"><FaComment /></div>
            <p>{t('chat.empty')}</p>
            <p className="chat-list-empty-sub">{t('chat.empty_sub')}</p>
          </div>
        ) : (
          conversations.map((conv) => (
            <button
              key={conv.id}
              className={`chat-list-item ${conv.id === activeConvId ? 'chat-list-item--active' : ''}`}
              onClick={() => selectConversation(conv.id)}
              onContextMenu={(e) => handleContextMenu(e, conv.id)}
            >
              <Avatar
                src={conv.otherUser?.avatar_url}
                alt={conv.otherUser?.username || '?'}
                className="chat-list-item-avatar"
              />
              <div className="chat-list-item-info">
                <div className="chat-list-item-top">
                  <span className="chat-list-item-name">{conv.otherUser?.username || t('common.unknown')}</span>
                  {conv.last_message_at && (
                    <span className="chat-list-item-time">
                      {getTimeAgo(t, locale, conv.last_message_at)}
                    </span>
                  )}
                </div>
                <div className="chat-list-item-bottom">
                  <span className="chat-list-item-preview">
                    {conv.last_message_text || ''}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="chat-list-item-badge">
                      {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );

  // ── Render message area content ──
  const renderMessageAreaContent = () => (
    <div className="chat-messages">
      {/* Header */}
      <div className="chat-messages-header">
        <button className="chat-messages-back" onClick={goBackToList}>
          <FaArrowLeft />
        </button>
        <Avatar
          src={otherUser?.avatar_url}
          alt={otherUser?.username || '?'}
          className="chat-messages-header-avatar"
          style={{ cursor: 'pointer' }}
          onClick={goToProfile}
        />
        <div className="chat-messages-header-info" style={{ cursor: 'pointer' }} onClick={goToProfile}>
          <span className="chat-messages-header-name">{otherUser?.username || t('common.unknown')}</span>
        </div>
      </div>

      {/* Messages — key=activeConvId fuerza remount completo al cambiar de chat */}
      <div className="chat-messages-body" ref={messagesContainerRef}>
        {msgsLoading ? (
          <div className="chat-messages-loading">{t('common.loading')}</div>
        ) : messages.length === 0 ? (
          <div className="chat-messages-empty">
            <FaComment className="chat-messages-empty-icon" />
            <p>{t('chat.no_messages')}</p>
          </div>
        ) : (
          reversedMessages.map((msg) => {
            const isOwn = msg.sender_id === user.id;
            const isEditing = editMsgId === msg.id;
            const groupInfo = messageGroupMap[msg.id] || {};
            const groupClass = groupInfo.groupClass || 'chat-message-bubble--solo';
            const showAvatar = groupInfo.showAvatar !== false;
            const reactions = msg.reactions || {};
            // Group reactions by emoji for stacking
            const groupedReactions = {};
            Object.entries(reactions).forEach(([uid, em]) => {
              if (!groupedReactions[em]) {
                groupedReactions[em] = { count: 0, isOwn: false };
              }
              groupedReactions[em].count++;
              if (uid === user.id) groupedReactions[em].isOwn = true;
            });
            const ownReaction = reactions[user.id];

            return (
              <div
                key={msg.id}
                className={`chat-message ${isOwn ? 'chat-message--own' : 'chat-message--other'}`}
                onContextMenu={(e) => handleMsgContextMenu(e, msg)}
              >
                {msg.is_pinned && (
                  <div className="chat-message-pin-badge">
                    <FaThumbtack />
                    <span>{t('post.pinned')}</span>
                  </div>
                )}
                <div className={`chat-message-row ${isOwn ? 'chat-message-row--own' : 'chat-message-row--other'}`}>
                  {!isOwn && showAvatar && (
                    <Avatar
                      src={otherUser?.avatar_url}
                      alt={otherUser?.username || '?'}
                      className="chat-message-avatar"
                    />
                  )}
                  {!isOwn && !showAvatar && <div className="chat-message-avatar-spacer" />}
                  <div className={`chat-message-bubble ${groupClass} ${msg.is_pinned ? 'chat-message-bubble--pinned' : ''}`}>
                    <p className="chat-message-text">
                      {msg.decryptedContent || (
                        <span className="chat-message-encrypted">{t('chat.encrypted')}</span>
                      )}
                    </p>
                  </div>
                  {isOwn && (
                    <span className="chat-message-time">
                      {msg.edited_at && (
                        <span className="chat-message-edited">{t('chat.edited')} · </span>
                      )}
                      {getTimeAgo(t, locale, msg.created_at)}
                    </span>
                  )}
                  {isOwn && showAvatar && (
                    <Avatar
                      src={profile?.avatar_url || user?.user_metadata?.avatar_url || user?.avatar_url}
                      alt={profile?.username || user?.username || '?'}
                      className="chat-message-avatar chat-message-avatar--own"
                    />
                  )}
                  {isOwn && !showAvatar && <div className="chat-message-avatar-spacer" />}
                  {!isOwn && (
                    <span className="chat-message-time">
                      {msg.edited_at && (
                        <span className="chat-message-edited">{t('chat.edited')} · </span>
                      )}
                      {getTimeAgo(t, locale, msg.created_at)}
                    </span>
                  )}
                </div>

                {/* Reactions — floating outside bubble, stacked by emoji */}
                {!isEditing && Object.keys(reactions).length > 0 && (
                  <div className="chat-message-reactions">
                    {Object.entries(groupedReactions).map(([emoji, { count, isOwn }]) => (
                      <span
                        key={emoji}
                        className={`chat-message-reaction ${isOwn ? 'chat-message-reaction--own' : ''}`}
                        onClick={() => {
                          if (isOwn) {
                            handleReact(emoji, msg.id);
                          }
                        }}
                      >
                        {emoji}
                        {count > 1 && <span className="chat-message-reaction-count">{count}</span>}
                      </span>
                    ))}
                  </div>
                )}

                {/* Emoji picker — floating below */}
                {emojiPickerMsgId === msg.id && (
                  <div className="chat-message-emoji-picker" ref={emojiPickerRef} onClick={(e) => e.stopPropagation()}>
                    {EMOJIS.map(emoji => (
                      <button
                        key={emoji}
                        className={`chat-message-emoji-btn ${ownReaction === emoji ? 'chat-message-emoji-btn--active' : ''}`}
                        onClick={() => handleReact(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                    <input
                      type="text"
                      className="chat-message-emoji-input"
                      inputMode="emoji"
                      placeholder="+"
                      maxLength={1}
                      autoComplete="off"
                      onInput={(e) => {
                        const val = e.target.value.trim();
                        if (val) {
                          handleReact(val);
                          e.target.value = '';
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Input */}
      <div className="chat-messages-input">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.input_placeholder')}
          rows={1}
          maxLength={2000}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!inputValue.trim() || sending}
        >
          <FaPaperPlane />
        </button>
      </div>
    </div>
  );

  return (
    <div className="chat-page">
      <div className={`chat-list${!showList ? ' chat-list--hide-mobile' : ''}`}>
        {renderConversationListContent()}
      </div>
      <div className={`chat-messages${showList ? ' chat-messages--hide-mobile' : ''}`}>
        {activeConvId ? renderMessageAreaContent() : (
          <div className="chat-messages-welcome">
            <FaComment className="chat-messages-welcome-icon" />
            <p>{t('chat.select_chat')}</p>
          </div>
        )}
      </div>
      {contextMenu.open && (
        <div
          ref={contextMenuRef}
          className="chat-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="chat-context-menu-btn chat-context-menu-btn--danger" onClick={handleDeleteConversation}>
            <FaTrash />
            <span>{t('post.delete')}</span>
          </button>
        </div>
      )}
      {msgMenu.open && msgMenu.msg && (
        <div
          ref={msgMenuRef}
          className="chat-context-menu"
          style={{ left: msgMenu.x, top: msgMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {msgMenu.msg.sender_id === user.id ? (
            <>
              <button className="chat-context-menu-btn" onClick={handleCopyMessage}>
                <FaCopy />
                <span>{t('chat.copy')}</span>
              </button>
              <button className="chat-context-menu-btn" onClick={handleStartEdit}>
                <FaEdit />
                <span>{t('post.edit')}</span>
              </button>
              <button className="chat-context-menu-btn" onClick={() => { setMsgMenu({ ...msgMenu, open: false }); toggleEmojiPicker(msgMenu.msg.id); }}>
                <FaSmile />
                <span>{t('chat.react')}</span>
              </button>
              <button className="chat-context-menu-btn" onClick={handlePinMessage}>
                <FaThumbtack />
                <span>{msgMenu.msg.is_pinned ? t('post.unpin') : t('post.pin')}</span>
              </button>
              <button className="chat-context-menu-btn chat-context-menu-btn--danger" onClick={handleDeleteMessage}>
                <FaTrash />
                <span>{t('chat.delete_message')}</span>
              </button>
            </>
          ) : (
            <>
              <button className="chat-context-menu-btn" onClick={handleCopyMessage}>
                <FaCopy />
                <span>{t('chat.copy')}</span>
              </button>
              <button className="chat-context-menu-btn" onClick={() => { setMsgMenu({ ...msgMenu, open: false }); toggleEmojiPicker(msgMenu.msg.id); }}>
                <FaSmile />
                <span>{t('chat.react')}</span>
              </button>
              <button className="chat-context-menu-btn" onClick={handlePinMessage}>
                <FaThumbtack />
                <span>{msgMenu.msg.is_pinned ? t('post.unpin') : t('post.pin')}</span>
              </button>
              <button className="chat-context-menu-btn" onClick={handleDeleteMessageForMe}>
                <FaTrash />
                <span>{t('chat.delete_for_me')}</span>
              </button>
            </>
          )}
        </div>
      )}
      <ModalShell
        isOpen={showEditModal && Boolean(editMsgId)}
        onClose={handleCancelEdit}
        onEscape={handleCancelEdit}
        disableBackdropClose={false}
        className="chat-edit-modal"
      >
        <div className="fc-modal-header">
          <div>
            <h3 className="fc-modal-title">{t('chat.edit_title')}</h3>
          </div>
          <div className="fc-modal-header-actions">
            <button type="button" className="fc-modal-save" onClick={handleSaveEdit}>
              {t('common.save')}
            </button>
            <button type="button" className="fc-modal-close" onClick={handleCancelEdit} title={t('common.cancel')}>
              <FaTimes />
            </button>
          </div>
        </div>
        <div className="chat-edit-modal-body">
          <div className="chat-edit-modal-layout">
            <div className="chat-edit-modal-editor">
              <label className="fc-modal-label">
                <span>{t('chat.edit_title')}</span>
                <textarea
                  ref={editRef}
                  className="fc-modal-input chat-message-edit-input"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  rows={8}
                  maxLength={2000}
                  placeholder={t('chat.edit_placeholder')}
                />
              </label>
            </div>
            <div className="chat-edit-modal-preview">
              <div className="chat-edit-modal-preview-header">
                <span className="chat-edit-modal-preview-label">{t('chat.edit_preview')}</span>
              </div>
              <div className="chat-edit-modal-preview-card">
                <div className="chat-edit-modal-preview-content">
                  <p className="chat-edit-modal-preview-text">
                    {editText || editContentRef.current || t('chat.encrypted')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ModalShell>
      {renderFollowersModal()}
    </div>
  );
}
