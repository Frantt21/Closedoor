import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../services/i18n/useI18n';
import usePageTitle from '../../hooks/usePageTitle';
import { getTrendingHashtags, getTrendingWords, getCachedTrendingWords, getCachedTrendingHashtags, deduplicateTrending } from '../services/hashtagService';
import { getTrendingCategory } from '../services/trendingDictionary';
import { FaFire, FaHashtag, FaArrowLeft } from 'react-icons/fa';
import '../Resources/Styles/trending.css';
import '../Resources/Styles/skeleton.css';

const REFRESH_INTERVAL = 1000 * 60 * 5;

export default function Trending() {
  const { t } = useI18n();
  const navigate = useNavigate();
  usePageTitle(t('trending.title') || 'Tendencias');

  const goBack = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  }, [navigate]);

  const [words, setWords] = useState(() => getCachedTrendingWords());
  const [hashtags, setHashtags] = useState(() => getCachedTrendingHashtags());
  const [loading, setLoading] = useState(!words && !hashtags);

  const fetchTrending = useCallback(async () => {
    setLoading(true);
    try {
      const [newWords, newHashtags] = await Promise.all([
        getTrendingWords(20).catch(() => []),
        getTrendingHashtags(20).catch(() => []),
      ]);
      const deduped = deduplicateTrending(newWords, newHashtags);
      setWords(deduped);
      setHashtags(newHashtags);
    } catch (err) {
      console.warn('Error fetching trending:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrending();
    const interval = setInterval(fetchTrending, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchTrending]);

  const isEmpty = !loading && !words?.length && !hashtags?.length;

  return (
    <div className="trending-page">
      <div className="trending-header">
        <button type="button" className="trending-back" onClick={goBack}>
          <FaArrowLeft />
        </button>
        <h1 className="trending-title">{t('trending.title') || 'Tendencias'}</h1>
      </div>

      {loading ? (
        <div className="trending-skeleton-list">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton trending-skeleton-item" />
          ))}
        </div>
      ) : isEmpty ? (
        <p className="trending-empty">{t('trending.empty') || 'No hay tendencias en este momento.'}</p>
      ) : (
        <>
          {/* ── Trending words ── */}
          {words?.length > 0 && (
            <section className="trending-section">
              <h2 className="trending-section-title">
                <FaFire className="trending-section-icon" />
                {t('right_panel.trending_words')}
              </h2>
              <div className="trending-list">
                {words.map((item, i) => (
                  <Link
                    key={`word-${i}`}
                    to={`/hashtag/${encodeURIComponent(item.word)}?text=1`}
                    className="trending-item"
                  >
                    <span className="trending-rank">#{i + 1}</span>
                    <div className="trending-item-body">
                      <span className="trending-name">{item.word}</span>
                      <span className="trending-category">
                        {getTrendingCategory(item.word) || t('trending.various') || 'Varios'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ── Hashtags populares ── */}
          {hashtags?.length > 0 && (
            <section className="trending-section">
              <h2 className="trending-section-title">
                <FaHashtag className="trending-section-icon" />
                {t('right_panel.trending_hashtags')}
              </h2>
              <div className="trending-list">
                {hashtags.map((item, i) => (
                  <Link
                    key={`hash-${i}`}
                    to={`/hashtag/${encodeURIComponent(item.name)}`}
                    className="trending-item"
                  >
                    <span className="trending-rank">#{i + 1}</span>
                    <div className="trending-item-body">
                      <span className="trending-name">{item.name}</span>
                      <span className="trending-category">
                        {getTrendingCategory(item.name) || t('trending.various') || 'Varios'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
