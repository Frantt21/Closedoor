import { useContext } from 'react';
import { MusicPlayerContext } from '../context/musicContext';

/**
 * Acceso al reproductor global de música (context/MusicPlayerContext.jsx).
 * Devuelve {} si todavía no hay provider para no romper consumidores sueltos.
 */
export function useMusicPlayer() {
  return useContext(MusicPlayerContext) || {};
}
