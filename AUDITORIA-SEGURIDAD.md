# 🛡️ Auditoría y Endurecimiento de Seguridad — FastChange

**Fecha:** Agosto 2026
**Estado final:** Auditoría **96/96 (100%)** ✅ — TODAS las pruebas pasan

---

## 📊 Resumen ejecutivo

Se realizó una auditoría de seguridad integral (DB + cliente + servidor) y se corrigieron
**3 vulnerabilidades reales** y varios puntos débiles. La suite de pruebas
(`scripts/test-security-full.mjs`) pasó de **66/69** a **96/96 (100%)**.

| Área | Resultado |
|---|---|
| DB (RLS, columnas, RPCs, tablas sociales) | 27/27 ✅ |
| SQL Injection (API REST) | 6/6 ✅ |
| XSS (helpers reales) | 12/12 ✅ |
| Auth (validaciones, whitelist de email) | 25/25 ✅ |
| Cache (storage cifrado) | 14/14 ✅ |
| Web (CSP, headers, superficie XSS) | 22/22 ✅ |

---

## 🔴 Vulnerabilidades corregidas (reales)

### 1. Emails visibles en la tabla `profiles` (crítica)

**Problema:** Cualquiera con la anon key podía hacer `SELECT id, email, username FROM profiles`
y ver **todos los emails** de la base. RLS trabaja a nivel de *fila*, no de *columna*, así que
la política no protegía el email.

**Solución (migración 053 v2, `src/assets/services/migrations/053_revoke_email_column.sql`):**
- `REVOKE ALL ON public.profiles FROM anon, authenticated` — elimina cualquier grant previo
  (el REVOKE de columna simple de la v1 no surtió efecto en Supabase).
- Grants explícitos **por columna** con lo que la app necesita:
  - `SELECT`: las 52 columnas públicas (**sin email**)
  - `INSERT`: `id, email, username, displayname, created_at` (email solo **escribible** al registrarse)
  - `UPDATE`: las 52 columnas públicas (sin email)
  - `DELETE`: tabla completa (RLS controla filas)
- El email solo se LEE vía **RPCs `SECURITY DEFINER`** (login por username y check de registro):
  - `get_email_by_username(uname)` → `text`
  - `email_exists(addr)` → `boolean`
  - Corren con permisos del definer, `SET search_path = public`, devuelven solo `text|boolean`,
    nunca la tabla completa.

**Verificación directa (anon key, sin sesión):**

| Consulta | Antes | Después |
|---|---|---|
| `select=email` | 200 → devolvía el email | **401 permission denied** ✅ |
| `select=id,email,username` | 200 → devolvía todo | **401 permission denied** ✅ |
| `select=id,username,avatar_url` | 200 | 200 ✅ (app intacta) |

**Frontend (`userService.js`, `AuthContext.jsx`):**
- `getEmailByUsername` y `checkEmailExists` → ahora usan las RPCs.
- `getUserProfile`, `refreshProfile`, `createUserProfile` → selects explícitos con
  `PROFILE_PUBLIC_COLUMNS` (52 columnas reales, sin email). Se corrigió de paso
  `profile_card_visibility` → `badges_visibility` y se añadieron columnas que faltaban.

---

### 2. Token de sesión en la URL (OAuth con Discord)

**Problema:** supabase-js usa `flowType: 'implicit'` por defecto → durante el login con Discord,
el `access_token` y `refresh_token` viajaban en el **hash de la URL** (`#access_token=...`),
quedando en el historial del navegador y pudiendo filtrarse por `Referrer`.

**Solución:**
- `src/assets/services/supabaseclient.js` → `auth.flowType: 'pkce'`.
  Con PKCE en la URL solo va un `code` de un solo uso; el token se intercambia en segundo plano.
- `src/assets/Pages/AuthCallback.jsx` → corrección defensiva: si `exchangeCodeForSession` falla
  (code ya consumido por el auto-exchange de supabase-js), ahora **re-consulta la sesión** antes
  de mostrar error — evita un falso "Login failed" tras un login exitoso.
- El login con password no se ve afectado.

---

### 3. Header CSP HTTP anulaba la meta CSP (regresión detectada en review)

