import React, { createContext, useState, useEffect } from 'react';
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

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
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
    });

    return () => {
      subscription?.unsubscribe();
    };
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
      // Bypass cache para obtener datos frescos siempre
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
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

  const login = async (emailOrUsername, password) => {
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
      }

      setUser(loggedUser);
      return { success: true, user: loggedUser };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  const register = async (email, password, username) => {
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
          data: {
            username,
            display_name: username,
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
          await createUserProfile(data.session.user.id, email, username);
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
