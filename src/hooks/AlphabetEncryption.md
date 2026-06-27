# AlphabetEncryption — Sistema de Ofuscación de Posts

## Concepto

Sistema que permite a un usuario crear posts con contenido ofuscado,
visible solo para personas que el autor seleccione explícitamente.

## Encoding alfabético (ofuscación visual)

Cada letra del alfabeto se mapea a un número palindrómico:

```
a = 2112      b = 4114      c = 6116      d = 8118
e = 101110    f = 121112    g = 141114    h = 161116
i = 181118    j = 201120    k = 221122    l = 241124
m = 261126    n = 281128    o = 301130    p = 321132
q = 341134    r = 361136    s = 381138    t = 401140
u = 421142    v = 441144    w = 461146    x = 481148
y = 501150    z = 521152
```

**Fórmula:** `letra_n = (n*2) + "11" + (n*2)` donde n es la posición en el alfabeto (1-indexed).

Ejemplo: `"hola" = 161116 301130 241124 2112 = 1611163011302411242112`

También incluye caracteres extendidos (espacio, puntuación, números).

## Capas de seguridad

| Capa | Propósito | Implementación |
|---|---|---|
| **Ofuscación visual** | Mostrar texto "codificado" en la UI | Encoding palindrómico (sin clave) |
| **Encriptación real** | Proteger el contenido real | AES-256-GCM con Web Crypto API |
| **Control de acceso** | Solo usuarios seleccionados pueden descifrar | Clave derivada de `postId + userIds` via PBKDF2 |

## Flujo de creación

1. Usuario escribe contenido en CreatePostModal
2. Activa toggle "Ofuscar contenido"
3. Selecciona usuarios que pueden verlo (autocompletado de seguidos)
4. Al guardar:
   - `content` → se guarda el texto original (para los que tienen permiso)
   - `is_encrypted = true`
   - `encrypted_content` → AES-256-GCM del contenido (base64)
   - `allowed_users` → array de UUIDs de usuarios seleccionados
   - `obfuscated_display` → encoding alfabético del contenido
5. Se renderiza normal para el autor

## Flujo de visualización

- **Autor del post**: ve el contenido original
- **Usuario en allowed_users**: se descifra automáticamente con AES
- **Usuario NO autorizado**: ve el texto ofuscado (código numérico)
- **Usuario no autenticado**: ve "🔒" con mensaje de bloqueo

## DerivationKey

La clave AES se deriva de:
- `postId` (único por post)
- `sortedUserIds.join(',')` (todos los userIds permitidos, ordenados)

Esto significa que:
- Si el conjunto de usuarios permitidos cambia, la clave cambia
- Cada post tiene una clave única
- No se almacena ninguna clave en el servidor

## API Reference

```js
import { encode, decode, encryptForUsers, decryptForUser } from '../services/alphabetEncryption';

// Ofuscación visual
const encoded = encode('hola mundo');     // → "161116..."
const decoded = decode(encoded);          // → "hola mundo"

// Encriptación real (AES)
const { ciphertext, iv } = await encryptForUsers(content, postId, [user1Id, user2Id]);

// Descifrado
const decrypted = await decryptForUser(ciphertext, iv, postId, allowedUserIds, currentUserId);
```