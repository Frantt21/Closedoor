# 🛡️ Pruebas de Seguridad DB — FastChange

## Cómo usar

1. Abre **DevTools** (F12) → pestaña **Console**
2. Pega **el script de carga de supabase** (una sola vez):

```js
// Pega esto UNA VEZ al inicio de la sesión:
const { supabase } = await import('/src/assets/services/supabaseclient.js');
```

3. Luego pega cualquier script de prueba **uno por uno** y presiona Enter
4. Observa la respuesta. Si ves `error: { code: "...", message: "new row violates row-level security..." }` o `{ error: { message: "permission denied for table..." } }` → **RLS funciona correctamente** ✅
5. Si ves datos devueltos o la operación se completa sin error → **⚠️ RLS está fallando** en esa tabla

### 🚀 Script de prueba rápida (todo en uno)

Si quieres hacer una prueba rápida sin tener que pegar 15 scripts, usa este:

```js
const { supabase } = await import('/src/assets/services/supabaseclient.js');

console.log('=== 🛡️ PRUEBA RÁPIDA DE SEGURIDAD DB ===');

// 1. Leer perfiles con email
const { data: p, error: e1 } = await supabase
  .from('profiles').select('id, email, username').limit(5);
console.log('📋 Perfiles (email visible?):', p?.map(x => ({ user: x.username, email: x.email })), e1);

// 2. Leer posts encriptados ajenos
const { data: ep, error: e2 } = await supabase
  .from('posts').select('id, encrypted_content, is_encrypted')
  .eq('is_encrypted', true).limit(5);
console.log('📋 Posts encriptados:', ep, e2);

// 3. Leer conversaciones ajenas
const { data: cv, error: e3 } = await supabase
  .from('conversations').select('*').limit(5);
console.log('📋 Conversaciones ajenas:', cv, e3);

// 4. Leer notificaciones ajenas
const { data: n, error: e4 } = await supabase
  .from('notifications').select('*').limit(10);
console.log('📋 Notificaciones ajenas:', n, e4);

// 5. Leer mensajes ajenos
const { data: m, error: e5 } = await supabase
  .from('messages').select('*').limit(5);
console.log('📋 Mensajes ajenos:', m, e5);

// 6. Intentar publicar como otro usuario
const { data: ins, error: e6 } = await supabase
  .from('posts').insert({ user_id: '00000000-0000-0000-0000-000000000000', content: 'Hackeado!' });
console.log('📋 Insert post como otro:', e6?.message || '⚠️ SE INSERTO!');

console.log('=== FIN ===');
```

---

## 🟢 Nivel 1: Lectura de datos ajenos

### 1.1 Leer perfiles que no deberías ver
```js
// Intenta leer perfiles con datos sensibles (email)
const { data, error } = await supabase
  .from('profiles')
  .select('id, email, username, bio, avatar_url')
  .limit(5);
console.log('📋 Perfiles:', data, error);
// ✅ Debe devolver SOLO perfiles públicos, sin email
// ⚠️ Si ves emails de otros usuarios → RLS en profiles SELECT está mal!
```

### 1.2 Leer posts encriptados sin permiso
```js
// Busca posts encriptados que no te pertenecen
const { data, error } = await supabase
  .from('posts')
  .select('id, content, encrypted_content, is_encrypted, allowed_users')
  .eq('is_encrypted', true)
  .limit(5);
console.log('📋 Posts encriptados:', data, error);
// ✅ Debe devolver NULL o solo los que tienes permiso
// ⚠️ Si ves `encrypted_content` de posts que no son tuyos → RLS mal!
```

### 1.3 Leer likes de otros usuarios
```js
// Intenta ver todos los likes (no solo los tuyos)
const { data, error } = await supabase
  .from('likes')
  .select('*, profiles!inner(username)')
  .limit(10);
console.log('📋 Todos los likes:', data, error);
// ✅ Debe devolver solo likes públicos o propios
```

### 1.4 Leer conversaciones de chat ajenas
```js
// Intenta ver todas las conversaciones de chat
const { data, error } = await supabase
  .from('conversations')
  .select('*')
  .limit(5);
console.log('📋 Conversaciones ajenas:', data, error);
// ✅ Debe devolver 0 filas (solo ves las tuyas por RLS)
```

### 1.5 Leer mensajes de chat sin ser participante
```js
// Escoge un conversation_id de la prueba anterior (si hay)
// O usa un UUID cualquiera
const { data, error } = await supabase
  .from('messages')
  .select('*')
  .limit(5);
console.log('📋 Mensajes ajenos:', data, error);
// ✅ Debe devolver 0 filas (solo ves los de tus conversaciones)
```

