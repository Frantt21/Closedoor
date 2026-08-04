import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../assets/services/supabaseclient';
import {
  checkUsernameExists,
  checkEmailExists,
  createUserProfile,
  ensureUserProfile,
  getEmailByUsername,
  getUserProfile,
  getCachedProfile,
  setCachedProfile,
  clearCachedProfile,
  clearCachedProfileByUsername,
} from '../assets/services/userService';
import { clearAllAppCaches } from '../assets/services/postService';
import { clearDecryptedCache } from '../assets/services/alphabetEncryption';
import { clearBlockedListsCache } from '../assets/services/blockService';
import { clearCachedFollowCounts } from '../assets/services/followService';
import { initPresence, disposePresence } from '../assets/services/presenceService';
import { getItem, waitForKeyReady } from '../assets/services/secureStorage';
import { PROFILE_PUBLIC_COLUMNS } from '../assets/services/userService';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const myStatusRef = useRef('online');
  const sessionTokenRef = useRef(null);
  const heartbeatRef = useRef(null);

  // ── Persistir mi estado a la DB ──
  const persistMyStatus = useCallback(async (status, userId) => {
    if (!userId) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          user_status: status,
          user_status_updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
      if (error) console.warn('[AuthStatus] DB update error:', error);
    } catch (err) {
      console.warn('[AuthStatus] Error updating status:', err);
    }
  }, []);

  // ── Inicializar estado del usuario (global, nunca se desmonta) ──
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Esperar a que la clave maestra esté cargada (IndexedDB/memoria)
        // para poder descifrar la sesión de forma fiable.
        await waitForKeyReady();

        // Get current session
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error('Error getting session:', error);
          setUser(null);
          setProfile(null);
          setProfileLoading(false);
        } else {
          const currentUser = session?.user || null;
          setUser(currentUser);
          if (currentUser) {
            const cached = getCachedProfile(currentUser.id);
            if (cached) {
              setProfile(cached);
              setProfileLoading(false);
            }
            try {
              const freshProfile = await getUserProfile(currentUser.id);
              if (freshProfile) {
                setProfile(freshProfile);
                setCachedProfile(freshProfile);
              }
            } catch (err) {
              console.warn('Could not refresh profile on init:', err);
            } finally {
              setProfileLoading(false);
            }

            // ── Inicializar Presence global ──
            initPresence(currentUser.id, 'online');

            // ── Restaurar estado guardado + heartbeat global ──
            startMyStatusTracker(currentUser.id);
          } else {
            setProfile(null);
            setProfileLoading(false);
          }
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
        setUser(null);
        setProfile(null);
        setProfileLoading(false);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const currentUser = session?.user || null;
      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        setProfileLoading(false);
        disposePresence();
        stopMyStatusTracker();
        return;
      }

      const cached = getCachedProfile(currentUser.id);
      if (cached) {
        setProfile(cached);
        setProfileLoading(false);
      }

      try {
        const freshProfile = await getUserProfile(currentUser.id);
        if (freshProfile) {
          setProfile(freshProfile);
          setCachedProfile(freshProfile);
        }
      } catch (err) {
        console.warn('Could not refresh profile on auth change:', err);
      } finally {
        setProfileLoading(false);
      }

      // Reiniciar tracker de estado al cambiar de usuario
      stopMyStatusTracker();
      startMyStatusTracker(currentUser.id);
    });

    return () => {
      subscription?.unsubscribe();
      stopMyStatusTracker();
    };
  }, []);

  // ── Status tracker: init, heartbeat, beforeunload ──
  const startMyStatusTracker = useCallback((userId) => {
    if (!userId) return;

    (async () => {
      // Restaurar estado guardado
      let initialStatus = 'online';
      try {
        const saved = getItem('fc_user_status');
        if (saved === 'dnd' || saved === 'idle') {
          initialStatus = saved;
        }
      } catch {}

      myStatusRef.current = initialStatus;

      // Sesión token para beforeunload fetch
      try {
        const { data } = await supabase.auth.getSession();
        sessionTokenRef.current = data?.session?.access_token || null;
      } catch {}

      // Heartbeat cada 30s — lee de secureStorage para sincronizar con
      // cambios de estado hechos desde useUserStatus.setMyStatus
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        let s = myStatusRef.current;
        try {
          const saved = getItem('fc_user_status');
          if (saved === 'dnd' || saved === 'idle' || saved === 'online') {
            s = saved;
            myStatusRef.current = s;
          }
        } catch {}
        if (s === 'online' || s === 'idle' || s === 'dnd') {
          persistMyStatus(s, userId);
        }
      }, 30000);

      // beforeunload/pagehide: poner disconnected
      const SB_URL = import.meta.env.VITE_SUPABASE_URL || '';
      const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
      const restOrigin = (() => { try { return new URL(SB_URL).origin; } catch { return ''; } })();

      const handleDisconnect = () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        const token = sessionTokenRef.current;
        if (SB_URL && SB_KEY && token) {
          try {
            fetch(`${restOrigin}/rest/v1/profiles?id=eq.${userId}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'apikey': SB_KEY,
              },
              body: JSON.stringify({
                user_status: 'disconnected',
                user_status_updated_at: new Date().toISOString(),
              }),
              keepalive: true,
            }).catch(() => {});
          } catch {}
        }
        persistMyStatus('disconnected', userId).catch(() => {});
      };
      window.addEventListener('beforeunload', handleDisconnect);
      window.addEventListener('pagehide', handleDisconnect);

      // Guardar cleanup
      window.__fc_statusCleanup = () => {
        window.removeEventListener('beforeunload', handleDisconnect);
        window.removeEventListener('pagehide', handleDisconnect);
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
      };

      // Sync inicial: restaurar estado en DB
      persistMyStatus(initialStatus, userId);
    })();
  }, [persistMyStatus]);

  const stopMyStatusTracker = useCallback(() => {
    if (typeof window.__fc_statusCleanup === 'function') {
      window.__fc_statusCleanup();
      window.__fc_statusCleanup = null;
    }
  }, []);

  // ── Realtime subscription para cambios en profiles ──
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`profile-realtime-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const fresh = payload.new;
          setProfile(fresh);
          setCachedProfile(fresh);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const refreshProfile = async (userId = user?.id) => {
    if (!userId) return null;

    try {
      // Bypass cache para obtener datos frescos siempre.
      // Columnas explícitas SIN email (columna revocada en migración 053).
      const { data, error } = await supabase
        .from('profiles')
        .select(PROFILE_PUBLIC_COLUMNS)
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error refreshing profile:', error);
        return null;
      }

      if (data) {
        setProfile(data);
        setCachedProfile(data);
      }
      return data;
    } catch (err) {
      console.warn('Could not refresh profile:', err);
      return null;
    }
  };

  const isDiscordLinked = !!(user?.identities?.some(i => i.provider === 'discord'));

  const linkDiscord = async () => {
    try {
      setError(null);
      const { data, error } = await supabase.auth.linkIdentity({
        provider: 'discord',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setError(error.message);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  const loginWithDiscord = async () => {
    try {
      setError(null);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setError(error.message);
        return { success: false, error: error.message };
      }

      // OAuth redirects away from the page, so we don't set user here
      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  const login = async (emailOrUsername, password, captchaToken) => {
    try {
      setError(null);
      let email = emailOrUsername;

      // If input doesn't contain @, treat it as username and fetch email
      if (!emailOrUsername.includes('@')) {
        const foundEmail = await getEmailByUsername(emailOrUsername);
        if (!foundEmail) {
          const err = 'Username or email not found';
          setError(err);
          return { success: false, error: err };
        }
        email = foundEmail;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: {
          // Token de Cloudflare Turnstile (verificado server-side por Supabase)
          captchaToken: captchaToken || undefined,
        },
      });

      if (error) {
        setError(error.message);
        return { success: false, error: error.message };
      }

      const loggedUser = data?.user || null;
      if (loggedUser) {
        try {
          await ensureUserProfile(loggedUser);
          const freshProfile = await refreshProfile(loggedUser.id);
          if (freshProfile) {
            setProfile(freshProfile);
          }
        } catch (profileErr) {
          console.warn('Could not ensure profile on login:', profileErr);
        }

        // ── Inicializar Presence global en login ──
        initPresence(loggedUser.id, 'online');
      }

      setUser(loggedUser);
      return { success: true, user: loggedUser };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  const register = async (email, password, username, nickname, captchaToken) => {
    try {
      setError(null);

      // Validate inputs
      if (!email || !password || !username) {
        const err = 'All fields are required';
        setError(err);
        return { success: false, error: err };
      }

      if (password.length < 6) {
        const err = 'Password must be at least 6 characters';
        setError(err);
        return { success: false, error: err };
      }

      if (username.length < 3) {
        const err = 'Username must be at least 3 characters';
        setError(err);
        return { success: false, error: err };
      }

      // Username: solo letras, números y guiones bajos
      if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
        const err = 'Username can only contain letters, numbers and underscores';
        setError(err);
        return { success: false, error: err };
      }

      // Check if username already exists
      try {
        const usernameExists = await checkUsernameExists(username);
        if (usernameExists) {
          const err = 'Username already taken';
          setError(err);
          return { success: false, error: err };
        }
      } catch (err) {
        console.warn('Could not check username (table may not exist):', err);
      }

      // Check if email already exists
      try {
        const emailExists = await checkEmailExists(email);
        if (emailExists) {
          const err = 'Email already registered';
          setError(err);
          return { success: false, error: err };
        }
      } catch (err) {
        console.warn('Could not check email:', err);
      }

      // Sign up with Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Token de Cloudflare Turnstile (verificado server-side por Supabase)
          captchaToken: captchaToken || undefined,
          data: {
            username,
            display_name: nickname || username,
          },
        },
      });

      if (error) {
        setError(error.message);
        return { success: false, error: error.message };
      }

      // Create user profile in profiles table only when a valid authenticated session exists.
      try {
        if (data?.session?.user) {
          await createUserProfile(data.session.user.id, email, username, nickname);
          setUser(data.session.user);
          try {
            const freshProfile = await getUserProfile(data.session.user.id);
            if (freshProfile) {
              setProfile(freshProfile);
              setCachedProfile(freshProfile);
            }
          } catch (profileErr) {
            console.warn('Could not load profile after registration:', profileErr);
          }
        } else {
          setUser(null);
        }
      } catch (profileErr) {
        console.warn('Could not create profile (table may not exist or session not authenticated):', profileErr);
      }

      return {
        success: true,
        user: data?.session?.user || null,
        message: data?.session
          ? 'Registration successful! Your profile was created.'
          : 'Registration successful! Please check your email to confirm before logging in.',
      };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  const logout = async () => {
    try {
      setError(null);
      const { error } = await supabase.auth.signOut();

      if (error) {
        setError(error.message);
        return { success: false, error: error.message };
      }

      const currentUserId = user?.id;
      const currentUsername = profile?.username;

      setUser(null);
      setProfile(null);

      // ── Liberar Presence global ──
      disposePresence();

      // ── Limpiar todo el caché de la sesión ──
      clearAllAppCaches();          // Elimina todos los localStorage fc_*
      clearDecryptedCache();        // Limpia el caché en memoria de contenido descifrado
      if (currentUserId) {
        clearCachedProfile(currentUserId);
        clearBlockedListsCache(currentUserId);
        clearCachedFollowCounts(currentUserId);
      }
      if (currentUsername) {
        clearCachedProfileByUsername(currentUsername);
      }

      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        profileLoading,
        loading,
        error,
        login,
        loginWithDiscord,
        linkDiscord,
        isDiscordLinked,
        register,
        logout,
        refreshProfile,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
