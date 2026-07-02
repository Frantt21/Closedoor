import React from 'react';
import { useI18n } from '../services/i18n/useI18n';
import usePageTitle from '../../hooks/usePageTitle';
import { FaComment } from 'react-icons/fa';

export default function Chat() {
  const { t } = useI18n();
  usePageTitle(t('chat.title'));

  return (
    <div className="chat-page">
      <div className="chat-header">
        <h2 className="chat-title">{t('chat.title')}</h2>
      </div>
      <div className="chat-empty">
        <div className="chat-empty-icon"><FaComment /></div>
        <p className="chat-empty-text">{t('chat.empty')}</p>
        <p className="chat-empty-subtext">{t('chat.empty_sub')}</p>
      </div>
    </div>
  );
}
