import React, { useState, useEffect, useRef } from 'react';
import { sanitizeUrl } from '../../services/helpers';

/**
 * Fetches OG tag data for a URL from the /api/og-link endpoint.
 * Renders a compact link preview card with title, description, image, and favicon.
 *
 * @param {object} props
 * @param {string} props.url - The URL to fetch OG data for
 * @param {function} [props.onExternalLink] - Callback when the card is clicked (for external link warning)
 * @param {string} [props.className] - Additional CSS class
 */
export default function LinkPreview({ url, onExternalLink, className = '' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const fetchRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const cacheKey = `og_cache_${url}`;

    // Check cache first (sessionStorage)
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.title) {
          setData(parsed);
          setLoading(false);
          // Still refresh in background
        }
      }
    } catch {}

    const fetchOG = async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/og-link?url=${encodeURIComponent(url)}`);
        const json = await res.json();
        if (cancelled || !mountedRef.current) return;

        if (json.success) {
          setData(json);
          // Cache result
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify(json));
          } catch {}
        } else {
          setError(true);
        }
      } catch {
        if (!cancelled && mountedRef.current) setError(true);
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    };

    fetchOG();

    return () => { cancelled = true; };
  }, [url]);

  if (!url) return null;

  // Show loading skeleton
  if (loading && !data) {
    return (
      <div className={`chat-link-preview chat-link-preview--loading ${className}`}>
        <div className="chat-link-preview-image-skeleton" />
        <div className="chat-link-preview-body">
          <div className="chat-link-preview-skeleton-line" style={{ width: '70%' }} />
          <div className="chat-link-preview-skeleton-line" style={{ width: '90%' }} />
          <div className="chat-link-preview-skeleton-line" style={{ width: '40%' }} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    // Fallback: show just the raw URL as a clickable link
    return (
      <a
        href={sanitizeUrl(url)}
        target="_blank"
        rel="noopener noreferrer"
        className={`chat-link-preview chat-link-preview--fallback ${className}`}
        onClick={(e) => {
          e.stopPropagation();
          if (onExternalLink) {
            e.preventDefault();
            onExternalLink(url);
          }
        }}
      >
        <span className="chat-link-preview-fallback-icon">🔗</span>
        <span className="chat-link-preview-fallback-url">{url}</span>
      </a>
    );
  }

  const handleClick = (e) => {
    e.stopPropagation();
    if (onExternalLink) {
      e.preventDefault();
      onExternalLink(url);
    }
  };

  return (
    <a
      href={sanitizeUrl(url)}
      target="_blank"
      rel="noopener noreferrer"
      className={`chat-link-preview ${className}`}
      onClick={handleClick}
    >
      {/* Image preview */}
      {data.image && (
        <div className="chat-link-preview-image-wrap">
          <img
            src={data.image}
            alt=""
            className="chat-link-preview-image"
            loading="lazy"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        </div>
      )}

      {/* Text body */}
      <div className="chat-link-preview-body">
        <div className="chat-link-preview-header">
          {data.favicon && (
            <img
              src={data.favicon}
              alt=""
              className="chat-link-preview-favicon"
              width="16"
              height="16"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
          <span className="chat-link-preview-domain">
            {(() => {
              try { return new URL(url).hostname; } catch { return url; }
            })()}
          </span>
        </div>
        {data.title && (
          <span className="chat-link-preview-title">{data.title}</span>
        )}
        {data.description && (
          <span className="chat-link-preview-desc">{data.description}</span>
        )}
      </div>
    </a>
  );
}
