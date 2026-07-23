import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar';

/**
 * MentionDropdownPortal — renders the @mention autocomplete dropdown
 * via portal into a container element (default: .fc-modal-overlays or dialog)
 * so it's not clipped by overflow.
 * Syncs position on scroll/resize.
 */
export default function MentionDropdownPortal({ textareaRef, mentionDropdownRef, mentions, selectedMentionIdx, insertMention }) {
  const dropdownRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const updatePosition = useCallback(() => {
    if (!textareaRef.current) return;
    const rect = textareaRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.min(rect.width, 360),
    });
  }, [textareaRef]);

  useEffect(() => {
    updatePosition();
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          updatePosition();
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [updatePosition]);

  // Find the best portal target: first try .fc-modal-overlays within the closest dialog,
  // then dialog itself, then document.body
  const portalTarget = useMemo(() => {
    const el = textareaRef.current;
    if (el) {
      const dialog = el.closest('dialog');
      if (dialog) {
        return dialog.querySelector('.fc-modal-overlays') || dialog;
      }
    }
    return document.body;
  }, [textareaRef]);

  return createPortal(
    <div
      ref={(node) => {
        dropdownRef.current = node;
        if (mentionDropdownRef) mentionDropdownRef.current = node;
      }}
      className="create-post-mention-dropdown"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 2147483647,
      }}
    >
      {mentions.map((user, idx) => (
        <button
          key={user.id}
          type="button"
          className={`create-post-mention-item ${idx === selectedMentionIdx ? 'create-post-mention-item--active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); }}
          onClick={(e) => { e.stopPropagation(); insertMention(user); }}
        >
          <Avatar
            className="create-post-mention-avatar"
            src={user.avatar_url}
            alt={user.username}
          />
          <span className="create-post-mention-username">{user.username}</span>
        </button>
      ))}
    </div>,
    portalTarget
  );
}
