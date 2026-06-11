import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';
import '../../Resources/Styles/login.css';

function Login() {
  const { t } = useI18n();
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!emailOrUsername || !password) {
      setError(t('auth.fill_fields'));
      setLoading(false);
      return;
    }

    const result = await login(emailOrUsername, password);

    if (result.success) {
      navigate('/');
    } else {
      setError(result.error || t('auth.login_error'));
    }

    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">{t('auth.login_title')}</h1>
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
          <input
            className="auth-input"
            type="password"
            placeholder={t('auth.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
          <button
            className="auth-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? t('auth.logging_in') : t('auth.login_btn')}
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
