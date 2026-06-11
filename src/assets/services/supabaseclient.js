import { createClient } from '@supabase/supabase-js';

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

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
