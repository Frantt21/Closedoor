import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  trackPostView,
} from '../services/postService';
import { FaHeart, FaRegHeart, FaReply, FaTrash, FaRegComment, FaRegSadTear, FaArrowLeft, FaImage } from 'react-icons/fa';
import PostCard from '../Resources/Components/PostCard';
import SafeImage from '../Resources/Components/SafeImage';
import Avatar from '../Resources/Components/Avatar';
import RichText from '../Resources/Components/RichText';
import ConfirmModal from '../Resources/Components/ConfirmModal';
import { getTimeAgo, IMG_RE, VID_RE } from '../services/helpers';
import usePageTitle from '../../hooks/usePageTitle';
import '../Resources/Styles/post.css';

export default function PostDetail() {
  const { postId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { t, locale } = useI18n();

  const [post, setPost] = useState(null);
  const [postLoading, setPostLoading] = useState(true);
  const [postError, setPostError] = useState(null);
  usePageTitle(postError ? t('post.not_found') : 'Post');

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
  const [commentMediaUrl, setCommentMediaUrl] = useState('');
  const [commentShowMedia, setCommentShowMedia] = useState(false);
  const [confirmDeleteComment, setConfirmDeleteComment] = useState(null);
  const [confirmExternalLink, setConfirmExternalLink] = useState(null);
  const handleCancelDeleteComment = useCallback(() => setConfirmDeleteComment(null), []);
  const handleCancelExternalLink = useCallback(() => setConfirmExternalLink(null), []);
  const [replyTo, setReplyTo] = useState(null); // { id, username } — para form inline
  // Estado del form inline (reply)
  const [replyContent, setReplyContent] = useState('');
  const [replyMediaUrl, setReplyMediaUrl] = useState('');
  const [replyShowMedia, setReplyShowMedia] = useState(false);
  const [submittingReply, setSubmittingReply] = useState(false);

  // ── Gallery de imágenes en comentarios ──
  const [commentGalleryUrls, setCommentGalleryUrls] = useState(null);
  const [commentGalleryIndex, setCommentGalleryIndex] = useState(0);

  const openCommentGallery = (e, urls, index) => {
    e.stopPropagation();
    setCommentGalleryUrls(urls);
    setCommentGalleryIndex(index);
  };
  const closeCommentGallery = () => setCommentGalleryUrls(null);
  const goCommentGalleryPrev = () => setCommentGalleryIndex((prev) => (prev > 0 ? prev - 1 : commentGalleryUrls.length - 1));
  const goCommentGalleryNext = () => setCommentGalleryIndex((prev) => (prev < commentGalleryUrls.length - 1 ? prev + 1 : 0));

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
        const results = await Promise.allSettled(
          data.map((c) => isCommentLiked(c.id, user.id))
        );
        data.forEach((c, i) => {
          if (results[i].status === 'fulfilled') likes[c.id] = results[i].value;
        });
        setCommentLikes(likes);
      }

      // Guardar en cache
      setCachedComments(postId, data, likes);

      // All replies start hidden by default
      setExpandedReplies({});
    } catch (err) {
      console.error('Error loading comments:', err);
    } finally {
      setCommentsLoading(false);
    }
  }, [postId, user?.id]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Track post view (once per user)
  useEffect(() => {
    if (!postId) return;
    trackPostView(postId, user?.id);
  }, [postId, user?.id]);

  // Check if current user liked/reposted this post
  useEffect(() => {
    if (!user?.id || !postId) return;
    isLiked(postId, user.id).then(setLiked).catch(() => {});
    isReposted(postId, user.id).then(setReposted).catch(() => {});
  }, [user?.id, postId]);

  // ── Keyboard nav for comment gallery ──
  useEffect(() => {
    if (!commentGalleryUrls) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') { closeCommentGallery(); return; }
      if (e.key === 'ArrowLeft') goCommentGalleryPrev();
      if (e.key === 'ArrowRight') goCommentGalleryNext();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [commentGalleryUrls, commentGalleryIndex]);

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
              views_count: updated.views_count,
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

    const trimmedMedia = commentMediaUrl.trim();
    const isImage = IMG_RE.test(trimmedMedia);
    const isVideo = VID_RE.test(trimmedMedia);
    const imageUrl = isImage ? trimmedMedia : null;
    const videoUrl = isVideo ? trimmedMedia : null;

    setSubmittingComment(true);
    try {
      const newComment = await createComment({
        postId,
        userId: user.id,
        content: trimmed,
        parentId: null,
        imageUrl,
        videoUrl,
      });
      // El primer comentario del usuario en este post cuenta como vista
      trackPostView(postId, user?.id);
      setComments((prev) => [...prev, newComment]);
      setCommentInput('');
      setCommentMediaUrl('');
      setCommentShowMedia(false);
    } catch (err) {
      console.error('Error creating comment:', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  // ── Handle inline reply submission ──
  const handleSubmitReply = async () => {
    if (!replyTo) return;
    const trimmed = replyContent.trim();
    if (!trimmed || !user?.id || !postId) return;

    const trimmedMedia = replyMediaUrl.trim();
    const isImage = IMG_RE.test(trimmedMedia);
    const isVideo = VID_RE.test(trimmedMedia);
    const imageUrl = isImage ? trimmedMedia : null;
    const videoUrl = isVideo ? trimmedMedia : null;

    setSubmittingReply(true);
    try {
      const newComment = await createComment({
        postId,
        userId: user.id,
        content: trimmed,
        parentId: replyTo.id,
        imageUrl,
        videoUrl,
      });
      setComments((prev) => [...prev, newComment]);
      // Expandir al padre para que la nueva reply sea visible
      setExpandedReplies((prev) => ({ ...prev, [replyTo.id]: true }));
      cancelReply();
    } catch (err) {
      console.error('Error creating reply:', err);
    } finally {
      setSubmittingReply(false);
    }
  };

  // ── Start replying to a comment ──
  const startReply = (comment, isNested = false) => {
    const prepend = isNested ? `@${comment.profiles?.username} ` : '';
    setReplyTo({
      id: comment.id,
      username: comment.profiles?.username,
    });
    setReplyContent(prepend);
    setReplyMediaUrl('');
    setReplyShowMedia(false);
    setTimeout(() => {
      const el = document.getElementById(`reply-form-${comment.id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const cancelReply = () => {
    setReplyTo(null);
    setReplyContent('');
    setReplyMediaUrl('');
    setReplyShowMedia(false);
  };



  const handleDeleteComment = (commentId) => {
    setConfirmDeleteComment(commentId);
  };

  const handleExternalLink = (url) => {
    setConfirmExternalLink(url);
  };

  const executeExternalLink = () => {
    if (confirmExternalLink) {
      window.open(confirmExternalLink, '_blank', 'noopener noreferrer');
    }
    setConfirmExternalLink(null);
  };

  const executeDeleteComment = async () => {
    const commentId = confirmDeleteComment;
    setConfirmDeleteComment(null);
    if (!commentId) return;
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



  // renderCommentContent is now handled by RichText component

  // ── Render a single reply card ──
  // depth=1: direct reply (indented), CAN be replied to, shows children toggle
  // depth>=2: nested reply, NO Reply button, NO children (terminal)
  const renderReplyCard = (reply, depth = 1) => {
    const isLikedComment = commentLikes[reply.id] || false;
    const isReplying = replyTo?.id === reply.id;
    const childReplies = getReplies(reply.id);
    const hasChildren = childReplies.length > 0;
    const childrenExpanded = expandedReplies[reply.id];
    const isDirectReply = depth === 1;
    // Encontrar el autor del comentario padre
    const parentComment = comments.find((c) => c.id === reply.parent_id);
    const parentUsername = parentComment?.profiles?.username;

    return (
      <div key={reply.id} className="comment-card comment-card--reply">
        <a
          href={`/profile/${reply.profiles?.username}`}
          onClick={(e) => { e.preventDefault(); navigate(`/profile/${reply.profiles?.username}`); }}
        >
          <Avatar
            className="comment-card-avatar"
            src={reply.profiles?.avatar_url}
            alt={reply.profiles?.username || 'user'}
          />
        </a>
        <div className="comment-card-content">
          <div className="comment-card-header">
            <a
              className="comment-card-username"
              href={`/profile/${reply.profiles?.username}`}
              onClick={(e) => { e.preventDefault(); navigate(`/profile/${reply.profiles?.username}`); }}
            >
              {reply.profiles?.username || 'unknown'}
            </a>
            <span className="comment-card-time">{getTimeAgo(t, locale, reply.created_at)}</span>
            {parentUsername && (
              <span className="comment-card-replying-to">
                {t('post.replying_to', { user: `@${parentUsername}` })}
              </span>
            )}
          </div>
          <p className="comment-card-text">
            <RichText
              text={reply.content}
              linkClass="comment-card-link"
              mentionClass="comment-card-mention"
              hashtagClass="comment-card-hashtag"
              onExternalLink={handleExternalLink}
            />
          </p>

          {/* ── Media (clickable for gallery) ── */}
          {reply.image_url && (
            <div className="comment-card-media">
              <SafeImage
                src={reply.image_url}
                alt={t('post.media_alt', { n: 1 })}
                className="comment-card-image"
                onClick={(e) => openCommentGallery(e, [reply.image_url], 0)}
              />
            </div>
          )}
          {reply.video_url && (
            <div className="comment-card-media">
              {reply.video_url.match(/\.(mp4|webm|ogg)(\?.*)?$/i) ? (
                <video src={reply.video_url} controls className="comment-card-video" />
              ) : (
                <SafeImage
                  src={reply.video_url}
                  alt={t('post.media_alt', { n: 1 })}
                  className="comment-card-image"
                  onClick={(e) => openCommentGallery(e, [reply.video_url], 0)}
                />
              )}
            </div>
          )}

          <div className="comment-card-actions-row">
            <button
              className={`comment-card-btn ${isLikedComment ? 'comment-card-btn--liked' : ''}`}
              onClick={() => handleLikeComment(reply.id)}
            >
              {isLikedComment ? <FaHeart /> : <FaRegHeart />}
              {reply.comment_likes_count > 0 && <span className="comment-card-btn-count">{reply.comment_likes_count}</span>}
            </button>

            {/* Only direct replies (depth=1) can be replied to */}
            {isDirectReply && (
              <button className="comment-card-btn" onClick={() => startReply(reply, true)}>
                <FaReply /> {t('post.reply')}
              </button>
            )}

            {isDirectReply && hasChildren && (
              <button
                className="comment-card-btn"
                onClick={() => setExpandedReplies((prev) => ({ ...prev, [reply.id]: !childrenExpanded }))}
              >
                {childrenExpanded ? t('post.hide_replies') : t('post.replies_count', { n: childReplies.length })}
              </button>
            )}
            {(user?.id === reply.user_id) && (
              <button className="comment-card-btn comment-card-btn--danger" onClick={() => handleDeleteComment(reply.id)}>
                <FaTrash />
              </button>
            )}
          </div>

          {/* ── Inline reply form (only for direct replies) ── */}
          {isDirectReply && isReplying && (
            <div className="comment-card-reply-form" id={`reply-form-${reply.id}`}>
              <div className="comment-card-reply-info">
                {t('post.reply_to', { user: `@${replyTo?.username}` })}
                <button className="comment-form-cancel-reply" onClick={cancelReply}>{t('post.cancel_reply')}</button>
              </div>
              <textarea
                className="comment-form-input"
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder={t('post.reply_placeholder', { user: replyTo?.username })}
                rows={2}
                maxLength={1000}
              />
              <div className="comment-form-media-row">
                <button
                  type="button"
                  className={`comment-form-media-btn ${replyShowMedia ? 'comment-form-media-btn--active' : ''}`}
                  onClick={() => setReplyShowMedia((s) => !s)}
                  title={t('post.comment_add_media')}
                >
                  <FaImage />
                  {replyMediaUrl && (
                    <span className="comment-form-media-badge">{t('post.comment_media_added')}</span>
                  )}
                </button>
              </div>
              {replyShowMedia && (
                <div className="comment-form-media-inputs">
                  <input className="comment-form-media-input" type="url" value={replyMediaUrl} onChange={(e) => setReplyMediaUrl(e.target.value)} placeholder={t('post.comment_media_url')} />
                  {replyMediaUrl && IMG_RE.test(replyMediaUrl) && (
                    <div className="comment-card-preview"><SafeImage src={replyMediaUrl} alt="Preview" hideOnError /></div>
                  )}
                  {replyMediaUrl && VID_RE.test(replyMediaUrl) && (
                    <div className="comment-card-preview"><video src={replyMediaUrl} controls /></div>
                  )}
                </div>
              )}
              <div className="comment-form-actions">
                <button className="comment-form-submit" onClick={handleSubmitReply} disabled={submittingReply || !replyContent.trim()}>
                  {submittingReply ? t('post.sending') : t('post.comment_post')}
                </button>
              </div>
            </div>
          )}

          {/* ── Nested replies (only direct replies can have children) ── */}
          {isDirectReply && hasChildren && childrenExpanded && (
            <div className="comment-card-replies">
              {childReplies.map((child) => renderReplyCard(child, 2))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Render a single comment (top-level) ──
  const renderComment = (comment) => {
    const isLikedComment = commentLikes[comment.id] || false;
    const directReplies = getReplies(comment.id);
    const isReplying = replyTo?.id === comment.id;

    return (
      <div key={comment.id} className="comment-card">
        <a
          href={`/profile/${comment.profiles?.username}`}
          onClick={(e) => { e.preventDefault(); navigate(`/profile/${comment.profiles?.username}`); }}
        >
          <Avatar
            className="comment-card-avatar"
            src={comment.profiles?.avatar_url}
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
          <p className="comment-card-text">
            <RichText
              text={comment.content}
              linkClass="comment-card-link"
              mentionClass="comment-card-mention"
              hashtagClass="comment-card-hashtag"
              onExternalLink={handleExternalLink}
            />
          </p>

          {/* ── Media en comentario (clickable, gallery) ── */}
          {comment.image_url && (
            <div className="comment-card-media">
              <SafeImage
                src={comment.image_url}
                alt={t('post.media_alt', { n: 1 })}
                className="comment-card-image"
                onClick={(e) => openCommentGallery(e, [comment.image_url], 0)}
              />
            </div>
          )}
          {comment.video_url && (
            <div className="comment-card-media">
              {comment.video_url.match(/\.(mp4|webm|ogg)(\?.*)?$/i) ? (
                <video src={comment.video_url} controls className="comment-card-video" />
              ) : (
                <SafeImage
                  src={comment.video_url}
                  alt={t('post.media_alt', { n: 1 })}
                  className="comment-card-image"
                  onClick={(e) => openCommentGallery(e, [comment.video_url], 0)}
                />
              )}
            </div>
          )}

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

            {/* Reply button */}
            <button
              className="comment-card-btn"
              onClick={() => startReply(comment, false)}
            >
              <FaReply /> {t('post.reply')}
            </button>

            {/* Show replies count */}
            {directReplies.length > 0 && (() => {
              const showReplies = expandedReplies[comment.id];
              return (
                <button
                  className="comment-card-btn"
                  onClick={() => setExpandedReplies((prev) => ({ ...prev, [comment.id]: !showReplies }))}
                >
                  {showReplies ? t('post.hide_replies') : t('post.replies_count', { n: directReplies.length })}
                </button>
              );
            })()}

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

          {/* ── Inline reply form ── */}
          {isReplying && (
            <div className="comment-card-reply-form" id={`reply-form-${comment.id}`}>
              <div className="comment-card-reply-info">
                {t('post.reply_to', { user: `@${replyTo?.username}` })}
                <button className="comment-form-cancel-reply" onClick={cancelReply}>{t('post.cancel_reply')}</button>
              </div>              <textarea
                className="comment-form-input"
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder={t('post.reply_placeholder', { user: replyTo?.username })}
                rows={2}
                maxLength={1000}
              />
              <div className="comment-form-media-row">
                <button
                  type="button"
                  className={`comment-form-media-btn ${replyShowMedia ? 'comment-form-media-btn--active' : ''}`}
                  onClick={() => setReplyShowMedia((s) => !s)}
                  title={t('post.comment_add_media')}
                >
                  <FaImage />
                  {replyMediaUrl && (
                    <span className="comment-form-media-badge">{t('post.comment_media_added')}</span>
                  )}
                </button>
              </div>
              {replyShowMedia && (
                <div className="comment-form-media-inputs">
                  <input className="comment-form-media-input" type="url" value={replyMediaUrl} onChange={(e) => setReplyMediaUrl(e.target.value)} placeholder={t('post.comment_media_url')} />
                  {replyMediaUrl && IMG_RE.test(replyMediaUrl) && (
                    <div className="comment-card-preview"><SafeImage src={replyMediaUrl} alt="Preview" hideOnError /></div>
                  )}
                  {replyMediaUrl && VID_RE.test(replyMediaUrl) && (
                    <div className="comment-card-preview"><video src={replyMediaUrl} controls /></div>
                  )}
                </div>
              )}
              <div className="comment-form-actions">
                <button
                  className="comment-form-submit"
                  onClick={handleSubmitReply}
                  disabled={submittingReply || !replyContent.trim()}
                >
                  {submittingReply ? t('post.sending') : t('post.comment_post')}
                </button>
              </div>
            </div>
          )}

          {/* ── Replies (indented once) ── */}
          {(() => {
            const showReplies = expandedReplies[comment.id];
            if (!showReplies || directReplies.length === 0) return null;
            return (
              <div className="comment-card-replies">
                {directReplies.map((reply) => renderReplyCard(reply))}
              </div>
            );
          })()}
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
        <h3 className="comments-title">{t('post.comments_title')}</h3>

        {/* Top-level comment form */}
        {user && (
          <div className="comment-form">
            <Avatar
              className="comment-form-avatar"
              src={profile?.avatar_url}
              alt="Your avatar"
            />
            <div className="comment-form-input-wrapper">
              <textarea
                className="comment-form-input"
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder={t('post.comment_placeholder')}
                rows={2}
                maxLength={1000}
              />
              <div className="comment-form-media-row">
                <button
                  type="button"
                  className={`comment-form-media-btn ${commentShowMedia ? 'comment-form-media-btn--active' : ''}`}
                  onClick={() => setCommentShowMedia((s) => !s)}
                  title={t('post.comment_add_media')}
                >
                  <FaImage />
                  {commentMediaUrl && (
                    <span className="comment-form-media-badge">{t('post.comment_media_added')}</span>
                  )}
                </button>
              </div>
              {commentShowMedia && (
                <div className="comment-form-media-inputs">
                  <input
                    className="comment-form-media-input"
                    type="url"
                    value={commentMediaUrl}
                    onChange={(e) => setCommentMediaUrl(e.target.value)}
                    placeholder={t('post.comment_media_url')}
                  />
                  {commentMediaUrl && IMG_RE.test(commentMediaUrl) && (
                    <div className="comment-card-preview">
                      <SafeImage src={commentMediaUrl} alt="Preview" hideOnError />
                    </div>
                  )}
                  {commentMediaUrl && VID_RE.test(commentMediaUrl) && (
                    <div className="comment-card-preview">
                      <video src={commentMediaUrl} controls />
                    </div>
                  )}
                </div>
              )}
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
          topLevelComments.map((comment) => renderComment(comment))
        )}
      </div>

      {/* ── Comment gallery lightbox ── */}      {/* ── Delete comment confirmation ── */}
      {confirmDeleteComment && (
        <ConfirmModal
          message={t('post.delete_comment_confirm')}
          onConfirm={executeDeleteComment}
          onCancel={handleCancelDeleteComment}
        />
      )}

      {/* ── External link confirmation ── */}
      {confirmExternalLink && (
        <ConfirmModal
          message={t('post.external_link_warning')}
          onConfirm={executeExternalLink}
          onCancel={handleCancelExternalLink}
        />
      )}

      {commentGalleryUrls && createPortal(
        <div className="post-card-lightbox" onClick={(e) => { e.stopPropagation(); closeCommentGallery(); }}>
          {commentGalleryUrls.length > 1 && (
            <button
              className="post-card-gallery-nav post-card-gallery-nav--prev"
              onClick={(e) => { e.stopPropagation(); goCommentGalleryPrev(); }}
              aria-label="Previous"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}

          <div className="post-card-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <div className="post-card-gallery-image-area">
              <SafeImage
                src={commentGalleryUrls[commentGalleryIndex]}
                alt={t('post.full_media')}
                className="post-card-gallery-image"
                key={commentGalleryIndex}
                fallbackText={t('post.image_failed')}
              />
            </div>
            <div className="post-card-lightbox-actions">
              {commentGalleryUrls.length > 1 && (
                <span className="post-card-gallery-counter">
                  {commentGalleryIndex + 1} / {commentGalleryUrls.length}
                </span>
              )}
              <a
                href={commentGalleryUrls[commentGalleryIndex]}
                target="_blank"
                rel="noopener noreferrer"
                className="post-card-lightbox-btn"
                title={t('post.open_new_tab')}
                onClick={(e) => e.stopPropagation()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
              <a
                href={commentGalleryUrls[commentGalleryIndex]}
                download
                className="post-card-lightbox-btn"
                title={t('post.download')}
                onClick={(e) => e.stopPropagation()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </a>
              <button
                className="post-card-lightbox-btn post-card-lightbox-close"
                onClick={closeCommentGallery}
                title={t('post.close')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* ── Thumbnail strip ── */}
            {commentGalleryUrls.length > 1 && (
              <div className="post-card-gallery-thumbnails">
                {commentGalleryUrls.map((url, i) => (
                  <button
                    key={i}
                    className={`post-card-gallery-thumb ${i === commentGalleryIndex ? 'post-card-gallery-thumb--active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setCommentGalleryIndex(i); }}
                    aria-label={`Go to image ${i + 1}`}
                  >
                    <div className="post-card-gallery-thumb-inner">
                      <SafeImage src={url} alt={`Thumbnail ${i + 1}`} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {commentGalleryUrls.length > 1 && (
            <button
              className="post-card-gallery-nav post-card-gallery-nav--next"
              onClick={(e) => { e.stopPropagation(); goCommentGalleryNext(); }}
              aria-label="Next"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

