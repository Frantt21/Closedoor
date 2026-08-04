import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseclient';
import { useI18n } from '../services/i18n/useI18n';
import usePageTitle from '../../hooks/usePageTitle';

function AuthCallback() {
  const { t } = useI18n();
  usePageTitle(t('redirect') || 'Redirecting...');
  const navigate = useNavigate();
  const [status, setStatus] = useState('processing');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Supabase automatically exchanges the code for a session
        // when using signInWithOAuth with the implicit flow.
        // We just need to check if we now have a session.
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error('Auth callback error:', error);
          setStatus('error');
          return;
        }

        if (session) {
          // Successful login — redirect to home
          navigate('/', { replace: true });
        } else {
          // Try to exchange code for session (PKCE flow)
          const code = new URLSearchParams(window.location.search).get('code') || '';
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

          if (exchangeError) {
            // Con PKCE + detectSessionInUrl, supabase-js pudo auto-intercambiar
            // el code al inicializar (el code es de un solo uso). Re-consultar la
            // sesión antes de declarar error: el auto-exchange puede haber
            // completado la sesión entre medias.
            const { data: retrySession } = await supabase.auth.getSession();
            if (retrySession?.session) {
              navigate('/', { replace: true });
              return;
            }
            console.error('Code exchange error:', exchangeError);
            setStatus('error');
            return;
          }

          if (data?.session) {
            navigate('/', { replace: true });
          } else {
            setStatus('error');
          }
        }
      } catch (err) {
        console.error('Auth callback exception:', err);
        setStatus('error');
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ textAlign: 'center', padding: '40px' }}>
        {status === 'processing' && (
          <>
            <div className="auth-spinner" />
            <p style={{ marginTop: 16, color: 'var(--color-text-secondary)' }}>
              {t('auth.redirecting') || 'Completing login...'}
            </p>
          </>
        )}
        {status === 'error' && (
          <>
            <p style={{ color: '#ef4444', fontWeight: 600 }}>
              {t('auth.login_error') || 'Login failed'}
            </p>
            <button
              className="auth-submit"
              style={{ marginTop: 16 }}
              onClick={() => navigate('/Login')}
            >
              {t('common.back') || 'Go back'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default AuthCallback;
