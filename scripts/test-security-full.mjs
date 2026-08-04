/**
 * 🛡️ TEST DE SEGURIDAD COMPLETO — FastChange
 *
 * Ejecuta:  node scripts/test-security-full.mjs
 *
 * Prueba:
 *   - DB: RLS en perfiles y posts (post-migración 051)
 *   - DB: Inyección SQL (a través de la API REST)
 *   - Cache: localStorage/sessionStorage cifrado
 *   - XSS: sanitización de contenido
 *   - Auth: validaciones de formularios
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Sanitización REAL del app (helpers.js) — el test verifica el comportamiento
// real de producción, no una simulación local que puede divergir.
import { sanitizeContent, sanitizeUrl } from '../src/assets/services/helpers.js';
// Validación de email REAL del app (emailValidation.js — módulo puro sin
// dependencias browser-only, re-exportado por userService.js).
import { validateEmail } from '../src/assets/services/emailValidation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Credenciales: prioridad a env vars de CI (GitHub Secrets), fallback a .env.local.
const envPath = path.resolve(__dirname, '..', '.env.local');
let envContent = '';
try {
  envContent = fs.readFileSync(envPath, 'utf-8');
} catch {
  // CI sin .env.local — se usan process.env
}

// Orden de prioridad SIEMPRE: env vars (CI) primero, luego .env.local.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  || process.env.VITE_SUPABASE_DATA_API_URL
  || envContent.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim()
  || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || envContent.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim()
  || envContent.match(/VITE_SUPABASE_PUBLISHABLE_KEY=(.+)/)?.[1]?.trim()
  || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\n❌ Faltan credenciales de Supabase. En CI configura los secrets');
  console.error('   VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (Settings → Secrets → Actions).');
  console.error('   Local: usa el .env.local existente.\n');
  process.exitCode = 1;
  throw new Error('Missing Supabase credentials');
}

const { createClient } = await import('@supabase/supabase-js');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ============================================
// 1. TEST DB: RLS post-migración 051
// ============================================
async function testDB() {
  console.log('\n═══════════════════════════════════════');
  console.log('  1. 🗄️  DB — RLS (Row Level Security)');
  console.log('═══════════════════════════════════════\n');

  const tests = [
    {
      n: 1, label: 'Perfiles: email oculto (sin auth)',
      fn: () => supabase.from('profiles').select('id, email, username').limit(10),
      check: (data) => {
        const emails = data?.filter(x => x.email).length || 0;
        return emails === 0 ? { pass: true, msg: '✅ Sin emails visibles (tabla profiles)' }
          : { pass: false, msg: `⚠️  ${emails}/${data?.length} emails visibles en tabla profiles (la vista profiles_public debería resolver esto)` };
      }
    },
    {
      n: '1b', label: 'Perfiles: email en vista profiles_public (sin auth)',
      fn: () => supabase.from('profiles_public').select('id, email, username').limit(10),
      check: (data, err) => {
        const emails = data?.filter(x => x.email).length || 0;
        return emails === 0 ? { pass: true, msg: '✅ Sin emails en la vista' }
          : { pass: false, msg: `⚠️  ${emails}/${data?.length} emails visibles en la vista` };
      }
    },
    {
      n: '1c', label: 'Columna email REVOCADA: SELECT directo falla o no devuelve emails (sin auth)',
      fn: () => supabase.from('profiles').select('email').limit(1),
      check: (data, err) => {
        // Tras migración 053: la columna email está revocada para anon →
        // o da error (permission denied) o devuelve 0 filas con email.
        const emails = data?.filter(x => x.email).length || 0;
        const blocked = !!err || emails === 0;
        return blocked ? { pass: true, msg: '✅ Email inaccesible (revocada)' }
          : { pass: false, msg: '⚠️  Email accesible por SELECT directo' };
      }
    },
    {
      n: '1d', label: 'RPC get_email_by_username bloqueado para anon (migración 054 — anti-scraping)',
      fn: () => supabase.rpc('get_email_by_username', { uname: 'usuario_que_no_existe_xyz' }),
      check: (data, err) => {
        // Tras migración 054 el RPC exige sesión → anon recibe error de permiso.
        // ⚠️ data === null SIN error NO es seguro: significa que anon pudo
        // ejecutar el RPC (respondió 200 null) — la fuga persiste.
        const blocked = !!err;
        return blocked ? { pass: true, msg: '✅ Anon bloqueado (permiso denegado)' }
          : { pass: false, msg: `⚠️  Anon pudo ejecutar el RPC (fuga de emails, respuesta: ${JSON.stringify(data)})` };
      }
    },
    {
      n: '1d2', label: 'RPC bump_hashtag_usage bloqueado para anon (migración 054 — no inflar trending)',
      // ⚠️ Side-effect intencional: si la migración 054 NO está aplicada, este
      // probe crea una fila real '__sec_test_anon__' en hashtags (demuestra el
      // abuso). Con la migración aplicada solo recibe error y no escribe nada.
      fn: () => supabase.rpc('bump_hashtag_usage', { p_name: '__sec_test_anon__' }),
      check: (data, err) => {
        const blocked = !!err;
        return blocked ? { pass: true, msg: '✅ Anon bloqueado (no puede inflar trending)' }
          : { pass: false, msg: '⚠️  Anon pudo inflar hashtags (¡abuso confirmado!)' };
      }
    },
    {
      n: '1d3', label: 'RPC unfollow_both_ways bloqueado para anon (migración 054 — no romper follows)',
      fn: () => supabase.rpc('unfollow_both_ways', { blocker_id: '00000000-0000-0000-0000-000000000000', blocked_id: '00000000-0000-0000-0000-000000000000' }),
      check: (data, err) => {
        const blocked = !!err;
        return blocked ? { pass: true, msg: '✅ Anon bloqueado (no puede des-followear)' }
          : { pass: false, msg: '⚠️  Anon pudo ejecutar unfollow_both_ways (¡abuso confirmado!)' };
      }
    },
    {
      n: '1e', label: 'RPC email_exists existe (registro sin SELECT directo)',
      fn: () => supabase.rpc('email_exists', { addr: 'nadie@example.com' }),
      check: (data, err) => ({ pass: !err, msg: err ? `⚠️  ${err.message}` : '✅ RPC disponible' })
    },
    {
      n: 2, label: 'Posts encriptados: ocultos (sin auth)',
      fn: () => supabase.from('posts').select('id, encrypted_content, is_encrypted').eq('is_encrypted', true).limit(5),
      check: (data) => {
        const count = data?.length || 0;
        return count === 0 ? { pass: true, msg: '✅ 0 posts encriptados visibles (tabla posts)' }
          : { pass: false, msg: `⚠️  ${count} posts encriptados visibles (tabla posts)` };
      }
    },
    {
      n: '2b', label: 'Posts encriptados: vista posts_public (sin auth)',
      fn: () => supabase.from('posts_public').select('id, encrypted_content, is_encrypted').limit(5),
      check: (data) => {
        const encrypted = data?.filter(x => x.is_encrypted).length || 0;
        return encrypted === 0 ? { pass: true, msg: '✅ 0 posts encriptados en la vista' }
          : { pass: false, msg: `⚠️  ${encrypted} posts encriptados en la vista` };
      }
    },
    {
      n: 3, label: 'Conversaciones: protegidas',
      fn: () => supabase.from('conversations').select('*').limit(5),
      check: (d) => ({ pass: !d?.length, msg: !d?.length ? '✅ 0 filas' : `⚠️  ${d.length} visibles` })
    },
    {
      n: 4, label: 'Notificaciones: protegidas',
      fn: () => supabase.from('notifications').select('*').limit(10),
      check: (d) => ({ pass: !d?.length, msg: !d?.length ? '✅ 0 filas' : `⚠️  ${d.length} visibles` })
    },
    {
      n: 5, label: 'Mensajes: protegidos',
      fn: () => supabase.from('messages').select('*').limit(5),
      check: (d) => ({ pass: !d?.length, msg: !d?.length ? '✅ 0 filas' : `⚠️  ${d.length} visibles` })
    },
    {
      n: 6, label: 'INSERT post como otro: bloqueado',
      fn: () => supabase.from('posts').insert({ user_id: '00000000-0000-0000-0000-000000000000', content: 'test' }),
      check: (d, err) => ({ pass: !!err, msg: err ? '✅ RLS violation' : '⚠️  SE INSERTO' })
    },
    {
      n: 7, label: 'UPDATE perfil ajeno: bloqueado',
      fn: () => supabase.from('profiles').update({ bio: 'test' }).eq('id', '00000000-0000-0000-0000-000000000000'),
      check: (d, err) => ({ pass: !d || err, msg: err ? '✅ RLS' : '⚠️  SE ACTUALIZO' })
    },
    {
      n: 8, label: 'DELETE post ajeno: bloqueado',
      fn: () => supabase.from('posts').delete().eq('id', '00000000-0000-0000-0000-000000000000'),
      check: (d, err) => ({ pass: !d || err, msg: err ? '✅ RLS' : '⚠️  SE BORRO' })
    },
    {
      n: 9, label: 'INSERT like ajeno: bloqueado',
      fn: () => supabase.from('likes').insert({ user_id: '00000000-0000-0000-0000-000000000000', post_id: '00000000-0000-0000-0000-000000000000' }),
      check: (d, err) => ({ pass: !!err, msg: err ? '✅ RLS violation' : '⚠️  SE INSERTO' })
    },
    {
      n: 10, label: 'DELETE comment ajeno: bloqueado',
      fn: () => supabase.from('comments').delete().eq('id', '00000000-0000-0000-0000-000000000000'),
      check: (d, err) => ({ pass: !d || err, msg: err ? '✅ RLS' : '⚠️  SE BORRO' })
    },
    {
      n: 11, label: 'Votos de encuestas: protegidos',
      fn: () => supabase.from('poll_votes').select('*').limit(10),
      check: (d) => ({ pass: !d?.length, msg: !d?.length ? '✅ 0 filas' : `⚠️  ${d.length} visibles` })
    },
    {
      n: 12, label: 'Llamadas: protegidas',
      fn: () => supabase.from('calls').select('*').limit(10),
      check: (d) => ({ pass: !d?.length, msg: !d?.length ? '✅ 0 filas' : `⚠️  ${d.length} visibles` })
    },
  ];

  let pass = 0, fail = 0;
  for (const test of tests) {
    const { data, error } = await test.fn();
    const result = test.check(data, error);
    const icon = result.pass ? '✅' : '⚠️ ';
    console.log(`${icon} ${test.n}. ${test.label}: ${result.msg}`);
    if (result.pass) pass++; else fail++;
  }
  return { pass, fail };
}

// ============================================
// 2. TEST DB: Inyección SQL
// ============================================
async function testSQLInjection() {
  console.log('\n═══════════════════════════════════════');
  console.log('  2. 💉 DB — Inyección SQL (API REST)');
  console.log('═══════════════════════════════════════\n');

  const payloads = [
    "' OR '1'='1",
    "'; DROP TABLE profiles; --",
    "' UNION SELECT * FROM auth.users --",
    "1; SELECT pg_sleep(5)",
    "admin'--",
    "\\x27 OR 1=1 --",
  ];

  let pass = 0, fail = 0;
  for (const payload of payloads) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username')
        .eq('username', payload)
        .limit(1);

      // Supabase REST API sanitiza automáticamente → nunca debe ejecutar SQL
      // Si devuelve error o data vacío → seguro
      if (error || !data?.length) {
        console.log(`✅ Payload: "${payload.substring(0, 30)}..." → ${error?.message || '0 resultados'}`);
        pass++;
      } else {
        console.log(`⚠️  Payload: "${payload.substring(0, 30)}..." → ${data.length} resultado(s)`);
        fail++;
      }
    } catch (err) {
      console.log(`✅ Payload: "${payload.substring(0, 30)}..." → error: ${err.message?.substring(0, 60)}`);
      pass++;
    }
  }
  return { pass, fail };
}

// ============================================
// 3. TEST: Sanitización XSS
// ============================================
function testXSS() {
  console.log('\n═══════════════════════════════════════');
  console.log('  3. 🕸️  XSS — Sanitización de contenido');
  console.log('═══════════════════════════════════════\n');

  // Se ejecutan las funciones REALES de producción (importadas arriba):
  // sanitizeContent y sanitizeUrl de helpers.js. Sin simulador local.
  const testCases = [
    // sanitizeContent tests — comportamiento REAL de helpers.js
    { fn: 'sanitizeContent', input: '<script>alert(1)</script>', expect: '' },
    { fn: 'sanitizeContent', input: '<img src=x onerror=alert(1)>', expect: '<img src=x>' },
    { fn: 'sanitizeContent', input: '<a href="javascript:alert(1)">click</a>', expect: '<a href="">click</a>' },
    { fn: 'sanitizeContent', input: '<iframe src="https://evil.com"></iframe>', expect: '' },
    { fn: 'sanitizeContent', input: '<svg onload=alert(1)>', expect: '' },
    { fn: 'sanitizeContent', input: 'javascript:alert(1)', expect: 'alert(1)' },
    { fn: 'sanitizeContent', input: 'Normal text with @mention and #hashtag', expect: 'Normal text with @mention and #hashtag' },
    // sanitizeUrl tests — comportamiento REAL de helpers.js
    { fn: 'sanitizeUrl', input: 'javascript:alert(1)', expect: '' },
    { fn: 'sanitizeUrl', input: 'https://evil.com', expect: 'https://evil.com' },
    { fn: 'sanitizeUrl', input: 'data:text/html,<script>alert(1)</script>', expect: '' },
    { fn: 'sanitizeUrl', input: '/profile/test', expect: '/profile/test' },
    { fn: 'sanitizeUrl', input: ' \u0000javascript:alert(1)', expect: '' },
  ];

  let pass = 0, fail = 0;
  for (const tc of testCases) {
    let result;
    if (tc.fn === 'sanitizeContent') result = sanitizeContent(tc.input);
    else result = sanitizeUrl(tc.input, '');

    if (result === tc.expect) {
      console.log(`✅ ${tc.fn}("${tc.input.substring(0, 30)}...") → "${String(result).substring(0, 30)}"`);
      pass++;
    } else {
      console.log(`⚠️  ${tc.fn}("${tc.input.substring(0, 30)}...") → "${String(result).substring(0, 30)}" (esperado: "${tc.expect}")`);
      fail++;
    }
  }
  return { pass, fail };
}

// ============================================
// 4. TEST: Validaciones Auth
// ============================================
function testAuthValidation() {
  console.log('\n═══════════════════════════════════════');
  console.log('  4. 🔐 Auth — Validaciones del lado cliente');
  console.log('═══════════════════════════════════════\n');

  const testCases = [
    { label: 'Password < 6 chars', password: '12345', expect: false },
    { label: 'Password >= 6 chars', password: '123456', expect: true },
    { label: 'Username con caracteres inválidos', username: 'user name!', expect: false },
    { label: 'Username solo letras/num/_', username: 'user_name123', expect: true },
    { label: 'Username < 3 chars', username: 'ab', expect: false },
    { label: 'Username >= 3 chars', username: 'abc', expect: true },
    // Email — whitelist REAL de proveedores (validateEmail de userService.js)
    { label: 'Email vacío', email: '', expect: false },
    { label: 'Email sin formato', email: 'notanemail', expect: false },
    { label: 'Email sin dominio (user@)', email: 'user@', expect: false },
    { label: 'Email con dominio no permitido (temp)', email: 'user@tempmail.com', expect: false },
    { label: 'Email con dominio inventado', email: 'user@test.com', expect: false },
    { label: 'Gmail permitido', email: 'user@gmail.com', expect: true },
    { label: 'Gmail con mayúsculas (case-insensitive)', email: 'User@GMAIL.COM', expect: true },
    { label: 'Plus-addressing Gmail (user+tag@gmail.com)', email: 'user+tag@gmail.com', expect: true },
    { label: 'Outlook permitido', email: 'user@outlook.com', expect: true },
    { label: 'Outlook regional (outlook.es)', email: 'user@outlook.es', expect: true },
    { label: 'Outlook regional (outlook.com.ar)', email: 'user@outlook.com.ar', expect: true },
    { label: 'Hotmail permitido', email: 'user@hotmail.com', expect: true },
    { label: 'Hotmail regional (hotmail.es)', email: 'user@hotmail.es', expect: true },
    { label: 'Live regional (live.com.ar)', email: 'user@live.com.ar', expect: true },
    { label: 'Yahoo permitido', email: 'user@yahoo.com', expect: true },
    { label: 'Yahoo regional (yahoo.co.uk)', email: 'user@yahoo.co.uk', expect: true },
    { label: 'Proton permitido', email: 'user@proton.me', expect: true },
    { label: 'iCloud permitido', email: 'user@icloud.com', expect: true },
    { label: 'iCloud alias (me.com) permitido', email: 'user@me.com', expect: true },
  ];

  let pass = 0, fail = 0;
  for (const tc of testCases) {
    let valid = true;
    const reasons = [];

    if ('password' in tc) {
      if (tc.password.length < 6) { valid = false; reasons.push('password < 6'); }
    }
    if ('username' in tc) {
      if (!/^[a-zA-Z0-9_]+$/.test(tc.username)) { valid = false; reasons.push('invalid chars'); }
      if (tc.username.length < 3) { valid = false; reasons.push('too short'); }
      if (tc.username.length > 20) { valid = false; reasons.push('too long'); }
    }
    if ('email' in tc) {
      const res = validateEmail(tc.email);
      if (res !== null) { valid = false; reasons.push(res === 'invalid' ? 'formato inválido' : `dominio no permitido (${res})`); }
    }

    if (valid === tc.expect) {
      console.log(`✅ ${tc.label}: ${tc.expect ? 'válido' : 'inválido'} (correcto)`);
      pass++;
    } else {
      console.log(`⚠️  ${tc.label}: esperado ${tc.expect} pero obtuve ${valid} (${reasons.join(', ')})`);
      fail++;
    }
  }
  return { pass, fail };
}

// ============================================
// 5. TEST: Cache localStorage (simulado)
// ============================================
function testCacheSecurity() {
  console.log('\n═══════════════════════════════════════');
  console.log('  5. 💾 Cache — localStorage cifrado');
  console.log('═══════════════════════════════════════\n');

  // Verificar que secureStorage.js usa cifrado XOR
  const securePath = path.resolve(__dirname, '..', 'src/assets/services/secureStorage.js');
  const secureContent = fs.readFileSync(securePath, 'utf-8');

  const checks = [
    { label: 'Usa XOR key', pattern: 'XOR' },
    { label: 'Usa hash de keys', pattern: 'hashKey' },
    { label: 'Keys con prefijo _s', pattern: "STORAGE_PREFIX = '_s'" },
    { label: 'XOR key de 32 bytes', pattern: 'new Uint8Array(32)' },
    { label: 'Almacenamiento cifrado en localStorage', pattern: 'localStorage.setItem' },
    { label: 'Prefijo para sessionStorage', pattern: "SESSION_STORAGE_PREFIX = '_ss'" },
    { label: 'GetItem con decrypt', pattern: 'decrypt(raw, entryName)' },
    { label: 'SetItem con encrypt', pattern: 'encrypt(value, entryName)' },
    { label: 'Clave maestra envuelta en IDB (no cruda)', pattern: 'idbSet(WRAP_KEY_RECORD' },
    { label: 'Wrap key NO extraíble (Web Crypto)', pattern: 'non-extractable' },
    { label: 'Blob cifrado de la clave (AES-GCM)', pattern: 'wrapMasterKey' },
    { label: 'Migración borra clave cruda legacy', pattern: 'idbDelete(KEY_RECORD' },
    { label: 'Salt aleatorio por entrada', pattern: 'crypto.getRandomValues(new Uint8Array(16))' },
    { label: 'Limpieza de fc_* legacy', pattern: "startsWith('fc_')" },
  ];

  let pass = 0, fail = 0;
  for (const check of checks) {
    if (secureContent.includes(check.pattern)) {
      console.log(`✅ ${check.label}`);
      pass++;
    } else {
      console.log(`⚠️  ${check.label}: no encontrado`);
      fail++;
    }
  }
  return { pass, fail };
}

// ============================================
// 6. TEST: CSP + superficie XSS
// ============================================
function testWebSecurity() {
  console.log('\n═══════════════════════════════════════');
  console.log('  6. 🌐 Web — CSP y superficie XSS');
  console.log('═══════════════════════════════════════\n');

  const root = path.resolve(__dirname, '..');
  const cspPluginPath = path.join(root, 'plugins', 'cspPlugin.js');
  const cspPlugin = fs.existsSync(cspPluginPath) ? fs.readFileSync(cspPluginPath, 'utf-8') : '';
  const vercelPath = path.join(root, 'vercel.json');
  const vercelJson = fs.existsSync(vercelPath) ? fs.readFileSync(vercelPath, 'utf-8') : '';
  const supabaseClientPath = path.join(root, 'src', 'assets', 'services', 'supabaseclient.js');
  const supabaseClient = fs.existsSync(supabaseClientPath) ? fs.readFileSync(supabaseClientPath, 'utf-8') : '';
  const userServicePath = path.join(root, 'src', 'assets', 'services', 'userService.js');
  const userService = fs.existsSync(userServicePath) ? fs.readFileSync(userServicePath, 'utf-8') : '';
  const loginPath = path.join(root, 'src', 'assets', 'Pages', 'Sing', 'Login.jsx');
  const loginContent = fs.existsSync(loginPath) ? fs.readFileSync(loginPath, 'utf-8') : '';
  const serverPath = path.join(root, 'server.js');
  const serverContent = fs.existsSync(serverPath) ? fs.readFileSync(serverPath, 'utf-8') : '';

  const checks = [
    { label: 'Plugin CSP existe', pattern: "name: 'inject-csp'", file: cspPlugin },
    { label: 'CSP solo en build (no rompe dev HMR)', pattern: "apply: 'build'", file: cspPlugin },
    { label: 'script-src SIN unsafe-eval/inline', pattern: "script-src 'self' https://challenges.cloudflare.com", file: cspPlugin },
    { label: 'connect-src cubre túneles música (ngrok)', pattern: '*.ngrok-free.app', file: cspPlugin },
    { label: 'connect-src cubre cloudflared', pattern: '*.trycloudflare.com', file: cspPlugin },
    { label: 'connect-src cubre LiveKit', pattern: '*.livekit.cloud', file: cspPlugin },
    { label: 'connect-src cubre Supabase Realtime (wss)', pattern: 'wss://', file: cspPlugin },
    { label: 'frame-src cubre Turnstile', pattern: 'https://challenges.cloudflare.com', file: cspPlugin },
    { label: 'object-src none (bloquea plugins/flash)', pattern: "object-src 'none'", file: cspPlugin },
    { label: 'X-Frame-Options DENY (anti clickjacking)', pattern: 'X-Frame-Options', file: vercelJson },
    { label: 'X-Content-Type-Options nosniff', pattern: 'X-Content-Type-Options', file: vercelJson },
    { label: 'Referrer-Policy strict', pattern: 'strict-origin-when-cross-origin', file: vercelJson },
    { label: 'HSTS en vercel.json', pattern: 'Strict-Transport-Security', file: vercelJson },
    { label: 'Permissions-Policy en vercel.json', pattern: 'Permissions-Policy', file: vercelJson },
    { label: '__supabase SOLO en DEV (import.meta.env.DEV)', pattern: 'import.meta.env.DEV', file: supabaseClient },
    { label: 'getEmailByUsername via RPC (sin SELECT email)', pattern: "rpc('get_email_by_username'", file: userService },
    { label: 'checkEmailExists via RPC (sin SELECT email)', pattern: "rpc('email_exists'", file: userService },
    { label: 'getUserProfile sin select("*") (columna email revocada)', pattern: 'PROFILE_PUBLIC_COLUMNS', file: userService },
    { label: 'Login NO bloquea dominio (solo formato — cuentas legacy)', pattern: 'validateEmail(emailOrUsername) === \'invalid\'', file: loginContent },
  ];

  let pass = 0, fail = 0;
  for (const check of checks) {
    if (check.file.includes(check.pattern)) {
      console.log(`✅ ${check.label}`);
      pass++;
    } else {
      console.log(`⚠️  ${check.label}: no encontrado`);
      fail++;
    }
  }

  // Check NEGATIVO: la directiva script-src del CÓDIGO no debe contener
  // unsafe-eval/unsafe-inline. (style-src sí usa unsafe-inline — obligatorio —
  // pero script-src no.) Se extrae la línea literal del array (con comillas)
  // para no capturar comentarios del archivo que mencionen esos tokens.
  const scriptSrcLine = cspPlugin.split('\n').find((l) => l.includes('"script-src'));
  if (
    scriptSrcLine &&
    !scriptSrcLine.includes("'unsafe-eval'") &&
    !scriptSrcLine.includes("'unsafe-inline'") &&
    scriptSrcLine.includes("https://challenges.cloudflare.com")
  ) {
    console.log('✅ script-src sin unsafe-eval ni unsafe-inline (check negativo)');
    pass++;
  } else {
    console.log('⚠️  script-src contiene unsafe-eval o unsafe-inline (¡NO permitido!)');
    fail++;
  }

  // Check NEGATIVO (CSP): vercel.json/server.js NO deben enviar header CSP
  // HTTP. Según la spec CSP, si existe un header CSP, el navegador IGNORA la
  // meta CSP del HTML (que lleva la política completa) → se desactiva todo.
  // El header solo serviría para romper la protección. X-Frame-Options: DENY
  // ya cubre el clickjacking.
  const noHttpCspHeader =
    !/"key"\s*:\s*"Content-Security-Policy"/i.test(vercelJson) &&
    !/setHeader\s*\(\s*['"]Content-Security-Policy/i.test(serverContent);
  if (noHttpCspHeader) {
    console.log('✅ NO header CSP HTTP (la meta CSP del HTML manda — sin shadowing)');
    pass++;
  } else {
    console.log('⚠️  Se encontró header CSP HTTP → sombrea/ignora la meta CSP (¡desactiva la protección!)');
    fail++;
  }

  // Check NEGATIVO: el login NO debe rechazar por dominio (bloquearía cuentas
  // legacy registradas antes de la whitelist con dominios fuera de la lista).
  if (loginContent.includes('email_domain_not_allowed')) {
    console.log('⚠️  Login usa el error de dominio — cuentas legacy quedarían fuera (¡NO permitido!)');
    fail++;
  } else {
    console.log('✅ Login solo valida formato de email (sin bloqueo por dominio)');
    pass++;
  }

  return { pass, fail };
}

// ============================================
// MAIN
// ============================================
console.log('\n▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
console.log('▓               🛡️  AUDITORÍA DE SEGURIDAD              ▓');
console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');

const results = {};
results.db = await testDB();
results.sql = await testSQLInjection();
results.xss = testXSS();
results.auth = testAuthValidation();
results.cache = testCacheSecurity();
results.web = testWebSecurity();

// ============================================
// RESUMEN
// ============================================
console.log('\n═══════════════════════════════════════');
console.log('  📊  RESUMEN FINAL');
console.log('═══════════════════════════════════════\n');

const total = { pass: 0, fail: 0 };
for (const [area, res] of Object.entries(results)) {
  const pct = ((res.pass / (res.pass + res.fail)) * 100).toFixed(0);
  console.log(`${area.toUpperCase()}: ${res.pass}/${res.pass + res.fail} (${pct}%)`);
  total.pass += res.pass;
  total.fail += res.fail;
}

const totalPct = ((total.pass / (total.pass + total.fail)) * 100).toFixed(0);
console.log(`\n🏁  TOTAL: ${total.pass}/${total.pass + total.fail} (${totalPct}%)`);
if (total.fail === 0) {
  console.log('🎉  TODAS LAS PRUEBAS PASARON');
} else {
  console.log(`⚠️  ${total.fail} PRUEBA(S) FALLARON — REVISAR`);
}
// process.exitCode (no process.exit) para que Node flushee el stdout en CI
// y el resumen final nunca se pierda del log.
process.exitCode = total.fail > 0 ? 1 : 0;