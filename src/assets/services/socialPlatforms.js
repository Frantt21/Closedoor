// ── Social platform detection ──
// Auto-detects platform from a username or URL
// Uses react-icons for platform icons

import {
  FaXTwitter, FaInstagram, FaGithub, FaYoutube, FaTwitch, FaTiktok,
  FaLinkedin, FaDiscord, FaTelegram, FaFacebook, FaSnapchat, FaReddit,
  FaPinterest, FaVk, FaSoundcloud, FaSpotify, FaApple, FaSteam,
  FaDribbble, FaBehance, FaMedium, FaMastodon, FaCodepen,
  FaStackOverflow, FaLink,
} from 'react-icons/fa6';

const ICON_MAP = {
  twitter: FaXTwitter,
  instagram: FaInstagram,
  github: FaGithub,
  youtube: FaYoutube,
  twitch: FaTwitch,
  tiktok: FaTiktok,
  linkedin: FaLinkedin,
  discord: FaDiscord,
  telegram: FaTelegram,
  facebook: FaFacebook,
  snapchat: FaSnapchat,
  reddit: FaReddit,
  pinterest: FaPinterest,
  vk: FaVk,
  soundcloud: FaSoundcloud,
  spotify: FaSpotify,
  applemusic: FaApple,
  steam: FaSteam,
  dribbble: FaDribbble,
  behance: FaBehance,
  medium: FaMedium,
  mastodon: FaMastodon,
  codepen: FaCodepen,
  stackoverflow: FaStackOverflow,
  website: FaLink,
  custom: FaLink,
};

// ── Helper: extract username from URL path per platform ──
function extractTwitterUser(path) {
  // /username, /@username, /username/status/123
  const parts = path.replace(/^@/, '').split('/');
  const u = parts[0]?.match(/^(\w{1,15})$/);
  return u ? u[1] : null;
}

function extractInstagramUser(path) {
  // /username, /@username  (NOT /p/, /reel/, /reels/, /tv/, /stories/)
  const first = path.split('/')[0]?.replace(/^@/, '');
  if (!first || ['p', 'reel', 'reels', 'tv', 'stories', 'explore'].includes(first)) return null;
  return first.match(/^[\w.]{1,30}$/) ? first : null;
}

function extractGithubUser(path) {
  // /username, /username/repo
  return path.split('/')[0]?.match(/^([\w-]+)$/)?.[1] || null;
}

function extractYoutubeUser(path) {
  // /@username, /c/username, /user/username, /channel/UCxxx
  const parts = path.split('/');
  if (parts[0]?.startsWith('@')) return parts[0].slice(1);
  if (parts[0] === 'c' && parts[1]) return parts[1];
  if (parts[0] === 'user' && parts[1]) return parts[1];
  if (parts[0] === 'channel' && parts[1]) return parts[1];
  return null;
}

function extractTwitchUser(path) {
  // /username
  return path.split('/')[0]?.match(/^(\w{4,25})$/) ? path.split('/')[0] : null;
}

function extractTiktokUser(path) {
  // /@username, /username  (skip /video/, /tag/)
  const first = path.replace(/^@/, '').split('/')[0];
  if (!first || ['video', 'tag', 'music'].includes(first)) return null;
  return first.match(/^[\w.]{2,24}$/) ? first : null;
}

function extractLinkedinUser(path) {
  // /in/username, /company/name
  const parts = path.split('/');
  if (parts[0] === 'in' && parts[1]) return parts[1];
  if (parts[0] === 'company' && parts[1]) return parts[1];
  return null;
}

function extractFacebookUser(path) {
  // /username, /@username, /profile.php?id=...
  const first = path.replace(/^@/, '').split('/')[0];
  if (!first || ['photo', 'video', 'story', 'events', 'groups', 'pages', 'messages'].includes(first)) return null;
  if (first === 'profile.php') return null; // handled by query param
  return first.match(/^[\w.]+$/) ? first : null;
}

function extractSnapchatUser(path) {
  // /add/username
  const parts = path.split('/');
  if (parts[0] === 'add' && parts[1]) return parts[1].match(/^[\w-]{3,15}$/) ? parts[1] : null;
  return null;
}

function extractRedditUser(path) {
  // /user/username
  const parts = path.split('/');
  if (parts[0] === 'user' && parts[1]) return parts[1].match(/^[\w-]{3,20}$/) ? parts[1] : null;
  return null;
}

function extractPinterestUser(path) {
  // /username, /@username
  const first = path.replace(/^@/, '').split('/')[0];
  if (!first || ['pin', 'board', '_created'].includes(first)) return null;
  return first.match(/^[\w-]+$/) ? first : null;
}

function extractVkUser(path) {
  // /username, /id12345
  const first = path.split('/')[0];
  if (first?.startsWith('id') && /^id\d+$/.test(first)) return first;
  if (!first || ['feed', 'wall', 'video', 'audio', 'club', 'event', 'album'].includes(first)) return null;
  return first.match(/^[\w.]+$/) ? first : null;
}

