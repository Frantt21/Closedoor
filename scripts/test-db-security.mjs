import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

const SUPABASE_URL = envContent.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim() || '';
const SUPABASE_KEY = envContent.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim()
  || envContent.match(/VITE_SUPABASE_PUBLISHABLE_KEY=(.+)/)?.[1]?.trim()
  || '';

const { createClient } = await import('@supabase/supabase-js');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

console.log('\n=== 🛡️ PRUEBA DE SEGURIDAD DB (sin auth) ===\n');

const tests = [
  { n: 1, label: 'Perfiles con email', fn: () => supabase.from('profiles').select('id, email, username').limit(5) },
  { n: 2, label: 'Posts encriptados', fn: () => supabase.from('posts').select('id, encrypted_content, is_encrypted').eq('is_encrypted', true).limit(5) },
  { n: 3, label: 'Conversaciones ajenas', fn: () => supabase.from('conversations').select('*').limit(5) },
  { n: 4, label: 'Notificaciones ajenas', fn: () => supabase.from('notifications').select('*').limit(10) },
  { n: 5, label: 'Mensajes ajenos', fn: () => supabase.from('messages').select('*').limit(5) },
  { n: 6, label: 'Insert post como otro', fn: () => supabase.from('posts').insert({ user_id: '00000000-0000-0000-0000-000000000000', content: 'Hackeado!' }) },
  { n: 7, label: 'Update perfil ajeno', fn: () => supabase.from('profiles').update({ bio: 'Editado!' }).eq('id', '00000000-0000-0000-0000-000000000000') },
  { n: 8, label: 'Delete post ajeno', fn: () => supabase.from('posts').delete().eq('id', '00000000-0000-0000-0000-000000000000') },
  { n: 9, label: 'Insert like ajeno', fn: () => supabase.from('likes').insert({ user_id: '00000000-0000-0000-0000-000000000000', post_id: '00000000-0000-0000-0000-000000000000' }) },
  { n: 10, label: 'Delete comment ajeno', fn: () => supabase.from('comments').delete().eq('id', '00000000-0000-0000-0000-000000000000') },
  { n: 11, label: 'Votos de encuestas ajenos', fn: () => supabase.from('poll_votes').select('*').limit(10) },
  { n: 12, label: 'Llamadas ajenas', fn: () => supabase.from('calls').select('*').limit(10) },
];

let pass = 0, fail = 0;
for (const test of tests) {
  const { data, error } = await test.fn();
  const isSecure = !data || (Array.isArray(data) && data.length === 0) || error;
  if (isSecure) {
    console.log('✅ ' + test.n + '. ' + test.label + ': PROTEGIDO' + (error ? ' (' + error.message?.substring(0, 80) + ')' : ' (0 filas)'));
    pass++;
  } else {
    console.log('⚠️  ' + test.n + '. ' + test.label + ': EXPUESTO — ' + (Array.isArray(data) ? data.length : '1') + ' resultado(s)');
    fail++;
  }
}

console.log('\n=== RESULTADO: ' + pass + '/12 pasaron, ' + fail + '/12 fallaron ===');
if (fail > 0) console.log('⚠️  REVISAR RLS EN LAS TABLAS SEÑALADAS');
else console.log('✅ TODO PROTEGIDO');
