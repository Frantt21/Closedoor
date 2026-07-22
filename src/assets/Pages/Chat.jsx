import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  subscribeToMessages,
  subscribeToConversations,
} from '../services/chatService';
import { searchProfiles } from '../services/userService';
import { getFollowing } from '../services/followService';
import ModalShell from '../Resources/Components/ModalShell';
import { FaComment, FaSearch, FaPaperPlane, FaArrowLeft, FaPlus, FaTimes, FaUserPlus, FaUsers, FaTrash } from 'react-icons/fa';
import Avatar from '../Resources/Components/Avatar';
import Badge from '../Resources/Components/Badge';
import Tooltip from '../Resources/Components/Tooltip';
import { getTimeAgo } from '../services/helpers';
import { supabase } from '../services/supabaseclient';
import usePageTitle from '../../hooks/usePageTitle';
import '../Resources/Styles/chat.css';

export default function Chat() {
  const { t, locale } = useI18n();
  const { user, loading: authLoading } = useAuth();
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

  // Context menu state
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0, convId: null });
  const contextMenuRef = useRef(null);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu({ open: false, x: 0, y: 0, convId: null });
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Refs
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);

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
    setMsgsLoading(true);
    setMessages([]);
    markAsRead(activeConvId, user.id);

    getMessages(activeConvId)
      .then(async (msgs) => {
        // Decrypt each message
        const decrypted = await Promise.all(
          msgs.map(async (msg) => {
            const content = await decryptMessage(msg, user.id);
            return { ...msg, decryptedContent: content };
          })
        );
        setMessages(decrypted);
      })
      .catch((err) => console.warn('Error loading messages:', err))
      .finally(() => setMsgsLoading(false));

    // Real-time subscription
    const unsub = subscribeToMessages(activeConvId, async (newMsg) => {
      const content = await decryptMessage(newMsg, user.id);
      setMessages((prev) => [...prev, { ...newMsg, decryptedContent: content }]);
      // Auto-scroll
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      markAsRead(activeConvId, user.id);
    });

    return () => {
      unsub?.unsubscribe();
    };
  }, [activeConvId, user?.id]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  // ── Send message ──
  const handleSend = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || !activeConvId || !user?.id || sending) return;

    setSending(true);
    try {
      // Get other participant IDs
      const { data: participants } = await supabase
        .from('chat_participants')
        .select('user_id')
        .eq('conversation_id', activeConvId);

      const participantIds = (participants || []).map(p => p.user_id).filter(id => id !== user.id);

      await sendMessage(activeConvId, user.id, trimmed, participantIds);
      setInputValue('');
      // Reload conversations to update last message preview
      loadConvs();
    } catch (err) {
      console.error('Error sending message:', err);
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
    if (!user?.id) return;
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

  // ── Context menu handlers ──
  const handleContextMenu = useCallback((e, convId) => {
    e.preventDefault();
    setContextMenu({ open: true, x: e.clientX, y: e.clientY, convId });
  }, []);

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

  // ── Open followers modal ──
  const openFollowersModal = useCallback(async () => {
    if (!user?.id) return;
    setShowFollowersModal(true);
    setFollowersLoading(true);
    try {
      const data = await getFollowing(user.id);
      setFollowers(data || []);
    } catch (err) {
      console.warn('Error fetching following:', err);
      setFollowers([]);
    } finally {
      setFollowersLoading(false);
    }
  }, [user?.id]);

  // ── Get active conversation's other user ──
  const activeConv = conversations.find((c) => c.id === activeConvId);
  const otherUser = activeConv?.otherUser;

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
        <Tooltip text={t('nav.home')} placement="bottom">
          <button className="chat-list-back-btn" onClick={() => navigate('/')}>
            <FaArrowLeft />
          </button>
        </Tooltip>
        <h2 className="chat-list-title">{t('chat.title')}</h2>
        <Tooltip text={t('chat.new') || 'New chat'} placement="bottom">
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
            placeholder={t('chat.search_placeholder') || 'Search users...'}
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
                  <span className="chat-list-item-name">{conv.otherUser?.username || 'Unknown'}</span>
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
        />
        <div className="chat-messages-header-info">
          <span className="chat-messages-header-name">{otherUser?.username || 'Unknown'}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages-body" ref={messagesContainerRef}>
        {msgsLoading ? (
          <div className="chat-messages-loading">{t('common.loading')}</div>
        ) : messages.length === 0 ? (
          <div className="chat-messages-empty">
            <FaComment className="chat-messages-empty-icon" />
            <p>{t('chat.no_messages') || 'No messages yet. Start the conversation!'}</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.sender_id === user.id;
            return (
              <div
                key={msg.id}
                className={`chat-message ${isOwn ? 'chat-message--own' : 'chat-message--other'}`}
              >
                <div className="chat-message-bubble">
                  <p className="chat-message-text">
                    {msg.decryptedContent || (
                      <span className="chat-message-encrypted">{t('chat.encrypted') || '🔒 Encrypted'}</span>
                    )}
                  </p>
                  <span className="chat-message-time">
                    {getTimeAgo(t, locale, msg.created_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-messages-input">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.input_placeholder') || 'Type a message...'}
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
            <p>{t('chat.select_chat') || 'Select a conversation to start chatting'}</p>
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
      {renderFollowersModal()}
    </div>
  );
}