**Problema:** `vercel.json` enviaba `Content-Security-Policy: frame-ancestors 'none'` como header
HTTP. Según la spec CSP, **si existe un header CSP, el navegador IGNORA la meta CSP** del HTML
(que lleva la política completa: script-src, connect-src, object-src, etc.). ¡Era una regresión
que desactivaba toda la protección XSS!

**Solución:** Eliminado el header CSP de `vercel.json` y de `server.js`.
`X-Frame-Options: DENY` ya cubre el clickjacking. La meta CSP (inyectada por
`plugins/cspPlugin.js` solo en build) sigue siendo la única fuente de la política.

---

## 🟡 Endurecimiento aplicado

### 4. CSP estricta (defensa contra XSS)

**`plugins/cspPlugin.js`** (nuevo) — inyecta la meta CSP **solo en build de producción**
(`apply: 'build'`), sin romper el dev server con HMR:

| Directiva | Configuración |
|---|---|
| `script-src` | `'self'` + `https://challenges.cloudflare.com` — **sin `unsafe-inline` ni `unsafe-eval`** |
| `connect-src` | Supabase (REST + Realtime `wss://`), iTunes, Klipy, Turnstile, túneles dinámicos (`*.ngrok-free.app`, `*.trycloudflare.com`), LiveKit (`*.livekit.cloud`) |
| `style-src` | `'self'` + `'unsafe-inline'` (obligatorio: inlineCssPlugin + estilos inline de React) |
| `frame-src` | Turnstile + YouTube + Vimeo |
| `worker-src` `'self'` · `object-src 'none'` · `base-uri 'self'` · `form-action 'self'` | — |

### 5. `window.__supabase` restringido a DEV

En `src/assets/services/supabaseclient.js` el global solo se expone con `import.meta.env.DEV`.
En producción ya no existe un global que un script inyectado pudiera usar para leer la sesión.

### 6. Cache de LinkPreview cifrado

`src/assets/Resources/Components/LinkPreview.jsx` — el cache de OG tags (`og_cache_*`) pasó de
`sessionStorage` crudo a `getSessionItem`/`setSessionItem` de `secureStorage` (cifrado + key
hasheada), consistente con el resto del storage.

### 7. Headers de seguridad en `server.js` y `vercel.json`

La app **no usa cookies** (la sesión vive en localStorage cifrado vía el adapter), así que los
flags `Secure`/`SameSite` no aplican. Se añadió el resto del hardening:

| Header | server.js | vercel.json |
|---|---|---|
| `X-Frame-Options: DENY` | ✅ | ✅ |
| `X-Content-Type-Options: nosniff` | ✅ | ✅ |
| `Referrer-Policy: strict-origin-when-cross-origin` | ✅ | ✅ |
| `Strict-Transport-Security` | ✅ (solo HTTPS) | ✅ `max-age=31536000; includeSubDomains; preload` |
| `Permissions-Policy` | — | ✅ `camera=(self), microphone=(self), notifications=(self), geolocation=(), interest-cohort=()` |
| Header CSP HTTP | ❌ (a propósito) | ❌ (a propósito) |

`Permissions-Policy` permite micrófono/cámara/notificaciones para `self` porque LiveKit captura
audio desde el documento principal (no desde un iframe). Geolocalización y FLoC bloqueados.

### 8. `sanitizeContent` mejorado (`helpers.js`)

Ahora **vacía por completo** los atributos `href`/`src`/`action`/`formaction` con protocolos
peligrosos, y el orden de pasos garantiza que el vaciado ocurra antes de la neutralización en
texto plano:

```
<a href="javascript:alert(1)">click</a>  →  <a href="">click</a>
<script>alert(1)</script>                 →  ""  (bloque completo eliminado)
<img src=x onerror=alert(1)>              →  <img src=x>
```

---

### 9. RPCs blindados contra anon (migración 054 — auditoría en vivo)

**Problema (detectado atacando `app.foranly.space` con la anon key, sin sesión):**

