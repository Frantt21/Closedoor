import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../services/i18n/useI18n';
import usePageTitle from '../../hooks/usePageTitle';
import { FaUsers, FaPlus, FaSpinner, FaLock, FaSearch } from 'react-icons/fa';
import { useAuth } from '../../hooks/useAuth';
import { getCommunities, getCommunityById, canCreateCommunity, MIN_FOLLOWERS_TO_CREATE, MAX_COMMUNITIES_PER_USER } from '../services/communityService';
import { supabase } from '../services/supabaseclient';
import CreateCommunityModal from '../Resources/Components/CreateCommunityModal';
import { toast } from 'react-toastify';
import '../Resources/Styles/explore.css';
import '../Resources/Styles/skeleton.css';
import './styles/communities.css';

export default function Comunidades() {
  const { t } = useI18n();
  usePageTitle(t('comunidades.title'));
  const { user, profile } = useAuth();

  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [checkingPerms, setCheckingPerms] = useState(false);
  const searchTimerRef = useRef(null);

  const load = useCallback(async (query = '') => {
    setLoading(true);
    try {
      const data = await getCommunities({ search: query, limit: 60 });
      setCommunities(data);
    } catch (err) {
      console.error('[Comunidades] Error loading:', err);
      setCommunities([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(''); }, [load]);

  // Búsqueda con debounce
  const handleSearch = (value) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => load(value), 350);
  };

  // Realtime: actualizar contadores de miembros/posts en el listado
  useEffect(() => {
    const channel = supabase
      .channel('communities-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'communities' }, async (payload) => {
        if (payload.eventType === 'INSERT') {
          const c = await getCommunityById(payload.new.id).catch(() => null);
          if (c) setCommunities((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
        } else if (payload.eventType === 'DELETE') {
          setCommunities((prev) => prev.filter((c) => c.id !== payload.old.id));
        } else if (payload.eventType === 'UPDATE') {
          setCommunities((prev) => prev.map((c) => (c.id === payload.new.id ? { ...c, ...payload.new } : c)));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleCreated = (community) => {
    setCommunities((prev) => (prev.some((c) => c.id === community.id) ? prev : [community, ...prev]));
    toast.success(t('comunidades.created'));
  };

  // ── Aviso ANTES de abrir el modal: si no cumple los requisitos (admin o
  //    100+ followers y menos de 3 comunidades) no abre ──
  const handleCreateClick = async () => {
    if (!user?.id) return;
    setCheckingPerms(true);
    try {
      const res = await canCreateCommunity(user.id, { roles: profile?.roles || [] });
      if (!res.allowed) {
        if (res.limitReached) {
          toast.error(t('comunidades.limit_reached', { n: MAX_COMMUNITIES_PER_USER }));
        } else {
          toast.error(t('comunidades.followers_required', { n: MIN_FOLLOWERS_TO_CREATE }));
        }
        return;
      }
      setShowCreate(true);
    } catch {
      setShowCreate(true);
    } finally {
      setCheckingPerms(false);
    }
  };

  return (
    <div className="comunidades-page">
      <div className="comunidades-header">
        <h2 className="comunidades-title">{t('comunidades.title')}</h2>
        <button
          type="button"
          className="explore-filter-btn comunidades-create-btn"
          onClick={handleCreateClick}
          disabled={!user?.id || checkingPerms}
          title={user?.id ? '' : t('auth.login_btn')}
        >
          {checkingPerms ? <FaSpinner className="fc-spin" /> : <FaPlus />} {t('comunidades.create_btn')}
        </button>
      </div>

      <div className="explore-search">
        <div className="explore-search-wrap">
          <FaSearch className="explore-search-icon" />
          <input
            className="explore-search-input"
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t('comunidades.search_placeholder')}
          />
        </div>
      </div>

      {loading ? (
        <div className="explore-skeleton-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="explore-skeleton-card">
              <div className="skeleton explore-skeleton-banner" />
              <div className="explore-skeleton-body">
                <div className="skeleton skeleton--circle explore-skeleton-avatar" />
                <div className="explore-skeleton-content">
                  <div className="skeleton explore-skeleton-name" />
                  <div className="skeleton explore-skeleton-count" />
                  <div className="skeleton explore-skeleton-bio-line" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : communities.length === 0 ? (
        <div className="comunidades-empty">
          <div className="comunidades-empty-icon"><FaUsers /></div>
          <p className="comunidades-empty-text">{t('comunidades.empty')}</p>
          <p className="comunidades-empty-sub">{t('comunidades.empty_sub')}</p>
        </div>
      ) : (
        <div className="explore-grid comunidades-grid">
          {communities.map((c) => {
            const accentStyle = c.accent_color
              ? {
                  '--accent-color': c.accent_color,
                  '--accent-color-2': c.accent_color_secondary || c.accent_color,
                }
              : {};
            return (
              <Link
                key={c.id}
                to={`/c/${c.slug}`}
                className={`explore-card${c.accent_color ? ' explore-card--accent' : ''}`}
                style={accentStyle}
              >
                <div className="explore-card-banner">
                  {c.banner_url ? (
                    <img className="explore-card-banner-img" src={c.banner_url} alt="" />
                  ) : (
                    <div
                      className="comunidades-card-banner-fallback"
                      style={{ background: `linear-gradient(135deg, ${c.accent_color || '#333'}, ${c.accent_color_secondary || c.accent_color || '#222'})` }}
                    />
                  )}
                  <div className="explore-card-overlay" />
                </div>

                <div className="explore-card-body">
                  {c.avatar_url ? (
                    <img className="explore-card-avatar" src={c.avatar_url} alt={c.name} />
                  ) : (
                    <div
                      className="explore-card-avatar comunidades-card-avatar-letter"
                      style={{ background: `linear-gradient(135deg, ${c.accent_color || '#333'}, ${c.accent_color_secondary || c.accent_color || '#222'})` }}
                    >
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div className="explore-card-info">
                    <div className="explore-card-name-row">
                      <span className="explore-card-name">{c.name}</span>
                      <span className="comunidades-card-slug">c/{c.slug}</span>
                      {c.is_private && (
                        <span className="explore-card-private-icon" title={t('comunidades.private')}>
                          <FaLock />
                        </span>
                      )}
                    </div>

                    <span className="explore-card-followers">
                      {c.member_count || 0} {t('comunidades.members')} · {c.post_count || 0} {t('comunidades.posts')}
                    </span>

                    {c.description && <p className="explore-card-bio">{c.description}</p>}

                    {c.interests?.length > 0 && (
                      <div className="explore-card-interests">
                        {c.interests.slice(0, 3).map((interest) => (
                          <span key={interest} className="explore-card-interest">{interest}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <CreateCommunityModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={handleCreated}
      />
    </div>
  );
}
