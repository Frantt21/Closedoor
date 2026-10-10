# FastChange

Plataforma de red social desarrollada con React y Supabase: perfiles, publicaciones multimedia, interacciones sociales, contenido encriptado, encuestas, chat y comunidades.

---

12 de agosto

## Indice

1. [Descripcion](#descripcion)
2. [Tecnologias](#tecnologias)
3. [Estructura del proyecto](#estructura-del-proyecto)
4. [Requisitos](#requisitos)
5. [Instalacion](#instalacion)
6. [Variables de entorno](#variables-de-entorno)
7. [Scripts disponibles](#scripts-disponibles)
8. [Funcionalidades](#funcionalidades)
9. [Base de datos](#base-de-datos)
10. [Sistema de encriptacion](#sistema-de-encriptacion)
11. [Internacionalizacion](#internacionalizacion)
12. [Documentacion](#documentacion)
13. [Notas para desarrolladores](#notas-para-desarrolladores)

---

## Descripcion

FastChange es una aplicacion web tipo red social que permite a los usuarios crear perfiles, publicar contenido multimedia, interactuar mediante likes, comentarios y reposts, seguir a otros usuarios y participar en comunidades. Incluye encriptacion de publicaciones (AES-256-GCM), encuestas, publicaciones programadas, chat en tiempo real y un sistema completo de notificaciones.

---

## Tecnologias

**Frontend**

- React 19 con JSX
- React Router v7 (enrutamiento)
- Vite 8 (bundler y servidor de desarrollo)
- React Icons (iconografia)
- React Toastify (notificaciones toast)

**Backend y servicios**

- Supabase (autenticacion, PostgreSQL, suscripciones en tiempo real, RPC)
- Web Crypto API (encriptacion AES-256-GCM)

**Herramientas de desarrollo**

- ESLint (analisis estatico)
- Babel con React Compiler (compilacion optimizada)

---

## Estructura del proyecto

```
FastChange/
  index.html
  package.json
  vite.config.js
  eslint.config.js
  server.js               -- API local (dev / self-hosted) + streaming de musica (innertube)
  README.md
  docs/                   -- Documentacion (indice en docs/README.md)
    database/             -- Referencia de Supabase y migraciones
    security/             -- Auditorias y pruebas de seguridad
    deployment/           -- Deploy en Vercel y tuneles ngrok
  src/
    main.jsx              -- Punto de entrada de la aplicacion
    App.jsx               -- Configuracion de rutas y layout principal
    context/              -- Proveedores de contexto (auth, notificaciones, llamadas, etc.)
    hooks/                -- Hooks personalizados (useAuth, usePageTitle, etc.)
    assets/
      Pages/              -- Paginas (Home, profile, Explore, Chat, Comunidades, etc.)
      Resources/
        Components/       -- Componentes reutilizables (PostCard, Header, modales, etc.)
        Styles/           -- Hojas de estilo globales
      services/           -- Servicios (Supabase, posts, usuarios, chat, encriptacion, i18n)
        i18n/locales/     -- Traducciones (en, es, ja, pt, ru)
        migrations/       -- Migraciones SQL de Supabase
  api/                    -- Funciones serverless (Vercel) y helpers
  plugins/                -- Plugins de Vite (OG tags, CSP, preload, etc.)
  scripts/                -- Scripts de utilidad y diagnostico
  cdn-server/             -- Servidor CDN de archivos (Go)
  public/                 -- Archivos estaticos
```

---

## Requisitos

- Node.js 18 o superior
- npm, pnpm o yarn
- Una cuenta en [Supabase](https://app.supabase.com)

---

## Instalacion

1. Clonar el repositorio:

```bash
git clone https://github.com/<usuario>/FastChange.git
cd FastChange
```

2. Instalar dependencias:

```bash
npm install
```

3. Crear el archivo `.env.local` en la raiz con las variables de entorno (ver [Variables de entorno](#variables-de-entorno)).

4. Iniciar el servidor de desarrollo:

```bash
npm run dev
```

5. Abrir la aplicacion en `http://localhost:5173`.

---

## Variables de entorno

El archivo `.env.local` debe contener al menos:

```
VITE_SUPABASE_URL=https://<proyecto>.supabase.co
VITE_SUPABASE_ANON_KEY=<clave_anon>
```

| Variable | Descripcion |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto de Supabase |
| `VITE_SUPABASE_DATA_API_URL` | URL alternativa del Data API de Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave anonima/publica de Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave publicable (nomenclatura alternativa) |
| `VITE_SUPABASE_PUBLIC_KEY` | Clave publica (nomenclatura alternativa) |

---

## Scripts disponibles

| Comando | Descripcion |
|---|---|
| `npm run dev` | Servidor de desarrollo con HMR (incluye la API de música, ver `plugins/musicDevApiPlugin.js`) |
| `npm run build` | Build de produccion |
| `npm run lint` | Analisis estatico con ESLint |
| `npm run preview` | Vista previa de la build |
| `npm run start` | Servidor de produccion (server.js: API + streaming) |

---

## Funcionalidades

### Autenticacion y perfiles

- Registro e inicio de sesion (correo o nombre de usuario)
- Perfil con avatar, banner, biografia, pronombres e intereses
- Color de acento personalizado
- Perfiles privados con solicitudes de seguimiento
- Vistas de perfil rastreadas

### Publicaciones

- Texto, imagenes (hasta 4), videos e incrustaciones (YouTube, Vimeo)
- Edicion, eliminacion y fijado (hasta 3)
- Programacion para fecha futura
- Control de permisos de comentarios
- Likes, comentarios anidados, reposts y guardados
- Conteo de vistas
- Menciones con @ y autocompletado
- Hashtags con tendencias

### Encuestas

- Hasta 10 opciones, voto unico por usuario
- Fecha de expiracion opcional
- Notificacion al autor al recibir votos

### Encriptacion de contenido

- Ofuscacion visual con codificacion palindromica alfanumerica
- Encriptacion real con AES-256-GCM (Web Crypto API)
- Control de acceso por lista de usuarios permitidos

### Interaccion social

- Seguidores, solicitudes para perfiles privados y bloqueos
- Notificaciones en tiempo real (likes, comentarios, reposts, menciones, etc.)
- Chat con mensajes cifrados, reacciones, respuestas y llamadas
- Comunidades

### Exploracion

- Perfiles sugeridos
- Palabras y hashtags en tendencia
- Busqueda de publicaciones por contenido

---

## Base de datos

Las migraciones SQL estan en `src/assets/services/migrations/` y deben aplicarse en orden numerico en el SQL Editor de Supabase.

La referencia completa (configuracion, esquema, politicas RLS, funciones y triggers) esta en [docs/database/SUPABASE_REFERENCE.md](./docs/database/SUPABASE_REFERENCE.md).

### Tablas principales

| Tabla | Descripcion |
|---|---|
| `profiles` | Perfiles de usuario y configuracion de privacidad |
| `posts` | Publicaciones, metadatos de encriptacion, encuestas y programacion |
| `likes`, `comments`, `comment_likes`, `reposts`, `saved_posts` | Interacciones |
| `follows` | Relaciones de seguimiento (accepted, pending) |
| `blocks` | Bloqueos entre usuarios |
| `notifications` | Notificaciones en tiempo real |
| `hashtags`, `post_hashtags` | Hashtags y tendencias |
| `poll_votes` | Votos de encuestas |

### Seguridad (RLS)

Todas las tablas usan Row Level Security. Las politicas garantizan que:

- Los usuarios solo modifican sus propios datos
- Los perfiles privados son visibles solo para seguidores aceptados
- Las publicaciones encriptadas solo se leen con autorizacion
- Los usuarios bloqueados no ven contenido ni interactuan

---

## Sistema de encriptacion

El sistema opera en dos capas:

1. **Ofuscacion visual**: cada caracter se codifica como un palindromo numerico (p. ej. "a" se convierte en "2112").
2. **Encriptacion real**: AES-256-GCM con la Web Crypto API; la clave se deriva del ID del autor y los IDs de los usuarios permitidos mediante PBKDF2 (100.000 iteraciones, SHA-256).

La clave no depende del ID de la publicacion, lo que permite encriptar antes de crear el registro.

Documentacion detallada: [src/hooks/AlphabetEncryption.md](./src/hooks/AlphabetEncryption.md).

---

## Internacionalizacion

El sistema i18n esta en `src/assets/services/i18n/`. Idiomas soportados: ingles (en), espanol (es), japones (ja), portugues (pt) y ruso (ru).

Para agregar un idioma:

1. Crear `src/assets/services/i18n/locales/<codigo>.json` basandose en uno existente.
2. Registrar el archivo en `I18nContext.jsx`.

---

## Documentacion

| Tema | Documento |
|---|---|
| Indice general | [docs/README.md](./docs/README.md) |
| Base de datos | [docs/database/SUPABASE_REFERENCE.md](./docs/database/SUPABASE_REFERENCE.md) |
| Seguridad | [docs/security/AUDITORIA-SEGURIDAD.md](./docs/security/AUDITORIA-SEGURIDAD.md) |
| Deploy en Vercel | [docs/deployment/VERCEL_DEPLOYMENT.md](./docs/deployment/VERCEL_DEPLOYMENT.md) |
| Tuneles ngrok | [docs/deployment/NGROK_SETUP.md](./docs/deployment/NGROK_SETUP.md) |

> Nota: `docs/INFRAESTRUCTURA.md` contiene credenciales de servidores y no se sube a git.

---

## Notas para desarrolladores

- El proyecto usa React Compiler (via `babel-plugin-react-compiler`) para optimizaciones automaticas.
- El cliente de Supabase normaliza automaticamente la URL del proyecto.
- El cache local usa prefijos `fc_` con expiracion por TTL.
- "Cancion del perfil": la busqueda de metadatos usa iTunes (directo) o Deezer (via `/api/music-search`), y el audio completo lo resuelve **innertube** dentro de la propia app (`api/_innertube.js` + `/api/music/stream`). No hay servidor externo ni binarios (yt-dlp/ffmpeg): la misma logica corre en Vercel (`api/*.js`), en `npm run dev` (montada por `plugins/musicDevApiPlugin.js`, asi que no hace falta `npm start` para oir la cancion) y en `npm start`.
- Test del resolver de streams (offline, sin red): `node scripts/test-innertube-resolver.mjs`.
- **Stream de YouTube: limites medidos y como se sortean (2026-10-10)**: las URLs **audio-only** (adaptive: 140, 599, ...) llevan `rqh=1` y el CDN solo entrega un tramo que empieza en el offset 0 y cuyo tamano **varia** (medido 0,3-1 MiB segun IP y momento; no se recarga reutilizando la misma URL, y pedir un offset >= 1 MiB da 403 aunque sea la primera peticion de una URL recien resuelta). Ademas el `<audio>` de Chrome pide la continuacion (`Range: bytes=1048576-`) **en paralelo** al arrancar, asi que un 403 ahi tumba el pipeline entero (medido con navegador real: `PIPELINE_ERROR_READ` a los ~1,5 s, con 64 s ya en buffer). Por eso: (1) el proxy pide siempre bloques **acotados** de 1 MiB (`upstreamRangeHeader`); (2) el resolver prefiere el mejor audio-only cuya pista ENTERA quepa en ese tramo (140 -> 139 -> 599); (3) si ninguno cabe, o si el CDN responde 403 al primer bloque, se sirve el formato **MUXED itag 18** (`pickMuxedFormat` + `markStreamFallback`): verificado contra el CDN que sus URLs sirven CUALQUIER offset (3, 5 y 12 MB de un archivo de 13 MB) mientras las audio-only daban 403. Coste del muxed: baja tambien el video (3-13 MB por cancion, audio AAC ~128 kbps); el audio-only, cuando entra, pesa menos pero suena peor (32-50 kbps). La idea es del proyecto **Scrup** (ytdownloader): el audio-only va "gated", el muxed no. Solo si la pista no tiene muxed con URL se devuelve `playable:false` y la card usa el preview de 30 s. Levantar el tope para el audio-only exigiria un **PO token** (servicio extra, p. ej. `bgutil-ytdlp-pot-provider`).
