import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../services/i18n/useI18n';
import { IMG_RE } from '../../services/helpers';
import Avatar from './Avatar';
import Badge from './Badge';
import RichText from './RichText';
import SafeImage from './SafeImage';

/**
 * ChatSharedPostCard — post compartido dentro de un mensaje.
 *
 * La usan el chat completo (Chat.jsx) y la ventana flotante (FloatingChat.jsx)
 * para que el post se vea igual (y del mismo tamaño) en las dos. Extraída del
 * JSX que vivía inline en Chat.jsx, sin cambios de diseño.
 *
 * Props:
 *  - post: fila del post con `profiles`; null mientras carga → esqueleto
 *  - postId: id del post, para el esqueleto y el click
 *  - onOpen: opcional; por defecto navega a /post/:id
 */
export default function ChatSharedPostCard({ post, postId, onOpen }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const targetId = post?.id || postId;
  const open = () => {
    if (!targetId) return;
    if (onOpen) onOpen(targetId);
    else navigate(`/post/${targetId}`);
  };

  if (!post) {
    return (
      <div className="chat-message-shared-post chat-message-shared-post--loading" onClick={open}>
        <div className="chat-message-shared-post-spinner" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  const postProfile = post.profiles || {};
  const hasMedia = !!(post.image_urls?.length || post.image_url);

  return (
    <div className="chat-message-shared-post" onClick={open}>
      {/* Header: avatar + username + badge */}
      <div className="chat-message-shared-post-header">
        <Avatar
          src={postProfile.avatar_url}
          alt={postProfile.username || '?'}
          className="chat-message-shared-post-avatar"
        />
        <div className="chat-message-shared-post-author">
          <span className="chat-message-shared-post-username">
            {postProfile.username || 'unknown'}
          </span>
          {Array.isArray(postProfile.roles) && postProfile.roles.some((r) => r !== 'user') && (
            <Badge roles={postProfile.roles} />
          )}
        </div>
      </div>
      {/* Content with RichText */}
      {post.content && (
        <div className="chat-message-shared-post-text">
          <RichText
            text={post.content.length > 150
              ? post.content.slice(0, 150) + '...'
              : post.content}
            skipUrls={(() => {
              const urls = post.content.match(/(https?:\/\/[^\s<]+)/gi) || [];
              return urls.filter((u) => IMG_RE.test(u));
            })()}
            mentions={post.mentions}
          />
        </div>
      )}
      {/* Media preview */}
      {hasMedia && (
        <div className="chat-message-shared-post-media">
          <SafeImage
            src={post.image_urls?.[0] || post.image_url}
            alt="Post media"
            className="chat-message-shared-post-img"
          />
        </div>
      )}
    </div>
  );
}
