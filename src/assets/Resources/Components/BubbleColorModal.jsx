import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FaTimes, FaPalette } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';
import { setBubbleColors } from '../../services/chatService';
import { getContrastFromHex } from '../../services/colorExtractor';
import '../Styles/chat.css';
import './css/modal.css';

const PALETTE = [
  '#111111', '#1f2937', '#374151', '#4b5563',
  '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#22c55e', '#06b6d4', '#14b8a6',
  '#e5e7eb', '#f8fafc',
];

/**
 * BubbleColorModal — colores de burbuja por conversación.
 *
 * Deja personalizar el color de las burbujas propias y las del otro
 * usuario en un chat concreto. Se guarda en chat_bubble_settings
 * (sincronizado con la cuenta, patrón de nicknames).
 *
 * Props:
 *  - conversationId: id de la conversación.
 *  - currentColors: { own, other } hex actuales ('' o null = default).
 *  - otherName: nombre del otro participante (para el preview/label).
 *  - onClose: () => void
 *  - onSaved: (colors) => void — recibe { own, other } finales.
 */
export default function BubbleColorModal({ conversationId, currentColors = {}, otherName = '', onClose, onSaved }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [own, setOwn] = useState(currentColors.own || '');
  const [other, setOther] = useState(currentColors.other || '');
  const [saving, setSaving] = useState(false);

  // Reset al abrir para otra conversación
  useEffect(() => {
    setOwn(currentColors.own || '');
    setOther(currentColors.other || '');
  }, [conversationId, currentColors.own, currentColors.other]);

  const close = useCallback(() => { if (!saving) onClose?.(); }, [saving, onClose]);

  const handleSave = useCallback(async () => {
    if (!user?.id || !conversationId) return;
    setSaving(true);
    try {
      const colors = { own: own || null, other: other || null };
      await setBubbleColors(user.id, conversationId, colors);
      onSaved?.(colors);
      toast.success(t('chat.bubble_saved') || 'Bubble colors saved');
      onClose?.();
    } catch (err) {
      console.error('Error saving bubble colors:', err);
      toast.error(t('common.error') || 'Error');
    } finally {
      setSaving(false);
    }
  }, [user?.id, conversationId, own, other, onSaved, onClose, t]);

  const renderRow = (label, value, setValue) => (
    <div className="chat-bubble-color-row">
      <div className="chat-bubble-color-label">
        <span>{label}</span>
        <button type="button" className="chat-bubble-color-reset" onClick={() => setValue('')}>
          {t('chat.bubble_default') || 'Default'}
        </button>
      </div>
      <div className="chat-bubble-color-swatches">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={`chat-bubble-color-swatch ${value === c ? 'chat-bubble-color-swatch--selected' : ''}`}
            style={{ background: c }}
            onClick={() => setValue(c)}
            title={c}
          />
        ))}
        <label className="chat-bubble-color-swatch chat-bubble-color-custom" title={t('modal.accent_color_custom') || 'Custom'}>
          <input
            type="color"
            value={value || '#3b82f6'}
            onChange={(e) => setValue(e.target.value)}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
          />
          <FaPalette />
        </label>
      </div>
    </div>
  );

  if (!conversationId) return null;

  return createPortal(
    <div className="chat-nickname-overlay" onClick={close}>
      <div className="chat-nickname-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="chat-nickname-modal-header">
          <h3 className="fc-modal-title">{t('chat.bubble_colors') || 'Bubble colors'}</h3>
          <button className="chat-nickname-modal-close" onClick={close} title={t('modal.cancel') || 'Cancel'}>
            <FaTimes />
          </button>
        </div>

        <div className="chat-nickname-modal-body">
          {/* ── Live preview ── */}
          <div className="chat-bubble-preview">
            <div className="chat-bubble-preview-row chat-bubble-preview-row--own">
              <div
                className="chat-bubble-preview-bubble"
                style={{ background: own || '#111111', color: getContrastFromHex(own || '#111111') }}
              >
                {t('chat.bubble_own') || 'My bubbles'}
              </div>
            </div>
            <div className="chat-bubble-preview-row chat-bubble-preview-row--other">
              <div
                className="chat-bubble-preview-bubble"
                style={{ background: other || 'var(--color-surface, #1a1a1a)', color: getContrastFromHex(other || '') }}
              >
                {otherName
                  ? (t('chat.bubble_other_name', { name: otherName }) || `Their bubbles (${otherName})`)
                  : (t('chat.bubble_other') || 'Their bubbles')}
              </div>
            </div>
          </div>

          {renderRow(t('chat.bubble_own') || 'My bubbles', own, setOwn)}
          {renderRow(t('chat.bubble_other') || 'Their bubbles', other, setOther)}
        </div>

        {/* ── Footer ── */}
        <div className="chat-nickname-modal-footer">
          <button className="fc-modal-save" onClick={handleSave} disabled={saving}>
            {saving ? (t('modal.saving') || 'Saving...') : (t('common.save') || 'Save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
