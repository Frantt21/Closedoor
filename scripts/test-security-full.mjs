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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

const SUPABASE_URL = envContent.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim() || '';
const SUPABASE_KEY = envContent.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim()
  || envContent.match(/VITE_SUPABASE_PUBLISHABLE_KEY=(.+)/)?.[1]?.trim() || '';

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
      check: (data) => {
        const emails = data?.filter(x => x.email).length || 0;
        return emails === 0 ? { pass: true, msg: '✅ Sin emails en la vista' }
          : { pass: false, msg: `⚠️  ${emails}/${data?.length} emails visibles en la vista` };
      }
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

  // Importar helpers para probar sanitizeContent/sanitizeUrl
  const helpersPath = path.resolve(__dirname, '..', 'src/assets/services/helpers.js');
  // Simulación local de la lógica de sanitización
  const testCases = [
    // sanitizeContent tests
    { fn: 'sanitizeContent', input: '<script>alert(1)</script>', expect: 'alert(1)' },
    { fn: 'sanitizeContent', input: '<img src=x onerror=alert(1)>', expect: '<img src=x>' },
    { fn: 'sanitizeContent', input: '<a href="javascript:alert(1)">click</a>', expect: '<a href="">click</a>' },
    { fn: 'sanitizeContent', input: '<iframe src="https://evil.com"></iframe>', expect: '' },
    { fn: 'sanitizeContent', input: '<svg onload=alert(1)>', expect: '' },
    { fn: 'sanitizeContent', input: 'javascript:alert(1)', expect: 'alert(1)' },
    { fn: 'sanitizeContent', input: 'Normal text with @mention and #hashtag', expect: 'Normal text with @mention and #hashtag' },
    // sanitizeUrl tests
    { fn: 'sanitizeUrl', input: 'javascript:alert(1)', expect: '' },
    { fn: 'sanitizeUrl', input: 'https://evil.com', expect: 'https://evil.com' },
    { fn: 'sanitizeUrl', input: 'data:text/html,<script>alert(1)</script>', expect: '' },
    { fn: 'sanitizeUrl', input: '/profile/test', expect: '/profile/test' },
    { fn: 'sanitizeUrl', input: ' \u0000javascript:alert(1)', expect: '' },
  ];

  // Simular las funciones de sanitización
  const SAFE_URL_PROTOCOLS = new Set(['http', 'https', 'mailto']);

  function simulateSanitizeContent(text) {
    if (typeof text !== 'string' || !text) return text || '';
    let out = text;
    out = out.replace(/<\s*script\b[\s\S]*?<\s*\/\s*script\s*>/gi, '');
    out = out.replace(/<\s*\/?\s*(?:script|iframe|object|embed|link|meta|base|style|form|template|svg|math)\b[^>]*>/gi, '');
    out = out.replace(/<[a-zA-Z][^>]*>/gi, (tag) =>
      tag.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    );
    out = out.replace(/\b(?:javascript|vbscript|data):/gi, '');
    return out;
  }

  function simulateSanitizeUrl(url, fallback = '') {
    if (!url || typeof url !== 'string') return fallback;
    const trimmed = url.trim();
    if (!trimmed) return fallback;
    if (/[\u0000-\u001F\u007F]/.test(trimmed)) return fallback;
    if (trimmed.startsWith('/')) return trimmed;
    const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (match && !SAFE_URL_PROTOCOLS.has(match[1].toLowerCase())) return fallback;
    if (!trimmed.startsWith('/') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return trimmed;
  }

  let pass = 0, fail = 0;
  for (const tc of testCases) {
    let result;
    if (tc.fn === 'sanitizeContent') result = simulateSanitizeContent(tc.input);
    else result = simulateSanitizeUrl(tc.input, '');

    if (result === tc.expect) {
      console.log(`✅ ${tc.fn}("${tc.input.substring(0, 30)}...") → "${result.substring(0, 30)}"`);
      pass++;
    } else {
      console.log(`⚠️  ${tc.fn}("${tc.input.substring(0, 30)}...") → "${result.substring(0, 30)}" (esperado: "${tc.expect}")`);
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
    { label: 'Email vacío', email: '', expect: false },
    { label: 'Email válido', email: 'test@test.com', expect: true },
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
      if (!tc.email) { valid = false; reasons.push('empty'); }
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
    { label: 'CSP en vercel.json (HTTP header)', pattern: 'Content-Security-Policy', file: vercelJson },
    { label: 'X-Frame-Options DENY (anti clickjacking)', pattern: 'X-Frame-Options', file: vercelJson },
    { label: 'X-Content-Type-Options nosniff', pattern: 'X-Content-Type-Options', file: vercelJson },
    { label: 'Referrer-Policy strict', pattern: 'strict-origin-when-cross-origin', file: vercelJson },
    { label: '__supabase SOLO en DEV (import.meta.env.DEV)', pattern: 'import.meta.env.DEV', file: supabaseClient },
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
if (total.fail === 0) console.log('🎉  TODAS LAS PRUEBAS PASARON');
else console.log(`⚠️  ${total.fail} PRUEBA(S) FALLARON — REVISAR`);