import { createClient } from '@supabase/supabase-js';
import { getItem, setItem, removeItem } from './secureStorage';

const rawSupabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.VITE_SUPABASE_DATA_API_URL ||
  '';

function normalizeSupabaseUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.pathname && parsed.pathname !== '/') {
      return `${parsed.protocol}//${parsed.host}`;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch (error) {
    return url;
  }
}

const SUPABASE_URL = normalizeSupabaseUrl(rawSupabaseUrl);
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLIC_KEY ||
  import.meta.env.VITE_SUPABASE_KEY ||
  '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn(
    'Supabase credentials are not configured. Please add VITE_SUPABASE_URL or VITE_SUPABASE_DATA_API_URL and either VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_PUBLIC_KEY, or VITE_SUPABASE_ANON_KEY to your .env file.'
  );
}

/**
 * Custom storage adapter que cifra el token de auth de Supabase
 * usando nuestro secureStorage en vez de localStorage plano.
 * El token aún usa la key `sb-{project-ref}-auth-token` pero el valor
 * queda cifrado (base64 en vez de JSON legible).
 */
const secureSupabaseStorage = {
  getItem(key) {
    return getItem(key);
  },
  setItem(key, value) {
    setItem(key, value);
  },
  removeItem(key) {
    removeItem(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: secureSupabaseStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
