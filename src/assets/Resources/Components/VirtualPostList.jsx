import React, { useEffect, useRef, useState, useCallback, useReducer } from "react";
import PostCard from "./PostCard";

/**
 * VirtualPostList
 *
 * Virtualización propia (sin librería externa): el scroll es de ventana, así
 * que medimos EN VIVO la posición del contenedor (header/banner arriba) y
 * calculamos el rango visible desde window.scrollY con las alturas medidas
 * (fallback: estimación). Solo se montan las cards del rango + overscan →
 * FPS estable con cientos de posts. Un ResizeObserver por row re-mide al
 * cargar imágenes y reposiciona sin huecos ni superposiciones.
 */
function VirtualPostList({
    posts,
    likedIds,
    dislikedIds,
    repostedIds,
    savedIds,
    repostInfoByPostId = null,
    replyInfoByPostId = null,
    // Resuelve la clave única de cada row (React key + lookups de liked/
    // disliked/reposted/saved/replyInfo). Para posts normales es post.id;
    // para replies (varias por post) es post.commentId || post.id.
    getKey = null,
    // Renderizador custom (ej. NotificationItem). Si se pasa, se usa en vez
    // de PostCard; recibe (item, rowKey) y devuelve el JSX de la fila.
    renderItem = null,
    // Altura estimada por row para el primer paint, antes de que el
    // ResizeObserver mida la real. 332 = PostCard; ~96 = NotificationItem.
    estimateHeight = 332,
    onUpdate,
    onDelete,
    onSaveToggle,
    onLikeToggle,
    onDislikeToggle,
    onRepostToggle,
    onBlockUser,
}) {
    const listRef = useRef(null);
    const [range, setRange] = useState({ start: 0, end: 0 });
    // Fuerza re-render manual (para mediciones de altura de rows).
    const [, forceRender] = useReducer((x) => x + 1, 0);
    // Alturas medidas por CLAVE de fila (no por índice): al insertar/borrar
    // posts los índices se desplazan y las alturas quedarían desalineadas.
    // Fallback ESTIMATE.
    const heightsRef = useRef(Object.create(null));
    const roRef = useRef(null);
    // Ref al array actual: los listeners/observers (creados una vez) siempre
    // leen la última versión → sin closures stale al cambiar posts.length.
    const postsRef = useRef(posts);
    // Claves normalizadas del array actual (mismo orden que postsRef). Las
    // funciones estables (computeRange, observers) las leen de aquí: getKey
    // suele ser una arrow inline nueva en cada render.
    const keysRef = useRef([]);

    // Clave de una fila en el render (getKey suele venir por props).
    const keyOfPost = (post) => String(getKey ? getKey(post) : post.id);
    // Altura estimada por row para el primer paint, antes de que el
    // ResizeObserver mida la real. 332 = PostCard; ~96 = NotificationItem.
    // computeRange es un callback estable ([]) que captura ESTIMATE al
    // crearse; como estimateHeight es constante por instancia, es seguro.
    const ESTIMATE = estimateHeight;
    const OVERSCAN = 900; // px extra arriba/abajo del viewport

    // Calcula el rango visible midiendo EN VIVO la posición del contenedor
    // (banner + header + tabs arriba). setRange con el mismo rango no
    // dispara re-render (React baila) → barato llamarlo en cada scroll.
    // Callback estable: solo lee refs, nunca se recrea por render.
    const computeRange = useCallback(() => {
        const el = listRef.current;
        if (!el) return;
        const off = Math.round(el.getBoundingClientRect().top + window.scrollY);
        const relTop = window.scrollY - off;
        const relBottom = relTop + window.innerHeight;
        const heights = heightsRef.current;
        const keys = keysRef.current;
        const n = postsRef.current.length;
        if (n === 0) {
            setRange((prev) => (prev.start === 0 && prev.end === -1 ? prev : { start: 0, end: -1 }));
            return;
        }
        let start = 0;
        let acc = 0;
        for (let i = 0; i < n; i++) {
            const size = heights[keys[i]] || ESTIMATE;
            if (acc + size > relTop - OVERSCAN) {
                start = i;
                break;
            }
            acc += size;
        }
        acc = 0;
        let end = n - 1;
        for (let i = 0; i < n; i++) {
            const size = heights[keys[i]] || ESTIMATE;
            if (acc > relBottom + OVERSCAN) {
                end = i - 1;
                break;
            }
            acc += size;
        }
        if (end < start) end = start;
        if (end >= n) end = n - 1;
        setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    }, []);

    // Mantener el ref de posts siempre fresco (se actualiza tras cada render,
    // antes de que los listeners/observers lo lean). Las claves se normalizan
    // aquí una sola vez: los efectos de abajo corren después.
    useEffect(() => {
        postsRef.current = posts;
        keysRef.current = posts.map((post) => String(getKey ? getKey(post) : post.id));
    });

    // Scroll + resize + re-mediciones retrasadas (header inestable) →
    // recomputa el rango con rAF-throttling.
    useEffect(() => {
        let raf = 0;
        const schedule = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                computeRange();
            });
        };
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule, { passive: true });
        schedule();
        const t1 = setTimeout(schedule, 250);
        const t2 = setTimeout(schedule, 800);
        return () => {
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            if (raf) cancelAnimationFrame(raf);
            clearTimeout(t1);
            clearTimeout(t2);
        };
    }, [computeRange]);

    // Disconnect del ResizeObserver al desmontar el componente.
    useEffect(() => {
        return () => {
            if (roRef.current) {
                roRef.current.disconnect();
                roRef.current = null;
            }
        };
    }, []);

    // Al cambiar la lista NO se borran todas las mediciones: solo se
    // descartan las claves que ya no existen y se re-miden las filas
    // montadas. Antes se hacía `heightsRef.current = {}` y cada actualización
    // de realtime (likes, contadores) devolvía cientos de filas a la altura
    // estimada → el contenido saltaba y quedaban huecos/solapes.
    useEffect(() => {
        const heights = heightsRef.current;
        const valid = new Set(keysRef.current);
        for (const key of Object.keys(heights)) {
            if (!valid.has(key)) delete heights[key];
        }

        let changed = false;
        const el = listRef.current;
        if (el) {
            el.querySelectorAll('.virtual-post-row').forEach((node) => {
                const key = node.getAttribute('data-row-key');
                if (!key) return;
                const px = Math.round(node.offsetHeight);
                if (heights[key] !== px) {
                    heights[key] = px;
                    changed = true;
                }
            });
        }

        computeRange();
        if (changed) forceRender();
    }, [posts, computeRange]);

    // Mide la altura real de cada row montado y reposiciona al cambiar
    // (imágenes/GIFs que cargan después del montaje). Callback estable.
    // IMPORTANTE: se mide offsetHeight (incluye padding+borde), NO
    // contentRect.height — el row lleva padding-bottom: 12px (gap entre
    // cards en CSS) y contentRect lo EXCLUYE, dejando las cards pegadas.
    const handleRowResize = useCallback((entries) => {
        let changed = false;
        for (const entry of entries) {
            const key = entry.target.getAttribute('data-row-key');
            if (!key) continue;
            const px = Math.round(entry.target.offsetHeight);
            if (heightsRef.current[key] !== px) {
                heightsRef.current[key] = px;
                changed = true;
            }
        }
        if (changed) {
            forceRender();
            computeRange();
        }
    }, [computeRange]);

    // Ref callback de cada row: el ResizeObserver es la ÚNICA fuente de
    // medición (su callback inicial mide y fuerza el re-render con las
    // posiciones correctas). No hay pre-medición aquí: eso suprimiría la
    // corrección y dejaría el spacing estimado.
    const rowRef = useCallback((node) => {
        if (!node) return undefined;
        if (!roRef.current) {
            roRef.current = new ResizeObserver(handleRowResize);
        }
        roRef.current.observe(node);
        return () => {
            if (roRef.current) roRef.current.unobserve(node);
        };
    }, [handleRowResize]);

    // Posiciones acumuladas, alto total y rango visible (O(n) barato).
    const positions = [];
    let total = 0;
    const heights = heightsRef.current;
    for (let i = 0; i < posts.length; i++) {
        positions[i] = total;
        total += heights[keyOfPost(posts[i])] || ESTIMATE;
    }
    const visible = [];
    for (let i = range.start; i <= range.end; i++) {
        if (posts[i]) visible.push(i);
    }

    return (
        <div ref={listRef}>
            <div style={{ height: total, position: 'relative', width: '100%' }}>
                {visible.map((i) => {
                    const post = posts[i];
                    // Clave original (número/string) para key y lookups de
                    // liked/saved/repost; las alturas usan la forma
                    // normalizada a string.
                    const rowKey = getKey ? getKey(post) : post.id;
                    return (
                        <div
                            key={rowKey}
                            data-index={i}
                            data-row-key={String(rowKey)}
                            ref={rowRef}
                            className="virtual-post-row"
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${positions[i]}px)`,
                            }}
                        >
                            {renderItem ? (
                                renderItem(post, rowKey)
                            ) : (
                                <PostCard
                                    post={post}
                                    liked={likedIds.includes(rowKey)}
                                    disliked={dislikedIds.includes(rowKey)}
                                    reposted={repostedIds.includes(rowKey)}
                                    saved={savedIds.includes(rowKey)}
                                    onUpdate={onUpdate}
                                    onDelete={onDelete}
                                    onSaveToggle={onSaveToggle}
                                    onLikeToggle={onLikeToggle}
                                    onDislikeToggle={onDislikeToggle}
                                    onRepostToggle={onRepostToggle}
                                    onBlockUser={onBlockUser}
                                    repostInfo={repostInfoByPostId?.get(rowKey) || null}
                                    replyInfo={replyInfoByPostId?.get(rowKey) || null}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default VirtualPostList;
