import React, { useEffect, useRef } from 'react';
import ModalShell from './ModalShell';
import { useI18n } from '../../services/i18n/useI18n';

export default function ConfirmModal({ isOpen = true, message, onConfirm, onCancel }) {
  const { t } = useI18n();
  const confirmRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  // Scroll locking, Escape handling, focus trapping: manejado por ModalShell (<dialog> nativo)

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <ModalShell isOpen={isOpen} onClose={onCancel} onEscape={onCancel}>
      <div
        style={{ maxWidth: 400, padding: 24 }}
        ref={confirmRef}
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
    </ModalShell>
  );
}
