# Foranly Desktop (`desktop/`)

Envoltorio **Electron** de la web con un **servidor de música local**.

## Por qué existe

YouTube decide si entrega el stream completo según la **reputación de la IP**.
Desde un datacenter (Vercel, cualquier VPS) la resolución termina en
*"Sign in to confirm you're not a bot"*; los PO tokens no lo arreglan. Desde la IP
residencial del usuario sí funciona, y la web no puede lanzar procesos en su
máquina. La app de escritorio sí: la ventana carga la web publicada y, en
paralelo, levanta el servidor de música del propio repo (el mismo que usa
producción) escuchando **solo en `127.0.0.1:5990`**.

```
┌────────────────────────── Foranly Desktop ──────────────────────────┐
│  BrowserWindow ──► https://app.foranly.space  (la web publicada)    │
│        │ window.foranlyDesktop = { musicApiUrl, musicReady, … }     │
│        ▼                                                            │
│  src/assets/services/desktopApp.js  (detección en el cliente)       │
│        │ /api/music/stream →                                          │
│        ▼                                                            │
│  http://127.0.0.1:5990  ◄── scripts/music-api-server.mjs (proceso    │
│                              principal, IP residencial del usuario) │
└─────────────────────────────────────────────────────────────────────┘
```

## Uso

```bash
npm --prefix desktop install     # electron + electron-builder (una vez)
npm run desktop                  # abre la app con la web de producción
npm run desktop:dev              # apunta a http://localhost:5173 (requiere `npm run dev`)
```

La ventana abre **maximizada** (1280×820 es el tamaño de restauración); el botón
de la titlebar o el doble clic en la franja superior la restauran.

**Segundo plano:** cerrar la ventana (X) **no** cierra la app — la oculta en la
**bandeja del sistema** y todo sigue vivo (sesión, audio y servidor de música
local). Se recupera con clic en el icono de la bandeja, con *Abrir Foranly* en su
menú, o relanzando `npm run desktop` (instancia única: la trae al frente). Para
salir del todo: **bandeja → Salir**.

Iconos: `desktop/assets/icon.png` (512, ventana/taskbar/instalador) y
`desktop/assets/tray.png` (32, bandeja), declarados en `build.win/mac/linux.icon`
(`assets/**` viaja dentro del asar vía `build.files`).

Se generan del tile cuadrado de marca `public/mini_icon.png`:

```bash
npm run desktop:icons     # 512×512 y 32×32 desde public/mini_icon.png
```

⚠️ No uses `public/logo.svg` para esto: su PNG embebido es un trazo blanco finísimo
(0,59% de píxeles opacos) para el header sobre fondo oscuro — a 32 px desaparece.

Guía paso a paso (incluye probarla sin pantalla y el checklist de publicación):
[`docs/deployment/ELECTRON_BUILD.md`](../docs/deployment/ELECTRON_BUILD.md).

Variables de entorno:

| Variable | Defecto | Para qué |
| --- | --- | --- |
| `FORANLY_WEB_URL` | `https://app.foranly.space` | Qué web carga la ventana |
| `FORANLY_MUSIC_PORT` | `5990` | Puerto del servidor de música local (**no cambiar sin tocar la CSP**) |
| `FORANLY_DEBUG` | — | `1` imprime en consola el puente tal como lo ve la web y sondea el audio local **desde la página** (health + `<audio>` + bloqueos de CSP). Es el diagnóstico que distingue "el servidor local no está" de "la web desplegada no autoriza el loopback" |

## Empaquetado

```bash
npm run desktop:dist             # instaladores de la plataforma actual
npm run desktop:dist:win         # .exe (NSIS)
npm run desktop:dist:mac         # .dmg
npm run desktop:dist:linux       # .AppImage / .deb
```

Salida en `desktop/dist/`. `electron-builder` incluye `scripts/music-api-server.mjs`
y `api/**` vía `extraResources` (quedan en `resources/app/…`, que es la ruta que
resuelve `main.js` cuando `app.isPackaged`). Para probar el empaquetado sin
generar instaladores: `npm --prefix desktop run dist -- --linux dir` (deja la app
en `desktop/dist/linux-unpacked/` y se puede lanzar ahí mismo).

Sin firma de código, Windows/macOS muestran avisos al abrir el instalador
(SmartScreen / "desarrollador no identificado"). Para quitarlos hacen falta
certificados (Apple Developer ID + notarización, o un certificado EV en Windows).

## Piezas acopladas (si tocas una, revisa la otra)

- **Puerto fijo `5990`**: la CSP de la web solo autoriza `http://127.0.0.1:5990`
  (`plugins/cspPlugin.js`) y el servidor responde CORS a todo origen.
- **`scripts/music-api-server.mjs`**: exporta `startMusicServer()`; su CLI sigue
  funcionando igual (`npm run music-api`) para el host propio. Al empaquetar se
  copia a `resources/app/scripts/` junto a `resources/app/api/`, y
  `app-package.json` se copia como `resources/app/package.json` para declarar
  que esos `.js` son ESM (sin él, Node los reparsea y avisa con
  `MODULE_TYPELESS_PACKAGE_JSON` en la consola del usuario).
- **Detección en la web**: `src/assets/services/desktopApp.js` lee
  `window.foranlyDesktop` para (1) usar el stream local y (2) no ofrecer la
  descarga a quien ya está en la app.

## Orden de despliegue

La ventana carga la web publicada, así que **la web se despliega primero**: el
bundle lleva la detección del escritorio y la CSP que autoriza `127.0.0.1:5990`.
Con la web vieja, la app arranca pero solo suena el preview de 30 s (Chromium
bloquea las peticiones del documento al loopback). Detalle y medidas en
[`docs/deployment/ELECTRON_BUILD.md`](../docs/deployment/ELECTRON_BUILD.md) §6.1.

## Alcance actual

- La ventana carga la web **publicada**: cada deploy llega al instante, sin
  republicar la app. Solo cambia el binario cuando cambia el envoltorio.
- El servidor local sirve **solo** `/api/music/*` y `/api/music-search`; el
  resto de la API sigue siendo la de producción.
- No sustituye a las llamadas ni al chat: es la misma web, con mejor acceso al
  audio.
