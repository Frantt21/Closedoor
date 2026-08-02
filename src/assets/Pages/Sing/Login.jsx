import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';
import usePageTitle from '../../../hooks/usePageTitle';
import { FaEye, FaEyeSlash, FaDiscord } from 'react-icons/fa';
import TurnstileCaptcha, { isTurnstileActive } from '../../Resources/Components/TurnstileCaptcha';
import '../../Resources/Styles/login.css';

function Login() {
  const { t } = useI18n();
  usePageTitle(t('auth.login_title'));
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [discordLoading, setDiscordLoading] = useState(false);
  const [error, setError] = useState('');
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const { login, loginWithDiscord } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!emailOrUsername || !password) {
      setError(t('auth.fill_fields'));
      setLoading(false);
      return;
    }

    if (isTurnstileActive() && !captchaToken) {
      setError(t('auth.captcha_required') || 'Complete the CAPTCHA to continue');
      setLoading(false);
      return;
    }

    const result = await login(emailOrUsername, password, captchaToken);

    if (result.success) {
      const params = new URLSearchParams(location.search);
      const redirect = params.get('redirect') || '/';
      navigate(redirect);
    } else {
      setError(result.error || t('auth.login_error'));
    }

    // Resetear el reto para el siguiente intento
    setCaptchaToken(null);
    setCaptchaNonce((n) => n + 1);

    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="auth-subtitle">{t('auth.login_subtitle')}</p>

        {error && <div className="auth-error">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            className="auth-input"
            type="text"
            placeholder={t('auth.login_placeholder')}
            value={emailOrUsername}
            onChange={(e) => setEmailOrUsername(e.target.value)}
            disabled={loading}
          />
          <div className="auth-password-wrap">
            <input
              className="auth-input auth-input--password"
              type={showPassword ? 'text' : 'password'}
              placeholder={t('auth.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPassword((s) => !s)}
              tabIndex={-1}
              aria-label={showPassword ? t('auth.hide_password') || 'Hide password' : t('auth.show_password') || 'Show password'}
            >
              {showPassword ? <FaEyeSlash /> : <FaEye />}
            </button>
          </div>
          <TurnstileCaptcha onTokenChange={setCaptchaToken} resetKey={captchaNonce} />
          <button
            className="auth-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? t('auth.logging_in') : t('auth.login_btn')}
          </button>

          <div className="auth-divider">
            <span>{t('auth.or') || 'or'}</span>
          </div>

          <button
            className="auth-submit auth-submit--discord"
            type="button"
            disabled={discordLoading}
            onClick={async () => {
              setDiscordLoading(true);
              await loginWithDiscord();
              setDiscordLoading(false);
            }}
          >
            <FaDiscord className="auth-discord-icon" />
            {discordLoading
              ? (t('auth.redirecting') || 'Redirecting...')
              : (t('auth.login_discord') || 'Continue with Discord')}
          </button>
        </form>

        <p className="auth-footer">
          {t('auth.no_account')}{' '}
          <Link to="/Register" className="auth-link">
            {t('auth.signup_link')}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Login;
