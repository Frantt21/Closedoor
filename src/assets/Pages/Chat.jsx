import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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
  broadcastTyping,
  subscribeToTyping,
} from '../services/chatService';
import { searchProfiles } from '../services/userService';
import { getFollowing } from '../services/followService';
import { isBlocked, getCachedBlockStatus, cacheBlockStatus } from '../services/blockService';
import FollowButton from '../Resources/Components/FollowButton';
import ModalShell from '../Resources/Components/ModalShell';
import { FaComment, FaSearch, FaArrowLeft, FaPlus, FaTimes, FaUserPlus, FaUsers, FaTrash, FaThumbtack, FaCopy, FaEdit, FaCheck, FaSmile, FaReply, FaImage, FaMusic, FaUser, FaPhone, FaLock } from 'react-icons/fa';
import Avatar from '../Resources/Components/Avatar';
import Badge from '../Resources/Components/Badge';
import Tooltip from '../Resources/Components/Tooltip';
import GifPicker from '../Resources/Components/GifPicker';
import { getTimeAgo, IMG_RE, detectMediaFromContent, getImgTransformStyle } from '../services/helpers';
import SafeImage from '../Resources/Components/SafeImage';
import { toast } from 'react-toastify';
import { supabase } from '../services/supabaseclient';
import usePageTitle from '../../hooks/usePageTitle';
import '../Resources/Styles/chat.css';
import '../Resources/Styles/explore.css';

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
  // Refs to avoid `sending` and `replyingTo` in callback dependency arrays
  const sendingRef = useRef(false);
  // Keep sendingRef in sync
  useEffect(() => { sendingRef.current = sending; }, [sending]);

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
  const [replyingTo, setReplyingTo] = useState(null); // mensaje al que se está respondiendo
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showMediaInput, setShowMediaInput] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [showInputEmojiPicker, setShowInputEmojiPicker] = useState(false);
  const [inputEmojiTab, setInputEmojiTab] = useState(0);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState('');
  const editRef = useRef(null);
  // Preserve content during modal close animation (ref survives state clears)
  const editContentRef = useRef('');

  // Emoji picker state
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState({ x: 0, y: 0 });
  const [emojiTab, setEmojiTab] = useState(0);
  const [recentEmojis, setRecentEmojis] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('chatRecentEmojis') || '[]');
    } catch { return []; }
  });
  const emojiPickerRef = useRef(null);

  // Categorized emojis for reactions
  const MAX_RECENT = 30;

  const EMOJI_CATEGORIES = [
    {
      name: '😀', emojis: ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😗','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','😮','😯','😲','😳','🥺','😢','😭','😤','😠','😡','🤬','💀','☠️','👻','👽','🤡','💩']
    },
    {
      name: '👋', emojis: ['👍','👎','👊','✊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✌️','🤟','🤘','👌','👉','👈','👆','👇','☝️','✋','🤚','🖐','🖖','👋','🤙','💪','🦵','🦶','👂','👃','🧠','👀','👅','👄']
    },
    {
      name: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💕','💞','💗','💖','💘','💝','💟','❤️‍🔥','❤️‍🩹','💔','❣️','💑','💏','👨‍❤️‍👨','👩‍❤️‍👩','💋','💌']
    },
    {
      name: '🔥', emojis: ['🔥','⭐','🌟','✨','💫','⚡','🌈','🌊','☀️','🌙','🌍','🌎','🌏','🌸','🌺','🌻','🌹','🌷','🌿','🍀','🌵','🎄','🌲','🌴','🍁','🍂']
    },
    {
      name: '🎉', emojis: ['🎉','🎊','🎈','🎁','🎀','🎃','🎄','🎆','🎇','✨','🎶','🎵','🎸','🎹','🎺','🎻','🥁','🎯','🎱','🎲','🎮','🕹️','🎭','🎨','🎪','🎤','🎧']
    },
  ];

  // Compute categories with "Recent" tab prepended when there are recent emojis
  const categoriesWithRecent = React.useMemo(() => {
    const cats = [...EMOJI_CATEGORIES];
    if (recentEmojis.length > 0) {
      cats.unshift({ name: '🕐', emojis: recentEmojis });
    }
    return cats;
  }, [recentEmojis]);

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
  const draftsRef = useRef({}); // borradores del input por conversation ID
  const prevConvIdRef = useRef(null);
  const messagesOwnerRef = useRef(null); // tracks which conversation the current `messages` state belongs to
  const [otherUserTyping, setOtherUserTyping] = useState(false);

  // ── useLayoutEffect: runs BEFORE browser paint — garantiza que no haya flash de mensajes viejos ──
  useLayoutEffect(() => {
    if (!activeConvId) return;
    if (prevConvIdRef.current === activeConvId) return; // misma conversación, no hacer nada

    // Save current messages to the OLD conversation's cache before switching
    if (prevConvIdRef.current && messagesOwnerRef.current === prevConvIdRef.current) {
      // Don't overwrite — the cache is already up-to-date from the sync effect
    }

    // Limpiar/restaurar mensajes inmediatamente ANTES del paint
    const cached = messagesCacheRef.current[activeConvId];
    if (cached) {
      setMessages(cached);
      setMsgsLoading(false);
    } else {
      setMessages([]);
      setMsgsLoading(true);
    }
    messagesOwnerRef.current = activeConvId;
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
    let aborted = false;

    markAsRead(activeConvId, user.id);

    const convForThisEffect = activeConvId;
    getMessages(convForThisEffect)
      .then(async (msgs) => {
        if (aborted) return; // user switched conversation while loading — discard
        // Filter out messages deleted for me
        const filtered = msgs.filter(m => !m.deleted_for?.includes(user.id));
        // Decrypt each message
        const decrypted = await Promise.all(
          filtered.map(async (msg) => {
            const content = await decryptMessage(msg, user.id);
            return { ...msg, decryptedContent: content };
          })
        );
        if (aborted) return; // check again after async work
        // Update cache for THIS conversation only
        messagesCacheRef.current[convForThisEffect] = decrypted;
        messagesOwnerRef.current = convForThisEffect;
        setMessages(decrypted);
      })
      .catch((err) => { if (!aborted) console.warn('Error loading messages:', err); })
      .finally(() => { if (!aborted) setMsgsLoading(false); });

    // Real-time subscription
    const unsub = subscribeToMessages(convForThisEffect, async (newMsg, eventType) => {
      if (aborted) return;
      const content = await decryptMessage(newMsg, user.id);
      if (aborted) return;
      if (eventType === 'UPDATE') {
        setMessages((prev) => prev.map((msg) => msg.id === newMsg.id ? { ...msg, ...newMsg, decryptedContent: content } : msg));
      } else {
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
      markAsRead(convForThisEffect, user.id);
    });

    return () => {
      aborted = true;
      unsub?.unsubscribe();
    };
  }, [activeConvId, user?.id]);

  // ── Typing indicator: subscribe to other user's typing events ──
  useEffect(() => {
    if (!activeConvId || !user?.id) return;
    setOtherUserTyping(false);

    const unsub = subscribeToTyping(
      activeConvId,
      user.id,
      () => setOtherUserTyping(true),
      () => setOtherUserTyping(false)
    );

    return () => {
      unsub();
      setOtherUserTyping(false);
    };
  }, [activeConvId, user?.id]);

  // ── Persist recent emojis to localStorage ──
  useEffect(() => {
    localStorage.setItem('chatRecentEmojis', JSON.stringify(recentEmojis));
  }, [recentEmojis]);

  // Sync messages cache on every update (realtime, delete, edit, etc.)
  // Only writes to cache if the messages actually belong to activeConvId
  useEffect(() => {
    if (!activeConvId) return;
    if (messagesOwnerRef.current !== activeConvId) return; // don't write stale data
    messagesCacheRef.current[activeConvId] = messages;
  }, [messages, activeConvId]);

  // ── Broadcast typing when input changes (throttled inside broadcastTyping) ──
  useEffect(() => {
    if (!activeConvId || !user?.id || !inputValue) return;
    broadcastTyping(activeConvId, user.id);
  }, [inputValue, activeConvId, user?.id]);

  // ── Select conversation (con borradores por chat) ──
  const selectConversation = (convId) => {
    // Guardar borrador del chat actual antes de cambiar
    if (activeConvId) {
      draftsRef.current[activeConvId] = inputValue;
    }
    // Cargar borrador del nuevo chat
    const draft = draftsRef.current[convId] || '';
    setInputValue(draft);

    setActiveConvId(convId);
    setShowList(false);
    // Cerrar paneles flotantes al cambiar de chat
    setShowMsgSearch(false);
    setShowMediaGallery(false);
    setShowPinnedPanel(false);
    setShowProfileCard(false);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }, 100);
  };

  const goBackToList = () => {
    // Guardar borrador antes de ir a la lista
    if (activeConvId) {
      draftsRef.current[activeConvId] = inputValue;
    }
    setActiveConvId(null);
    setShowList(true);
    // Cerrar paneles flotantes al volver a la lista
    setShowMsgSearch(false);
    setShowMediaGallery(false);
    setShowPinnedPanel(false);
    setShowProfileCard(false);
  };

  // ── Send message (optimistic — no delay, includes media preview) ──
  const handleSend = async () => {
    const trimmed = inputValue.trim();
    const hasPreview = !!mediaPreviewUrl;
    if (!trimmed && !hasPreview) return;
    const content = hasPreview
      ? (trimmed ? `${trimmed}\n${mediaPreviewUrl}` : mediaPreviewUrl)
      : trimmed;
    await sendContent(content, { clearInput: true });
    if (hasPreview) setMediaPreviewUrl('');
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

    const menuWidth = 180;
    const menuHeight = 260;

    // Posicionar relativo a la burbuja del mensaje, no al cursor
    const bubbleEl = e.currentTarget.querySelector('.chat-message-bubble');
    const rect = bubbleEl ? bubbleEl.getBoundingClientRect() : e.currentTarget.getBoundingClientRect();
    const isOwn = msg.sender_id === user?.id;

    let x, y;
    const gap = 6; // separación visual de la burbuja
    if (isOwn) {
      // Mensaje propio (derecha) → menú a la IZQUIERDA de la burbuja
      x = rect.left - menuWidth - gap;
    } else {
      // Mensaje ajeno (izquierda) → menú a la DERECHA de la burbuja
      x = rect.right + gap;
    }
    // Vertical: alinear con el top de la burbuja
    y = rect.top;

    // Ajustar si se sale del viewport
    if (x < 4) x = 4;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 4;
    if (y < 4) y = 4;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 4;

    setMsgMenu({ open: true, x, y, msg });
  }, [user?.id]);

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

    // Track emoji as recently used (move to front, no duplicates, max limit)
    setRecentEmojis((prev) => {
      const next = prev.filter(e => e !== emoji);
      next.unshift(emoji);
      return next.slice(0, MAX_RECENT);
    });

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

  // ── Reply to message ──
  const handleStartReply = useCallback((msg) => {
    setReplyingTo(msg);
    setMsgMenu({ open: false, x: 0, y: 0, msg: null });
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  // ── Add media URL as preview above input (not pasted into textarea) ──
  const handleMediaSend = useCallback(() => {
    const url = mediaUrl.trim();
    if (!url) return;
    setMediaPreviewUrl(url);
    setShowMediaInput(false);
    setMediaUrl('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [mediaUrl]);

  // ── Insert emoji at cursor position in the input ──
  const handleInputEmojiSelect = useCallback((emoji) => {
    const el = inputRef.current;
    if (!el) {
      setInputValue((prev) => prev + emoji);
    } else {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      const newVal = before + emoji + after;
      setInputValue(newVal);
      // Restore cursor position after the inserted emoji
      requestAnimationFrame(() => {
        const pos = start + emoji.length;
        el.setSelectionRange(pos, pos);
        el.focus();
      });
    }
    // Track as recent
    setRecentEmojis((prev) => {
      const next = prev.filter(e => e !== emoji);
      next.unshift(emoji);
      return next.slice(0, MAX_RECENT);
    });
  }, []);

  // ── Panel states for header actions ──
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  const [msgSearchQuery, setMsgSearchQuery] = useState('');
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [showProfileCard, setShowProfileCard] = useState(false);

  // ── Gallery state for chat images ──
  const [chatGalleryUrls, setChatGalleryUrls] = useState(null);
  const [chatGalleryIndex, setChatGalleryIndex] = useState(0);

  const openChatGallery = useCallback((e, urls, index) => {
    if (e) e.stopPropagation();
    setChatGalleryUrls(urls);
    setChatGalleryIndex(index);
  }, []);

  const closeChatGallery = useCallback(() => setChatGalleryUrls(null), []);

  const goChatGalleryPrev = useCallback(() => {
    setChatGalleryIndex((prev) => (prev > 0 ? prev - 1 : chatGalleryUrls.length - 1));
  }, [chatGalleryUrls]);

  const goChatGalleryNext = useCallback(() => {
    setChatGalleryIndex((prev) => (prev < chatGalleryUrls.length - 1 ? prev + 1 : 0));
  }, [chatGalleryUrls]);

  // ── Close floating panels (media, pinned, profile) on outside click ──
  useEffect(() => {
    if (!showMediaGallery && !showPinnedPanel && !showProfileCard) return;
    const handleClick = (e) => {
      if (!e.target.closest('.chat-float-panel') && !e.target.closest('.chat-header-action-btn')) {
        setShowMediaGallery(false);
        setShowPinnedPanel(false);
        setShowProfileCard(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMediaGallery, showPinnedPanel, showProfileCard]);

  // ── Keyboard nav for gallery ──
  useEffect(() => {
    if (!chatGalleryUrls) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') { closeChatGallery(); return; }
      if (e.key === 'ArrowLeft') goChatGalleryPrev();
      if (e.key === 'ArrowRight') goChatGalleryNext();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [chatGalleryUrls, chatGalleryIndex, closeChatGallery, goChatGalleryPrev, goChatGalleryNext]);

  const highlightTimeoutRef = useRef(null);
  // ── Navigate to a message by ID (scroll + highlight) ──
  const handleGoToMessage = useCallback((msgId) => {
    if (!msgId || !messagesContainerRef.current) return;
    // Clear any previous highlight
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
      document.querySelectorAll('.chat-message--highlighted').forEach(el => el.classList.remove('chat-message--highlighted'));
    }
    const el = document.querySelector(`[data-msg-id="${CSS.escape(msgId)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('chat-message--highlighted');
      highlightTimeoutRef.current = setTimeout(() => el.classList.remove('chat-message--highlighted'), 2000);
    }
  }, []);

  const toggleEmojiPicker = useCallback((msgId) => {
    if (!msgId) return;
    setEmojiPickerMsgId(prev => {
      if (prev === msgId) return null; // close

      // Calcular posición relativa a la burbuja del mensaje
      const PICKER_W = 300, PICKER_H = 280;
      const msgEl = document.querySelector(`[data-msg-id="${CSS.escape(msgId)}"]`);
      if (msgEl) {
        const bubbleEl = msgEl.querySelector('.chat-message-bubble');
        const rect = bubbleEl ? bubbleEl.getBoundingClientRect() : msgEl.getBoundingClientRect();
        const targetMsg = messages.find(m => m.id === msgId);
        const isOwn = targetMsg?.sender_id === user?.id;
        const gap = 6;

        let x, y;
        if (isOwn) {
          x = rect.left - PICKER_W - gap;
        } else {
          x = rect.right + gap;
        }
        y = rect.top;

        // Clamp to viewport
        if (x < 4) x = 4;
        if (x + PICKER_W > window.innerWidth) x = window.innerWidth - PICKER_W - 4;
        if (y < 4) y = 4;
        if (y + PICKER_H > window.innerHeight) y = window.innerHeight - PICKER_H - 4;

        setEmojiPickerPos({ x, y });
      }

      setEmojiTab(0);
      return msgId;
    });
    setMsgMenu({ open: false, x: 0, y: 0, msg: null });
  }, [messages, user?.id]);

  // ── Get active conversation's other user ──
  const activeConv = conversations.find((c) => c.id === activeConvId);
  const otherUser = activeConv?.otherUser;

  // ── Shared send logic (optimistic + API + dedup) ──
  const sendContent = useCallback(async (content, { clearInput = false } = {}) => {
    if (!content || !activeConvId || !user?.id || sendingRef.current) return null;

    if (otherUser) {
      const cachedBlocked = getCachedBlockStatus(user.id, otherUser.id);
      if (cachedBlocked === true) {
        toast.error(t('chat.blocked_cannot_send'), { className: 'fc-toast' });
        return null;
      }
      const cachedBlockedByThem = getCachedBlockStatus(otherUser.id, user.id);
      if (cachedBlockedByThem === true) {
        toast.error(t('chat.blocked_by_them'), { className: 'fc-toast' });
        return null;
      }
    }

    const replyToId = replyingTo?.id || null;
    const tempId = crypto.randomUUID();
    const optimisticMsg = {
      id: tempId,
      conversation_id: activeConvId,
      sender_id: user.id,
      decryptedContent: content,
      reply_to: replyToId,
      created_at: new Date().toISOString(),
      edited_at: null,
      is_pinned: false,
      reactions: {},
      deleted_for: null,
      _optimistic: true,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    if (clearInput) {
      setInputValue('');
      if (activeConvId) draftsRef.current[activeConvId] = '';
    }
    setReplyingTo(null);
    setSending(true);
    setTimeout(() => messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 10);

    try {
      const { data: participants } = await supabase
        .from('chat_participants')
        .select('user_id')
        .eq('conversation_id', activeConvId);
      const participantIds = (participants || []).map(p => p.user_id).filter(id => id !== user.id);
      const sentMsg = await sendMessage(activeConvId, user.id, content, participantIds, replyToId);

      setMessages((prev) => {
        const replaced = prev.map(m =>
          m.id === tempId ? { ...sentMsg, decryptedContent: content, _optimistic: false } : m
        );
        const seen = new Set();
        return replaced.filter(m => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
      });
      loadConvs();
      return sentMsg;
    } catch (err) {
      setMessages((prev) => prev.filter(m => m.id !== tempId));
      console.error('Error sending message:', err);
      toast.error(t('chat.send_error'), { className: 'fc-toast' });
      return null;
    } finally {
      setSending(false);
    }
  }, [activeConvId, otherUser, user?.id, replyingTo, loadConvs, t]);

  // ── Send GIF ──
  const handleGifSelect = useCallback(async (gifUrl) => {
    setShowGifPicker(false);
    if (!gifUrl) return;
    await sendContent(gifUrl);
  }, [sendContent]);

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
                    {conv.last_message_text && (IMG_RE.test(conv.last_message_text) || /(giphy|tenor|klipy)\.com|(\.|\/)gif/i.test(conv.last_message_text))
                      ? <><FaImage className="chat-list-item-preview-icon" /> {/(giphy|tenor|klipy)\.com/i.test(conv.last_message_text) ? 'GIF' : 'Image'}</>
                      : (conv.last_message_text || '')
                    }
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
        <div className="chat-messages-header-left">
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
        <div className="chat-messages-header-actions">
          <Tooltip text={t('chat.search_messages') || 'Search'} placement="bottom">
            <button
              className={`chat-header-action-btn ${showMsgSearch ? 'chat-header-action-btn--active' : ''}`}
              onClick={() => { setShowMsgSearch(s => !s); setShowMediaGallery(false); setShowPinnedPanel(false); setShowProfileCard(false); }}
            >
              <FaSearch />
            </button>
          </Tooltip>
          <Tooltip text={t('chat.media_gallery') || 'Media'} placement="bottom">
            <button
              className={`chat-header-action-btn ${showMediaGallery ? 'chat-header-action-btn--active' : ''}`}
              onClick={() => {
                setShowMediaGallery(s => !s);
                setShowMsgSearch(false);
                setShowPinnedPanel(false);
                setShowProfileCard(false);
              }}
            >
              <FaImage />
            </button>
          </Tooltip>
          <Tooltip text={t('post.pinned') || 'Pinned'} placement="bottom">
            <button
              className={`chat-header-action-btn ${showPinnedPanel ? 'chat-header-action-btn--active' : ''}`}
              onClick={() => { setShowPinnedPanel(s => !s); setShowMsgSearch(false); setShowMediaGallery(false); setShowProfileCard(false); }}
            >
              <FaThumbtack />
            </button>
          </Tooltip>
          <Tooltip text={t('chat.view_profile') || 'Profile'} placement="bottom">
            <button
              className={`chat-header-action-btn ${showProfileCard ? 'chat-header-action-btn--active' : ''}`}
              onClick={() => { setShowProfileCard(s => !s); setShowMsgSearch(false); setShowMediaGallery(false); setShowPinnedPanel(false); }}
            >
              <FaUser />
            </button>
          </Tooltip>
          <Tooltip text={t('chat.call') || 'Call'} placement="bottom">
            <button className="chat-header-action-btn" disabled>
              <FaPhone />
            </button>
          </Tooltip>
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
                data-msg-id={msg.id}
                className={`chat-message ${isOwn ? 'chat-message--own' : 'chat-message--other'}`}
                onContextMenu={(e) => handleMsgContextMenu(e, msg)}
              >
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
                    {msg.is_pinned && (
                      <div className="chat-message-pin-badge">
                        <FaThumbtack />
                        <span>{t('post.pinned')}</span>
                      </div>
                    )}
                    {msg.reply_to && (() => {
                      const replied = messages.find(m => m.id === msg.reply_to);
                      if (!replied) return null;
                      return (
                        <div className="chat-message-reply-preview" onClick={() => handleGoToMessage(msg.reply_to)}>
                          <div className="chat-message-reply-preview-top">
                            <FaReply className="chat-message-reply-preview-icon" />
                            <Avatar
                              src={replied.sender_id === user.id
                                ? (profile?.avatar_url || user?.user_metadata?.avatar_url)
                                : otherUser?.avatar_url}
                              alt={replied.sender_id === user.id ? t('chat.replying_self') : (otherUser?.username || '?')}
                              className="chat-message-reply-preview-avatar"
                            />
                            <div className="chat-message-reply-preview-info">
                              <span className="chat-message-reply-preview-author">
                                {replied.sender_id === user.id
                                  ? t('chat.replying_self')
                                  : (replied.sender_id === otherUser?.id
                                    ? otherUser?.username
                                    : t('common.unknown'))}
                              </span>
                              <span className="chat-message-reply-preview-text">
                                {(() => {
                                  const txt = replied.decryptedContent || '';
                                  if (!txt) return <span>{t('chat.encrypted')}</span>;
                                  if (IMG_RE.test(txt) || /(giphy|tenor|klipy)\.com|(\.|\/)gif/i.test(txt)) {
                                    return <><FaImage className="chat-list-item-preview-icon" /> {/(giphy|tenor|klipy)\.com/i.test(txt) ? 'GIF' : 'Image'}</>;
                                  }
                                  return <>{txt.slice(0, 60)}{txt.length > 60 ? '...' : ''}</>;
                                })()}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {(() => {
                      const content = msg.decryptedContent || '';
                      const { imageUrl } = detectMediaFromContent(content);
                      const textOnly = imageUrl ? content.replace(imageUrl, '').trim() : content;
                      if (!textOnly && !imageUrl) {
                        return (
                          <p className="chat-message-text">
                            {content || <span className="chat-message-encrypted">{t('chat.encrypted')}</span>}
                          </p>
                        );
                      }
                      return (
                        <>
                          {imageUrl && IMG_RE.test(imageUrl) && (
                            <SafeImage
                              src={imageUrl}
                              alt="Media"
                              className="chat-message-media-img"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Collect all image URLs from all messages for gallery navigation
                                const allImages = messages
                                  .map(m => {
                                    const c = m.decryptedContent || '';
                                    const { imageUrl: u } = detectMediaFromContent(c);
                                    return u && IMG_RE.test(u) ? u : null;
                                  })
                                  .filter(Boolean);
                                const idx = allImages.indexOf(imageUrl);
                                openChatGallery(e, allImages.length > 0 ? allImages : [imageUrl], idx >= 0 ? idx : 0);
                              }}
                            />
                          )}
                          {textOnly && <p className="chat-message-text">{textOnly}</p>}
                        </>
                      );
                    })()}
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

              </div>
            );
          })
        )}
      </div>

      {/* ── Typing indicator ── */}
      {otherUserTyping && (
        <div className="chat-typing-indicator">
          <div className="chat-typing-dots">
            <span className="chat-typing-dot"></span>
            <span className="chat-typing-dot"></span>
            <span className="chat-typing-dot"></span>
          </div>
          <span className="chat-typing-label">{otherUser?.username || t('common.unknown')} {t('chat.typing') || 'typing...'}</span>
        </div>
      )}

      {/* Reply bar */}
      {replyingTo && (
        <div className="chat-reply-bar">
          <div className="chat-reply-bar-content">
            <FaReply className="chat-reply-bar-icon" />
            <div className="chat-reply-bar-text">
              <span className="chat-reply-bar-author">
                {replyingTo.sender_id === user.id
                  ? t('chat.replying_self')
                  : otherUser?.username || t('common.unknown')}
              </span>
              <span className="chat-reply-bar-preview">
                {replyingTo.decryptedContent?.slice(0, 80) || t('chat.encrypted')}
                {replyingTo.decryptedContent?.length > 80 ? '...' : ''}
              </span>
            </div>
          </div>
          <button className="chat-reply-bar-close" onClick={cancelReply} title={t('common.cancel')}>
            <FaTimes />
          </button>
        </div>
      )}

      {/* Input + actions */}
      <div className="chat-messages-input">
        {/* Media preview */}
        {mediaPreviewUrl && (
          <div className="chat-media-preview">
            {IMG_RE.test(mediaPreviewUrl) ? (
              <SafeImage src={mediaPreviewUrl} alt="Preview" className="chat-media-preview-img" />
            ) : (
              <span className="chat-media-preview-text">{mediaPreviewUrl}</span>
            )}
            <button className="chat-media-preview-remove" onClick={() => setMediaPreviewUrl('')} title="Remove">
              <FaTimes />
            </button>
          </div>
        )}
        {/* GIF picker */}
        {showGifPicker && (
          <GifPicker
            onSelect={handleGifSelect}
            onClose={() => setShowGifPicker(false)}
          />
        )}
        {/* Input emoji picker */}
        {showInputEmojiPicker && (
          <div className="chat-input-emoji-picker">
            <div className="emoji-picker-tabs">
              {categoriesWithRecent.map((cat, idx) => (
                <button
                  key={idx}
                  className={`emoji-picker-tab ${inputEmojiTab === idx ? 'emoji-picker-tab--active' : ''}`}
                  onClick={() => setInputEmojiTab(idx)}
                  title={cat.name}
                >
                  {cat.name}
                </button>
              ))}
            </div>
            <div className="emoji-picker-grid">
              {categoriesWithRecent[inputEmojiTab]?.emojis.map(emoji => (
                <button
                  key={emoji}
                  className="emoji-picker-btn"
                  onClick={() => handleInputEmojiSelect(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Media URL input */}
        {showMediaInput && (
          <div className="chat-media-input-bar">
            <input
              className="chat-media-input"
              type="url"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder={t('chat.media_placeholder')}
              autoFocus
            />
            <button
              className="chat-media-input-btn"
              onClick={handleMediaSend}
              disabled={!mediaUrl.trim()}
            >
              Add
            </button>
            <button
              className="chat-media-input-close"
              onClick={() => { setShowMediaInput(false); setMediaUrl(''); }}
            >
              <FaTimes />
            </button>
          </div>
        )}
        <div className="chat-input-inner">
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
          <div className="chat-input-actions">
            <button
              className={`chat-input-action-btn ${showInputEmojiPicker ? 'chat-input-action-btn--active' : ''}`}
              onClick={() => { setShowInputEmojiPicker(s => !s); setShowGifPicker(false); }}
              title="Emoji"
            >
              <FaSmile />
            </button>
            <button
              className={`chat-input-action-btn ${showGifPicker ? 'chat-input-action-btn--active' : ''}`}
              onClick={() => { setShowGifPicker(s => !s); setShowInputEmojiPicker(false); }}
              title="GIF"
            >
              <span className="chat-input-action-btn-gif">GIF</span>
            </button>
            <button
              className={`chat-input-action-btn ${showMediaInput ? 'chat-input-action-btn--active' : ''}`}
              onClick={() => setShowMediaInput(s => !s)}
              title="Media"
            >
              <FaImage />
            </button>
            <button
              className="chat-input-action-btn"
              disabled
              title="Audio"
            >
              <FaMusic />
            </button>
          </div>
        </div>
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
      {/* ── Floating emoji picker (positioned like context menu) ── */}
      {emojiPickerMsgId && (
        <div
          ref={emojiPickerRef}
          className="chat-message-emoji-picker"
          style={{ left: emojiPickerPos.x, top: emojiPickerPos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="emoji-picker-tabs">
            {categoriesWithRecent.map((cat, idx) => (
              <button
                key={idx}
                className={`emoji-picker-tab ${emojiTab === idx ? 'emoji-picker-tab--active' : ''}`}
                onClick={() => setEmojiTab(idx)}
                title={cat.name}
              >
                {cat.name}
              </button>
            ))}
          </div>
          <div className="emoji-picker-grid">
            {(() => {
              const targetMsg = messages.find(m => m.id === emojiPickerMsgId);
              const currentOwnReaction = targetMsg?.reactions?.[user?.id];
              return categoriesWithRecent[emojiTab]?.emojis.map(emoji => (
                <button
                  key={emoji}
                  className={`emoji-picker-btn ${currentOwnReaction === emoji ? 'emoji-picker-btn--active' : ''}`}
                  onClick={() => handleReact(emoji)}
                >
                  {emoji}
                </button>
              ));
            })()}
          </div>
        </div>
      )}

      {/* ── Message Search floating panel ── */}
      {showMsgSearch && (
        <div className="chat-float-panel chat-float-panel--search" onClick={(e) => e.stopPropagation()}>
          <div className="chat-float-panel-header">
            <span className="chat-float-panel-title">{t('chat.search_messages') || 'Search'}</span>
            <button className="chat-float-panel-close" onClick={() => setShowMsgSearch(false)}>
              <FaTimes />
            </button>
          </div>
          <div className="chat-msg-search-content">
            <div className="chat-msg-search-bar">
              <FaSearch className="chat-msg-search-bar-icon" />
              <input
                className="chat-msg-search-bar-input"
                type="text"
                value={msgSearchQuery}
                onChange={(e) => setMsgSearchQuery(e.target.value)}
                placeholder={t('chat.search_messages_placeholder') || 'Search messages...'}
                autoFocus
              />
              {msgSearchQuery && (
                <button className="chat-msg-search-bar-clear" onClick={() => setMsgSearchQuery('')}>
                  <FaTimes />
                </button>
              )}
            </div>
            <div className="chat-msg-search-results">
              {(() => {
                const q = msgSearchQuery.toLowerCase();
                const filtered = msgSearchQuery
                  ? messages.filter(m => (m.decryptedContent || '').toLowerCase().includes(q))
                  : [];
                if (filtered.length === 0) {
                  return <div className="chat-msg-search-empty">{msgSearchQuery ? t('explore.no_results') : t('chat.search_messages_placeholder') || 'Search messages...'}</div>;
                }
                return filtered.slice(0, 20).map(msg => {
                  const isOwn = msg.sender_id === user?.id;
                  const senderName = isOwn ? t('chat.replying_self') : (otherUser?.username || t('common.unknown'));
                  const senderAvatar = isOwn
                    ? (profile?.avatar_url || user?.user_metadata?.avatar_url)
                    : otherUser?.avatar_url;
                  return (
                    <button
                      key={msg.id}
                      className="chat-msg-search-result"
                      onClick={() => { handleGoToMessage(msg.id); setShowMsgSearch(false); }}
                    >
                      <Avatar src={senderAvatar} alt={senderName} className="chat-msg-search-result-avatar" />
                      <div className="chat-msg-search-result-info">
                        <span className="chat-msg-search-result-sender">{senderName}</span>
                        <span className="chat-msg-search-result-text">
                          {(() => {
                            const txt = msg.decryptedContent || '';
                            if (!txt) return <span>{t('chat.encrypted')}</span>;
                            if (IMG_RE.test(txt) || /(giphy|tenor|klipy)\.com|(\.|\/)gif/i.test(txt)) {
                              return <><FaImage className="chat-list-item-preview-icon" /> {/(giphy|tenor|klipy)\.com/i.test(txt) ? 'GIF' : 'Image'}</>;
                            }
                            return <>{txt.slice(0, 60)}{txt.length > 60 ? '...' : ''}</>;
                          })()}
                        </span>
                      </div>
                      <span className="chat-msg-search-result-time">
                        {getTimeAgo(t, locale, msg.created_at)}
                      </span>
                    </button>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Media Gallery floating panel ── */}
      {showMediaGallery && (
        <div className="chat-float-panel">
          <div className="chat-float-panel-header">
            <span className="chat-float-panel-title">{t('chat.media_gallery') || 'Media'}</span>
            <button className="chat-float-panel-close" onClick={() => setShowMediaGallery(false)}>
              <FaTimes />
            </button>
          </div>
          <div className="chat-media-gallery-grid">
            {(() => {
              const allImages = messages
                .map(m => {
                  const c = m.decryptedContent || '';
                  const { imageUrl } = detectMediaFromContent(c);
                  return imageUrl && IMG_RE.test(imageUrl) ? imageUrl : null;
                })
                .filter(Boolean);
              if (allImages.length === 0) {
                return <p className="chat-float-panel-empty">{t('chat.no_messages')}</p>;
              }
              return allImages.map((url, i) => (
                <SafeImage
                  key={i}
                  src={url}
                  alt=""
                  className="chat-media-gallery-img"
                  onClick={(e) => {
                    e.stopPropagation();
                    openChatGallery(e, allImages, i);
                  }}
                />
              ));
            })()}
          </div>
        </div>
      )}

      {/* ── Pinned Messages floating panel ── */}
      {showPinnedPanel && (
        <div className="chat-float-panel">
          <div className="chat-float-panel-header">
            <span className="chat-float-panel-title">{t('post.pinned')}</span>
            <button className="chat-float-panel-close" onClick={() => setShowPinnedPanel(false)}>
              <FaTimes />
            </button>
          </div>
          <div className="chat-pinned-list">
            {(() => {
              const pinned = messages.filter(m => m.is_pinned);
              if (pinned.length === 0) {
                return <p className="chat-float-panel-empty">{t('chat.no_messages')}</p>;
              }
              return [...pinned].reverse().map(msg => {
                const sender = msg.sender_id === user?.id
                  ? { name: t('chat.replying_self'), avatar: profile?.avatar_url }
                  : { name: otherUser?.username || '?', avatar: otherUser?.avatar_url };
                return (
                  <button key={msg.id} className="chat-pinned-item" onClick={() => { handleGoToMessage(msg.id); setShowPinnedPanel(false); }}>
                    <FaThumbtack className="chat-pinned-item-icon" />
                    <Avatar src={sender.avatar} alt={sender.name} className="chat-pinned-item-avatar" />
                    <div className="chat-pinned-item-info">
                      <span className="chat-pinned-item-sender">{sender.name}</span>
                      <span className="chat-pinned-item-text">
                        {msg.decryptedContent || t('chat.encrypted')}
                      </span>
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ── Profile Card floating panel ── */}
      {showProfileCard && otherUser && (
        <div className="chat-float-panel" style={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: '0' }}>
          <div className={`explore-card${otherUser.accent_color ? ' explore-card--accent' : ''}`}
            style={{
              '--accent-color': otherUser.accent_color || 'transparent',
              '--accent-color-2': otherUser.accent_color_secondary || otherUser.accent_color || 'transparent',
            }}
            onClick={() => { navigate(`/profile/${otherUser.username}`); setShowProfileCard(false); }}
          >
            <div className="explore-card-banner">
              {otherUser.banner_url && (
                <SafeImage
                  className="explore-card-banner-img"
                  src={otherUser.banner_url}
                  alt=""
                  style={getImgTransformStyle(otherUser.banner_position)}
                />
              )}
              <div className="explore-card-overlay" />
            </div>
            <div className="explore-card-body">
              <Avatar
                className="explore-card-avatar"
                src={otherUser.avatar_url}
                alt={otherUser.username || '?'}
                style={getImgTransformStyle(otherUser.avatar_position)}
              />
              <div className="explore-card-info">
                <div className="explore-card-name-row">
                  <span className="explore-card-name">{otherUser.username || t('common.unknown')}</span>
                  {otherUser.is_private === true && (
                    <span className="explore-card-private-icon" title={t('profile.private_profile')}>
                      <FaLock />
                    </span>
                  )}
                  {Array.isArray(otherUser.roles) && otherUser.roles.some(r => r !== 'user') && (
                    <Badge roles={otherUser.roles} />
                  )}
                </div>
                <span className="explore-card-followers">
                  {otherUser.followerCount || 0} {otherUser.followerCount === 1 ? t('explore.followers_singular') : t('explore.followers_plural')}
                </span>
                {(otherUser.bio || otherUser.pronouns) && (
                  <p className="explore-card-bio">
                    {otherUser.bio || ''}
                    {otherUser.bio && otherUser.pronouns && <span style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.5 }}> · {otherUser.pronouns}</span>}
                    {!otherUser.bio && otherUser.pronouns && <span style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.5 }}>{otherUser.pronouns}</span>}
                  </p>
                )}
                {Array.isArray(otherUser.interests) && otherUser.interests.length > 0 && (
                  <div className="explore-card-interests">
                    {otherUser.interests.slice(0, 3).map((interest, i) => (
                      <span key={i} className="explore-card-interest-pill">{interest}</span>
                    ))}
                    {otherUser.interests.length > 3 && (
                      <span className="explore-card-interest-more">+{otherUser.interests.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="explore-card-action">
                <FollowButton targetUserId={otherUser.id} />
              </div>
            </div>
          </div>
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
              <button className="chat-context-menu-btn" onClick={() => handleStartReply(msgMenu.msg)}>
                <FaReply />
                <span>{t('chat.reply')}</span>
              </button>
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
              <button className="chat-context-menu-btn" onClick={() => handleStartReply(msgMenu.msg)}>
                <FaReply />
                <span>{t('chat.reply')}</span>
              </button>
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

      {/* ── Chat image gallery lightbox ── */}
      {chatGalleryUrls && createPortal(
        <div className="post-card-lightbox" onClick={(e) => { e.stopPropagation(); closeChatGallery(); }}>
          {chatGalleryUrls.length > 1 && (
            <button
              className="post-card-gallery-nav post-card-gallery-nav--prev"
              onClick={(e) => { e.stopPropagation(); goChatGalleryPrev(); }}
              aria-label="Previous"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}

          <div className="post-card-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <div className="post-card-gallery-image-area">
              <SafeImage
                src={chatGalleryUrls[chatGalleryIndex]}
                alt={t('post.full_media')}
                className="post-card-gallery-image"
                key={chatGalleryIndex}
                fallbackText={t('post.image_failed')}
              />
            </div>
            <div className="post-card-lightbox-actions">
              {chatGalleryUrls.length > 1 && (
                <span className="post-card-gallery-counter">
                  {chatGalleryIndex + 1} / {chatGalleryUrls.length}
                </span>
              )}
              <Tooltip text={t('post.open_new_tab')} placement="bottom">
                <a
                  href={chatGalleryUrls[chatGalleryIndex]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="post-card-lightbox-btn"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </Tooltip>
              <Tooltip text={t('post.download')} placement="bottom">
                <a
                  href={chatGalleryUrls[chatGalleryIndex]}
                  download
                  className="post-card-lightbox-btn"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </a>
              </Tooltip>
              <Tooltip text={t('post.close')} placement="bottom">
                <button
                  className="post-card-lightbox-btn post-card-lightbox-close"
                  onClick={closeChatGallery}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </Tooltip>
            </div>

            {/* ── Thumbnail strip ── */}
            {chatGalleryUrls.length > 1 && (
              <div className="post-card-gallery-thumbnails">
                {chatGalleryUrls.map((url, i) => (
                  <button
                    key={i}
                    className={`post-card-gallery-thumb ${i === chatGalleryIndex ? 'post-card-gallery-thumb--active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setChatGalleryIndex(i); }}
                    aria-label={`Go to image ${i + 1}`}
                  >
                    <div className="post-card-gallery-thumb-inner">
                      <SafeImage src={url} alt={`Thumbnail ${i + 1}`} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {chatGalleryUrls.length > 1 && (
            <button
              className="post-card-gallery-nav post-card-gallery-nav--next"
              onClick={(e) => { e.stopPropagation(); goChatGalleryNext(); }}
              aria-label="Next"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