| RPC | Vulnerabilidad | Evidencia |
|---|---|---|
| `bump_hashtag_usage` | `SECURITY DEFINER` sin `REVOKE` → Supabase da `EXECUTE PUBLIC` por defecto. Cualquiera **creaba hashtags** y podía inflar el trending infinitamente | `bump('audtest_xxx')` creó el hashtag real en la DB (`use_count:1`) |
| `unfollow_both_ways` | Idem: sin sesión, conociendo dos UUIDs **des-seguía a cualquier par de usuarios** | Respuesta `204` sin sesión |
| `get_email_by_username` | `SECURITY DEFINER` con `GRANT` a `anon` — **fuga de emails** por enumeración de usernames | `get_email_by_username('orlndku')` → email real sin sesión |

**Solución (`src/assets/services/migrations/054_secure_rpcs.sql`):**
- `bump_hashtag_usage` → `REVOKE PUBLIC` + exige `auth.uid()` (solo usuarios logueados crean posts con hashtags).
- `unfollow_both_ways` → `REVOKE PUBLIC` + exige `auth.uid() = blocker_id` (solo el que bloquea des-followea).
- `get_email_by_username` → `REVOKE` de `anon`, solo `authenticated`. **El login por username deja de funcionar para anon** (trade-off aceptado para matar el scraping de emails).
- Frontend: `AuthContext.login` ahora muestra "Login with username is no longer available — use your email address" y el placeholder de login pasó a solo "Email" en los 5 idiomas.

**El test de seguridad ahora EXIGE estos bloqueos** (checks `1d`, `1d2`, `1d3`): si la migración no está aplicada, la auditoría baja de 100% y el CI bloquea el merge.

### 10. Tablas de interacción social sin RLS (auditoría en vivo — migración 055)

**Problema (detectado atacando `app.foranly.space` con la anon key, sin sesión):**

| Tabla | Vulnerabilidad | Evidencia |
|---|---|---|
| `likes` | **Sin RLS habilitado** → 10+ filas con user_ids + post_ids | 200 con datos reales |
| `comments` | **Sin RLS habilitado** → user_id, content, post_id, image_url | 200 con contenido completo |
| `follows` | **Sin RLS habilitado** → follower_id, following_id, status | 200 con grafo social |
| `reposts` | Solo INSERT policy, **sin SELECT restriction** | 200 con user_ids |
| `dislikes` | Policy "Anyone can read" → user_ids expuestos | 200 con datos |
| `comment_likes` | Policy "Anyone can view" → user_ids expuestos | 200 con datos |
| `comment_dislikes` | Policy "Anyone can view" → user_ids expuestos | 200 con datos |
| `posts_public` | Incluía `allowed_users` en la vista | Columna visible |
| `posts` (raw) | SELECT accesible con anon (debería ser solo la vista) | 25 columnas |
| `profiles` (raw) | SELECT accesible con anon (debería ser solo la vista) | Accesible |

**Solución (`src/assets/services/migrations/055_hardening_table_access.sql`):**
- `likes` → Enable RLS + SELECT solo `authenticated` (oculta grafo social de anon)
- `comments` → Enable RLS + SELECT público (contenido visible), escritura solo `authenticated`
- `follows` → Enable RLS + SELECT solo los involucrados (`follower_id = auth.uid() OR following_id = auth.uid()`)
- `reposts` → SELECT solo `authenticated`
- `dislikes`, `comment_likes`, `comment_dislikes` → SELECT solo `authenticated`
- `posts_public` → `allowed_users` eliminado de la vista
- `REVOKE SELECT` en `posts` y `profiles` (raw tables) → acceso solo a través de las vistas

**El test de seguridad ahora EXIGE estos bloqueos** (checks `1f`–`1p`): si la migración no está aplicada, 8 checks fallan y la auditoría baja de 100%.

---

### 11. Whitelist de proveedores de email (registro y login)

**Problema:** como la verificación de email está deshabilitada en Supabase, cualquiera podía
crear una cuenta con un correo falso/desechable (`user@tempmail.com`, dominios inventados, etc.).

**Solución (nuevo módulo puro `src/assets/services/emailValidation.js`):**
- Whitelist de proveedores principales + variantes regionales:
  - **Google:** `gmail.com`, `googlemail.com`
  - **Microsoft:** `outlook.com` (+ `.es`, `.com.ar`, `.com.br`, `.com.mx`), `hotmail.com`
    (+ `.es`, `.com.br`, `.co.uk`, `.fr`), `live.com` (+ `.com.ar`, `.com.br`, `.com.mx`)
  - **Yahoo:** `yahoo.com` (+ `.com.ar`, `.com.mx`, `.com.es`, `.com.br`, `.co.uk`, `.ca`, `.co.in`)
  - **Proton:** `proton.me`, `protonmail.com`
  - **Apple:** `icloud.com`, `me.com`