---

## 🟡 Nivel 2: Escritura no autorizada

### 2.1 Publicar como otro usuario
```js
// Intenta crear un post con user_id de otro usuario
const { data, error } = await supabase
  .from('posts')
  .insert({
    user_id: '00000000-0000-0000-0000-000000000000', // UUID falso
    content: 'Hackeado! 🚨'
  });
console.log('📋 Post como otro:', data, error);
// ✅ Debe fallar con RLS: "new row violates row-level security"
```

### 2.2 Dar like en nombre de otro
```js
// Intenta insertar un like con tu user_id pero a un post que no existe
const { data, error } = await supabase
  .from('likes')
  .insert({
    user_id: (await supabase.auth.getSession()).data.session?.user?.id || 'anon',
    post_id: '00000000-0000-0000-0000-000000000000' // post falso
  });
console.log('📋 Like falso:', data, error);
// ✅ Debe fallar por FK o RLS
```

### 2.3 Seguir a alguien sin permiso (si es privado)
```js
// Busca un usuario privado primero
const { data: privUser } = await supabase
  .from('profiles')
  .select('id, username')
  .eq('is_private', true)
  .limit(1);
console.log('Usuario privado encontrado:', privUser);

if (privUser?.[0]) {
  // Intenta seguir directamente (sin solicitud)
  const { data, error } = await supabase
    .from('follows')
    .insert({
      follower_id: (await supabase.auth.getSession()).data.session?.user?.id,
      following_id: privUser[0].id,
      status: 'accepted'  // ← debería ser 'pending' si es privado
    });
  console.log('📋 Follow directo a privado:', data, error);
  // ✅ Debe ser forzado a 'pending' por RLS o fallar
}
```

### 2.4 Bloquear a un usuario (sin ser admin)
```js
// Intenta bloquear a un usuario
const { data: targetUser } = await supabase
  .from('profiles')
  .select('id, username')
  .limit(1);
console.log('Usuario objetivo:', targetUser);

if (targetUser?.[0]) {
  const { data, error } = await supabase
    .from('blocks')
    .insert({
      blocker_id: (await supabase.auth.getSession()).data.session?.user?.id,
      blocked_id: targetUser[0].id
    });
  console.log('📋 Bloquear usuario:', data, error);
}
```

---

## 🔴 Nivel 3: Modificación/Eliminación de datos ajenos

### 3.1 Editar perfil de otro usuario
```js
// Intenta actualizar el bio de otro usuario
const { data: otherUser } = await supabase
  .from('profiles')
  .select('id, username')
  .limit(1);

if (otherUser?.[0]) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ bio: 'Editado por hacker 🚨' })
    .eq('id', otherUser[0].id);
  console.log('📋 Editar perfil ajeno:', data, error);
  // ✅ Debe fallar: "new row violates row-level security for profiles"
}
```

### 3.2 Eliminar post de otro usuario
```js
// Busca un post de otro usuario
const { data: otherPost } = await supabase
  .from('posts')
  .select('id, user_id, profiles!inner(username)')
  .limit(1);

if (otherPost?.[0]) {
  const { data, error } = await supabase
    .from('posts')
    .delete()
    .eq('id', otherPost[0].id);
  console.log('📋 Eliminar post ajeno:', data, error);
  // ✅ Debe fallar a menos que el post sea tuyo
}
```

### 3.3 Eliminar comentario de otro usuario
```js
const { data: otherComment } = await supabase
  .from('comments')
  .select('id, user_id')
  .limit(1);

if (otherComment?.[0]) {
  const { data, error } = await supabase
    .from('comments')
    .delete()
    .eq('id', otherComment[0].id);
  console.log('📋 Eliminar comentario ajeno:', data, error);
  // ✅ Solo debe funcionar si eres el dueño del post donde está el comentario
}
```

### 3.4 Desbloquear un bloqueo que no te pertenece
```js
// Intenta eliminar un bloque del que no eres blocker
const { data: anyBlock } = await supabase
  .from('blocks')
  .select('*')
  .limit(1);

if (anyBlock?.[0]) {
  // Intentar eliminar el bloque aunque no seas el blocker
  const { data, error } = await supabase
    .from('blocks')
    .delete()
    .eq('id', anyBlock[0].id);
  console.log('📋 Desbloquear ajeno:', data, error);
  // ✅ Debe fallar: solo el blocker puede desbloquear
}
```

---

## 🟣 Nivel 4: Auth/Privacidad

### 4.1 Verificar que no puedes leer notifications de otros
```js
const { data, error } = await supabase
  .from('notifications')
  .select('*')
  .limit(10);
console.log('📋 Notificaciones ajenas:', data, error);
// ✅ Debe devolver 0 o solo las tuyas
```

