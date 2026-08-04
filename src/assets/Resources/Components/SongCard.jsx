import { useEffect, useRef, useState } from 'react';
import { FaMusic, FaPlay, FaPause, FaPencilAlt, FaTrash, FaSearch, FaSpinner } from 'react-icons/fa';
import { useI18n } from '../../services/i18n/useI18n';
import { useAuth } from '../../../hooks/useAuth';
import { searchMusic, resolvePreviewUrl, getStreamUrl, getStreamHealth } from '../../services/musicService';
import { updateUserProfile } from '../../services/userService';
import { toast } from 'react-toastify';
import './css/songCard.css';

function formatTime(s) {
  if (!isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Timeout por INACTIVIDAD (stall), no total: un stream grande y lento pero
// constante NO debe abortarse al llegar al límite (un timeout total hacía que
// el app descartara descargas que ya habían terminado y reintentara de más).
// Se aborta solo si:
//  - La respuesta del server no llega en STREAM_HEADERS_TIMEOUT (la resolución
//    de yt-dlp en el celular, incluso el fallback lento, cabe holgado aquí).
//  - El body no envía NINGÚN byte durante STREAM_STALL_TIMEOUT (colgado).
const STREAM_HEADERS_TIMEOUT = 120_000; // espera de la respuesta del server
const STREAM_STALL_TIMEOUT = 60_000;    // sin bytes durante 60s → abortar
const STREAM_TOTAL_TIMEOUT = 300_000;   // tope absoluto (5 min) por seguridad

// Descarga el blob del stream con timeout por INACTIVIDAD:
// - Aborta si la respuesta tarda más de STREAM_HEADERS_TIMEOUT en llegar.
// - Aborta si el body se queda sin bytes durante STREAM_STALL_TIMEOUT.
// - Tope absoluto STREAM_TOTAL_TIMEOUT por si hubiera un tricleo patológico.
// - Una descarga lenta PERO CONSTANTE nunca aborta → el app siempre recibe el
//   blob aunque tarde 2-3 min en un túnel free.
async function fetchStreamBlob(url) {
  const controller = new AbortController();
  const armTimer = (ms, label) =>
    setTimeout(() => controller.abort(new DOMException(label, 'TimeoutError')), ms);

  const totalTimer = armTimer(STREAM_TOTAL_TIMEOUT, 'Stream total timeout');
  const headersTimer = armTimer(STREAM_HEADERS_TIMEOUT, 'Stream headers timeout');
  try {
    let res;
    try {
      res = await fetch(url, {
        headers: { 'ngrok-skip-browser-warning': '1' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(headersTimer);
    }
    if (!res.ok) throw new Error(`stream fetch ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    // ngrok puede devolver 200 con el interstitial HTML → filtrar
    if (!/audio|octet-stream/i.test(ct)) throw new Error('not audio');
    if (!res.body) throw new Error('no body');

    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    let stallTimer = null;
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = armTimer(STREAM_STALL_TIMEOUT, 'Stream stalled');
    };
    try {
      armStall();
      for (;;) {
        const { done, value } = await reader.read();
        clearTimeout(stallTimer);
        if (done) break;
        if (value.length) {
          chunks.push(value);
          total += value.length;
        }
        armStall(); // cada chunk reinicia el contador de inactividad
      }
    } finally {
      clearTimeout(stallTimer);
    }
    if (!total) throw new Error('empty stream');
    return new Blob(chunks, { type: ct });
  } finally {
    clearTimeout(totalTimer);
  }
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
  // true cuando el stream directo del <audio> falló (interstitial, CORS)
  const [directStreamFailed, setDirectStreamFailed] = useState(false);
  // true cuando el stream completo falló y hay que caer al preview de 30s
  const [usePreview, setUsePreview] = useState(false);
  // ¿El server de stream (yt-dlp) está disponible? Gate: si solo corre vite
  // (sin server.js), reproducir directamente el preview de 30s y evitar
  // intentar una URL de stream que devolvería 502 / "no supported source".
  const [streamHealthy, setStreamHealthy] = useState(false);
  // Fallback para túneles free (ngrok): el <audio> no puede mandar headers y
  // el interstitial de ngrok rompe la carga directa → se baja el stream con
  // fetch + header de bypass y se reproduce desde un blob local.
  const [blobSrc, setBlobSrc] = useState(null);
  const [blobFailed, setBlobFailed] = useState(false);
  const [loadingStream, setLoadingStream] = useState(false); // feedback visual al bajar el blob
  const blobUrlRef = useRef(null);
  const blobForRef = useRef(''); // sig de la canción para la que se descarga el blob
  const wantsPlayRef = useRef(false); // el usuario pulsó play → autoplay cuando el blob esté listo
  const [progress, setProgress] = useState(0);
  // URL de preview resuelta con la sig de la canción a la que pertenece
  // (los previews de Deezer expiran ≈ 15 min → se re-consultan al reproducir)
  const [resolvedPreview, setResolvedPreview] = useState({ sig: '', url: null });
  const audioRef = useRef(null);

  // ── Sync cuando cambia el song del perfil (realtime / navegación) ──
  const songSig = songObj ? `${songObj.provider}:${songObj.trackId}` : '';
  const prevSigRef = useRef(songSig);
  const revokeBlob = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  };

  useEffect(() => {
    if (prevSigRef.current === songSig) return;
    prevSigRef.current = songSig;
    revokeBlob();
    blobForRef.current = ''; // invalida cualquier descarga de blob en vuelo
    setBlobSrc(null);
    setBlobFailed(false);
    setSelected(songObj || null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(songObj?.duration || 0);
    setProgress(0);
    setUsePreview(false);
    setDirectStreamFailed(false);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    wantsPlayRef.current = false;
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

  // Health del server de stream (una vez; getStreamHealth cachea 5 min)
  useEffect(() => {
    let cancelled = false;
    getStreamHealth().then((h) => {
      if (cancelled) return;
      setStreamHealthy(!!h);
      console.info('[song] stream health:', h ? 'OK — stream completo disponible' : 'no disponible → preview 30s');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pausar al desmontar (el <audio> siempre está montado → el ref es estable).
  // blobForRef se resetea para invalidar cualquier fetch de blob en vuelo: el
  // guard del .then aborta y no crea el object URL tras el cleanup (sin fugas).
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      blobForRef.current = ''; // invalida descargas en vuelo al desmontar
      if (audio) audio.pause();
      revokeBlob();
    };
  }, []);

  // ── Fuente de reproducción: stream completo (yt-dlp) ──
  // Estrategia de streaming PROGRESIVO:
  //   1. Stream directo (<audio src> apunta a la URL del túnel): la canción
  //      empieza a sonar mientras descarga. El navegador maneja el buffering.
  //      Con cloudflared (sin interstitial) funciona perfecto.
  //   2. Blob (fetch + Object URL): solo como fallback para túneles con
  //      interstitial (ngrok free) donde el <audio> no puede cargar directo.
  //   3. Preview de 30s: último recurso si todo falla.
  const streamUrl = streamHealthy ? getStreamUrl(selected) : null;
  const isRemoteStream = !!streamUrl && (() => {
    try {
      return new URL(streamUrl, window.location.href).origin !== window.location.origin;
    } catch {
      return false;
    }
  })();
  // Para el stream directo remoto, el <audio> carga progresivamente.
  // Si falla (onError en el <audio>), se cae al blob y luego al preview.
  const canStreamDirect = !!(streamUrl && isRemoteStream && !directStreamFailed && !usePreview);
  // Blob: solo si el stream directo ya falló.
  const canStartBlob = !!(streamUrl && isRemoteStream && directStreamFailed && !blobSrc && !blobFailed && !usePreview);
  const playbackSrc = usePreview
    ? effectivePreviewSrc
    : (blobSrc || (canStreamDirect ? streamUrl : (directStreamFailed ? effectivePreviewSrc : streamUrl)) || effectivePreviewSrc);

  const ignorePlaybackError = (err) => {
    // AbortError = el src cambió (nuevo load) antes de que play() arrancara.
    // Es benigno (el blob/preview nuevo se encargará) → no loguear.
    if (err?.name === 'AbortError') return;
    console.warn('[song] playback error:', err?.message || err);
  };

  // Baja el stream con fetch + header de bypass (necesario para túneles free
  // como ngrok: el <audio> no puede mandar headers) y reproduce desde blob.
  // - Timeout por INACTIVIDAD (fetchStreamBlob): una descarga lenta pero
  //   constante NUNCA aborta (antes un timeout total de 120s descartaba
  //   descargas que ya habían terminado). Solo aborta si se cuelga.
  // - Reintento único tras un abort: el server CACHEA la resolución, así que
  //   el segundo intento suele completar rápido.
  // - Si ya hay una descarga en vuelo para esta canción, no se duplica.
  // - Muestra el spinner (loadingStream) y loguea cada etapa para depurar.
  const startBlobDownload = (url, attempt = 0) => {
    if (blobForRef.current === selSig) return; // ya en vuelo para esta canción
    blobForRef.current = selSig;
    setBlobFailed(true);
    setLoadingStream(true);
    console.info(`[song] stream: descargando blob (intento ${attempt + 1})...`);
    fetchStreamBlob(url)
      .then((blob) => {
        // La canción cambió mientras se descargaba → descartar
        if (blobForRef.current !== selSig) return;
        const objectUrl = URL.createObjectURL(blob);
        revokeBlob();
        blobUrlRef.current = objectUrl;
        setBlobSrc(objectUrl);
        setLoadingStream(false);
        console.info(`[song] stream blob listo (${Math.round(blob.size / 1024)} KB)`);
        const a = audioRef.current;
        if (a) {
          a.src = objectUrl; // src imperativo: no esperar al re-render de React
          // Autoplay solo si el usuario ya pulsó play (si no, el blob queda
          // listo y el siguiente click arranca al instante).
          if (wantsPlayRef.current) {
            a.play().then(() => setPlaying(true)).catch(ignorePlaybackError);
          }
        }
      })
      .catch((err) => {
        if (blobForRef.current !== selSig) return;
        // Un abort/timeout en el PRIMER intento casi siempre es la resolución
        // lenta de yt-dlp en el server; como este CACHEA el resultado, un
        // segundo intento completa rápido → reintentar una sola vez.
        const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        if (isTimeout && attempt < 1) {
          console.warn('[song] stream: intento 1 abortó por inactividad, reintentando (el server ya pudo resolver)...');
          blobForRef.current = ''; // liberar para permitir el reintento
          startBlobDownload(url, attempt + 1);
          return;
        }
        // Fallo real (red/interstitial/no-audio) → caer al preview de 30s.
        console.warn('[song] stream blob falló:', err?.message || err);
        blobForRef.current = '';
        setBlobFailed(true);
        setLoadingStream(false);
        setUsePreview(true);
        const a = audioRef.current;
        if (a && effectivePreviewSrc) {
          a.src = effectivePreviewSrc;
          if (wantsPlayRef.current) {
            a.play().then(() => setPlaying(true)).catch(ignorePlaybackError);
          }
        }
      });
  };

  // Si el stream directo falló, baja el blob como fallback.
  useEffect(() => {
    if (!canStartBlob || !streamUrl) return;
    startBlobDownload(streamUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStartBlob, selSig]);

  // Perfil ajeno sin canción → no mostrar la card (después de los hooks)
  if (!isOwnProfile && !selected) return null;

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      wantsPlayRef.current = false;
      return;
    }
    wantsPlayRef.current = true;
    // Estrategia de streaming PROGRESIVO:
    //   1. Stream directo (progresivo, arranca en segundos mientras descarga)
    //   2. Blob (si el directo falló, p. ej. ngrok interstitial)
    //   3. Preview de 30s (último recurso)
    if (streamUrl && isRemoteStream && !usePreview) {
      if (directStreamFailed) {
        // Stream directo falló → intentar blob
        if (blobSrc) {
          audio.play().then(() => setPlaying(true)).catch(ignorePlaybackError);
          return;
        }
        if (blobForRef.current !== selSig) startBlobDownload(streamUrl);
        return; // blob descargándose → autoplay cuando termine
      }
      // Stream directo: el <audio> ya tiene la src URL, play() arranca
      audio.play().then(() => setPlaying(true)).catch(ignorePlaybackError);
      return;
    }
    if (!playbackSrc) return;
    audio
      .play()
      .then(() => setPlaying(true))
      .catch(ignorePlaybackError);
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
        /* ── Canción fijada: portada + disco a la derecha + info ── */
        <div className="song-card-main">
          {/* Escenario: portada + disco. Tiempo y acciones viven sobre la portada */}
          <div className="song-card-stage">
            {/* Portada: click = play/pausa; tiempo arriba-izq; acciones en hover */}
            <div className="song-card-cover-wrap">
              <button
                type="button"
                className={`song-card-cover ${!playbackSrc && !canStartBlob && !loadingStream ? 'song-card-cover--disabled' : ''}`}
                onClick={togglePlay}
                aria-pressed={playing}
                disabled={!playbackSrc && !canStartBlob && !loadingStream}
                title={loadingStream ? t('profile.song_loading') || 'Loading…' : (playing ? t('profile.song_pause') : t('profile.song_play'))}
              >
                {selected.artwork ? (
                  <img
                    className="song-card-cover-img"
                    src={selected.artwork}
                    alt={selected.title || ''}
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                  />
                ) : (
                  <span className="song-card-cover-img song-card-cover-img--empty">
                    <FaMusic />
                  </span>
                )}
                <span className="song-card-cover-time">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                <span className="song-card-cover-btn">
                  {loadingStream ? <FaSpinner className="fc-spin" /> : (playing ? <FaPause /> : <FaPlay />)}
                </span>
              </button>

              {/* Editar / eliminar: solo perfil propio, visibles en hover (o siempre en táctil) */}
              {isOwnProfile && (
                <div className="song-card-cover-actions">
                  <button
                    type="button"
                    className="song-card-cover-action"
                    onClick={openEditor}
                    title={t('profile.song_change')}
                  >
                    <FaPencilAlt />
                  </button>
                  <button
                    type="button"
                    className="song-card-cover-action song-card-cover-action--danger"
                    onClick={removeSong}
                    disabled={saving}
                    title={t('profile.song_remove')}
                  >
                    <FaTrash />
                  </button>
                </div>
              )}
            </div>

            {/* Disco de vinilo: a la derecha de la portada, asomando la mitad */}
            <button
              type="button"
              className={`song-card-vinyl ${playing ? 'song-card-vinyl--playing' : ''}`}
              onClick={togglePlay}
              aria-pressed={playing}
              disabled={!playbackSrc && !canStartBlob && !loadingStream}
              title={playing ? t('profile.song_pause') : t('profile.song_play')}
            >
              <span className="song-card-vinyl-art" style={{ backgroundImage: `url(${selected.artwork})` }} />
            </button>
          </div>

          {/* Título/artista + progreso */}
          <div className="song-card-info">
            <span className="song-card-texts">
              <span className="song-card-title">{selected.title}</span>
              <span className="song-card-artist">{selected.artist}</span>
            </span>
            <div className="song-card-progress">
              <div className="song-card-progress-fill" style={{ width: `${Math.min(progress * 100, 100)}%` }} />
            </div>
          </div>
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
          // Si ya está en preview, no hay más fallbacks
          if (usePreview) return;
          // El src actual no cargó. Estrategia en cascada:
          // 1. Si es stream directo remoto → marcar como fallido
          // 2. Si el stream directo ya falló y hay que bajar blob → iniciar blob
          // 3. Si ya es blob o preview → no hacer nada (no más fallbacks)
          if (streamUrl && isRemoteStream && !directStreamFailed && !usePreview) {
            console.info('[song] stream directo falló → bajando blob como fallback');
            setDirectStreamFailed(true);
            return;
          }
          if (streamUrl && isRemoteStream && directStreamFailed && !usePreview) {
            startBlobDownload(streamUrl);
            return;
          }
          if (blobForRef.current === selSig) return;
          setUsePreview(true);
        }}
      />
    </div>
  );
}
