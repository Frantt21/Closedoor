import React, { useEffect, useRef } from 'react';
import { useI18n } from '../../services/i18n/useI18n';

export default function ConfirmModal({ message, onConfirm, onCancel }) {
  const { t } = useI18n();
  const confirmRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onCancelRef.current();
    };
    document.addEventListener('keydown', handleKey);
    confirmRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div
      className="fc-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="fc-modal"
        style={{ maxWidth: 400, padding: 24 }}
        ref={confirmRef}
        tabIndex={-1}
      >
        <p style={{
          fontSize: '0.95rem',
          color: 'var(--color-text, #ffffff)',
          lineHeight: 1.6,
          margin: '0 0 20px 0',
        }}>
          {message}
        </p>
        <div style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}>
          <button
            className="fc-modal-save"
            onClick={(e) => { e.stopPropagation(); onConfirm(); }}
            autoFocus
          >
            {t('common.confirm')}
          </button>
          <button
            className="fc-modal-sub-cancel"
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
