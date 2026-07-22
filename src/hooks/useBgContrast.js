import { useState, useEffect, useRef } from 'react';
import { getContrastForBg } from '../assets/services/colorExtractor';

/**
 * Custom hook that analyzes a background image URL and returns the ideal
 * text contrast color for glass/translucent overlays.
 *
 * - Returns '#000000' for light/bright images
 * - Returns '#ffffff' for dark images
 * - Defaults to '#ffffff' while loading or if no image
 * - Results are cached in localStorage by colorExtractor
 */
export default function useBgContrast(bgUrl) {
  const [contrastColor, setContrastColor] = useState('#ffffff');
  const prevUrlRef = useRef(null);

  useEffect(() => {
    if (!bgUrl) {
      setContrastColor('#ffffff');
      prevUrlRef.current = null;
      return;
    }

    // Avoid re-fetching if URL hasn't changed
    if (bgUrl === prevUrlRef.current) return;
    prevUrlRef.current = bgUrl;

    getContrastForBg(bgUrl).then((color) => {
      setContrastColor(color);
    }).catch(() => {
      // Fallback: default to white text on error
      setContrastColor('#ffffff');
    });
  }, [bgUrl]);

  return contrastColor;
}
