import { createContext } from 'react';

/**
 * Contexto del reproductor global de música ("Mi canción").
 *
 * Vive en su propio módulo (sin componentes) para que el provider
 * (context/MusicPlayerContext.jsx) y el hook (hooks/useMusicPlayer.js) puedan
 * compartirlo sin romper el fast-refresh de Vite.
 */
export const MusicPlayerContext = createContext(null);
