const fs = require('fs');

const filePath = 'src/assets/Pages/Chat.jsx';
let content = fs.readFileSync(filePath, 'utf8');

// ============================================================
// 1. Update search results section — show clickable message items
// ============================================================
const oldSearchResults = `            <div className="chat-msg-search-results">
              {msgSearchQuery
                ? messages.filter(m => (m.decryptedContent || '').toLowerCase().includes(msgSearchQuery.toLowerCase())).length
                : messages.length} / {messages.length} messages
            </div>
          </div>
        </div>
      )}

      {/* ── Media Gallery floating panel ── */}`;

const newSearchResults = `            <div className="chat-msg-search-results">
              {(() => {
                const q = msgSearchQuery.toLowerCase();
                const filtered = msgSearchQuery
                  ? messages.filter(m => (m.decryptedContent || '').toLowerCase().includes(q))
                  : [];
                if (filtered.length === 0) {
                  return <div className="chat-msg-search-empty">{msgSearchQuery ? t('explore.no_results') : t('chat.search_messages_placeholder') || 'Search messages...'}</div>;
                }
                return filtered.slice(0, 20).map(msg => (
                  <button
                    key={msg.id}
                    className="chat-msg-search-result"
                    onClick={() => { handleGoToMessage(msg.id); setShowMsgSearch(false); }}
                  >
                    <span className="chat-msg-search-result-text">
                      {msg.decryptedContent || t('chat.encrypted')}
                    </span>
                    <span className="chat-msg-search-result-time">
                      {getTimeAgo(t, locale, msg.created_at)}
                    </span>
                  </button>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Media Gallery floating panel ── */}`;

const searchIdx = content.indexOf(oldSearchResults);
if (searchIdx !== -1) {
  content = content.slice(0, searchIdx) + newSearchResults + content.slice(searchIdx + oldSearchResults.length);
  console.log('1. Updated search results section OK');
} else {
  console.log('1. FAILED: could not find search results section');
}

// ============================================================
// 2. Remove stopPropagation from media gallery, pinned, profile card panels
//    and add a useEffect to close panels on outside click
// ============================================================

// Find the useEffect that handles closing context menus
const contextMenuEffectPos = content.indexOf('// Close context menus on click outside');
if (contextMenuEffectPos === -1) {
  console.log('2. FAILED: could not find context menu effect');
  process.exit(1);
}

// Find the end of the emojiPickerRef handling
const emojiRefEnd = content.indexOf('    };\n    document.addEventListener', contextMenuEffectPos);
const effectEnd = content.indexOf('  }, []);', emojiRefEnd);

// After the existing close-handler for context menus, add close-handler for floating panels
const oldEffectSection = content.slice(contextMenuEffectPos, effectEnd + 7);
const newEffectSection = `// Close context menus on click outside
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

  // Close floating panels (media, pinned, profile) on outside click
  const floatPanelRef = useRef(null);
  useEffect(() => {
    if (!showMediaGallery && !showPinnedPanel && !showProfileCard) return;
    const handleClick = (e) => {
      if (floatPanelRef.current && !floatPanelRef.current.contains(e.target)) {
        setShowMediaGallery(false);
        setShowPinnedPanel(false);
        setShowProfileCard(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMediaGallery, showPinnedPanel, showProfileCard]);`;

content = content.slice(0, contextMenuEffectPos) + newEffectSection + content.slice(effectEnd + 7);
console.log('2. Added outside click handler for floating panels OK');

// ============================================================
// 3. Add floatPanelRef ref variable
// ============================================================
// Find the existing refs section and add floatPanelRef
const refsSection = 'const messagesContainerRef = useRef(null);\n  const inputRef = useRef(null);';
const newRefsSection = 'const messagesContainerRef = useRef(null);\n  const inputRef = useRef(null);\n  const floatPanelRef = useRef(null);';
content = content.replace(refsSection, newRefsSection);
console.log('3. Added floatPanelRef OK');

// ============================================================
// 4. Remove stopPropagation from media gallery, pinned, profile card panels
//    and add ref to their container div
// ============================================================

// Media gallery panel
content = content.replace(
  `showMediaGallery && (
        <div className="chat-float-panel" onClick={(e) => e.stopPropagation()}>`,
  `showMediaGallery && (
        <div className="chat-float-panel">`
);

// Pinned messages panel
content = content.replace(
  `showPinnedPanel && (
        <div className="chat-float-panel" onClick={(e) => e.stopPropagation()}>`,
  `showPinnedPanel && (
        <div className="chat-float-panel">`
);

// Profile card panel - remove stopPropagation, wrap panels in a ref container
content = content.replace(
  `showProfileCard && otherUser && (
        <div className="chat-float-panel" onClick={(e) => e.stopPropagation()} style={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: '0' }}>`,
  `showProfileCard && otherUser && (
        <div className="chat-float-panel" style={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: '0' }}>`
);

console.log('4. Removed stopPropagation from panels OK');

// ============================================================
// 5. Wrap the 3 floating panels (media, pinned, profile) in a single div with ref
// ============================================================
// After the search panel, wrap media gallery + pinned + profile card in a div with ref

const markerSearchEnd = `      {/* ── Media Gallery floating panel ── */}`;
const markerProfileEnd = `        </div>
      )}`; // The closing of profile card

// Find the closing of profile card + newline before the floating emoji picker
const profileCardEnd = content.lastIndexOf('        </div>\n      )}\n\n      {/* ── Floating emoji picker');
if (profileCardEnd !== -1) {
  // Insert opening div with ref before media gallery
  const mediaStart = content.indexOf(markerSearchEnd);
  if (mediaStart !== -1) {
    // Add ref div before media gallery
    const before = content.slice(0, mediaStart);
    const after = content.slice(mediaStart);
    content = before + '      <div ref={floatPanelRef}>\n' + after;
    
    // Add closing div after profile card
    // The profile card now ends before the emoji picker
    const emojiStart = content.indexOf('      {/* ── Floating emoji picker');
    if (emojiStart !== -1) {
      const beforeEmoji = content.slice(0, emojiStart);
      const afterEmoji = content.slice(emojiStart);
      content = beforeEmoji + '      </div>\n\n' + afterEmoji;
    }
    console.log('5. Wrapped panels in ref div OK');
  } else {
    console.log('5. FAILED: could not find media gallery start');
  }
} else {
  console.log('5. FAILED: could not find profile card end');
}

// ============================================================
// 6. Profile card panel: remove title + X button from header
// ============================================================
const oldProfileHeader = `          <div className="chat-float-panel-header" style={{ padding: '0 0 8px 0' }}>
            <span className="chat-float-panel-title">{t('chat.view_profile') || 'Profile'}</span>
            <button className="chat-float-panel-close" onClick={() => setShowProfileCard(false)}>
              <FaTimes />
            </button>
          </div>
          <div className=`;

const newProfileHeader = `          <div className=`;

content = content.replace(oldProfileHeader, newProfileHeader);
console.log('6. Removed profile card header title + X OK');

fs.writeFileSync(filePath, content, 'utf8');
console.log('File written successfully');
