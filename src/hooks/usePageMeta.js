import { useEffect } from 'react';

const SITE_NAME = 'Closedoor';

/**
 * Sets document title and Open Graph / Twitter meta tags dynamically.
 * Note: For social media scrapers (Discord, Twitter, etc.), server-side
 * OG tag injection is required (see /server.js).
 */
export default function usePageMeta({ title, description, image, url } = {}) {
  useEffect(() => {
    // Title
    document.title = title ? `${title} | ${SITE_NAME}` : SITE_NAME;

    // Remove previous dynamic meta tags
    document.querySelectorAll('meta[data-dynamic]').forEach((el) => el.remove());

    // Helper to set a meta tag
    const setMeta = (attrName, attrVal, content) => {
      if (!content) return;
      const el = document.createElement('meta');
      el.setAttribute(attrName, attrVal);
      el.setAttribute('content', content);
      el.dataset.dynamic = 'true';
      document.head.appendChild(el);
    };

    // OG tags
    setMeta('property', 'og:title', title || SITE_NAME);
    setMeta('property', 'og:description', description || 'Share and discover on Closedoor.');
    setMeta('property', 'og:image', image || '');
    setMeta('property', 'og:url', url || '');
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', SITE_NAME);
    setMeta('name', 'description', description || 'Share and discover on Closedoor.');

    // Twitter cards
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title || SITE_NAME);
    setMeta('name', 'twitter:description', description || 'Share and discover on Closedoor.');
    setMeta('name', 'twitter:image', image || '');
  }, [title, description, image, url]);
}
