import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';
import usePageTitle from '../../../hooks/usePageTitle';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import '../../Resources/Styles/register.css';

function Register() {
  const { t } = useI18n();
  usePageTitle(t('auth.register_title'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password || !username) {
      setError(t('auth.fill_fields'));
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError(t('auth.password_length'));
      setLoading(false);
      return;
    }

    const result = await register(email, password, username, nickname || username);

    if (result.success) {
      const params = new URLSearchParams(location.search);
      const redirect = params.get('redirect') || '/';
      navigate(redirect);
    } else {
      setError(result.error || t('auth.register_error'));
    }

    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="auth-subtitle">{t('auth.register_subtitle')}</p>

        {error && <div className="auth-error">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            className="auth-input"
            type="text"
            placeholder={t('auth.nickname') || 'Nickname'}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            disabled={loading}
          />
          <input
            className="auth-input"
            type="text"
            placeholder={t('auth.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
          />
          <input
            className="auth-input"
            type="email"
            placeholder={t('auth.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? t('auth.registering') : t('auth.register_btn')}
          </button>
        </form>

        <p className="auth-footer">
          {t('auth.has_account')}{' '}
          <Link to="/Login" className="auth-link">
            {t('auth.login_link')}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Register;