### 4.2 Verificar llamadas de otros
```js
const { data, error } = await supabase
  .from('calls')
  .select('*')
  .limit(10);
console.log('📋 Llamadas ajenas:', data, error);
// ✅ Debe devolver 0 o solo las de tus conversaciones
```

### 4.3 Verificar votos de encuestas
```js
const { data, error } = await supabase
  .from('poll_votes')
  .select('*')
  .limit(10);
console.log('📋 Votos de encuestas:', data, error);
// ✅ Debe devolver solo tus votos
```

---

## 📊 Resultados de la auditoría (12 tests)

| # | Tabla | Operación | Resultado | Estado |
|---|---|---|---|---|
| 1 | `profiles` | SELECT email ajeno | ⚠️ **10/10 emails visibles** | 🔴 REQUIERE MIGRACIÓN 051 |
| 2 | `posts` | SELECT encrypted_content ajeno | ⚠️ **2 posts visibles** | 🔴 REQUIERE MIGRACIÓN 051 |
| 3 | `conversations` | SELECT ajenas | `[]` (vacío) | ✅ |
| 4 | `notifications` | SELECT ajenas | `[]` (vacío) | ✅ |
| 5 | `messages` | SELECT sin ser participante | `[]` (vacío) | ✅ |
| 6 | `posts` | INSERT con user_id ajeno | `error: RLS violation` | ✅ |
| 7 | `profiles` | UPDATE perfil ajeno | `0 filas` | ✅ |
| 8 | `posts` | DELETE post ajeno | `0 filas` | ✅ |
| 9 | `likes` | INSERT con user_id ajeno | `error: RLS violation` | ✅ |
| 10 | `comments` | DELETE comment ajeno | `0 filas` | ✅ |
| 11 | `poll_votes` | SELECT ajenos | `[]` (vacío) | ✅ |
| 12 | `calls` | SELECT ajenas | `[]` (vacío) | ✅ |

**Resultado: 10/12 pasaron, 2/12 requieren la migración 051**

### 🔧 Migración 051 — Para aplicar en SQL Editor de Supabase:

El archivo `src/assets/services/migrations/051_rls_email_encrypted_posts.sql` contiene:

```sql
-- 1. Crea vista profiles_public (sin email)
CREATE OR REPLACE VIEW public.profiles_public AS ...

-- 2. Filtra posts encriptados por RLS (solo autor/allowed_users)
DROP POLICY IF EXISTS "Anyone can view posts" ON posts;
CREATE POLICY "Anyone can view non-encrypted posts" ON posts ...
CREATE POLICY "Authors and allowed users can view encrypted posts" ON posts ...

-- 3. Crea vista posts_public (sin encrypted_content)
CREATE OR REPLACE VIEW public.posts_public AS ...

-- 4. Función helper get_encrypted_post(id) para usuarios autorizados
CREATE OR REPLACE FUNCTION public.get_encrypted_post(post_id uuid) ...
```

> ⚠️ **IMPORTANTE**: Después de aplicar la migración, el frontend debe
> actualizarse para consultar `profiles_public` en vez de `profiles`
> cuando solo necesite datos públicos. Si no se actualiza, el SELECT
> a `profiles` seguirá devolviendo email NULL para otros usuarios,
> pero la query podría fallar si RLS bloquea el acceso a la tabla.
> La migración 051 incluye las políticas necesarias para que los
> SELECTs actuales sigan funcionando.

---

## 🔥 Bonus: SQL directo desde Supabase SQL Editor

Si quieres probar desde el **SQL Editor** de Supabase directamente (no desde el navegador), puedes ejecutar estas consultas para verificar las políticas RLS activas:

### Ver todas las políticas RLS
```sql
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### Verificar el RLS está habilitado en cada tabla
```sql
SELECT
  relname AS table_name,
  relrowsecurity AS rls_enabled,
  relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relkind = 'r'
  AND relnamespace = 'public'::regnamespace
ORDER BY relname;
```

### Simular una consulta como usuario anónimo
```sql
-- Como anónimo (sin sesión)
SELECT * FROM profiles LIMIT 5;

-- Como anónimo intentando leer emails
SELECT id, email, username FROM profiles LIMIT 5;
```

---

> **Nota**: Siempre debes empezar con `const { supabase } = await import('/src/assets/services/supabaseclient.js');`
> al inicio de cada sesión de DevTools. `supabase` solo vive en el scope de esa línea,
> así que cada script individual que pegues después debe asumir que `supabase` ya fue cargado.