- `validateEmail(email)` → `'invalid'` (formato) | `'domain'` (fuera de whitelist) | `null` (válido)
- Case-insensitive, tolera espacios al inicio/fin y plus-addressing (`user+tag@gmail.com`).
- Módulo **puro sin imports** → el test de CI lo importa directamente (mismo motivo que helpers.js).
  `userService.js` re-exporta todo para que la app no cambie de API.

**Aplicación:**
- **Registro (`Register.jsx` + `AuthContext.register`):** bloquea formato inválido Y dominio fuera
  de la whitelist — evita cuentas basura nuevas.
- **Login (`Login.jsx` + `AuthContext.login`):** valida **solo el formato** (nunca el dominio).
  ⚠️ Decisión importante: hay cuentas *legacy* registradas antes de la whitelist con otros
  dominios (la verificación de email estaba deshabilitada). Bloquear el dominio en el login las
  dejaría fuera para siempre. El check negativo del test lo vigila.
- Mensajes localizados en los 5 idiomas (`auth.email_invalid`, `auth.email_domain_not_allowed`).

---

## 🧪 El test de seguridad

**`scripts/test-security-full.mjs`** — auditoría completa. Ejecutar con:

```bash
node scripts/test-security-full.mjs
```

**Mejora clave:** la sección XSS ahora importa y ejecuta las **funciones REALES de producción**
(`sanitizeContent`, `sanitizeUrl` de `helpers.js`) en vez de un simulador local que divergía.
Esto eliminó los últimos 2 falsos positivos.

### Qué prueba cada sección

- **DB (17):** RLS en perfiles/posts/conversaciones/notificaciones/mensajes/votos/llamadas,
  email oculto y revocado, RPCs disponibles, UPDATE/DELETE/INSERT de entidades ajenas bloqueados.
- **SQL (6):** payloads de inyección contra la API REST (parámetros `eq`).
- **XSS (12):** sanitización real de contenido y URLs (script, eventos, iframe, svg, protocolos).
- **AUTH (25):** password, username, y email con la **whitelist real** (`validateEmail` de
  `emailValidation.js`): dominios permitidos (incl. variantes regionales), case-insensitive,
  plus-addressing, y bloqueo de dominios basura (tempmail, inventados).
- **CACHE (14):** secureStorage usa XOR + salt + hash de keys + wrap key no extraíble en IDB.
- **WEB (22):** CSP en build (sin unsafe-eval/inline), cobertura de túneles/LiveKit/Realtime,
  headers (sin header CSP HTTP), RPCs, `__supabase` solo DEV, y check negativo de que el
  login NO bloquea por dominio (cuentas legacy).

### Resultado final

```
DB: 27/27 (100%)   SQL: 6/6 (100%)   XSS: 12/12 (100%)
AUTH: 25/25 (100%)   CACHE: 14/14 (100%)   WEB: 22/22 (100%)

🏁 TOTAL: 106/106 (100%)
🎉 TODAS LAS PRUEBAS PASARON
```

---

## 🤖 CI: la auditoría nunca puede bajar de 100%

**`.github/workflows/security-audit.yml`** (nuevo) — ejecuta la auditoría en cada push/PR a `main`:

1. `npm ci` (dependencias desde el lockfile)
2. Pre-flight check de secrets (mensaje claro si faltan — los PR desde forks no reciben secrets y fallan con un aviso explícito, no con un cascadón de 401)
3. `node scripts/test-security-full.mjs` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` desde **GitHub Secrets**
4. `npx vite build` (verifica que el build y la meta CSP sigan generándose)
5. `timeout-minutes: 15` para que un test colgado falle rápido

**Cambios necesarios en el test para que funcione en CI:**
- `scripts/test-security-full.mjs` ahora **sale con exit code 1 si hay CUALQUIER fallo** (antes solo imprimía el aviso y el CI habría pasado igual).
- Acepta credenciales desde `process.env` (GitHub Secrets) con fallback a `.env.local` — verificado en CI-mode: 77/77 con exit 0 usando solo env vars.

**Setup en GitHub (una vez):**

```
Settings → Secrets and variables → Actions → New repository secret
  VITE_SUPABASE_URL       → https://xxxx.supabase.co
  VITE_SUPABASE_ANON_KEY  → la anon key pública
