import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../services/i18n/useI18n';
import usePageTitle from '../../hooks/usePageTitle';
import { FaUsers, FaPlus, FaSpinner, FaLock, FaSearch } from 'react-icons/fa';
import { useAuth } from '../../hooks/useAuth';
import { getCommunities, getCommunityById, canCreateCommunity, MIN_FOLLOWERS_TO_CREATE } from '../services/communityService';
import { supabase } from '../services/supabaseclient';
import CreateCommunityModal from '../Resources/Components/CreateCommunityModal';
import { toast } from 'react-toastify';
import './styles/communities.css';

export default function Comunidades() {
  const { t } = useI18n();
  usePageTitle(t('comunidades.title'));
  const { user } = useAuth();

  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [checkingFollowers, setCheckingFollowers] = useState(false);
  const searchTimerRef = useRef(null);

  const load = useCallback(async (query = '') => {
    setLoading(true);
    try {
      const data = await getCommunities({ search: query, limit: 50 });
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

  // ── Aviso ANTES de abrir el modal: si no cumple los 100 seguidores, no abre ──
  const handleCreateClick = async () => {
    if (!user?.id) return;
    setCheckingFollowers(true);
    try {
      const res = await canCreateCommunity(user.id);
      if (!res.allowed) {
        toast.error(t('comunidades.followers_required', { n: MIN_FOLLOWERS_TO_CREATE }));
        return;
      }
      setShowCreate(true);
    } catch {
      setShowCreate(true);
    } finally {
      setCheckingFollowers(false);
    }
  };

  return (
    <div className="comunidades-page">
      <div className="comunidades-header">
        <h2 className="comunidades-title">{t('comunidades.title')}</h2>
        <button
          type="button"
          className="comunidades-create-btn"
          onClick={handleCreateClick}
          disabled={!user?.id || checkingFollowers}
          title={user?.id ? '' : t('auth.login_btn')}
        >
          {checkingFollowers ? <FaSpinner className="fc-spin" /> : <FaPlus />} {t('comunidades.create_btn')}
        </button>
      </div>

      <div className="comunidades-search-wrap" style={{ position: 'relative' }}>
        <FaSearch style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted, #6b7280)', fontSize: '0.85rem', pointerEvents: 'none' }} />
        <input
          className="comunidades-search"
          style={{ paddingLeft: 36 }}
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder={t('comunidades.search_placeholder')}
        />
      </div>

      {loading ? (
        <div className="comunidades-loading"><FaSpinner className="fc-spin" /></div>
      ) : communities.length === 0 ? (
        <div className="comunidades-empty">
          <div className="comunidades-empty-icon"><FaUsers /></div>
          <p className="comunidades-empty-text">{t('comunidades.empty')}</p>
          <p className="comunidades-empty-sub">{t('comunidades.empty_sub')}</p>
        </div>
      ) : (
        <div className="comunidades-grid">
          {communities.map((c) => (
            <Link key={c.id} to={`/c/${c.slug}`} className="comunidades-card">
              <div className="comunidades-card-avatar" style={{ '--cc-accent': c.accent_color || 'transparent' }}>
                {c.avatar_url ? (
                  <img src={c.avatar_url} alt={c.name} />
                ) : (
                  <span style={{ background: `linear-gradient(135deg, ${c.accent_color || '#333'}, ${c.accent_color_secondary || c.accent_color || '#222'})` }}>
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="comunidades-card-info">
                <div className="comunidades-card-name-row">
                  <span className="comunidades-card-name">{c.name}</span>
                  <span className="comunidades-card-slug">c/{c.slug}</span>
                  {c.is_private && (
                    <span className="comunidades-card-private"><FaLock /> {t('comunidades.private')}</span>
                  )}
                </div>
                {c.description && <p className="comunidades-card-desc">{c.description}</p>}
                <div className="comunidades-card-stats">
                  <span><strong>{c.member_count || 0}</strong> {t('comunidades.members')}</span>
                  <span><strong>{c.post_count || 0}</strong> {t('comunidades.posts')}</span>
                </div>
              </div>
            </Link>
          ))}
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
