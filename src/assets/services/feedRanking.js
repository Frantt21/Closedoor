import { countInterestOverlap } from "./interestDictionary";
import { extractHashtags } from "./hashtagService";

/**
 * Feed ranking básico ("Para ti").
 *
 * Puntúa un post para el usuario actual según tres señales:
 *   1. Afinidad de intereses del autor (jerárquica, reusa countInterestOverlap).
 *   2. Hashtags del contenido que coinciden con sus intereses.
 *   3. Engagement (likes + comentarios + reposts), acotado para no dominar.
 *
 * Es un algoritmo simple y barato (corre en cliente sobre un lote acotado),
 * sin paginar todo el histórico — respeta recursos de servidor y peticiones.
 */
export function scorePostForUser(post, userInterests = []) {
    if (!post) return 0;
    const interests = Array.isArray(userInterests) ? userInterests : [];
    let score = 0;

    // 1) Intereses del autor que coinciden con los tuyos (jerárquico)
    const authorInterests = post.profiles?.interests || [];
    if (interests.length && authorInterests.length) {
        score += countInterestOverlap(interests, authorInterests) * 10;
    }

    // 2) Hashtags del contenido que coinciden con tus intereses
    const tags = extractHashtags(post.content || "");
    if (interests.length && tags.length) {
        score += countInterestOverlap(interests, tags) * 8;
    }

    // 3) Engagement (acotado a 100 para que no domine sobre la relevancia)
    const engagement =
        (post.likes_count || 0) +
        (post.comments_count || 0) * 2 +
        (post.reposts_count || 0) * 3;
    score += Math.min(engagement, 100);

    return score;
}

/**
 * Ordena un lote de posts por relevancia para el usuario (score desc,
 * desempate por recencia). Devuelve un array nuevo, no muta el original.
 */
export function rankFeedForUser(posts, userInterests = []) {
    if (!Array.isArray(posts) || posts.length <= 1) return posts || [];
    return posts
        .map((post) => ({ post, score: scorePostForUser(post, userInterests) }))
        .sort(
            (a, b) =>
                b.score - a.score ||
                new Date(b.post.created_at) - new Date(a.post.created_at)
        )
        .map((x) => x.post);
}
