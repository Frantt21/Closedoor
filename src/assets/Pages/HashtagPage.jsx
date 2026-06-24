import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../services/i18n/useI18n';
import { getPostsByHashtag, searchPostsByContent } from '../services/hashtagService';
import { getLikedPostIds, getRepostedPostIds, clearFeedCache } from '../services/postService';
import PostCard from '../Resources/Components/PostCard';
import { FaArrowLeft, FaHashtag, FaRegSadTear, FaFire } from 'react-icons/fa';
import usePageTitle from '../../hooks/usePageTitle';
import '../Resources/Styles/post.css';
import '../Resources/Styles/skeleton.css';

export default function HashtagPage() {
  const { tag } = useParams();
  const [searchParams] = useSearchParams();
  const isTextSearch = searchParams.get('text') === '1';
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useI18n();

  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [likedIds, setLikedIds] = useState([]);
  const [repostedIds, setRepostedIds] = useState([]);

  const decodedTag = tag ? decodeURIComponent(tag) : '';
  usePageTitle(decodedTag ? `#${decodedTag}` : t('hashtag.not_found'));
  useEffect(() => {
    if (!decodedTag) {
      setError(t('hashtag.not_found'));
      setLoading(false);
      return;
    }

    const fetchPosts = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = isTextSearch
          ? await searchPostsByContent(decodedTag, { limit: 30 })
          : await getPostsByHashtag(decodedTag, { limit: 30 });
        setPosts(data);

        // Fetch liked/reposted states
        if (user?.id && data.length > 0) {
          const postIds = data.map(p => p.id);
          const [liked, reposted] = await Promise.all([
            getLikedPostIds(postIds, user.id),
            getRepostedPostIds(postIds, user.id),
          ]);
          setLikedIds(liked);
          setRepostedIds(reposted);
        }

        if (data.length === 0) {
          setError(t('hashtag.no_posts'));
        }
      } catch (err) {
        console.error('Error fetching hashtag posts:', err);
        setError(t('hashtag.load_error'));
      } finally {
        setLoading(false);
      }
    };

    fetchPosts();
  }, [decodedTag, user?.id, t]);

  const handlePostUpdate = (updatedPost) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === updatedPost.id ? { ...p, ...updatedPost } : p))
    );
    clearFeedCache('hashtag_' + decodedTag);
  };

  const handlePostDelete = (postId) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    clearFeedCache('hashtag_' + decodedTag);
  };

  return (
    <div className="post-detail-page">
      <div className="hashtag-header">
        <button className="post-detail-back" onClick={() => navigate(-1)}>
          <FaArrowLeft /> {t('post.back')}
        </button>
        <div className="hashtag-title">
          {isTextSearch ? (
            <FaFire className="hashtag-icon hashtag-icon--trend" />
          ) : (
            <FaHashtag className="hashtag-icon" />
          )}
        </div>
        <p className="hashtag-subtitle">
          {isTextSearch ? t('hashtag.posts_with_word', { word: decodedTag }) : t('hashtag.posts_with_tag', { tag: decodedTag })}
        </p>
      </div>

      {loading ? (
        <div className="posts-skeleton">
          {[1, 2, 3].map((i) => (
            <div key={i} className="posts-skeleton-card">
              <div className="skeleton posts-skeleton-avatar" />
              <div className="posts-skeleton-lines">
                <div className="posts-skeleton-line posts-skeleton-line--short" />
                <div className="posts-skeleton-line" />
                <div className="posts-skeleton-line posts-skeleton-line--medium" />
              </div>
            </div>
          ))}
        </div>
      ) : error && posts.length === 0 ? (
        <div className="posts-empty">
          <span className="posts-empty-icon"><FaRegSadTear /></span>
          <p className="posts-empty-text">{error}</p>
        </div>
      ) : (
        <div className="posts-feed">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              liked={likedIds.includes(post.id)}
              reposted={repostedIds.includes(post.id)}
              onUpdate={handlePostUpdate}
              onDelete={handlePostDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
