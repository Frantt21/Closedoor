import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const SUPABASE_URL = envContent.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim() || '';
const SUPABASE_KEY = envContent.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim() || envContent.match(/VITE_SUPABASE_PUBLISHABLE_KEY=(.+)/)?.[1]?.trim() || '';
const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { autoRefreshToken: false, persistSession: false }});

console.log('\n=== DETALLE DE EXPOSICIONES ===\n');

// 1. Perfiles - ver exactamente qué datos
const { data: p } = await supabase.from('profiles').select('id, email, username').limit(10);
console.log('⚠️  PERFILES CON EMAIL (' + p?.length + ' filas):');
p?.slice(0, 5).forEach(x => console.log('   ' + x.username + ' | email: ' + (x.email || 'null') + ' | id: ' + (x.id || '').substring(0, 8)));
const emailCount = p?.filter(x => x.email).length || 0;
console.log('   → ' + emailCount + '/' + p?.length + ' tienen email visible');

// 2. Posts encriptados
const { data: ep } = await supabase.from('posts').select('id, encrypted_content, is_encrypted').eq('is_encrypted', true).limit(5);
console.log('\n⚠️  POSTS ENCRIPTADOS (' + ep?.length + ' filas):');
ep?.forEach(x => console.log('   id: ' + (x.id || '').substring(0, 8) + ' | encrypted: ' + (x.encrypted_content?.substring(0, 30) || 'null') + '...'));

console.log('\n=== FIN ===');
