import { useEffect, useState } from 'react';
import { DEPLOY_UPDATE_EVENT } from '../../services/deployWatcher';
import { useI18n } from '../../services/i18n/useI18n';
import './css/deployUpdatePrompt.css';

/**
 * DeployUpdatePrompt — aviso "hay una versión nueva, recarga para actualizar".
 *
 * Lo dispara `services/deployWatcher.js` (evento DEPLOY_UPDATE_EVENT) cuando el
 * `build-id` servido por /version.json deja de coincidir con el del HTML actual.
 * Se muestra como una barra flotante abajo; "Recargar" hace un reload real (que
 * vuelve a pedir el HTML — network-first del service worker — y toma el build
 * nuevo). "Más tarde" lo esconde solo esta sesión de página.
 */
export default function DeployUpdatePrompt() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener(DEPLOY_UPDATE_EVENT, show);
    return () => window.removeEventListener(DEPLOY_UPDATE_EVENT, show);
  }, []);

  if (!visible) return null;

  return (
    <div className="deploy-update" role="status" aria-live="polite">
      <span className="deploy-update__text">
        <strong className="deploy-update__title">{t('update.title')}</strong>
        <span className="deploy-update__body">{t('update.body')}</span>
      </span>
      <div className="deploy-update__actions">
        <button
          type="button"
          className="deploy-update__reload"
          onClick={() => window.location.reload()}
        >
          {t('update.reload')}
        </button>
        <button
          type="button"
          className="deploy-update__later"
          onClick={() => setVisible(false)}
        >
          {t('update.later')}
        </button>
      </div>
    </div>
  );
}
