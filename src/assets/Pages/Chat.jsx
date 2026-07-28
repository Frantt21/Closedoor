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
import { getFollowing } from '../services/followService';
import { isBlocked, getCachedBlockStatus, cacheBlockStatus } from '../services/blockService';
import FollowButton from '../Resources/Components/FollowButton';
import ModalShell from '../Resources/Components/ModalShell';
import { FaComment, FaSearch, FaArrowLeft, FaPlus, FaTimes, FaUserPlus, FaUsers, FaTrash, FaThumbtack, FaCopy, FaEdit, FaCheck, FaSmile, FaReply, FaImage, FaMusic, FaUser, FaPhone, FaLock, FaUpload, FaSpinner, FaEllipsisH, FaArrowDown } from 'react-icons/fa';
import Avatar from '../Resources/Components/Avatar';
import Badge from '../Resources/Components/Badge';
import Tooltip from '../Resources/Components/Tooltip';
import GifPicker from '../Resources/Components/GifPicker';
import { getTimeAgo, IMG_RE, detectMediaFromContent, getImgTransformStyle, getAvatarTransformStyle } from '../services/helpers';
import { getPost } from '../services/postService';
import RichText from '../Resources/Components/RichText';
import SafeImage from '../Resources/Components/SafeImage';
import ConfirmModal from '../Resources/Components/ConfirmModal';
import LinkPreview from '../Resources/Components/LinkPreview';
import { toast } from 'react-toastify';
import { supabase } from '../services/supabaseclient';
import { uploadImage } from '../services/cdnService';
import usePageTitle from '../../hooks/usePageTitle';
import '../Resources/Styles/chat.css';
import '../Resources/Styles/explore.css';
import '../Resources/Styles/post.css';
import '../Resources/Components/css/modal.css';
import { getItem, setItem, removeItem, getSessionItem, setSessionItem, removeSessionItem } from '../services/secureStorage';
import { useUserStatus } from '../services/useUserStatus';

