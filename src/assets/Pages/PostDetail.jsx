import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../services/i18n/useI18n';
import { supabase } from '../services/supabaseclient';
import {
  getPost,
  getCachedPost,
  setCachedPost,
  getComments,
  createComment,
  deleteComment,
  isLiked,
  isReposted,
  likeComment,
  unlikeComment,
  isCommentLiked,
  getCachedComments,
  setCachedComments,
} from '../services/postService';
import { FaHeart, FaRegHeart, FaReply, FaTrash, FaRegComment, FaRegSadTear, FaArrowLeft } from 'react-icons/fa';
import PostCard from '../Resources/Components/PostCard';
import '../Resources/Styles/post.css';

const DEFAULT_AVATAR = 'https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg';

export default function PostDetail() {
  const { postId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { t, locale } = useI18n();

  const [post, setPost] = useState(null);
  const [postLoading, setPostLoading] = useState(true);
  const [postError, setPostError] = useState(null);

  // ── Comments con cache ──
  const [comments, setComments] = useState(() => {
    const cached = getCachedComments(postId);
    return cached?.comments || [];
  });
  const [commentLikes, setCommentLikes] = useState(() => {
    const cached = getCachedComments(postId);
    return cached?.commentLikes || {};
  });
  const [commentsLoading, setCommentsLoading] = useState(() => {
    return !getCachedComments(postId);
  });

  const [commentInput, setCommentInput] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // { id, username }

  const [liked, setLiked] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState({}); // { [commentId]: boolean }

  // Load post
  useEffect(() => {
    if (!postId) return;

    const cached = getCachedPost(postId);
    if (cached) {
      setPost(cached);
      setPostLoading(false);
    }

    const loadPost = async () => {
      setPostError(null);
      try {
        const data = await getPost(postId);
        setPost(data);
        setCachedPost(data);
      } catch (err) {
        setPostError(t('post.not_found'));
        setPost(null);
      } finally {
        setPostLoading(false);
      }
    };
    loadPost();
  }, [postId]);

  // Load comments + their likes (con cache + background refresh)
  const loadComments = useCallback(async () => {
    if (!postId) return;

    // Restaurar cache inmediato
    const cached = getCachedComments(postId);
    if (cached) {
      setComments(cached.comments || []);
      setCommentLikes(cached.commentLikes || {});
      setCommentsLoading(false);
    }

    try {
      const data = await getComments(postId);
      setComments(data);

      // Check which comments the user has liked
      let likes = {};
      if (user?.id && data.length > 0) {
        for (const c of data) {
          likes[c.id] = await isCommentLiked(c.id, user.id);
        }
        setCommentLikes(likes);
      }

      // Guardar en cache
      setCachedComments(postId, data, likes);

      // Expand all top-level comments' replies by default
      const topLevel = data.filter((c) => !c.parent_id);
      const expanded = {};
      topLevel.forEach((c) => { expanded[c.id] = true; });
      setExpandedReplies(expanded);
    } catch (err) {
      console.error('Error loading comments:', err);
    } finally {
      setCommentsLoading(false);
    }
  }, [postId, user?.id]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Check if current user liked/reposted this post
  useEffect(() => {
    if (!user?.id || !postId) return;
    isLiked(postId, user.id).then(setLiked).catch(() => {});
    isReposted(postId, user.id).then(setReposted).catch(() => {});
  }, [user?.id, postId]);

  // Realtime: listen for new comments + updates on post/comments
  useEffect(() => {
    if (!postId) return;

    const channel = supabase
      .channel(`post-detail-${postId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` },
        async (payload) => {
          try {
            const { data } = await supabase
              .from('comments')
              .select('*, profiles!comments_user_id_fkey (id, username, avatar_url, roles)')
              .eq('id', payload.new.id)
              .single();

            if (data) {
              setComments((prev) => {
                // Evitar duplicados: si el usuario acaba de crear el comentario
                // desde handleSubmitComment, el Realtime no debe agregarlo otra vez
                if (prev.some((c) => c.id === data.id)) return prev;
                return [...prev, data];
              });
              if (user?.id) {
                const liked = await isCommentLiked(data.id, user.id);
                setCommentLikes((prev) => ({ ...prev, [data.id]: liked }));
              }
            }
          } catch (err) {
            console.warn('Error fetching new comment:', err);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'posts', filter: `id=eq.${postId}` },
        (payload) => {
          // Actualizar contadores del post en vivo
          const updated = payload.new;
          setPost((prev) => {
            if (!prev) return prev;
            const merged = {
              ...prev,
              likes_count: updated.likes_count,
              reposts_count: updated.reposts_count,
              comments_count: updated.comments_count,
            };
            setCachedPost(merged);
            return merged;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` },
        (payload) => {
          // Actualizar comment_likes_count en vivo
          const updated = payload.new;
          setComments((prev) =>
            prev.map((c) =>
              c.id === updated.id
                ? { ...c, comment_likes_count: updated.comment_likes_count }
                : c
            )
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [postId, user?.id]);

  const handleSubmitComment = async () => {
    const trimmed = commentInput.trim();
    if (!trimmed || !user?.id || !postId) return;

    setSubmittingComment(true);
    try {
      const newComment = await createComment({
        postId,
        userId: user.id,
        content: trimmed,
        parentId: replyTo?.id || null,
      });
      setComments((prev) => [...prev, newComment]);
      setCommentInput('');
      setReplyTo(null);
    } catch (err) {
      console.error('Error creating comment:', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm(t('post.delete_comment_confirm'))) return;
    try {
      await deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      console.error('Error deleting comment:', err);
    }
  };

  const handleLikeComment = async (commentId) => {
    if (!user?.id) return;
    try {
      if (commentLikes[commentId]) {
        await unlikeComment(commentId, user.id);
        setCommentLikes((prev) => ({ ...prev, [commentId]: false }));
      } else {
        await likeComment(commentId, user.id);
        setCommentLikes((prev) => ({ ...prev, [commentId]: true }));
      }
    } catch (err) {
      console.error('Error toggling comment like:', err);
    }
  };

  const handlePostUpdate = (updatedPost) => {
    setPost(updatedPost);
    setCachedPost(updatedPost);
  };

  const handlePostDelete = () => {
    navigate(-1);
  };

  // ── Group comments into top-level + replies ──
  const topLevelComments = comments.filter((c) => !c.parent_id);
  const getReplies = (parentId) => comments.filter((c) => c.parent_id === parentId);

  // ── Render a single comment (used for top-level and replies) ──
  const renderComment = (comment, isReply = false) => {
    const likesCount = comments.filter((c) => c.parent_id === comment.id).length;
    // We don't track comment likes count from DB here, just the UI toggle
    const isLikedComment = commentLikes[comment.id] || false;
    const replies = getReplies(comment.id);
    const showReplies = expandedReplies[comment.id];

    return (
      <div key={comment.id} className={`comment-card ${isReply ? 'comment-card--reply' : ''}`}>
        <a
          href={`/profile/${comment.profiles?.username}`}
          onClick={(e) => { e.preventDefault(); navigate(`/profile/${comment.profiles?.username}`); }}
        >
          <img
            className="comment-card-avatar"
            src={comment.profiles?.avatar_url || DEFAULT_AVATAR}
            alt={comment.profiles?.username || 'user'}
          />
        </a>
        <div className="comment-card-content">
          <div className="comment-card-header">
            <a
              className="comment-card-username"
              href={`/profile/${comment.profiles?.username}`}
              onClick={(e) => { e.preventDefault(); navigate(`/profile/${comment.profiles?.username}`); }}
            >
              {comment.profiles?.username || 'unknown'}
            </a>
            <span className="comment-card-time">{getTimeAgo(t, locale, comment.created_at)}</span>
          </div>
          <p className="comment-card-text">{comment.content}</p>

          <div className="comment-card-actions-row">
            {/* Like button */}
            <button
              className={`comment-card-btn ${isLikedComment ? 'comment-card-btn--liked' : ''}`}
              onClick={() => handleLikeComment(comment.id)}
            >
              {isLikedComment ? <FaHeart /> : <FaRegHeart />}
              {comment.comment_likes_count > 0 && (
                <span className="comment-card-btn-count">{comment.comment_likes_count}</span>
              )}
            </button>

            {/* Reply button (only on top-level) */}
            {!isReply && (
              <button
                className="comment-card-btn"
                onClick={() => setReplyTo({ id: comment.id, username: comment.profiles?.username })}
              >
                <FaReply /> {t('post.reply')}
              </button>
            )}

            {/* Show replies count */}
            {!isReply && replies.length > 0 && (
              <button
                className="comment-card-btn"
                onClick={() => setExpandedReplies((prev) => ({ ...prev, [comment.id]: !showReplies }))}
              >
                {showReplies ? t('post.hide_replies') : t('post.replies_count', { n: replies.length })}
              </button>
            )}

            {/* Delete (owner only) */}
            {(user?.id === comment.user_id) && (
              <button
                className="comment-card-btn comment-card-btn--danger"
                onClick={() => handleDeleteComment(comment.id)}
              >
                <FaTrash />
              </button>
            )}
          </div>

          {/* Replies */}
          {!isReply && showReplies && replies.length > 0 && (
            <div className="comment-card-replies">
              {replies.map((reply) => renderComment(reply, true))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Loading state ──
  if (postLoading) {
    return (
      <div className="post-detail-page">
        <div className="posts-skeleton">
          <div className="posts-skeleton-card">
            <div className="skeleton posts-skeleton-avatar" />
            <div className="posts-skeleton-lines">
              <div className="posts-skeleton-line posts-skeleton-line--short" />
              <div className="posts-skeleton-line" />
              <div className="posts-skeleton-line posts-skeleton-line--medium" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (postError || !post) {
    return (
      <div className="post-detail-page">
        <button className="post-detail-back" onClick={() => navigate(-1)}><FaArrowLeft /> {t('post.back')}</button>
        <div className="posts-empty">
          <span className="posts-empty-icon"><FaRegSadTear /></span>
          <p className="posts-empty-text">{postError || t('post.not_found')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="post-detail-page">
      <button className="post-detail-back" onClick={() => navigate(-1)}><FaArrowLeft /> {t('post.back')}</button>

      <PostCard
        post={post}
        liked={liked}
        reposted={reposted}
        onUpdate={handlePostUpdate}
        onDelete={handlePostDelete}
      />

      {/* Comments Section */}
      <div className="comments-section">
        <h3 className="comments-title">{t('post.comments_title')}{comments.length > 0 && ` (${comments.length})`}</h3>

        {/* Comment form */}
        {user && (
          <div className="comment-form">
            <img
              className="comment-form-avatar"
              src={profile?.avatar_url || DEFAULT_AVATAR}
              alt="Your avatar"
            />
            <div className="comment-form-input-wrapper">
              {replyTo && (
                <div className="comment-form-reply-info">
                  {t('post.reply_to', { user: replyTo.username })}
                  <button className="comment-form-cancel-reply" onClick={() => setReplyTo(null)}>{t('post.cancel_reply')}</button>
                </div>
              )}
              <textarea
                className="comment-form-input"
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder={replyTo ? t('post.reply_placeholder', { user: replyTo.username }) : t('post.comment_placeholder')}
                rows={2}
                maxLength={1000}
              />
              <div className="comment-form-actions">
                <button
                  className="comment-form-submit"
                  onClick={handleSubmitComment}
                  disabled={submittingComment || !commentInput.trim()}
                >
                  {submittingComment ? t('post.sending') : t('post.comment_post')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Comments list */}
        {commentsLoading ? (
          <div className="posts-skeleton">
            {[1, 2, 3].map((i) => (
              <div key={i} className="posts-skeleton-card" style={{ padding: '12px' }}>
                <div className="skeleton posts-skeleton-avatar" style={{ width: '32px', height: '32px' }} />
                <div className="posts-skeleton-lines">
                  <div className="posts-skeleton-line posts-skeleton-line--short" />
                  <div className="posts-skeleton-line" />
                </div>
              </div>
            ))}
          </div>
        ) : topLevelComments.length === 0 ? (
          <div className="posts-empty">
            <span className="posts-empty-icon"><FaRegComment /></span>
            <p className="posts-empty-text">{t('post.no_comments')}</p>
          </div>
        ) : (
          topLevelComments.map((comment) => renderComment(comment, false))
        )}
      </div>
    </div>
  );
}

function getTimeAgo(t, locale, dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return t('post.just_now');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('post.minutes_ago', { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('post.hours_ago', { n: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return t('post.days_ago', { n: diffDay });
  return new Date(dateStr).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', { day: 'numeric', month: 'short' });
}
