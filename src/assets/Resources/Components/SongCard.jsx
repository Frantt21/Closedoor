import { useEffect, useRef, useState } from 'react';
import { FaMusic, FaPlay, FaPause, FaPencilAlt, FaTrash, FaSearch, FaSpinner } from 'react-icons/fa';
import { useI18n } from '../../services/i18n/useI18n';
import { useAuth } from '../../../hooks/useAuth';
import { searchMusic, resolvePreviewUrl, getStreamUrl } from '../../services/musicService';
import { updateUserProfile } from '../../services/userService';
import { toast } from 'react-toastify';
import './css/songCard.css';

function formatTime(s) {
  if (!isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Card "Mi canción" del sidebar del perfil (arriba de los intereses).
 * - Muestra el arte del álbum como un disco de vinilo que gira al reproducir
 *   el preview de 30s (iTunes / Deezer).
 * - En el perfil propio permite buscar, elegir, cambiar y quitar la canción
 *   inline (sin abrir el modal de edición).
 */
export default function SongCard({ song, isOwnProfile, surfaceStyle }) {
  const { t } = useI18n();
  const { user } = useAuth();

  // Guard: solo tratar como canción si el shape es válido
  const songObj = song && typeof song === 'object' && song?.title && song?.previewUrl ? song : null;

  // ── Estado del song (synced desde el perfil) ──
  const [selected, setSelected] = useState(songObj || null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Playback ──
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(songObj?.duration || 0);
  // true cuando el stream completo falló y hay que caer al preview de 30s
  const [usePreview, setUsePreview] = useState(false);
  const [progress, setProgress] = useState(0);
  // URL de preview resuelta con la sig de la canción a la que pertenece
  // (los previews de Deezer expiran ≈ 15 min → se re-consultan al reproducir)
  const [resolvedPreview, setResolvedPreview] = useState({ sig: '', url: null });
  const audioRef = useRef(null);

  // ── Sync cuando cambia el song del perfil (realtime / navegación) ──
  const songSig = songObj ? `${songObj.provider}:${songObj.trackId}` : '';
  const prevSigRef = useRef(songSig);
  useEffect(() => {
    if (prevSigRef.current === songSig) return;
    prevSigRef.current = songSig;
    setSelected(songObj || null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(songObj?.duration || 0);
    setProgress(0);
    setUsePreview(false);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [songObj, songSig]);

  const selSig = selected ? `${selected.provider}:${selected.trackId}` : '';
  const isDeezer = selected?.provider === 'deezer' && !!selected?.trackId;
  // iTunes: preview estable → src derivado directo del selected.
  // Deezer: usa la URL resuelta SOLO si pertenece a la canción actual
  // (si no, null hasta que la resolución termine).
  const effectivePreviewSrc = isDeezer
    ? (resolvedPreview.sig === selSig ? resolvedPreview.url : null)
    : (selected?.previewUrl || null);

  // ── Resolver preview fresco (Deezer) cuando cambia la canción visible ──
  // Se basa en `selected` (no en el prop) para cubrir también el guardado local
  // inline, sin esperar al realtime. setState solo en callbacks async.
  useEffect(() => {
    if (!isDeezer || !selected?.trackId) return;
    let cancelled = false;
    resolvePreviewUrl(selected)
      .then((url) => {
        if (cancelled) return;
        setResolvedPreview({ sig: selSig, url: url || selected.previewUrl });
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedPreview({ sig: selSig, url: selected.previewUrl });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Pausar al desmontar (el <audio> siempre está montado → el ref es estable)
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) audio.pause();
    };
  }, []);

  // Perfil ajeno sin canción → no mostrar la card
  if (!isOwnProfile && !selected) return null;

  // ── Fuente de reproducción: stream completo (yt-dlp) si existe, con
  //    fallback al preview de 30s cuando el server de stream no está o falla ──
  const streamUrl = getStreamUrl(selected);
  const playbackSrc = usePreview || !streamUrl ? effectivePreviewSrc : streamUrl;

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !playbackSrc) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio
        .play()
        .then(() => setPlaying(true))
        .catch((err) => console.warn('[song] playback error:', err?.message || err));
    }
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchError('');
    try {
      const { results: found } = await searchMusic(q, { limit: 8 });
      setResults(found);
      if (!found.length) setSearchError(t('profile.song_no_results') || 'No songs found');
    } catch (err) {
      console.warn('[song] search error:', err?.message || err);
      setSearchError(t('profile.song_error') || "Couldn't search music");
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const saveSong = async (track) => {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      await updateUserProfile(user.id, { song: track });
      setSelected(track);
      setEditing(false);
      setResults([]);
      setQuery('');
      setSearchError('');
      toast.success(t('profile.song_saved') || 'Song saved to your profile');
    } catch (err) {
      console.warn('[song] save error:', err?.message || err);
      toast.error(err?.message || t('profile.error_generic') || 'Error');
    } finally {
      setSaving(false);
    }
  };

  const removeSong = async () => {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      await updateUserProfile(user.id, { song: null });
      setSelected(null);
      setEditing(false);
      setResults([]);
      setQuery('');
      setSearchError('');
      toast.success(t('profile.song_removed') || 'Song removed from your profile');
    } catch (err) {
      console.warn('[song] remove error:', err?.message || err);
      toast.error(err?.message || t('profile.error_generic') || 'Error');
    } finally {
      setSaving(false);
    }
  };

  const openEditor = () => {
    setEditing(true);
    setQuery('');
    setResults([]);
    setSearchError('');
  };

  const closeEditor = () => {
    setEditing(false);
    setQuery('');
    setResults([]);
    setSearchError('');
  };

  return (
    <div className="profile-sidebar-card" style={surfaceStyle}>
      <h3 className="profile-sidebar-title">
        <FaMusic className="profile-sidebar-title-icon" />
        {t('profile.song_title')}
      </h3>

      {editing ? (
        /* ── Editor inline (perfil propio) ── */
        <div className="song-card-editor">
          <div className="song-card-search-row">
            <input
              className="song-card-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder={t('profile.song_search_placeholder')}
              autoFocus
            />
            <button
              type="button"
              className="song-card-search-btn"
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              title={t('profile.song_search_btn')}
            >
              {searching ? <FaSpinner className="fc-spin" /> : <FaSearch />}
            </button>
          </div>

          {searching && <p className="song-card-search-msg">{t('profile.song_searching')}</p>}
          {searchError && <p className="song-card-search-msg">{searchError}</p>}

          {results.length > 0 && (
            <>
              <p className="song-card-select-hint">{t('profile.song_select_hint')}</p>
              <div className="song-card-results">
                {results.map((r) => (
                  <button
                    key={`${r.provider}-${r.trackId}`}
                    type="button"
                    className={`song-card-result ${
                      selected?.trackId === r.trackId && selected?.provider === r.provider
                        ? 'song-card-result--selected'
                        : ''
                    }`}
                    onClick={() => saveSong(r)}
                    disabled={saving}
                  >
                    {r.artwork ? (
                      <img
                        className="song-card-result-art"
                        src={r.artwork}
                        alt=""
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                      />
                    ) : (
                      <span className="song-card-result-art song-card-result-art--empty">
                        <FaMusic />
                      </span>
                    )}
                    <span className="song-card-result-info">
                      <span className="song-card-result-title">{r.title}</span>
                      <span className="song-card-result-artist">{r.artist}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="song-card-editor-actions">
            <button type="button" className="song-card-cancel-btn" onClick={closeEditor} disabled={saving}>
              {t('common.cancel')}
            </button>
            {selected && (
              <button
                type="button"
                className="song-card-remove-btn"
                onClick={removeSong}
                disabled={saving}
              >
                {t('profile.song_remove')}
              </button>
            )}
          </div>
        </div>
      ) : !selected ? (
        /* ── Sin canción (perfil propio): CTA ── */
        <button type="button" className="song-card-add" onClick={openEditor}>
          <FaMusic />
          {t('profile.song_add')}
        </button>
      ) : (
        /* ── Canción fijada: disco + info + controles ── */
        <div className="song-card-main">
          <div className="song-card-vinyl-wrap">
            <button
              type="button"
              className={`song-card-vinyl ${playing ? 'song-card-vinyl--playing' : ''}`}
              onClick={togglePlay}
              aria-pressed={playing}
              title={playing ? t('profile.song_pause') : t('profile.song_play')}
            >
              <span className="song-card-vinyl-art" style={{ backgroundImage: `url(${selected.artwork})` }} />
            </button>

            <div className="song-card-info">
              <div className="song-card-info-top">
                <button
                  type="button"
                  className="song-card-play-btn"
                  onClick={togglePlay}
                  disabled={!playbackSrc}
                  aria-pressed={playing}
                  title={playing ? t('profile.song_pause') : t('profile.song_play')}
                >
                  {playing ? <FaPause /> : <FaPlay />}
                </button>
                <span className="song-card-texts">
                  <span className="song-card-title">{selected.title}</span>
                  <span className="song-card-artist">{selected.artist}</span>
                </span>
              </div>
              <div className="song-card-progress">
                <div className="song-card-progress-fill" style={{ width: `${Math.min(progress * 100, 100)}%` }} />
              </div>
              <span className="song-card-time">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
          </div>

          {isOwnProfile && (
            <div className="song-card-actions">
              <button type="button" className="song-card-action-btn" onClick={openEditor} title={t('profile.song_change')}>
                <FaPencilAlt />
              </button>
              <button
                type="button"
                className="song-card-action-btn song-card-action-btn--danger"
                onClick={removeSong}
                disabled={saving}
                title={t('profile.song_remove')}
              >
                <FaTrash />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Reproductor oculto (siempre montado: ref estable para el cleanup) ── */}
      <audio
        ref={audioRef}
        src={playbackSrc || undefined}
        preload="none"
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          setCurrentTime(a.currentTime);
          setProgress(a.duration ? a.currentTime / a.duration : 0);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setCurrentTime(0);
        }}
        onError={() => {
          // Si el stream completo no se pudo cargar (server caído / sin match
          // en YouTube), caer al preview de 30s (que puede tardar un instante
          // en resolverse en Deezer).
          if (streamUrl && !usePreview) setUsePreview(true);
        }}
      />
    </div>
  );
}
