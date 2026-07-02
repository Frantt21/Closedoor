import React from 'react';
import { useI18n } from '../services/i18n/useI18n';
import usePageTitle from '../../hooks/usePageTitle';
import { FaUsers } from 'react-icons/fa';

export default function Comunidades() {
  const { t } = useI18n();
  usePageTitle(t('comunidades.title'));

  return (
    <div className="comunidades-page">
      <div className="comunidades-header">
        <h2 className="comunidades-title">{t('comunidades.title')}</h2>
      </div>
      <div className="comunidades-empty">
        <div className="comunidades-empty-icon"><FaUsers /></div>
        <p className="comunidades-empty-text">{t('comunidades.empty')}</p>
        <p className="comunidades-empty-subtext">{t('comunidades.empty_sub')}</p>
      </div>
    </div>
  );
}
