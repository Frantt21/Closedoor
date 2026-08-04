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

/**
 * Helper para consultar las vistas públicas (profiles_public, posts_public)
 * que NO exponen email ni encrypted_content.
 *
 * Úsalo en lugar de supabase.from('profiles') para todas las consultas
 * de SOLO LECTURA que no necesiten el email del usuario.
 *
 * Ejemplo:
 *   const { data } = await dbPublic.from('profiles').select('id, username');
 *   const { data } = await dbPublic.from('posts').select('id, content');
 *
 * Para operaciones de escritura (UPDATE, INSERT, DELETE) o consultas que
 * requieran el email (login), sigue usando supabase.from('profiles') directamente.
 */
export const dbPublic = {
  from: (table) => {
    const viewName = table === 'profiles' ? 'profiles_public'
      : table === 'posts' ? 'posts_public'
      : table;
    return supabase.from(viewName);
  },
};

// Exposición global SOLO en desarrollo para pruebas de seguridad desde
// DevTools. En producción NO se expone: cualquier script inyectado (XSS)
// podría llamar __supabase.auth.getSession() y leer el token en claro,
// anulando el cifrado del storage. Para auditar producción usa
// scripts/test-security-full.mjs (usa su propio cliente, sin global).
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  window.__supabase = supabase;
}
