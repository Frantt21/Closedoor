import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

// Combined regex for @mentions, #hashtags, and URLs
const COMBINED_REGEX = /(?<![\w@])(@[a-zA-Z0-9_]+)|(?<![#\w])#([a-zA-Z0-9_\u00C0-\u024F]+)|(https?:\/\/[^\s<]+)/gi;

/**
 * Renders text with clickable @mentions, #hashtags, and external links.
 * 
 * @param {object} props
 * @param {string} props.text - The text to render
 * @param {string[]} [props.skipUrls] - URLs to skip (rendered as media separately)
 * @param {object} [props.mentions] - Map of userId -> username for mention resolution
 * @param {function} [props.onExternalLink] - Callback when an external link is clicked (replaces window.confirm)
 * @param {string} [props.linkClass] - CSS class for external links
 * @param {string} [props.mentionClass] - CSS class for @mentions
 * @param {string} [props.hashtagClass] - CSS class for #hashtags
 * @param {function} [props.onMentionClick] - Custom click handler for mentions (default: navigate to profile)
 */
export default function RichText({
  text,
  skipUrls = [],
  mentions = {},
  onExternalLink,
  linkClass = 'post-card-link',
  mentionClass = 'post-card-mention',
  hashtagClass = 'post-card-hashtag',
  onMentionClick,
}) {
  const navigate = useNavigate();
  if (!text) return null;

  const skipSet = new Set(skipUrls);
  const parts = [];
  let lastIndex = 0, match;

  while ((match = COMBINED_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const matchedText = match[0];
    // Skip URLs that are rendered as media separately
    if (matchedText.startsWith('@') || !skipSet.has(matchedText)) {
      parts.push(matchedText);
    }
    lastIndex = match.index + matchedText.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('@')) {
          const username = part.slice(1);
          const mentionEntry = Object.entries(mentions).find(([, stored]) => stored === username);
          const profileLink = mentionEntry ? `/profile/${mentionEntry[0]}` : `/profile/${username}`;
          return (
            <Link
              key={i}
              to={profileLink}
              className={mentionClass}
              onClick={(e) => {
                e.stopPropagation();
                onMentionClick?.(username, e);
              }}
            >
              {part}
            </Link>
          );
        }
        if (part.startsWith('#')) {
          const tag = part.slice(1);
          return (
            <Link
              key={i}
              to={`/hashtag/${encodeURIComponent(tag)}`}
              className={hashtagClass}
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </Link>
          );
        }
        if (part.startsWith('http://') || part.startsWith('https://')) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
              onClick={(e) => {
                e.stopPropagation();
                if (onExternalLink) {
                  e.preventDefault();
                  onExternalLink(part);
                }
              }}
            >
              {part}
            </a>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}