function extractSoundcloudUser(path) {
  // /username
  const first = path.split('/')[0];
  if (!first || ['discover', 'stream', 'upload', 'you', 'popular'].includes(first)) return null;
  return first.match(/^[\w-]{3,25}$/) ? first : null;
}

function extractSpotifyUser(path) {
  // /user/username
  const parts = path.split('/');
  if (parts[0] === 'user' && parts[1]) return parts[1];
  return null;
}

function extractSteamUser(path) {
  // /id/username, /profiles/7656119...
  const parts = path.split('/');
  if (parts[0] === 'id' && parts[1]) return parts[1];
  if (parts[0] === 'profiles' && parts[1]) return parts[1];
  return null;
}

function extractGenericUser(path) {
  // Simple: first path segment, skip known non-profile paths
  const first = path.replace(/^@/, '').split('/')[0];
  if (!first || ['posts', 'photos', 'albums', 'about'].includes(first)) return null;
  return first.match(/^[\w-]+$/) ? first : null;
}

const PLATFORMS = [
  {
    id: 'twitter',
    name: 'Twitter / X',
    domains: ['twitter.com', 'x.com'],
    patterns: [/^@?(\w{1,15})$/i],
    urlTemplate: (username) => `https://x.com/${username}`,
    extractUrlUsername: extractTwitterUser,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    domains: ['instagram.com'],
    patterns: [/^@?(\w[\w.]{0,29})$/i],
    urlTemplate: (username) => `https://instagram.com/${username}`,
    extractUrlUsername: extractInstagramUser,
  },
  {
    id: 'github',
    name: 'GitHub',
    domains: ['github.com'],
    patterns: [/^@?([\w-]+)$/i],
    urlTemplate: (username) => `https://github.com/${username}`,
    extractUrlUsername: extractGithubUser,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    domains: ['youtube.com', 'youtu.be'],
    patterns: [/^@?([\w-]+)$/i],
    urlTemplate: (username) => `https://youtube.com/@${username}`,
    extractUrlUsername: extractYoutubeUser,
  },
  {
    id: 'twitch',
    name: 'Twitch',
    domains: ['twitch.tv'],
    patterns: [/^@?(\w{4,25})$/i],
    urlTemplate: (username) => `https://twitch.tv/${username}`,
    extractUrlUsername: extractTwitchUser,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    domains: ['tiktok.com'],
    patterns: [/^@?([\w.]{2,24})$/i],
    urlTemplate: (username) => `https://tiktok.com/@${username}`,
    extractUrlUsername: extractTiktokUser,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    domains: ['linkedin.com'],
    patterns: [/^@?([\w-]+)$/i],
    urlTemplate: (username) => `https://linkedin.com/in/${username}`,
    extractUrlUsername: extractLinkedinUser,
  },
  {
    id: 'discord',
    name: 'Discord',
    domains: ['discord.com', 'discord.gg'],
    patterns: [/^@?(.{2,32})#\d{4}$/i],
    urlTemplate: (username) => `https://discord.com/users/${username}`,
    extractUrlUsername: null,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    domains: ['t.me', 'telegram.me'],
    patterns: [/^@?(\w{5,32})$/i],
    urlTemplate: (username) => `https://t.me/${username}`,
    extractUrlUsername: (path) => path.split('/')[0]?.match(/^(\w{5,32})$/) ? path.split('/')[0] : null,
  },
  {
    id: 'facebook',
    name: 'Facebook',
    domains: ['facebook.com', 'fb.com'],
    patterns: [/^@?([\w.]+)$/i],
    urlTemplate: (username) => `https://facebook.com/${username}`,
    extractUrlUsername: extractFacebookUser,
  },
  {
    id: 'snapchat',
    name: 'Snapchat',
    domains: ['snapchat.com'],
    patterns: [/^@?([\w-]{3,15})$/i],
    urlTemplate: (username) => `https://snapchat.com/add/${username}`,
    extractUrlUsername: extractSnapchatUser,
  },
  {
    id: 'reddit',
    name: 'Reddit',
    domains: ['reddit.com'],
    patterns: [/^u\/([\w-]+)$/i, /^@?([\w-]{3,20})$/i],
    urlTemplate: (username) => `https://reddit.com/user/${username}`,
    extractUrlUsername: extractRedditUser,
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    domains: ['pinterest.com', 'pinterest.es', 'pinimg.com'],
    patterns: [/^@?([\w-]+)$/i],
    urlTemplate: (username) => `https://pinterest.com/${username}`,
    extractUrlUsername: extractPinterestUser,
  },
  {
    id: 'vk',
    name: 'VK',
    domains: ['vk.com', 'vkontakte.ru'],
    patterns: [/^@?([\w.]+)$/i],
    urlTemplate: (username) => `https://vk.com/${username}`,
    extractUrlUsername: extractVkUser,
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    domains: ['soundcloud.com'],
    patterns: [/^@?([\w-]{3,25})$/i],
    urlTemplate: (username) => `https://soundcloud.com/${username}`,
    extractUrlUsername: extractSoundcloudUser,
  },
  {
    id: 'spotify',
    name: 'Spotify',
    domains: ['spotify.com', 'open.spotify.com'],
    patterns: [/^@?([\w-]+)$/i],
    urlTemplate: (username) => `https://open.spotify.com/user/${username}`,
    extractUrlUsername: extractSpotifyUser,
  },
  {
    id: 'applemusic',
    name: 'Apple Music',
    domains: ['music.apple.com'],
    patterns: [],
    urlTemplate: (url) => url,
    extractUrlUsername: null,
  },
  {
    id: 'steam',
    name: 'Steam',
    domains: ['steamcommunity.com', 'steampowered.com'],
    patterns: [/^@?([\w-]+)$/i],
    urlTemplate: (username) => `https://steamcommunity.com/id/${username}`,
    extractUrlUsername: extractSteamUser,
  },
  {
    id: 'dribbble',
    name: 'Dribbble',
    domains: ['dribbble.com'],
    patterns: [/^@?([\w-]+)$/i],
    urlTemplate: (username) => `https://dribbble.com/${username}`,
    extractUrlUsername: extractGenericUser,
  },
  {
    id: 'behance',
    name: 'Behance',
    domains: ['behance.net'],
    patterns: [/^@?([\w-]+)$/i],
    urlTemplate: (username) => `https://behance.net/${username}`,
    extractUrlUsername: extractGenericUser,
  },
  {
    id: 'medium',
    name: 'Medium',
    domains: ['medium.com'],
    patterns: [/^@?([\w-]+)$/i],
    urlTemplate: (username) => `https://medium.com/@${username}`,
    extractUrlUsername: extractGenericUser,
  },
  {
    id: 'mastodon',
    name: 'Mastodon',
    domains: ['mastodon.social', 'mastodon.online', 'mastodon.cloud'],
    patterns: [/^@?([\w-]+@[\w.-]+)$/i],
    urlTemplate: (username) => {
      const parts = username.split('@');
      if (parts.length === 2) return `https://${parts[1]}/@${parts[0]}`;
      return `https://mastodon.social/@${username}`;
    },
    extractUrlUsername: null,
  },
  {
    id: 'codepen',
    name: 'CodePen',
    domains: ['codepen.io'],
    patterns: [/^@?([\w-]+)$/i],
    urlTemplate: (username) => `https://codepen.io/${username}`,
    extractUrlUsername: extractGenericUser,
  },
  {
    id: 'stackoverflow',
    name: 'Stack Overflow',
    domains: ['stackoverflow.com'],
    patterns: [/^@?([\w-]+)$/i],
    urlTemplate: (username) => `https://stackoverflow.com/users/${username}`,
    extractUrlUsername: null,
  },
  {
    id: 'website',
    name: 'Website',
    domains: [],
    patterns: [/^https?:\/\/.+/i],
    urlTemplate: (url) => url,
    extractUrlUsername: null,
  },
];

// ── Generic URL username extraction fallback ──
function extractUrlUsername(platform, path) {
  if (platform.extractUrlUsername) {
    return platform.extractUrlUsername(path);
  }
  // Fallback: first segment, strip @
  return path.replace(/^@/, '').split('/')[0] || null;
}

/**
 * Detect platform from a username or URL string
 * @param {string} input - Username (with or without @) or URL
 * @returns {{ platform: object, username: string, url: string } | null}
 */
export function detectPlatform(input) {
  if (!input || !input.trim()) return null;
  const text = input.trim();

  // Try URL detection first
  try {
    const urlObj = new URL(
      text.startsWith('http') ? text : `https://${text}`
    );
    const hostname = urlObj.hostname.replace(/^www\./, '').toLowerCase();
    const path = urlObj.pathname.replace(/^\/+/, '').replace(/\/+$/, '');

    for (const platform of PLATFORMS) {
      if (platform.domains.some((d) => hostname.includes(d))) {
        const username = extractUrlUsername(platform, path) || text;
        return {
          platform,
          username,
          url: text.startsWith('http') ? text : `https://${text}`,
        };
      }
    }
  } catch {
    // Not a valid URL, try username patterns
  }

  // Try username patterns
  for (const platform of PLATFORMS) {
    for (const pattern of platform.patterns) {
      const match = text.match(pattern);
      if (match) {
        const username = match[1];
        return {
          platform,
          username,
          url: platform.urlTemplate(username),
        };
      }
    }
  }

  // Fallback: unknown platform
  return {
    platform: { id: 'custom', name: 'Link', domains: [], patterns: [], urlTemplate: (u) => u.startsWith('http') ? u : `https://${u}` },
    username: text,
    url: text.startsWith('http') ? text : `https://${text}`,
  };
}

/**
 * Get React Icon component type for a platform
 * @param {string} platformId
 * @returns {React.ComponentType}
 */
export function getPlatformIcon(platformId) {
  return ICON_MAP[platformId] || FaLink;
}

/**
 * Get platform name
 */
export function getPlatformName(platformId) {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  return platform?.name || 'Link';
}

export { PLATFORMS };