// ── Helper: corrige estados obsoletos usando user_status_updated_at ──
const STALE_STATUS_MS = 60 * 1000; // 1 minuto — debe coincidir con useUserStatus.js
function computeEffectiveStatus(user) {
  if (!user?.user_status) return null;
  if (user.user_status === 'disconnected') return 'disconnected';
  if (!user.user_status_updated_at) return user.user_status;
  const ageMs = Date.now() - new Date(user.user_status_updated_at).getTime();
  return ageMs > STALE_STATUS_MS ? 'disconnected' : user.user_status;
}

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
  const [uploadingChatMedia, setUploadingChatMedia] = useState(false);
  const editRef = useRef(null);
  // Preserve content during modal close animation (ref survives state clears)
  const editContentRef = useRef('');
  // Preserve the editing message's image URL for the edit modal preview
  const editMediaUrlRef = useRef('');

  // Emoji picker state
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState({ x: 0, y: 0 });
  const [emojiTab, setEmojiTab] = useState(0);
  const [recentEmojis, setRecentEmojis] = useState([]);
  const emojiPickerRef = useRef(null);

  // Categorized emojis for reactions
  const MAX_RECENT = 30;

  const EMOJI_CATEGORIES = [
    {
      name: '😀', emojis: ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🫣','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','😮','😯','😲','😳','🥺','😢','😭','😤','😠','😡','🤬','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾']
    },
    {
      name: '👋', emojis: ['👍','👎','👊','✊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✌️','🤟','🤘','👌','🤌','🤏','👉','👈','👆','👇','☝️','✋','🤚','🖐','🖖','👋','🤙','🫶','💪','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','👀','👁️','👅','👄','🦷','🦴','👶','🧒','👦','👧','🧑','👱','👨','👩','🧔','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🤦','🤷','👮','🕵️','💂','🥷','👷','🫅','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🫃','🫄','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟','🧌']
    },
    {
      name: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❤️‍🔥','❤️‍🩹','💔','❣️','💕','💞','💗','💖','💘','💝','💟','💌','💋','💑','💏','👩‍❤️‍👨','👨‍❤️‍👨','👩‍❤️‍👩','💒','❤️‍💋‍👨','❤️‍💋‍👩']
    },
    {
      name: '🐱', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🪸','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🪶','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔','🐾','🐉','🐲']
    },
    {
      name: '🔥', emojis: ['🔥','⭐','🌟','✨','💫','⚡','🌈','🌊','☀️','🌤️','⛅','🌥️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','💧','💦','🫧','☔','☂️','🌫️','🌪️','🌙','🌚','🌛','🌜','🌝','🌞','🪐','💥','☄️','🌍','🌎','🌏','🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘']
    },
    {
      name: '🌸', emojis: ['🌸','💐','💮','🪷','🌹','🥀','🌺','🌻','🌼','🌷','🪻','🌱','🪴','🌿','☘️','🍀','🍁','🍂','🍃','🪹','🪺','🍄','🌾','🌵','🎄','🌲','🌳','🌴','🪵']
    },
    {
      name: '🎉', emojis: ['🎉','🎊','🎈','🎁','🎀','🎃','🎄','🎆','🎇','🧨','✨','🎶','🎵','🎸','🎹','🎺','🎻','🥁','🪘','🎷','📯','🎙️','🎚️','🎛️','🎤','🎧','📻','🎯','🎱','🎲','🎮','🕹️','🎭','🎨','🎪','🎼','🪕','🎬','🎟️','🎫','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️']
    },
    {
      name: '🍕', emojis: ['🍇','🍈','🍉','🍊','🍋','🍌','🍍','🥭','🍎','🍏','🍐','🍑','🍒','🍓','🫐','🥝','🍅','🫒','🥥','🥑','🍆','🥔','🥕','🌽','🌶️','🫑','🥒','🥬','🥦','🧄','🧅','🍄','🥜','🫘','🌰','🍞','🥐','🥖','🫓','🥨','🥯','🥞','🧇','🧀','🍖','🍗','🥩','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🫔','🥙','🧆','🥚','🍳','🥘','🍲','🫕','🥣','🥗','🍿','🧈','🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🥡','🦀','🦞','🦐','🦑','🦪','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍼','🥛','☕','🫖','🍵','🍶','🍾','🍷','🍸','🍹','🍺','🍻','🥂','🥃','🫗','🥤','🧋','🧃','🧉','🧊']
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

  // Close context menus on click outside + on scroll (but ignore scrolls originating inside the menus)
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

    // Scroll handler will close menus only when the scroll event does NOT originate
    // from inside any of the interactive menu elements (context menu, message menu, emoji picker).
    const handleScroll = (e) => {
      const target = e?.target;
      // If the scroll target is inside any menu, do nothing.
      if (target) {
        if (contextMenuRef.current && contextMenuRef.current.contains(target)) return;
        if (msgMenuRef.current && msgMenuRef.current.contains(target)) return;
        if (emojiPickerRef.current && emojiPickerRef.current.contains(target)) return;
      }
      // Otherwise, close all menus
      setContextMenu({ open: false, x: 0, y: 0, convId: null });
      setMsgMenu({ open: false, x: 0, y: 0, msg: null });
      setEmojiPickerMsgId(null);
      setShowMobileMenu(false);
    };

    document.addEventListener('click', handleClick);
    // Use capture so we receive scroll events from nested scrollable elements; handler filters internal scrolls.
    document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', handleScroll, { capture: true });
    };
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
  const skipCacheWipeRef = useRef(false);  // prevents useLayoutEffect from wiping messages when resolving pending conv
  const skipMsgLoadRef = useRef(false);   // prevents useEffect from fetching messages when sendContent resolves pending conv
  const draftsRef = useRef({}); // borradores del input por conversation ID
  const prevConvIdRef = useRef(null);
  const messagesOwnerRef = useRef(null); // tracks which conversation the current `messages` state belongs to
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  // ── Shared post data cache (state to trigger re-render) ──
  const [sharedPosts, setSharedPosts] = useState({});

  // ── SessionStorage cache helpers (survives page reload, cleared on tab close) ──
  const getSessionCacheKey = () => `chatMessagesCache_${user?.id || 'anon'}`;
  const loadCacheFromSession = () => {
    try {
      const saved = getSessionItem(getSessionCacheKey());
      if (saved) return saved;
    } catch {}
    return {};
  };
  const saveCacheToSession = (cache) => {
    try {
      // Limit size: keep only last 200 messages per conversation
      const trimmed = {};
      for (const [convId, msgs] of Object.entries(cache)) {
        if (convId === '_meta') {
          trimmed._meta = msgs;
        } else if (Array.isArray(msgs)) {
          trimmed[convId] = msgs.length > 200 ? msgs.slice(msgs.length - 200) : msgs;
        }
      }
      setSessionItem(getSessionCacheKey(), trimmed);
    } catch (e) {
      // sessionStorage quota exceeded — clear cache
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        try { removeSessionItem(getSessionCacheKey()); } catch {}
      }
    }
  };

  // ── Flag de sesión: evita borrar el caché en cada navegación SPA ──
  // `performance.getEntriesByType('navigation')` retorna el tipo de carga ORIGINAL
  // de la página. Si el usuario recargó (F5), type = 'reload'. Pero al navegar
  // a otra ruta y volver (SPA), el componente se monta de nuevo y el tipo SIGUE
  // siendo 'reload' — causando que el caché se borre en cada ruta.
  // window.__fc_cacheClearedOnReload persiste a través de montajes/desmontajes.

  // Restore cache from sessionStorage — only when user is available (not during auth loading)
  const sessionRestoredRef = useRef(false);
  if (!sessionRestoredRef.current && user?.id) {
    let isReload = false;
    try {
      const navEntries = performance.getEntriesByType ? performance.getEntriesByType('navigation') : null;
      const navType = navEntries?.[0]?.type || (performance.navigation && performance.navigation.type === 1 ? 'reload' : 'navigate');
      isReload = navType === 'reload';
    } catch (e) { /* ignore */ }

    if (isReload && !window.__fc_cacheClearedOnReload) {
      // 1ª vez: reload real → limpiar caché
      window.__fc_cacheClearedOnReload = true;
      try { removeSessionItem(getSessionCacheKey()); } catch (e) {}
      messagesCacheRef.current = {};
      console.log('[CACHE] Reload — caché limpiado (1 vez por sesión)');
    } else {
      // 2ª vez+ (SPA navigation) o navegación normal → restaurar desde sessionStorage
      const restored = loadCacheFromSession();
      const convCount = Object.keys(restored).filter(k => k !== '_meta').length;
      if (Object.keys(restored).length > 0) {
        messagesCacheRef.current = restored;
        console.log('[CACHE] Restaurado —', convCount, 'conversaciones');
      } else {
        console.log('[CACHE] Sin caché en sessionStorage');
      }
    }

    sessionRestoredRef.current = true;
  }

  // ── Conversations sessionStorage cache ──
  const getConvsSessionCacheKey = () => `chatConvsCache_${user?.id || 'anon'}`;
  const loadConvsFromSession = () => {
    try {
      const saved = getSessionItem(getConvsSessionCacheKey());
      if (saved) return saved;
    } catch {}
    return [];
  };
  const saveConvsToSession = (convs) => {
    try {
      setSessionItem(getConvsSessionCacheKey(), convs);
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        try { removeSessionItem(getConvsSessionCacheKey()); } catch {}
      }
    }
  };

  // Restore conversations from sessionStorage on mount
  const convsSessionRestoredRef = useRef(false);
  // Restore from cache DURING RENDER phase (before first paint)
  // This prevents the skeleton flash on SPA navigation
  if (!convsSessionRestoredRef.current && user?.id) {
    convsSessionRestoredRef.current = true;
    const cached = loadConvsFromSession();
    if (cached.length > 0 && conversations.length === 0) {
      // React 18 allows setState during render — triggers re-render before commit
      setConversations(cached);
      setConvsLoading(false);
    }
  }

  // ── Pagination state (infinite scroll / load older messages) ──
  const PAGE_SIZE = 40;
  const INITIAL_BATCH_LIMIT = 40; // fetch first 40 messages on initial load, then lazy load more via scroll
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [oldestMessageDate, setOldestMessageDate] = useState(null);
  // Ref to preserve scroll position when prepending older messages
  const scrollBeforeLoadRef = useRef(null);
  // Cooldown to prevent cascading loads after scroll restoration
  const lastLoadTimeRef = useRef(0);
  // Sync ref: prevents multiple loadOlderMessages calls in same event loop tick
  // (setLoadingMore(true) is async - React batches until next render)
  const loadingMoreRef = useRef(false);
  // ── "New messages" floating button counter ──
  const [newMsgCount, setNewMsgCount] = useState(0);
  // ── Track if user has scrolled up (show scroll-to-bottom button) ──
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  // ── Blocked status: null=unknown, 'blocked_by_me', 'blocked_by_them' ──
  const [isBlockedConv, setIsBlockedConv] = useState(null);
  const scrollToBottom = useCallback(() => {
    messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setNewMsgCount(0);
  }, []);

  // ── useLayoutEffect: runs BEFORE browser paint — garantiza que no haya flash de mensajes viejos ──
  useLayoutEffect(() => {
    if (!activeConvId) return;
    if (prevConvIdRef.current === activeConvId) {
      console.log('[BUG] layout — mismo conv, skip');
      return;
    }

    // Save current messages to the OLD conversation's cache before switching
    if (prevConvIdRef.current && messagesOwnerRef.current === prevConvIdRef.current) {
      // Don't overwrite — the cache is already up-to-date from the sync effect
    }

    // Don't wipe messages when resolving a pending conversation to real ID
    if (skipCacheWipeRef.current) {
      skipCacheWipeRef.current = false;
      prevConvIdRef.current = activeConvId;
      messagesOwnerRef.current = activeConvId;
      console.log('[BUG] layout — skipCacheWipe, set owner to', activeConvId.slice(0,8));
      return;
    }

    // Limpiar/restaurar mensajes inmediatamente ANTES del paint
    const cached = messagesCacheRef.current[activeConvId];
    const cachedMeta = messagesCacheRef.current._meta?.[activeConvId];

    const cacheLen = cached && Array.isArray(cached) ? cached.length : 0;
    const cacheMeta = cachedMeta?.hasMoreMessages;
    if (cached && Array.isArray(cached)) {
      // Check if cache is stale by comparing with conv.last_message_at
      const activeConv = conversations.find(c => c.id === activeConvId);
      const lastMsgAt = activeConv?.last_message_at;
      const fetchedAt = cachedMeta?.fetchedAt;
      const isStale = lastMsgAt && fetchedAt && new Date(lastMsgAt) > new Date(fetchedAt);
      console.log('[BUG] layout — CACHE HIT:', activeConvId.slice(0,8), 'len:', cached.length, 'stale:', !!isStale);

      if (isStale) {
        console.log('[BUG] layout — stale, clearing for refetch');
        setMessages([]);
        setMsgsLoading(true);
        setHasMoreMessages(true);
        setOldestMessageDate(null);
      } else {
        console.log('[BUG] layout — restoring from cache, skipMsgLoad=true');
        setMessages(cached);
        setMsgsLoading(false);
        if (cached.length > 0 && cachedMeta?.hasMoreMessages === false) {
          setHasMoreMessages(true);
        } else {
          const newVal = cachedMeta?.hasMoreMessages ?? true;
          setHasMoreMessages(newVal);
        }
        const restoredDate = cachedMeta?.oldestMessageDate ?? (cached.length > 0 ? cached[0].created_at : null);
        setOldestMessageDate(restoredDate);
        skipMsgLoadRef.current = true;
      }
    } else {
      console.log('[BUG] layout — NO CACHE for', activeConvId.slice(0,8), ', setting msgsLoading=true');
      setMessages([]);
      setMsgsLoading(true);
      setHasMoreMessages(true);
      setOldestMessageDate(null);
    }
    console.log('[BUG] layout — setting owner to', activeConvId.slice(0,8));
    messagesOwnerRef.current = activeConvId;
    prevConvIdRef.current = activeConvId;
  }, [activeConvId, conversations]);

  // ── Reset loadingMore when conversation changes (pagination state reset is handled in layout effect) ──
  useEffect(() => {
    setLoadingMore(false);
    loadingMoreRef.current = false; // sync ref must also reset to prevent stale blocking
  }, [activeConvId]);

  // ── Load conversations ──
  const loadConvs = useCallback(async () => {
    if (!user?.id) return;
    try {
      const convs = await getConversations(user.id);
      setConversations(convs);
      // Persist to sessionStorage after successful fetch
      saveConvsToSession(convs);
    } catch (err) {
      console.warn('Error loading conversations:', err);
    } finally {
      setConvsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    // If cache was restored during render phase, just clear the loading state
    // (the render-phase block already called setConvsLoading(false)).
    // Otherwise, fetch from DB — loadConvs() manages convsLoading in its finally block.
    if (conversations.length === 0) {
      loadConvs();
    } else {
      setConvsLoading(false);
    }
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
    // Skip DB ops for pending conversations (temp IDs like "pending_xxx" are not real UUIDs)
    if (activeConvId.startsWith('pending_')) {
      setMsgsLoading(false);
      return;
    }

    // Determine whether to skip the DB fetch (fresh cache restored by layout effect)
    const skipFetch = skipMsgLoadRef.current;
    console.log('[BUG] msgEffect — activeConvId:', activeConvId.slice(0,8), 'skipFetch:', skipFetch, 'msgsLoading:', msgsLoading);
    skipMsgLoadRef.current = false;
    let aborted = false;
    const convForThisEffect = activeConvId;

    markAsRead(activeConvId, user.id);

    // ══ DB fetch — skipped when layout effect restored from fresh cache ══
    if (!skipFetch) {
      console.log('[BUG] msgEffect — starting DB fetch for', convForThisEffect.slice(0,8));
      (async () => {
        try {
          let attempts = 0;
          let raw = [];
          let filtered = [];
          let decrypted = [];
          let hasMore = false;
          let cursor = null;
          const fetchLimit = INITIAL_BATCH_LIMIT + 1; // request one extra to detect 'more'

          do {
            attempts += 1;
            raw = await getMessages(convForThisEffect, fetchLimit, cursor);
            if (aborted) {
              console.log('[BUG] msgEffect — ABORTED after fetch for', convForThisEffect.slice(0,8));
              return;
            }
            hasMore = (raw.length > INITIAL_BATCH_LIMIT);
            // If we requested extra, drop the extra marker when mapping
            if (raw.length > INITIAL_BATCH_LIMIT) raw = raw.slice(0, INITIAL_BATCH_LIMIT);

            filtered = raw.filter(m => !m.deleted_for?.includes(user.id));
            // Decrypt visible messages
            decrypted = await Promise.all(
              filtered.map(async (msg) => {
                const content = await decryptMessage(msg, user.id);
                return { ...msg, decryptedContent: content };
              })
            );

            // If we got no visible messages (all were deleted), but there are more on the server,
            // advance the cursor to the last raw item's created_at and retry up to 3 attempts.
            if (decrypted.length === 0 && hasMore && attempts < 3) {
              cursor = raw.length ? raw[raw.length - 1].created_at : null;
              continue;
            }
            break;
          } while (attempts < 3);

          if (aborted) {
            console.log('[BUG] msgEffect — ABORTED after loop for', convForThisEffect.slice(0,8));
            return;
          }

          console.log('[BUG] msgEffect — fetch OK for', convForThisEffect.slice(0,8), 'got', decrypted.length, 'messages');

          // Pre-fetch shared post data BEFORE setMessages
          const sharedPostIds = [...new Set(decrypted.filter(m => m.shared_post_id).map(m => m.shared_post_id))];
          if (sharedPostIds.length > 0) {
            await Promise.all(sharedPostIds.map(async (pid) => {
              if (sharedPosts[pid]) return;
              try {
                const postData = await getPost(pid);
                setSharedPosts(prev => ({ ...prev, [pid]: postData }));
              } catch {}
            }));
          }

          messagesCacheRef.current[convForThisEffect] = decrypted;
          messagesOwnerRef.current = convForThisEffect;
          setMessages(decrypted);
          if (decrypted.length > 0) {
            setOldestMessageDate(decrypted[0].created_at);
          }
          setHasMoreMessages(hasMore);
        } catch (err) {
          if (!aborted) console.warn('[BUG] msgEffect — Error loading messages:', err);
        } finally {
          if (!aborted) {
            console.log('[BUG] msgEffect — done, msgsLoading=false for', convForThisEffect.slice(0,8));
            setMsgsLoading(false);
          } else {
            console.log('[BUG] msgEffect — skip msgsLoading=false (aborted) for', convForThisEffect.slice(0,8));
          }
        }
      })();
    } else {
      console.log('[BUG] msgEffect — SKIP db fetch for', activeConvId.slice(0,8), '(cache was fresh)');
      setMsgsLoading(false);
    }

    // ══ Realtime subscription — ALWAYS subscribed, even when cache was fresh ══
    const unsub = subscribeToMessages(
      convForThisEffect,
      async (newMsg, eventType) => {
        if (aborted) return;
        const content = await decryptMessage(newMsg, user.id);
        if (aborted) return;
        if (newMsg.shared_post_id && !sharedPosts[newMsg.shared_post_id]) {
          try {
            const postData = await getPost(newMsg.shared_post_id);
            setSharedPosts(prev => ({ ...prev, [newMsg.shared_post_id]: postData }));
          } catch {}
        }
        if (eventType === 'UPDATE') {
          setMessages((prev) => prev.map((msg) => msg.id === newMsg.id ? { ...msg, ...newMsg, decryptedContent: content } : msg));
        } else {
          setMessages((prev) => {
            const exists = prev.some(m => m.id === newMsg.id);
            if (exists) {
              return prev.map(m => m.id === newMsg.id ? { ...m, ...newMsg, decryptedContent: content } : m);
            }
            return [...prev, { ...newMsg, decryptedContent: content }];
          });
          updateConvPreview(
            convForThisEffect,
            content || '',
            newMsg.created_at,
            newMsg.sender_id !== user.id
          );
          // Only auto-scroll if user is near the bottom of the chat
          const el = messagesContainerRef.current;
          const isNearBottom = el && (el.scrollTop > -80 || el.scrollHeight - el.clientHeight + el.scrollTop < 80);
          if (isNearBottom) {
            setTimeout(() => messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 50);
            setNewMsgCount(0);
          } else {
            setNewMsgCount(prev => prev + 1);
          }
        }
        markAsRead(convForThisEffect, user.id);
      },
      // onDelete: called when a message is deleted by the other user
      (deletedId) => {
        if (aborted) return;
        setMessages((prev) => prev.filter(m => m.id !== deletedId));
        markAsRead(convForThisEffect, user.id);
      }
    );

    return () => {
      console.log('[BUG] msgEffect — CLEANUP, setting aborted=true for', convForThisEffect.slice(0,8), '| current activeConvId:', activeConvId.slice(0,8));
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

  // ── Load stored emojis on mount, persist on change ──
  useEffect(() => {
    const stored = getItem('chatRecentEmojis');
    if (Array.isArray(stored) && stored.length > 0) {
      setRecentEmojis(stored);
    }
  }, []);
  useEffect(() => {
    setItem('chatRecentEmojis', recentEmojis);
  }, [recentEmojis]);

  // Sync messages cache on every update (realtime, delete, edit, etc.)
  // Only writes to cache if the messages actually belong to activeConvId
  // IMPORTANT: Skip saving while loading (msgsLoading) to avoid a race condition:
  //   When switching chats, the layout effect sets messages=[] before the DB fetch
  //   completes. Without this guard, the cache for the old conversation gets
  //   overwritten with [], destroying valid cached data.
  useEffect(() => {
    if (!activeConvId) { console.log('[BUG] sync — no activeConvId'); return; }
    if (messagesOwnerRef.current !== activeConvId) {
      console.log('[BUG] sync — SKIP owner mismatch, conv:', activeConvId.slice(0,8), 'owner:', messagesOwnerRef.current?.slice(0,8));
      return;
    }
    if (msgsLoading) {
      console.log('[BUG] sync — SKIP msgsLoading=true para', activeConvId.slice(0,8));
      return;
    }
    messagesCacheRef.current[activeConvId] = messages;
    // Update fetchedAt + pagination state for staleness check on next conversation switch
    if (!messagesCacheRef.current._meta) messagesCacheRef.current._meta = {};
    messagesCacheRef.current._meta[activeConvId] = {
      fetchedAt: new Date().toISOString(),
      hasMoreMessages,
      oldestMessageDate,
    };
    // Persist to sessionStorage so cache survives page reload
    console.log('[BUG] sync — guardando', messages.length, 'mensajes en cache para', activeConvId.slice(0,8));
    saveCacheToSession(messagesCacheRef.current);
  }, [messages, activeConvId, msgsLoading]);

  // ── Flush messages cache on pagehide & unmount (navegación entre rutas) ──
  useEffect(() => {
    const flushCache = () => {
      if (!activeConvId) return;
      if (messagesOwnerRef.current !== activeConvId) return;
      messagesCacheRef.current[activeConvId] = messages;
      if (!messagesCacheRef.current._meta) messagesCacheRef.current._meta = {};
      messagesCacheRef.current._meta[activeConvId] = {
        fetchedAt: new Date().toISOString(),
        hasMoreMessages,
        oldestMessageDate,
      };
      saveCacheToSession(messagesCacheRef.current);
    };
    const handlePageHide = () => {
      console.log('[CACHE] pagehide — flusheando caché');
      flushCache();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      console.log('[CACHE] cleanup — flusheando caché antes de desmontar');
      flushCache(); // flush on unmount (route change)
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [activeConvId, messages, hasMoreMessages, oldestMessageDate]);

  // Persist conversations to sessionStorage on every change
  useEffect(() => {
    if (!user?.id) return;
    if (!convsSessionRestoredRef.current) return; // don't save before initial restore
    saveConvsToSession(conversations);
  }, [conversations, user?.id]);

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

    // ── Restaurar mensajes desde caché inmediatamente (síncrono) ──
    // Así, al cambiar de ruta y volver, los mensajes aparecen al instante
    // sin pasar por el estado de carga (spinner/skeleton).
    const cached = messagesCacheRef.current[convId];
    if (cached && Array.isArray(cached) && cached.length > 0) {
      const meta = messagesCacheRef.current._meta?.[convId];
      const conv = conversations.find(c => c.id === convId);
      const lastMsgAt = conv?.last_message_at;
      const fetchedAt = meta?.fetchedAt;
      const isStale = lastMsgAt && fetchedAt && new Date(lastMsgAt) > new Date(fetchedAt);
      console.log('[BUG] selectConv — cache HIT:', convId.slice(0,8), 'len:', cached.length, 'stale:', !!isStale, 'lastMsgAt:', lastMsgAt, 'fetchedAt:', fetchedAt);
      if (!isStale) {
        console.log('[BUG] selectConv — restoring, skipMsgLoad=true');
        setMessages(cached);
        setMsgsLoading(false);
        skipMsgLoadRef.current = true;
        if (meta) {
          setHasMoreMessages(meta.hasMoreMessages ?? true);
          setOldestMessageDate(meta.oldestMessageDate ?? null);
        }
      } else {
        console.log('[CACHE] selectConversation — caché obsoleto, se recargará de DB');
      }
    } else {
      console.log('[CACHE] selectConversation — sin caché para', convId.slice(0,8));
    }

    setActiveConvId(convId);
    setShowList(false);
    // Cerrar paneles flotantes al cambiar de chat
    setShowMsgSearch(false);
    setShowMediaGallery(false);
    setShowPinnedPanel(false);
    setShowProfileCard(false);
    // Resetear scroll al fondo (top: 0 en column-reverse = mensajes nuevos)
    setTimeout(() => {
      messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'instant' });
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

  // ── Send message — solo enviar si no hay subida en curso ──
  const handleSend = async () => {
    if (uploadingChatMedia) {
      toast.info(t('chat.waiting_upload') || 'Espera a que la imagen termine de subirse');
      return;
    }
    const trimmed = inputValue.trim();
    const hasPreview = !!mediaPreviewUrl;
    if (!trimmed && !hasPreview) return;
    const content = hasPreview
      ? (trimmed ? `${trimmed}\n${mediaPreviewUrl}` : mediaPreviewUrl)
      : trimmed;
    // Clear preview IMMEDIATELY (optimistic) BEFORE the async sendContent
    if (hasPreview) setMediaPreviewUrl('');
    await sendContent(content, { clearInput: true });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Ref for pending conversations (created locally, not yet in DB) ──
  const pendingConvRef = useRef(null);

  // ── Filter conversations by username/displayname ──
  const handleSearchChange = useCallback((e) => {
    setSearchQuery(e.target.value);
  }, []);

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

    // ── Check if there's already an existing conversation (was hidden/deleted locally) ──
    // If so, unhide and select it directly so messages load immediately
    try {
      const { data: myConvs } = await supabase
        .from('chat_participants')
        .select('conversation_id')
        .eq('user_id', user.id);

      const myConvIds = (myConvs || []).map(p => p.conversation_id);

      if (myConvIds.length > 0) {
        const { data: match } = await supabase
          .from('chat_participants')
          .select('conversation_id')
          .in('conversation_id', myConvIds)
          .eq('user_id', otherUser.id)
          .maybeSingle();

        if (match) {
          // Existing conversation found — unhide and select it
          setHiddenConvIds((prev) => prev.filter(id => id !== match.conversation_id));
          setSearchQuery('');
          selectConversation(match.conversation_id);
          return;
        }
      }
    } catch { /* fall through to pending flow */ }

    // ── No existing conversation — use pending flow to avoid creating empty conv in DB ──
    const tempId = `pending_${crypto.randomUUID()}`;
    pendingConvRef.current = { otherUser, tempId };

    // Add local conversation entry so the UI shows it immediately
    setConversations(prev => [{
      id: tempId,
      otherUser,
      unreadCount: 0,
      last_message_text: null,
      last_message_at: null,
      _pending: true,
    }, ...prev.filter(c => c.id !== tempId)]);

    setSearchQuery('');
    selectConversation(tempId);
  };

  // ── Context menu handlers (conversation list) ──
  const handleContextMenu = useCallback((e, convId) => {
    e.preventDefault();
    const pos = getSmartMenuPosition(e.clientX, e.clientY, 160, 80);
    setContextMenu({ open: true, x: pos.x, y: pos.y, convId });
  }, [getSmartMenuPosition]);

  const [hiddenConvIds, setHiddenConvIds] = useState(() => {
    try {
      const saved = getItem('hiddenConvIds');
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });

  // Filter out hidden + searched conversations from the list
  const visibleConversations = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return conversations.filter(c => !hiddenConvIds.includes(c.id));
    }
    return conversations.filter(c => {
      if (hiddenConvIds.includes(c.id)) return false;
      const name = (c.otherUser?.displayname || c.otherUser?.username || '').toLowerCase();
      const uname = (c.otherUser?.username || '').toLowerCase();
      return name.includes(q) || uname.includes(q);
    });
  }, [conversations, hiddenConvIds, searchQuery]);

  // Persist hidden IDs (saved by lazy initializer on mount, persisted on every change)
  useEffect(() => {
    setItem('hiddenConvIds', hiddenConvIds);
  }, [hiddenConvIds]);

  const handleDeleteConversation = useCallback(() => {
    const convId = contextMenu.convId;
    if (!convId) return;
    setContextMenu({ open: false, x: 0, y: 0, convId: null });
    // Solo local: ocultar la conversación, no tocar la DB
    setHiddenConvIds((prev) => [...prev, convId]);
    if (activeConvId === convId) {
      setActiveConvId(null);
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
    const { imageUrl } = detectMediaFromContent(msg.decryptedContent);
    editMediaUrlRef.current = imageUrl || '';
    // Strip image URL from text, so the user only edits the text portion
    let cleanText = msg.decryptedContent;
    if (imageUrl) {
      cleanText = cleanText.replace(imageUrl, '').replace(/\n{2,}/g, '\n').trim();
    }
    setEditMsgId(msg.id);
    setEditText(cleanText);
    setShowEditModal(true);
  }, [msgMenu.msg]);

  const handleCancelEdit = useCallback(() => {
    setEditMsgId(null);
    setEditText('');
    setShowEditModal(false);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editMsgId || (!editText.trim() && !editMediaUrlRef.current) || !user?.id) return;
    try {
      // Reconstruct full content: text + image URL
      const textPart = editText.trim();
      const imagePart = editMediaUrlRef.current || '';
      const fullContent = imagePart ? (textPart ? `${textPart}\n${imagePart}` : imagePart) : textPart;

      // Get participant IDs
      const { data: participants } = await supabase
        .from('chat_participants')
        .select('user_id')
        .eq('conversation_id', activeConvId);
      const participantIds = (participants || []).map(p => p.user_id).filter(id => id !== user.id);

      await editMessage(editMsgId, user.id, fullContent, participantIds);
      // Update local state with edited content
      setMessages((prev) => prev.map(m =>
        m.id === editMsgId
          ? { ...m, decryptedContent: fullContent, edited_at: new Date().toISOString() }
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

  // ── External link warning state ──
  const [confirmExternalLink, setConfirmExternalLink] = useState(null);

  // ── External link warning handlers ──
  const handleExternalLink = useCallback((url) => {
    setConfirmExternalLink(url);
  }, []);

  const executeExternalLink = useCallback(() => {
    if (confirmExternalLink) {
      window.open(confirmExternalLink, '_blank', 'noopener noreferrer');
    }
    setConfirmExternalLink(null);
  }, [confirmExternalLink]);

  const handleCancelExternalLink = useCallback(() => {
    setConfirmExternalLink(null);
  }, []);

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

  // ── Upload image file to CDN for chat (subida directa, sin blob) ──
  const handleChatMediaUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    if (!file.type.startsWith('image/')) {
      toast.error(t('modal.invalid_image_type') || 'Invalid image type');
      return;
    }

    setUploadingChatMedia(true);
    setMediaPreviewUrl('');
    setShowMediaInput(false);
    const toastId = toast.loading(t('upload.uploading') || 'Subiendo imagen...');

    try {
      const result = await uploadImage(file, user.id, 'chat');
      const realUrl = result.url || '';
      if (!realUrl) throw new Error('Upload returned empty URL');

      setMediaPreviewUrl(realUrl);
      setTimeout(() => inputRef.current?.focus(), 50);

      toast.update(toastId, {
        render: t('upload.uploaded') || 'Imagen subida',
        type: 'success',
        isLoading: false,
        autoClose: 2000,
      });
    } catch (err) {
      console.error('CDN upload error:', err);
      setMediaPreviewUrl('');
      toast.update(toastId, {
        render: err.message || 'Upload failed',
        type: 'error',
        isLoading: false,
        autoClose: 3000,
      });
    } finally {
      setUploadingChatMedia(false);
      e.target.value = '';
    }
  }, [user?.id, t]);

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
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [mobileMenuTop, setMobileMenuTop] = useState(0);

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

  // ── Subscribe to other users' realtime status for the visible conversation list ──
  const visibleConversationUserIds = React.useMemo(() => {
    return (visibleConversations || [])
      .map((conv) => conv.otherUser?.id)
      .filter(Boolean);
  }, [visibleConversations]);

  const { statuses: otherUserStatuses } = useUserStatus(user?.id, visibleConversationUserIds, true);
  const activeConversationStatus = otherUser?.id
    ? (otherUserStatuses?.[otherUser.id] ?? computeEffectiveStatus(otherUser))
    : null;

  // ── Blocked status detection (check cache + server) ──
  // Reset when changing conversations
  useEffect(() => {
    setIsBlockedConv(null);
    if (!activeConvId || !user?.id || !otherUser?.id) return;

    const checkBlock = async () => {
      // Cache check first (instant)
      const cachedByMe = getCachedBlockStatus(user.id, otherUser.id);
      const cachedByThem = getCachedBlockStatus(otherUser.id, user.id);
      if (cachedByMe === true) { setIsBlockedConv('blocked_by_me'); return; }
      if (cachedByThem === true) { setIsBlockedConv('blocked_by_them'); return; }

      // Server check in background (the input works normally until verified)
      try {
        const [byMe, byThem] = await Promise.all([
          isBlocked(user.id, otherUser.id),
          isBlocked(otherUser.id, user.id),
        ]);
        if (byMe) { cacheBlockStatus(user.id, otherUser.id, true); setIsBlockedConv('blocked_by_me'); return; }
        if (byThem) { cacheBlockStatus(otherUser.id, user.id, true); setIsBlockedConv('blocked_by_them'); return; }
        setIsBlockedConv(false);
      } catch { setIsBlockedConv(false); }
    };
    checkBlock();
  }, [activeConvId, otherUser?.id, user?.id]);

  // ── Update conversation list preview immediately (optimistic local update) ──
  const updateConvPreview = useCallback((convId, lastMsgText, lastMsgAt, incrementUnread = false) => {
    setConversations(prev => {
      const obfuscated = lastMsgText
        ? (lastMsgText.length > 80 ? lastMsgText.slice(0, 80) + '...' : lastMsgText)
        : lastMsgText;
      return prev
        .map(c => {
          if (c.id !== convId) return c;
          return {
            ...c,
            last_message_text: obfuscated,
            last_message_at: lastMsgAt,
            unreadCount: incrementUnread ? (c.unreadCount || 0) + 1 : c.unreadCount,
          };
        })
        // Move updated conversation to the top (most recent)
        .sort((a, b) => {
          if (a.id === convId) return -1;
          if (b.id === convId) return 1;
          return 0;
        });
    });
  }, []);

  // ── Delete message handlers (defined after updateConvPreview to avoid TDZ) ──
  const handleDeleteMessage = useCallback(async () => {
    const msg = msgMenu.msg;
    const convId = activeConvId;
    setMsgMenu({ open: false, x: 0, y: 0, msg: null });
    if (!msg || !convId) return;
    try {
      await deleteMessage(msg.id);
      setMessages((prev) => {
        const filtered = prev.filter(m => m.id !== msg.id);
        // If deleted message was the last one, update the conversation preview
        const wasLast = msg.id === prev[prev.length - 1]?.id;
        if (wasLast) {
          const newLast = filtered[filtered.length - 1];
          updateConvPreview(
            convId,
            newLast?.content || newLast?.decryptedContent || null,
            newLast?.created_at || null
          );
        }
        return filtered;
      });
    } catch (err) {
      console.error('Error deleting message:', err);
    }
  }, [msgMenu.msg, activeConvId, updateConvPreview]);

  const handleDeleteMessageForMe = useCallback(async () => {
    const msg = msgMenu.msg;
    const convId = activeConvId;
    setMsgMenu({ open: false, x: 0, y: 0, msg: null });
    if (!msg || !user?.id || !convId) return;
    try {
      await deleteMessageForMe(msg.id, user.id);
      setMessages((prev) => {
        const filtered = prev.filter(m => m.id !== msg.id);
        const wasLast = msg.id === prev[prev.length - 1]?.id;
        if (wasLast) {
          const newLast = filtered[filtered.length - 1];
          updateConvPreview(
            convId,
            newLast?.content || newLast?.decryptedContent || null,
            newLast?.created_at || null
          );
        }
        return filtered;
      });
    } catch (err) {
      console.error('Error hiding message:', err);
    }
  }, [msgMenu.msg, activeConvId, updateConvPreview, user?.id]);

  // ── Shared send logic (optimistic + API + dedup) ──
  const sendContent = useCallback(async (content, { clearInput = false } = {}) => {
    if (!content || !user?.id || sendingRef.current) return null;

    // ── Resolve conversation ID (create pending conversation in DB if needed) ──
    let convId = activeConvId;
    const pendingInfo = pendingConvRef.current;
    if (pendingInfo && activeConvId === pendingInfo.tempId) {
      const pendingOther = pendingInfo.otherUser;
      // Block check for pending conversation
      const cachedBlocked = getCachedBlockStatus(user.id, pendingOther.id);
      if (cachedBlocked === true) {
        toast.error(t('chat.blocked_cannot_send'), { className: 'fc-toast' });
        return null;
      }
      const cachedBlockedByThem = getCachedBlockStatus(pendingOther.id, user.id);
      if (cachedBlockedByThem === true) {
        toast.error(t('chat.blocked_by_them'), { className: 'fc-toast' });
        return null;
      }
      try {
        convId = await getOrCreateConversation(user.id, pendingOther.id);
      } catch (err) {
        console.error('Error creating conversation:', err);
        toast.error(t('chat.send_error'), { className: 'fc-toast' });
        return null;
      }
      pendingConvRef.current = null;
      // Mark that we're resolving a pending conversation — useLayoutEffect should not wipe messages
      skipCacheWipeRef.current = true;
      // Also skip the useEffect that loads messages (conv has no messages yet, sendContent handles them)
      skipMsgLoadRef.current = true;
      // If this conversation was previously hidden (deleted locally), unhide it
      setHiddenConvIds((prev) => prev.filter(id => id !== convId));
      // Update state with the real conversation ID
      setActiveConvId(convId);
      setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, id: convId } : c));
      // Reload conversations in background
      loadConvs();
    } else if (otherUser) {
      // Existing block check for non-pending conversations (cache + server)
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
      // Server double-check (cache might be stale)
      try {
        const blockedByMe = await isBlocked(user.id, otherUser.id);
        if (blockedByMe) {
          cacheBlockStatus(user.id, otherUser.id, true);
          toast.error(t('chat.blocked_cannot_send'), { className: 'fc-toast' });
          return null;
        }
        const blockedByThem = await isBlocked(otherUser.id, user.id);
        if (blockedByThem) {
          cacheBlockStatus(otherUser.id, user.id, true);
          toast.error(t('chat.blocked_by_them'), { className: 'fc-toast' });
          return null;
        }
      } catch {}
    }

    if (!convId) return null;

    const replyToId = replyingTo?.id || null;
    const tempId = crypto.randomUUID();
    const optimisticMsg = {
      id: tempId,
      conversation_id: convId,
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
      if (convId) draftsRef.current[convId] = '';
    }
    setReplyingTo(null);
    setSending(true);
    setTimeout(() => messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 10);

    try {
      const { data: participants } = await supabase
        .from('chat_participants')
        .select('user_id')
        .eq('conversation_id', convId);
      const participantIds = (participants || []).map(p => p.user_id).filter(id => id !== user.id);
      const sentMsg = await sendMessage(convId, user.id, content, participantIds, replyToId);

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
      // Update conversation preview immediately (optimistic), then sync in background
      updateConvPreview(convId, content, sentMsg.created_at || new Date().toISOString());
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

  // ── Load older messages (infinite scroll / pagination) ──
  const loadOlderMessages = useCallback(async () => {
    // SYNCHRONOUS check — prevents cascade from multiple scroll events in same event loop tick
    if (!activeConvId || loadingMoreRef.current || !hasMoreMessages || !oldestMessageDate || !user?.id) return;
    loadingMoreRef.current = true;

    setLoadingMore(true);
    const convIdAtStart = activeConvId;
    let aborted = false;

    // Save scrollHeight AND scrollTop BEFORE prepending so we can restore scroll position
    const el = messagesContainerRef.current;
    const scrollHeightBefore = el ? el.scrollHeight : 0;
    scrollBeforeLoadRef.current = el ? { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight } : null;    

    try {
      let attempts = 0;
      let raw = [];
      let filtered = [];
      let decrypted = [];
      let hasMore = false;
      let cursor = oldestMessageDate;
      const fetchLimit = PAGE_SIZE + 1; // request one extra to detect more

      do {
        attempts += 1;
        try {
          raw = await getMessages(convIdAtStart, fetchLimit, cursor);
        } catch (e) {
          raw = [];
        }
        if (aborted || convIdAtStart !== activeConvId) return;
        hasMore = raw.length > PAGE_SIZE;
        if (raw.length > PAGE_SIZE) raw = raw.slice(0, PAGE_SIZE);
        filtered = raw.filter(m => !m.deleted_for?.includes(user.id));
        decrypted = await Promise.all(
          filtered.map(async (msg) => {
            const content = await decryptMessage(msg, user.id);
            return { ...msg, decryptedContent: content };
          })
        );

        if (decrypted.length === 0 && hasMore && attempts < 3) {
          // advance cursor to last raw item and retry
          cursor = raw.length ? raw[raw.length - 1].created_at : null;
          continue;
        }
        break;
      } while (attempts < 3);

      if (aborted || convIdAtStart !== activeConvId) return;

      // ══ Pre-fetch shared post data BEFORE setMessages so DOM is stable at scroll-restore time ══
      const sharedPostIds = [...new Set(decrypted.filter(m => m.shared_post_id).map(m => m.shared_post_id))];
      if (sharedPostIds.length > 0) {
        await Promise.all(sharedPostIds.map(async (pid) => {
          try {
            const postData = await getPost(pid);
            setSharedPosts(prev => prev[pid] ? prev : { ...prev, [pid]: postData });
          } catch { /* ignore */ }
        })).catch(() => {});
      }

      // Safety: user might have switched conversations during shared-post fetch
      if (convIdAtStart !== activeConvId) return;

      if (decrypted.length === 0) {
        // No visible messages found; if server indicated no more, mark finished
        if (!hasMore) setHasMoreMessages(false);
        return;
      }

      // Prepend older messages — they will appear at the visual bottom (column-reverse)
      setMessages(prev => [...decrypted, ...prev]);
      // Cursor = oldest in this batch (first in ASC array) — ensures no overlap on next fetch
      setOldestMessageDate(decrypted[0].created_at);
      // Mark timestamp so the scroll handler's cooldown prevents cascade
      lastLoadTimeRef.current = Date.now();
      setHasMoreMessages(hasMore);

    } catch (err) {
      console.warn('Error loading older messages:', err);
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [activeConvId, loadingMore, hasMoreMessages, oldestMessageDate, user?.id]);


  // ── Scroll handler to detect when user reaches the visual top (oldest messages) ──
  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el || loadingMoreRef.current || !hasMoreMessages) return;

    // Cooldown: prevent cascade — ignore scroll events within 500ms of a load
    if (Date.now() - lastLoadTimeRef.current < 500) return;

    // In column-reverse, scrollTop is NEGATIVE when scrolling up (toward oldest).
    // At the very top (oldest messages): scrollTop ≈ -(scrollHeight - clientHeight)
    // scrollRemaining = scrollTop + scrollHeight - clientHeight → 0 at the top
    const scrollRemaining = el.scrollTop + el.scrollHeight - el.clientHeight;
    const threshold = 150;
    if (scrollRemaining < threshold) {
      // Pre-mark lastLoadTime to avoid immediate retriggers while async fetch starts
      lastLoadTimeRef.current = Date.now();
      // Call via ref to avoid recreating the scroll handler when the function identity changes
      try { loadOlderMessagesRef.current(); } catch (e) { console.warn('loadOlderMessagesRef failed', e); }
    }
    // Reset new messages counter when user scrolls near bottom
    if (newMsgCount > 0 && (el.scrollTop > -80 || el.scrollHeight - el.clientHeight + el.scrollTop < 80)) {
      setNewMsgCount(0);
    }
    // Track scroll position for scroll-to-bottom button
    const nearBottom = el.scrollTop > -80 || el.scrollHeight - el.clientHeight + el.scrollTop < 80;
    setIsScrolledUp(!nearBottom);
  }, [hasMoreMessages, loadOlderMessages, newMsgCount]);

  // Use a ref to call loadOlderMessages from the scroll handler so the handler
  // identity doesn't change when the callback is recreated, avoiding frequent
  // cleanup/attach of the scroll listener.
  const loadOlderMessagesRef = useRef(loadOlderMessages);
  useEffect(() => { loadOlderMessagesRef.current = loadOlderMessages; }, [loadOlderMessages]);

  // ── Attach scroll listener to messages container ──
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleMessagesScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleMessagesScroll);
    };
  }, [handleMessagesScroll]);

  // ── Restore scroll position after prepending older messages (column-reverse) ──
  useLayoutEffect(() => {
    if (scrollBeforeLoadRef.current == null) return;
    const saved = scrollBeforeLoadRef.current;
    scrollBeforeLoadRef.current = null;
    // Format: { scrollTop, scrollHeight }
    const el = messagesContainerRef.current;
    if (!el) return;
    const { scrollTop: savedTop, scrollHeight: oldH } = saved;
    const diff = el.scrollHeight - oldH;
    // Add a buffer so scrollRemaining > threshold after restoration, preventing immediate re-trigger
    const SCROLL_RESTORE_BUFFER = 200;
    const newScrollTop = savedTop - diff + SCROLL_RESTORE_BUFFER;
    if (diff > 0) {
      el.scrollTop = newScrollTop;
    }
  }, [messages]);

  // ── Send GIF ──
  const handleGifSelect = useCallback(async (gifUrl) => {
    setShowGifPicker(false);
    if (!gifUrl) return;
    await sendContent(gifUrl);
  }, [sendContent]);

  // ── Defensive dedup: some async races can introduce duplicate IDs ──
  const dedupedMessages = React.useMemo(() => {
    const seen = new Set();
    return messages.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [messages]);

  // ── Compute message grouping (based on chronological order) ──
  const messageGroupMap = React.useMemo(() => {
    const map = {};
    for (let i = 0; i < dedupedMessages.length; i++) {
      const msg = dedupedMessages[i];
      const prev = i > 0 ? dedupedMessages[i - 1] : null;
      const next = i < dedupedMessages.length - 1 ? dedupedMessages[i + 1] : null;
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
  }, [dedupedMessages]);

  // ── Reversed messages for column-reverse render (newest first in DOM) ──
  const reversedMessages = React.useMemo(() => [...dedupedMessages].reverse(), [dedupedMessages]);
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
      </div>        {followersLoading ? (
          <div className="chat-followers-modal-status"><FaSpinner className="fc-spin" /></div>
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
              <span className="chat-followers-modal-card-name">{u.displayname || u.username}</span>
              <span style={{ fontSize: '0.68rem', fontWeight: 400, opacity: 0.5 }}>@{u.username}</span>
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

      {/* Persistent search bar — filters conversations by name */}
      <div className="chat-search-bar">
        <div className="chat-search-bar-wrap">
          <FaSearch className="chat-search-bar-icon" />
          <input
            className="chat-search-bar-input"
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder={t('chat.search_placeholder') || 'Filter conversations...'}
          />
          {searchQuery && (
            <button className="chat-search-bar-clear" onClick={() => setSearchQuery('')}>
              <FaTimes />
            </button>
          )}
        </div>
      </div>

      {/* Conversations */}
      <div className="chat-list-items">
        {convsLoading ? (
          <div className="chat-list-loading">
            {[1,2,3,4,5].map((i) => (
              <div key={i} className="chat-list-skeleton-item">
                <div className="chat-list-skeleton-avatar" />
                <div className="chat-list-skeleton-lines">
                  <div className="chat-list-skeleton-line" />
                  <div className="chat-list-skeleton-line chat-list-skeleton-line--short" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleConversations.length === 0 ? (
          <div className="chat-list-empty">
            <div className="chat-list-empty-icon"><FaComment /></div>
            <p>{t('chat.empty')}</p>
            <p className="chat-list-empty-sub">{t('chat.empty_sub')}</p>
          </div>
        ) : (
          visibleConversations.map((conv) => (
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
                style={getAvatarTransformStyle(conv.otherUser?.avatar_position)}
                status={otherUserStatuses?.[conv.otherUser?.id] ?? computeEffectiveStatus(conv.otherUser)}
              />
              <div className="chat-list-item-info">
                <div className="chat-list-item-top">
                  <span className="chat-list-item-name">{conv.otherUser?.displayname || conv.otherUser?.username || t('common.unknown')}</span>
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
            style={{ cursor: 'pointer', ...getAvatarTransformStyle(otherUser?.avatar_position) }}
            onClick={goToProfile}
            status={activeConversationStatus}
          />
          <div className="chat-messages-header-info" style={{ cursor: 'pointer' }} onClick={goToProfile}>
            <span className="chat-messages-header-name">{otherUser?.displayname || otherUser?.username || t('common.unknown')}</span>
          </div>
        </div>
        <div className="chat-messages-header-actions">
          <div className="chat-header-actions-desktop">
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
          <button
            className="chat-header-mobile-menu-btn"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setMobileMenuTop(rect.bottom + 4);
              setShowMobileMenu(s => !s);
            }}
            title="More"
          >
            <FaEllipsisH />
          </button>
        </div>
      </div>

      {/* ── Mobile header menu ── */}
      {showMobileMenu && (
        <div className="chat-mobile-header-menu" style={{ top: mobileMenuTop }}>
          <button
            className={`chat-mobile-header-menu-item ${showMsgSearch ? 'active' : ''}`}
            onClick={() => { setShowMsgSearch(s => !s); setShowMobileMenu(false); setShowMediaGallery(false); setShowPinnedPanel(false); setShowProfileCard(false); }}
          >
            <FaSearch /> {t('chat.search_messages') || 'Search'}
          </button>
          <button
            className={`chat-mobile-header-menu-item ${showMediaGallery ? 'active' : ''}`}
            onClick={() => { setShowMediaGallery(s => !s); setShowMobileMenu(false); setShowMsgSearch(false); setShowPinnedPanel(false); setShowProfileCard(false); }}
          >
            <FaImage /> {t('chat.media_gallery') || 'Media'}
          </button>
          <button
            className={`chat-mobile-header-menu-item ${showPinnedPanel ? 'active' : ''}`}
            onClick={() => { setShowPinnedPanel(s => !s); setShowMobileMenu(false); setShowMsgSearch(false); setShowMediaGallery(false); setShowProfileCard(false); }}
          >
            <FaThumbtack /> {t('post.pinned') || 'Pinned'}
          </button>
          <button
            className={`chat-mobile-header-menu-item ${showProfileCard ? 'active' : ''}`}
            onClick={() => { setShowProfileCard(s => !s); setShowMobileMenu(false); setShowMsgSearch(false); setShowMediaGallery(false); setShowPinnedPanel(false); }}
          >
            <FaUser /> {t('chat.view_profile') || 'Profile'}
          </button>
        </div>
      )}

      {/* Messages — key=activeConvId fuerza remount completo al cambiar de chat */}
      <div className="chat-messages-body" ref={messagesContainerRef}>
        {msgsLoading ? (
          <div className="chat-messages-loading">
            {[1,2,3,4].map((i) => (
              <div key={i} className={`chat-messages-skeleton-msg ${i % 2 === 0 ? 'chat-messages-skeleton-msg--own' : 'chat-messages-skeleton-msg--other'}`}>
                <div className={`chat-messages-skeleton-bubble ${i % 2 === 0 ? 'chat-messages-skeleton-bubble--own' : 'chat-messages-skeleton-bubble--other'} ${i === 3 ? 'chat-messages-skeleton-bubble--short' : ''} ${i === 1 ? 'chat-messages-skeleton-bubble--long' : ''}`} />
              </div>
            ))}
          </div>
        ) : dedupedMessages.length === 0 ? (
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
                      style={getAvatarTransformStyle(otherUser?.avatar_position)}
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
                    {/* ── Shared post card (mini PostCard style) ── */}
                    {msg.shared_post_id && (() => {
                      const sharedPost = sharedPosts[msg.shared_post_id];
                      if (!sharedPost) {
                        return (
                          <div className="chat-message-shared-post chat-message-shared-post--loading" onClick={() => navigate(`/post/${msg.shared_post_id}`)}>
                            <div className="chat-message-shared-post-spinner" />
                            <span>{t('common.loading')}</span>
                          </div>
                        );
                      }
                      const postProfile = sharedPost.profiles || {};
                      const hasMedia = !!(sharedPost.image_urls?.length || sharedPost.image_url);
                      return (
                        <div className="chat-message-shared-post" onClick={() => navigate(`/post/${sharedPost.id}`)}>
                          {/* Header: avatar + username + badge */}
                          <div className="chat-message-shared-post-header">
                            <Avatar
                              src={postProfile.avatar_url}
                              alt={postProfile.username || '?'}
                              className="chat-message-shared-post-avatar"
                            />
                            <div className="chat-message-shared-post-author">
                              <span className="chat-message-shared-post-username">
                                {postProfile.username || 'unknown'}
                              </span>
                              {Array.isArray(postProfile.roles) && postProfile.roles.some(r => r !== 'user') && (
                                <Badge roles={postProfile.roles} />
                              )}
                            </div>
                          </div>
                          {/* Content with RichText */}
                          {sharedPost.content && (
                            <div className="chat-message-shared-post-text">
                              <RichText
                                text={sharedPost.content.length > 150
                                  ? sharedPost.content.slice(0, 150) + '...'
                                  : sharedPost.content}
                                skipUrls={(() => {
                                  const urls = sharedPost.content.match(/(https?:\/\/[^\s<]+)/gi) || [];
                                  return urls.filter(u => IMG_RE.test(u));
                                })()}
                                mentions={sharedPost.mentions}
                              />
                            </div>
                          )}
                          {/* Media preview */}
                          {hasMedia && (
                            <div className="chat-message-shared-post-media">
                              <SafeImage
                                src={sharedPost.image_urls?.[0] || sharedPost.image_url}
                                alt="Post media"
                                className="chat-message-shared-post-img"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {(() => {
                      const content = msg.decryptedContent || '';
                      if (!content) return null;
                      const { imageUrl } = detectMediaFromContent(content);
                      const textOnly = imageUrl ? content.replace(imageUrl, '').trim() : content;
                      if (!textOnly && !imageUrl) {
                        return (
                          <p className="chat-message-text">
                            <RichText
                              text={content || ''}
                              linkClass="chat-card-link"
                              mentionClass="chat-card-mention"
                              hashtagClass="chat-card-hashtag"
                              onExternalLink={handleExternalLink}
                            />
                            {!content && <span className="chat-message-encrypted">{t('chat.encrypted')}</span>}
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
                          {textOnly && (
                          <p className="chat-message-text">
                            <RichText
                              text={textOnly}
                              linkClass="chat-card-link"
                              mentionClass="chat-card-mention"
                              hashtagClass="chat-card-hashtag"
                              onExternalLink={handleExternalLink}
                            />
                          </p>
                        )}
                        {/* ── Link preview for non-media URLs ── */}
                        {(() => {
                          const urls = textOnly ? textOnly.match(/(https?:\/\/[^\s<]+)/gi) || [] : [];
                          const nonMediaUrls = urls.filter(u => !IMG_RE.test(u) && u !== imageUrl);
                          if (nonMediaUrls.length === 0) return null;
                          return nonMediaUrls.slice(0, 1).map((url, i) => (
                            <LinkPreview key={i} url={url} onExternalLink={handleExternalLink} />
                          ));
                        })()}
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
                      style={getAvatarTransformStyle(profile?.avatar_position)}
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
        {loadingMore && (
          <div className="chat-messages-loading">
            {[1,2].map((i) => (
              <div key={i} className={`chat-messages-skeleton-msg ${i % 2 === 0 ? 'chat-messages-skeleton-msg--own' : 'chat-messages-skeleton-msg--other'}`}>
                <div className={`chat-messages-skeleton-bubble ${i % 2 === 0 ? 'chat-messages-skeleton-bubble--own' : 'chat-messages-skeleton-bubble--other'} chat-messages-skeleton-bubble--short`} />
              </div>
            ))}
          </div>
        )}
        {loadingMore && (
          <div className="chat-load-more-spinner">
            <div className="chat-load-more-spinner-ring" />
          </div>
        )}
      </div>

      {/* Floating scroll-to-bottom button */}
      {(newMsgCount > 0 || isScrolledUp) && (
        <button className="chat-new-msg-btn" onClick={scrollToBottom}>
          <FaArrowDown className="chat-new-msg-btn-icon" />
          {newMsgCount > 0
            ? `${newMsgCount} ${newMsgCount === 1 ? (t('chat.new_message') || 'new message') : (t('chat.new_messages') || 'new messages')}`
            : (t('chat.scroll_to_bottom') || 'Volver al inicio')}
        </button>
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
        {isBlockedConv ? (
          <div className="chat-input-blocked">
            <FaLock className="chat-input-blocked-icon" />
            <span className="chat-input-blocked-text">
              {isBlockedConv === 'blocked_by_me'
                ? (t('chat.input_blocked_by_me') || 'You blocked this user. You cannot send messages.')
                : (t('chat.input_blocked_by_them') || 'This user has blocked you. You cannot send messages.')}
            </span>
          </div>
        ) : (
          <>
          {/* ── Typing indicator (absolute, does not push) ── */}
        {otherUserTyping && (
          <div className="chat-typing-indicator">
            <div className="chat-typing-dots">
              <span className="chat-typing-dot"></span>
              <span className="chat-typing-dot"></span>
              <span className="chat-typing-dot"></span>
            </div>
            <span className="chat-typing-label">{otherUser?.displayname || otherUser?.username || t('common.unknown')} {t('chat.typing') || 'typing...'}</span>
          </div>
        )}
        {/* Media preview — muestra la imagen o un spinner mientras se sube */}
        {(mediaPreviewUrl || uploadingChatMedia) && (
          <div className="chat-media-preview">
            {uploadingChatMedia ? (
              <div className="chat-media-preview-uploading">
                <FaSpinner className="fc-spin" />
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #6b7280)' }}>
                  {t('upload.uploading') || 'Subiendo...'}
                </span>
              </div>
            ) : IMG_RE.test(mediaPreviewUrl) ? (
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
            <label className="chat-media-upload-btn">
              {uploadingChatMedia ? <FaSpinner className="fc-spin" /> : <FaUpload />}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleChatMediaUpload}
                disabled={uploadingChatMedia}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
              />
            </label>
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
        )}          <div className="chat-input-inner">
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
            <div className="chat-input-actions-desktop">
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
          </>
        )}
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
                  ? messages.filter(m => {
                      const contentMatch = (m.decryptedContent || '').toLowerCase().includes(q);
                      // Also match by sender's username or displayname (only for current conversation)
                      const isSender = m.sender_id === user?.id;
                      const senderMatch = !isSender && otherUser
                        ? ((otherUser.username || '').toLowerCase().includes(q) ||
                           (otherUser.displayname || '').toLowerCase().includes(q))
                        : false;
                      return contentMatch || senderMatch;
                    })
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
              }               return allImages.map((url, i) => (
                <SafeImage
                  key={url}
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
                        {(() => {
                          const txt = msg.decryptedContent || '';
                          if (!txt) return t('chat.encrypted');
                          if (IMG_RE.test(txt) || /(giphy|tenor|klipy)\.com|(\.|\/)gif/i.test(txt)) {
                            return <><FaImage className="chat-list-item-preview-icon" /> {/(giphy|tenor|klipy)\.com/i.test(txt) ? 'GIF' : 'Image'}</>;
                          }
                          return txt;
                        })()}
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
                style={getAvatarTransformStyle(otherUser.avatar_position)}
              />
              <div className="explore-card-info">
                <div className="explore-card-name-row">
                  <span className="explore-card-name">{otherUser.displayname || otherUser.username || t('common.unknown')}</span>
                              <span style={{ fontSize: '0.68rem', fontWeight: 400, opacity: 0.5 }}> · @{otherUser.username || ''}</span>
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
                      <span key={interest} className="explore-card-interest">{interest}</span>
                    ))}
                    {otherUser.interests.length > 3 && (
                      <span className="explore-card-interests-more">show {otherUser.interests.length - 3} more</span>
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
                  className="chat-edit-modal-input"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  rows={4}
                  maxLength={2000}
                  placeholder={t('chat.edit_placeholder')}
                />
              </label>
            </div>
            <div className="chat-edit-modal-preview">
              <div className="chat-edit-modal-preview-header">
                <span className="chat-edit-modal-preview-label">{t('chat.edit_preview')}</span>
              </div>
              <div className="chat-edit-modal-preview-bubble">
                <div className="chat-edit-modal-preview-content">
                  <p className="chat-edit-modal-preview-text">
                    {editText || editContentRef.current || t('chat.encrypted')}
                  </p>
                </div>
                {editMediaUrlRef.current && IMG_RE.test(editMediaUrlRef.current) && (
                  <div className="chat-edit-modal-preview-media">
                    <img
                      src={editMediaUrlRef.current}
                      alt="Media"
                      className="chat-edit-modal-preview-img"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                )}
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
                    key={url}
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

      {confirmExternalLink && createPortal(
        <ConfirmModal
          message={t('chat.external_link_warning') || 'This link will take you to an external website. Do you want to continue?'}
          onConfirm={executeExternalLink}
          onCancel={handleCancelExternalLink}
        />,
        document.body
      )}
    </div>
  );
}
