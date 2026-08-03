# FastChange

Plataforma de redes sociales desarrollada con React y Supabase, que ofrece funcionalidades de publicacion, interaccion social, encriptacion de contenido y gestion de comunidades.

---

## Indice

1. [Descripcion general](#descripcion-general)
2. [Tecnologias utilizadas](#tecnologias-utilizadas)
3. [Estructura del proyecto](#estructura-del-proyecto)
4. [Requisitos previos](#requisitos-previos)
5. [Instalacion y configuracion](#instalacion-y-configuracion)
6. [Variables de entorno](#variables-de-entorno)
7. [Scripts disponibles](#scripts-disponibles)
8. [Funcionalidades](#funcionalidades)
9. [Arquitectura de base de datos](#arquitectura-de-base-de-datos)
10. [Sistema de encriptacion](#sistema-de-encriptacion)
11. [Internacionalizacion](#internacionalizacion)
12. [Notas para desarrolladores](#notas-para-desarrolladores)

---

## Descripcion general

FastChange es una aplicacion web de tipo red social que permite a los usuarios crear perfiles, publicar contenido multimedia, interactuar mediante likes, comentarios y reposts, seguir a otros usuarios, y participar en comunidades. El sistema incluye un motor de encriptacion de publicaciones basado en AES-256-GCM, encuestas, publicaciones programadas, y un sistema completo de notificaciones en tiempo real.

---

## Tecnologias utilizadas

**Frontend:**

- React 19 con JSX
- React Router v7 (enrutamiento)
- Vite 8 (bundler y servidor de desarrollo)
- React Icons (iconografia)
- React Toastify (notificaciones toast)

**Backend y servicios:**

- Supabase (autenticacion, base de datos PostgreSQL, suscripciones en tiempo real, RPC)
- Web Crypto API (encriptacion AES-256-GCM)

**Herramientas de desarrollo:**

- ESLint (analisis estatico de codigo)
- Babel con React Compiler (compilacion optimizada)

---

## Estructura del proyecto

```
FastChange/
  index.html
  package.json
  vite.config.js
  eslint.config.js
  README.md
  SUPABASE_REFERENCE.md        -- Referencia unificada de Supabase (configuracion, esquema, RLS, triggers)
  src/
    main.jsx                   -- Punto de entrada de la aplicacion
    App.jsx                    -- Configuracion de rutas y layout principal
    context/
      AuthContext.jsx           -- Proveedor de contexto de autenticacion
      NotificationContext.jsx   -- Proveedor de contexto de notificaciones
    hooks/
      useAuth.js               -- Hook personalizado para acceder al contexto de autenticacion
      useLockBodyScroll.js     -- Hook para bloquear el scroll del cuerpo
      usePageTitle.js          -- Hook para gestionar el titulo de la pagina
    assets/
      Pages/
        Home.jsx               -- Pagina principal (feed)
        profile.jsx            -- Pagina de perfil de usuario
        Explore.jsx            -- Pagina de exploracion (tendencias)
        Notifications.jsx      -- Pagina de notificaciones
        Settings.jsx           -- Pagina de configuracion
        PostDetail.jsx         -- Vista detallada de una publicacion
        HashtagPage.jsx        -- Pagina de publicaciones por hashtag
        Chat.jsx               -- Pagina de chat
        Comunidades.jsx        -- Pagina de comunidades
        Sing/
          Login.jsx            -- Pagina de inicio de sesion
          Register.jsx         -- Pagina de registro
      Resources/
        Components/
          Header.jsx           -- Barra lateral de navegacion
          PostCard.jsx         -- Tarjeta de publicacion
          CreatePostModal.jsx  -- Modal de creacion/edicion de publicaciones
          ProfileSidebar.jsx   -- Panel lateral de perfil
          RightPanel.jsx       -- Panel lateral derecho (tendencias)
          Avatar.jsx           -- Componente de avatar
          Badge.jsx            -- Componente de insignia de roles
          Modal.jsx            -- Componente modal generico
          ConfirmModal.jsx     -- Modal de confirmacion
          Tooltip.jsx          -- Componente de tooltip
          RichText.jsx         -- Renderizado de texto con formato
          SafeImage.jsx        -- Imagen con manejo de errores
          FollowButton.jsx     -- Boton de seguir/dejar de seguir
          FollowersModal.jsx   -- Modal de lista de seguidores
          FollowCountsWatcher.jsx  -- Observador de contadores de seguidores
          BlockRealtimeWatcher.jsx -- Observador de bloqueos en tiempo real
          ImagePositionEditor.jsx  -- Editor de posicion de imagen
          css/                 -- Hojas de estilo de componentes
        Styles/
          global.css           -- Estilos globales
          Home.css
          explore.css
          login.css
          register.css
          profiles.css
          post.css
          notifications.css
          settings.css
          skeleton.css
      services/
        supabaseclient.js      -- Cliente de Supabase (configuracion)
        postService.js         -- Servicio de publicaciones, likes, comentarios, reposts, encuestas
        userService.js         -- Servicio de perfiles de usuario
        followService.js       -- Servicio de seguidores y seguimiento
        notificationService.js -- Servicio de notificaciones
        blockService.js        -- Servicio de bloqueo de usuarios
        hashtagService.js      -- Servicio de hashtags y tendencias
        alphabetEncryption.js  -- Servicio de encriptacion alfabetica y AES-256-GCM
        trendingDictionary.js  -- Diccionario de palabras en tendencia
        colorExtractor.js      -- Extraccion de colores de imagenes
        feedScrollState.js     -- Estado de scroll del feed
        socialPlatforms.js     -- Plataformas sociales
        socialPlatforms.jsx    -- Iconos de plataformas sociales
        helpers.js             -- Funciones auxiliares (expresiones regulares, deteccion de medios)
        i18n/                  -- Sistema de internacionalizacion
          I18nContext.jsx
          useI18n.js
          locales/
            en.json
            es.json
            ja.json
            pt.json
            ru.json
        migrations/            -- Migraciones SQL de Supabase (001-030)
```

---

## Requisitos previos

- Node.js 18 o superior
- npm, pnpm o yarn
- Una cuenta en Supabase (https://app.supabase.com)

---

## Instalacion y configuracion

1. Clonar el repositorio:

```bash
git clone https://github.com/<usuario>/FastChange.git
cd FastChange
```

2. Instalar dependencias:

```bash
npm install
```

3. Crear el archivo `.env.local` en la raiz del proyecto con las variables de entorno requeridas (ver seccion [Variables de entorno](#variables-de-entorno)).

4. Iniciar el servidor de desarrollo:

```bash
npm run dev
```

5. Abrir la aplicacion en el navegador en la direccion mostrada por el servidor de desarrollo (por defecto http://localhost:5173).

---

## Variables de entorno

El archivo `.env.local` debe contener las siguientes variables:

```
VITE_SUPABASE_URL=https://<proyecto>.supabase.co
VITE_SUPABASE_ANON_KEY=<clave_anon>
```

Alternativamente, se admiten los siguientes nombres de variables:

| Variable | Descripcion |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto de Supabase |
| `VITE_SUPABASE_DATA_API_URL` | URL alternativa del Data API de Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave anonima/publica de Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave publicable de Supabase (nomenclatura alternativa) |
| `VITE_SUPABASE_PUBLIC_KEY` | Clave publica de Supabase (nomenclatura alternativa) |
| `YTDLP_BIN` | Ruta del binario de `yt-dlp` (solo server self-hosted, default `yt-dlp`) |
| `FFMPEG_BIN` | Ruta del binario de `ffmpeg` (solo server self-hosted, default `ffmpeg`) |

---

## Scripts disponibles

| Comando | Descripcion |
|---|---|
| `npm run dev` | Inicia el servidor de desarrollo con HMR |
| `npm run build` | Genera la build de produccion |
| `npm run lint` | Ejecuta el analisis estatico con ESLint |
| `npm run preview` | Vista previa de la build de produccion |

---

## Servidor de musica (streaming con yt-dlp)

La card "Mi cancion" del perfil reproduce la cancion completa cuando el server self-hosted tiene **yt-dlp** y **ffmpeg** instalados; si no, degrada automaticamente a los previews de 30s de iTunes/Deezer.

Arquitectura:
- **Metadatos**: búsqueda en Deezer (titulo, artista, album, portada y duracion).
- **Stream**: yt-dlp busca en YouTube `ytsearch:"artista - titulo"`, elige el candidato por similitud de titulo + duracion y resuelve la URL de audio directa (m4a preferido).
- **Servido**: las URLs de YouTube expiran y estan ligadas a la IP del server, asi que se proxian con soporte de Range; los formatos no reproducibles en todos los navegadores (webm/opus) se transcodifican a m4a con ffmpeg en streaming.

Endpoints (solo `server.js`, NO funcionan en Vercel serverless):

| Endpoint | Descripcion |
|---|---|
| `GET /api/music/search?q=...` | Busqueda combinada Deezer + flag `stream` |
| `GET /api/music/stream?artist=...&title=...&duration=...` | Stream completo (proxy Range / transcode) |
| `GET /api/music/health` | Estado de los binarios (yt-dlp/ffmpeg) |

**Dev (2 terminales):** el dev server de vite (`npm run dev`) proxifica
`/api/music/*` a `http://localhost:3000`, asi que para probar el streaming
completo hay que levantar tambien el server:

```bash
# Terminal 1 — API + streaming (server.js)
npm run start

# Terminal 2 — frontend
npm run dev
```

Si `npm run start` no esta corriendo, el frontend **degrada solo a los
previews de 30s** (iTunes directo funciona en dev sin server): busca bien y
reproduce previews, solo que no usa yt-dlp. El server auto-detecta yt-dlp en
`~/.local/bin/yt-dlp` y respeta `YTDLP_BIN` si lo defines.

### Server remoto en Termux (Android) + tunel

> 📱 Guia completa paso a paso: **[TERMUX_SETUP.md](./TERMUX_SETUP.md)**

> ⚡ Para Termux **no hace falta todo el repo**: hay un server standalone sin
> dependencias, **`music-server.js`** (3 archivos, sin npm ni build, solo los
> endpoints de musica). Es la via recomendada — ver TERMUX_SETUP.md.

El server self-hosted corre bien en **Termux** (telefono dedicado), y se puede
hacer accesible al app desplegado via **ngrok** o **cloudflared**:

```bash
# En Termux (instalar Termux desde F-Droid/GitHub, NO Google Play)
pkg update && pkg upgrade -y
pkg install python nodejs ffmpeg -y

# yt-dlp: binario standalone (mas fiable que pip en Termux; necesita python3,
# que ya esta instalado). El server usa --js-runtimes node, asi que NO hace
# falta el extra "[default]" (yt-dlp-ejs).
curl -L -o $PREFIX/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
chmod +x $PREFIX/bin/yt-dlp
yt-dlp --version

# Alternativa por pip (si prefieres): python -m pip install -U yt-dlp
cd FastChange && npm install

# Mantener vivo el proceso (Android mata los procesos en segundo plano):
# desliza la notificacion de Termux → "Acquire wakelock"

# Tunel (elige uno)
ngrok http 3000            # ⚠️ free: el interstitial rompe el <audio> directo
cloudflared tunnel --url http://localhost:3000   # ✅ sin interstitial
```

Y en el build del app (Vercel) define la variable:

```
VITE_MUSIC_API_URL=https://TU-TUNEL.trycloudflare.com/api/music
```

El frontend usara ese server para buscar (Deezer), health y stream; si el tunel
cae, degrada a previews de 30s. Notas:
- **ngrok free**: el interstitial rompe las peticiones del navegador; los
  `fetch` llevan el header `ngrok-skip-browser-warning` y el `<audio>` usa un
  fallback fetch+blob, asi que funciona, pero la URL dev-domain es persistente
  por cuenta. **cloudflared** no tiene interstitial y es lo mas simple.
- El stream NO debe pasar por Vercel (timeout de funciones cortaria una cancion
  completa): `VITE_MUSIC_API_URL` hace que el app llame al tunel directamente.
- El server responde CORS `*` en `/api/music` y auto-detecta yt-dlp en
  `~/.local/bin/yt-dlp` o en el PATH de Termux.

Instalacion en el server:

```bash
# yt-dlp (binario oficial standalone o pip)
curl -L -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
chmod +x /usr/local/bin/yt-dlp
# o: python3 -m pip install yt-dlp

# ffmpeg (requerido para extraccion/transcode)
apt install -y ffmpeg   # o el gestor de paquetes de tu distro
```

> ⚠️ **Version minima de yt-dlp: 2024.08.06+** (el servidor usa el flag `--js-runtimes node` para extraer algunos formatos sin warnings). Verifica con `yt-dlp --version`; si es mas antigua, actualizalo o el stream fallara en canciones que requieran JS runtime.

> ⚠️ **Legal/ToS**: el uso de yt-dlp con YouTube va contra los terminos de servicio de YouTube y puede haber implicaciones de copyright. Es responsabilidad del operador del server. El frontend no depende de esto: si el server no responde, la app sigue usando los previews de 30s.

---

## Funcionalidades

### Autenticacion y perfiles

- Registro de usuarios con correo electronico y contrasena
- Inicio de sesion por correo electronico o nombre de usuario
- Cierre de sesion
- Perfil de usuario con avatar, banner, biografia, pronombres e intereses
- Configuracion de color de acento personalizado
- Perfiles privados con solicitudes de seguimiento
- Vistas de perfil rastreadas

### Publicaciones

- Creacion de publicaciones con texto, imagenes (hasta 4), videos e incrustaciones (YouTube, Vimeo)
- Edicion y eliminacion de publicaciones propias
- Fijado de publicaciones en el perfil (hasta 3)
- Programacion de publicaciones para fecha futura
- Control de permisos de comentarios (todos, seguidores, nadie)
- Sistema de likes, comentarios (con respuestas anidadas) y reposts
- Guardado/borrador de publicaciones
- Conteo de vistas por publicacion
- Mencion de usuarios mediante @ con autocompletado
- Sistema de hashtags con tendencias

### Encuestas

- Creacion de encuestas dentro de publicaciones (hasta 10 opciones)
- Voto unico por usuario por publicacion
- Fecha de expiracion opcional
- Notificacion al autor cuando alguien vota

### Encriptacion de contenido

- Publicaciones ofuscadas con codificacion palindromica alfanumerica
- Encriptacion real del contenido con AES-256-GCM (Web Crypto API)
- Control de acceso por lista de usuarios permitidos
- Solo los usuarios autorizados pueden descifrar y leer el contenido original

### Interaccion social

- Sistema de seguidores y seguimiento
- Solicitudes de seguimiento para perfiles privados (aceptar, rechazar, cancelar)
- Bloqueo y desbloqueo de usuarios (elimina la relacion de seguimiento automaticamente)
- Sistema de notificaciones en tiempo real (likes, comentarios, reposts, menciones, seguimientos, encuestas, publicaciones encriptadas)

### Exploracion

- Pagina de exploracion con perfiles sugeridos
- Palabras en tendencia basadas en publicaciones recientes
- Hashtags en tendencia
- Busqueda de publicaciones por contenido

### Internacionalizacion

Soporte para los siguientes idiomas:

- Ingles (en)
- Espanol (es)
- Japones (ja)
- Portugues (pt)
- Ruso (ru)

### Otros

- Chat (en desarrollo)
- Comunidades (en desarrollo)
- Actualizaciones en tiempo real mediante suscripciones de Supabase
- Cache local en localStorage para datos frecuentes (perfiles, feed, hashtags, notificaciones, estado de seguimiento)
- Diseno responsivo con barra lateral colapsable

---

## Arquitectura de base de datos

Las migraciones SQL se encuentran en `src/assets/services/migrations/` (migraciones 001 a 030). La guia completa de configuracion, esquema de base de datos, politicas RLS y funciones se encuentra en `SUPABASE_REFERENCE.md`.

### Tablas principales

| Tabla | Descripcion |
|---|---|
| `profiles` | Perfiles de usuario (id, email, username, avatar, banner, bio, pronouns, roles, configuraciones de privacidad y acento) |
| `posts` | Publicaciones (contenido, imagenes, video, metadatos de encriptacion, encuestas, programacion) |
| `likes` | Likes en publicaciones |
| `comments` | Comentarios en publicaciones (soporte de respuestas anidadas) |
| `comment_likes` | Likes en comentarios |
| `reposts` | Reposts de publicaciones |
| `saved_posts` | Publicaciones guardadas por usuarios |
| `follows` | Relaciones de seguimiento (con estados: accepted, pending) |
| `blocks` | Bloqueos entre usuarios |
| `notifications` | Notificaciones (likes, comentarios, reposts, menciones, seguimientos, encuestas, encriptacion) |
| `hashtags` | Hashtags con conteo de uso |
| `post_hashtags` | Relacion publicaciones-hashtags |
| `poll_votes` | Votos en encuestas |

### Seguridad a nivel de fila (RLS)

Todas las tablas utilizan Row Level Security de Supabase. Las politicas controlan el acceso segun el usuario autenticado, garantizando que:

- Los usuarios solo pueden modificar sus propios datos
- Los perfiles privados solo son visibles para seguidores aceptados
- Las publicaciones encriptadas solo son legibles para los usuarios autorizados
- Los usuarios bloqueados no pueden ver contenido ni interactuar entre si

### Funciones y triggers

La base de datos incluye funciones RPC y triggers para:

- Mantener contadores desnormalizados (likes, comentarios, reposts)
- Gestionar tendencias de hashtags y palabras
- Eliminar relaciones de seguimiento bidireccional al bloquear

---

## Sistema de encriptacion

El sistema de encriptacion opera en dos capas:

1. **Ofuscacion visual**: Cada caracter del texto se codifica como un palindromo numerico (por ejemplo, la letra "a" se convierte en "2112"). Esto produce una representacion numerica que oculta el contenido original a usuarios no autorizados.

2. **Encriptacion real**: El contenido original se encripta con AES-256-GCM utilizando la Web Crypto API del navegador. La clave se deriva de una semilla compuesta por el ID del autor y los IDs de los usuarios permitidos, mediante PBKDF2 con 100.000 iteraciones y hash SHA-256.

La clave de encriptacion no depende del ID de la publicacion, lo que permite encriptar el contenido antes de crear la publicacion en la base de datos.

La documentacion detallada del sistema de encriptacion se encuentra en `src/hooks/AlphabetEncryption.md`.

---

## Internacionalizacion

El sistema de internacionalizacion (i18n) se encuentra en `src/assets/services/i18n/`. Para agregar un nuevo idioma:

1. Crear un archivo de traduccion en `src/assets/services/i18n/locales/<codigo>.json` basado en uno de los archivos existentes.
2. Registrar el archivo en `I18nContext.jsx`.

---

## Notas para desarrolladores

- El proyecto utiliza React Compiler (a traves de `babel-plugin-react-compiler`) para optimizaciones automaticas de rendimiento.
- El cliente de Supabase normaliza automaticamente la URL del proyecto, eliminando rutas adicionales de la URL si es necesario.
- El sistema de cache local utiliza prefijos `fc_` y expiracion por TTL para mantener los datos frescos sin sobrecargar la base de datos.
- Las migraciones SQL en `src/assets/services/migrations/` deben aplicarse en orden numerico en el SQL Editor de Supabase.
- Para informacion adicional sobre la configuracion de Supabase, consultar `SUPABASE_REFERENCE.md`.
