import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getFollowing } from '../services/followService';
import { supabase, dbPublic } from '../services/supabaseclient';
import MentionDropdownPortal from '../Resources/Components/MentionDropdownPortal';

/**
 * useMentionAutocomplete
 *
 * Encapsulates the @mention autocomplete logic for textareas.
 *
 * @param {string|null} userId  – Current user ID (to fetch followed users)
 * @param {string}       content – Current textarea content (controlled by parent)
 * @param {function}     setContent – Setter for content
 * @returns {{
 *   textareaRef,
 *   mentionDropdownRef,
 *   handleContentChange,  // wraps onChange to detect @mention positions
 *   handleTextareaKeyDown,// handles arrow/enter/esc for mention dropdown
 *   mentionDropdown,      // JSX element or null — render this in the textarea wrapper
 *   mentionIndex,         // -1 when no mention is active
 *   filteredMentions,     // current filtered user list
 *   resetMentions,        // call to close the dropdown manually
 * }}
 */
export default function useMentionAutocomplete(userId, content, setContent) {
  const [followedUsers, setFollowedUsers] = useState([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(-1);
  const [selectedMentionIdx, setSelectedMentionIdx] = useState(0);
  const textareaRef = useRef(null);
  const mentionDropdownRef = useRef(null);

  // Fetch followed users when userId changes
  useEffect(() => {
    if (!userId) {
      setFollowedUsers([]);
      return;
    }
    getFollowing(userId)
      .then(async (users) => {
        if (users.length > 0) {
          try {
            const { data: prefs } = await dbPublic
              .from('profiles')
              .select('id, allow_encrypted_add')
              .in('id', users.map(u => u.id));
            const disabledAdd = new Set(
              (prefs || []).filter(p => p.allow_encrypted_add === false).map(p => p.id)
            );
            setFollowedUsers(users.filter(u => !disabledAdd.has(u.id)));
          } catch {
            setFollowedUsers(users);
          }
        } else {
          setFollowedUsers([]);
        }
      })
      .catch((err) => console.warn('[Mention] Error fetching followed users:', err));
  }, [userId]);

  // Detect @mention from cursor position
  const updateMentionState = useCallback((text, cursorPos) => {
    if (cursorPos === undefined || cursorPos === null) {
      setMentionIndex(-1);
      return;
    }
    const beforeCursor = text.slice(0, cursorPos);
    const mentionMatch = beforeCursor.match(/(?<![\\w@])@([a-zA-Z0-9_]*)$/);
    if (mentionMatch) {
      const query = mentionMatch[1].toLowerCase();
      setMentionQuery(query);
      setMentionIndex(mentionMatch.index);
      setSelectedMentionIdx(0);
    } else {
      setMentionIndex(-1);
      setMentionQuery('');
    }
  }, []);

  // Filter followed users by current mention query
  const getFilteredMentions = useCallback(() => {
    if (mentionIndex === -1 || !followedUsers.length) return [];
    return followedUsers
      .filter((u) => u.username && u.username.toLowerCase().includes(mentionQuery))
      .slice(0, 8);
  }, [mentionIndex, mentionQuery, followedUsers]);

  // Insert selected mention into content
  const insertMention = useCallback(
    (user) => {
      const before = content.slice(0, mentionIndex);
      const after = content.slice(mentionIndex);
      const restOfMention = after.match(/^@[a-zA-Z0-9_]*/);
      const afterMention = restOfMention ? after.slice(restOfMention[0].length) : after;
      const newContent = before + `@${user.username} ` + afterMention;
      setContent(newContent);
      setMentionIndex(-1);
      setTimeout(() => {
        if (textareaRef.current) {
          const newCursor = before.length + user.username.length + 2;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursor, newCursor);
        }
      }, 0);
    },
    [content, mentionIndex, setContent]
  );

  // Handle keyboard navigation in the mention dropdown
  const handleTextareaKeyDown = useCallback(
    (e) => {
      const filtered = getFilteredMentions();
      if (mentionIndex === -1 || filtered.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIdx((prev) => (prev + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIdx((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filtered[selectedMentionIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setMentionIndex(-1);
      }
    },
    [mentionIndex, selectedMentionIdx, getFilteredMentions, insertMention]
  );

  // Wrapped onChange handler — updates content + detects @mention
  const handleContentChange = useCallback(
    (e) => {
      const text = e.target.value;
      const cursorPos = e.target.selectionStart;
      setContent(text);
      updateMentionState(text, cursorPos);
    },
    [setContent, updateMentionState]
  );

  // Close dropdown manually
  const resetMentions = useCallback(() => {
    setMentionIndex(-1);
    setMentionQuery('');
    setSelectedMentionIdx(0);
  }, []);

  // Memoized filtered list for rendering
  const filteredMentions = useMemo(() => getFilteredMentions(), [getFilteredMentions]);

  // Build the dropdown JSX (or null)
  const mentionDropdown =
    mentionIndex !== -1 && filteredMentions.length > 0 && textareaRef.current ? (
      <MentionDropdownPortal
        textareaRef={textareaRef}
        mentionDropdownRef={mentionDropdownRef}
        mentions={filteredMentions}
        selectedMentionIdx={selectedMentionIdx}
        insertMention={insertMention}
      />
    ) : null;

  return {
    textareaRef,
    mentionDropdownRef,
    handleContentChange,
    handleTextareaKeyDown,
    mentionDropdown,
    mentionIndex,
    filteredMentions,
    resetMentions,
    insertMention,
    selectedMentionIdx,
    followedUsers,
  };
}
