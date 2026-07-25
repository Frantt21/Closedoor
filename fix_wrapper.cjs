const fs = require('fs');
const filePath = 'src/assets/Pages/Chat.jsx';
let content = fs.readFileSync(filePath, 'utf8');

// Current structure (line 1465-1698):
// ...context menu...
//             <div ref={floatPanelRef}>
//
//       {/* ── Media Gallery floating panel ── */}
//       
//       {/* ── Message Search floating panel ── */}
//       {showMsgSearch && (
//         <div className="chat-float-panel chat-float-panel--search" ...
//         ...search panel...
//         </div>
//       )}
//
// {showMediaGallery && (
//         <div className="chat-float-panel">
//         ...media gallery...
//         </div>
//       )}
//       
//       {showPinnedPanel && (
//         ...pinned messages...
//       )}
//       
//       {/* ── Profile Card floating panel ... */}
//       {showProfileCard && otherUser && (
//         ...profile card...
//       )}
//       
//       </div>
//
//       {/* ── Floating emoji picker ... */}

// I need:
// ...context menu...
//
//       {/* ── Message Search floating panel ── */}
//       {showMsgSearch && (
//         ...search panel...
//       )}
//
//       <div ref={floatPanelRef}>
// {showMediaGallery && (
//         ...media gallery...
//       )}
//       
//       {showPinnedPanel && (
//         ...pinned messages...
//       )}
//       
//       {/* ── Profile Card floating panel ... */}
//       {showProfileCard && otherUser && (
//         ...profile card...
//       )}
//       </div>
//
//       {/* ── Floating emoji picker ... */}

// Find the key markers
const refDivStart = content.indexOf('            <div ref={floatPanelRef}>');
const mediaComment = content.indexOf('      {/* ── Media Gallery floating panel ── */}');
const searchComment = content.indexOf('      {/* ── Message Search floating panel ── */}');
const refDivEnd = content.indexOf('      </div>\n\n      {/* ── Floating emoji picker');

console.log('refDivStart:', refDivStart);
console.log('mediaComment:', mediaComment);
console.log('searchComment:', searchComment);
console.log('refDivEnd:', refDivEnd);

if (refDivStart === -1 || mediaComment === -1 || searchComment === -1 || refDivEnd === -1) {
  console.log('FAILED: could not find markers');
  process.exit(1);
}

// Extract the 3 sections:
// Section 1: Before ref div (context menu etc)
// Section 2: Inside ref div (from media comment to before floating emoji)
// Section 3: After ref div (floating emoji picker onwards)

const beforeRef = content.slice(0, refDivStart);
const insideRef = content.slice(refDivStart + refDivStart.length, refDivEnd);
const afterRef = content.slice(refDivEnd);

// Inside the ref div, extract:
// - Search panel (from searchComment to just before showMediaGallery)
// - The rest (media gallery + pinned + profile card)

const mediaGalleryStart = insideRef.indexOf('{showMediaGallery &&');
const searchContent = insideRef.slice(0, mediaGalleryStart);
const closableContent = insideRef.slice(mediaGalleryStart);

// New structure:
// beforeRef + searchContent + '<div ref={floatPanelRef}>\n' + closableContent + '</div>\n\n' + afterRef

const newContent = beforeRef + searchContent + '      <div ref={floatPanelRef}>\n' + closableContent + '      </div>\n\n' + afterRef;

fs.writeFileSync(filePath, newContent, 'utf8');
console.log('File rewritten successfully');
console.log('Search content length:', searchContent.length);
console.log('Closable content length:', closableContent.length);