```

A partir de ahí, cualquier push que rompa una prueba de seguridad **bloquea el merge** con el badge ✗ en el PR.

---

## 🗂️ Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/assets/services/migrations/053_revoke_email_column.sql` | REVOKE ALL + grants por columna + RPCs SECURITY DEFINER |
| `src/assets/services/emailValidation.js` | **Nuevo** — whitelist de proveedores + `validateEmail` (módulo puro) |
| `src/assets/services/userService.js` | RPCs para email, `PROFILE_PUBLIC_COLUMNS` (52 cols), re-export de emailValidation |
| `src/context/AuthContext.jsx` | `refreshProfile` sin `select('*')`, `waitForKeyReady()`, validación de email en login/register |
| `src/assets/Pages/Sing/Register.jsx` | Bloquea email inválido o fuera de la whitelist (mensaje localizado) |
| `src/assets/Pages/Sing/Login.jsx` | Valida solo formato de email (nunca dominio — cuentas legacy) |
| `src/assets/services/i18n/locales/*.json` | Keys `auth.email_invalid` y `auth.email_domain_not_allowed` en los 5 idiomas |
| `src/assets/services/supabaseclient.js` | `flowType:'pkce'`, `__supabase` solo DEV, storage cifrado |
| `src/assets/Pages/AuthCallback.jsx` | Re-consulta de sesión tras fallo de exchange |
| `src/assets/Resources/Components/LinkPreview.jsx` | Cache en sessionStorage cifrado |
| `src/assets/services/helpers.js` | `sanitizeContent` vacía href/src peligrosos |
| `plugins/cspPlugin.js` | **Nuevo** — inyecta meta CSP en build |
| `vite.config.js` | Registra cspPlugin |
| `vercel.json` | HSTS, Permissions-Policy, sin header CSP |
| `server.js` | Middleware de security headers (sin header CSP) |
| `src/assets/services/migrations/055_hardening_table_access.sql` | **Nuevo** — RLS en likes/comments/follows/reposts/dislikes, REVOKE raw tables, fix posts_public |
| `scripts/test-security-full.mjs` | Usa helpers reales, checks negativos CSP, exit 1 si falla, env vars de CI, 10 nuevos checks DB |
| `.github/workflows/security-audit.yml` | **Nuevo** — auditoría en cada push/PR (exige 100%) |

---

## 🔒 Arquitectura de seguridad del cliente (cómo queda)

```
localStorage/sessionStorage (datos cifrados XOR + salt por entrada)
        ▲
        │  secureStorage.js (getItem/setItem → cifrar/descifrar)
        │  clave por entrada = SHA-256(masterKey ‖ salt)
        │
   Master key (32B CSPRNG) ── SOLO EN MEMORIA ──┐
        │                                       │
        └── envuelta con AES-GCM ──► CryptoKey no-extraíble (IndexedDB)
                                          (extractable: false → no se exporta)

Token de sesión:  localStorage cifrado  →  se descifra solo en memoria al cargar
                  flujo OAuth: PKCE (nunca en la URL)
```

**Limitaciones aceptadas (documentadas en `secureStorage.js`):**
- No protege contra XSS activo del mismo origen (un script inyectado puede llamar las APIs del app
  para descifrar en runtime). Ningún esquema client-side puede evitarlo por completo.
- Si se borra el IndexedDB/datos del sitio, la key envuelta se pierde → el usuario debe
  re-loguearse una vez. Es el precio aceptado del nivel de seguridad.

---

## 🚀 Para producción

1. Aplicar la migración **053 v2** en Supabase (SQL Editor) si no está aplicada
   (también disponible en `migracion-053-email.md`).
2. Aplicar la migración **055** en Supabase (SQL Editor) — RLS en tablas de interacción social.
3. Redeploy en Vercel (headers + meta CSP del build).
4. El PKCE aplica al próximo login con Discord (no rompe sesiones existentes).
5. Re-ejecutar `node scripts/test-security-full.mjs` tras cualquier cambio de seguridad.
