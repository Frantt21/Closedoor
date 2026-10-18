# App de escritorio (Electron): lanzar y generar instaladores

Guía práctica de `desktop/`: cómo arrancar la app en desarrollo y cómo generar los
instaladores. Para el **por qué** y las piezas acopladas (puerto `5990`, CSP,
detección desde la web) ver [`desktop/README.md`](../../desktop/README.md).

Resumen de una línea: la app abre la **web publicada** en una ventana de Electron
(**maximizada**) y levanta en paralelo el **servidor de música del repo** en
`127.0.0.1:5990`, para que la canción del perfil suene completa saliendo por la
conexión del usuario.

---

## 1. Requisitos

| Necesitas | Detalle |
| --- | --- |
| Node.js | 18 o superior (el servidor de música usa `fetch` global y `Readable.fromWeb`) |
| npm | El que viene con Node |
| Sistema | Linux, Windows o macOS. Se puede **compilar** en Linux/Windows/macOS; ver la tabla de plataformas del punto 6 |
| Red | La primera instalación descarga Electron (~100 MB) y el primer `electron --version` completa la descarga del binario |

No hace falta ningún archivo `.env`: la app no usa variables de Supabase ni
secretos (la web publicada se encarga del login; el server local solo sirve audio).

---

## 2. Instalación (una sola vez)

```bash
npm run desktop:install        # ≡ npm --prefix desktop install
```

Instala `electron` y `electron-builder` **dentro de `desktop/node_modules`**, no en
el `node_modules` de la web: el proyecto de Vite no arrastra ~300 MB de herramientas
de escritorio.

---

## 3. Lanzarla en desarrollo

```bash
npm run desktop                # la ventana carga https://app.foranly.space
npm run desktop:dev            # la ventana carga http://localhost:5173  (antes: npm run dev)
```

La ventana abre **maximizada** (1280×820 es el tamaño de restauración) y lleva el
icono de la app (`desktop/assets/icon.png`) en la barra de tareas.

Qué verás en consola al arrancar:

```
[desktop] servidor de música local en http://127.0.0.1:5990
[desktop] icono de bandeja listo (cerrar la ventana deja la app en segundo plano)
[desktop] ventana lista (maximizada: true)
```

### Segundo plano (bandeja del sistema)

La **X de la ventana no cierra la app**: la oculta en la bandeja del sistema y todo
sigue vivo (sesión, audio y servidor de música local). Se vuelve con clic en el
icono de la bandeja, con *Abrir Foranly* en su menú o lanzando `npm run desktop`
otra vez (instancia única: la trae al frente).

La única forma de salir del todo es **bandeja → Salir** (o cerrar la sesión del
sistema). Si necesitas el cierre clásico al pulsar la X, comenta el handler
`mainWindow.on('close', …)` de `desktop/main.js`.

Comprobaciones útiles mientras está abierta:

```bash
curl -s http://127.0.0.1:5990/api/music/health      # {"ok":true,"stream":"innertube",...}
curl -s "http://127.0.0.1:5990/api/music/resolve?artist=Feid&title=Ferxxo%20100&duration=168"
# {"success":true,...,"playable":true,...}  ← la pista completa cabe en el tramo del CDN
```

### Diagnóstico del puente y del audio local

```bash
FORANLY_DEBUG=1 npm run desktop
# [desktop] puente visto por la web: {"app":"foranly-desktop","version":"0.1.0",
#   "platform":"linux","musicApiUrl":"http://127.0.0.1:5990","musicReady":true}
# [desktop] audio local visto por la página: {"health":200,"audio":"cargado"}
```

`audio: "cargado"` es la prueba de que la canción sonará completa: la petición
sale del documento cargado, así que pasó su `Content-Security-Policy`. Si sale
`blocked`/`error code=4` con mensajes `Refused to connect`, la web desplegada es
una versión anterior (ver *Orden de despliegue* y el punto 8).

Si `musicReady` sale `false`, el servidor local no arrancó (ver punto 8) y la web
cae al preview de 30 s igual que en un navegador.

> Ojo: si ya hay una ventana de Foranly abierta, un segundo `npm run desktop` la
> enfoca y termina (instancia única); imprime `ya hay una ventana de Foranly abierta`.

### En otra máquina de la red (móvil, tablet)

La app no publica nada: el servidor de música escucha **solo en loopback**
(`127.0.0.1`), que es justo lo que hace que YouTube vea la IP del usuario. Para
probar en otro dispositivo se usa la web normal (`npm run dev`), no la app.

---

## 4. Probar sin pantalla (CI, servidor, esta misma caja)

Electron necesita un display; se puede suplir con el backend headless de Ozone:

```bash
cd desktop
FORANLY_WEB_URL='data:text/html,<h1>ok</h1>' FORANLY_DEBUG=1 \
  ./node_modules/.bin/electron . --ozone-platform=headless --no-sandbox --disable-gpu
```

Sirve para verificar el arranque real (servidor de música + puente en la página)
sin abrir una ventana. En una máquina sin `xvfb` ni servidor gráfico es la única
forma de comprobar el proceso completo. `--no-sandbox` es solo para contenedores.

---

## 5. Lanzar la app ya empaquetada

```bash
npm --prefix desktop run dist -- --linux dir     # empaqueta sin instaladores
desktop/dist/linux-unpacked/foranly-desktop      # se ejecuta directamente
```

El nombre del ejecutable es el `name` del `package.json` (`foranly-desktop`); el
icono y el nombre visible son los del `productName` (`Foranly`).

---

## 6. Generar instaladores

| Comando | Salida | Plataforma que lo puede generar |
| --- | --- | --- |
| `npm run desktop:dist` | la del sistema actual | — |
| `npm run desktop:dist:linux` | `Foranly-<v>-x86_64.AppImage`, `Foranly-<v>-amd64.deb` | Linux |
| `npm run desktop:dist:win` | `Foranly-Setup-<v>.exe` (NSIS) | Windows (o Linux con Wine) |
| `npm run desktop:dist:mac` | `Foranly-<v>-arm64.dmg`, `Foranly-<v>-x64.dmg` | **solo macOS** |
| `npm --prefix desktop run dist -- --linux dir` | `desktop/dist/linux-unpacked/` (sin instalador) | cualquiera |

Todo cae en `desktop/dist/` (ignorado por git). El número de versión sale de
`desktop/package.json` (`version`) **y** de `src/assets/data/desktopApp.js`
(`DESKTOP_VERSION`): si publicas una versión nueva hay que subir los dos, porque la
página `/download` muestra los nombres de archivo a partir del segundo.

### Qué mete `electron-builder` dentro

```
desktop/dist/<target>/
  resources/
    app.asar                     ← main.js, preload.js, package.json (files)
    app/
      package.json               ← {"type":"module"} (desktop/app-package.json)
      scripts/music-api-server.mjs
      api/**                     ← handlers de música y _innertube.js
```

`main.js` resuelve esa ruta con `process.resourcesPath` cuando `app.isPackaged`
(la del repo, `../scripts/music-api-server.mjs`, cuando no lo está). Si mueves
`api/` o `scripts/`, hay que actualizar `build.extraResources` en
`desktop/package.json`.

### Iconos

Los iconos salen de `desktop/assets/`, declarados en `build.win/mac/linux.icon`:

| Archivo | Tamaño | Uso |
| --- | --- | --- |
| `assets/icon.png` | 512×512 | Ventana y barra de tareas (`BrowserWindow.icon`), instalador y `.exe`/`.AppImage`/`.dmg` (electron-builder genera `.ico`/`.icns` desde este PNG) |
| `assets/tray.png` | 32×32 | Icono de la **bandeja del sistema** |

Ambos se generan con `npm run desktop:icons` (`scripts/make-desktop-icons.mjs`) a
partir del tile cuadrado de marca `public/mini_icon.png`: recorta al bounding box
del alpha, lo centra en un cuadrado y escribe los PNG en Node puro (determinista),
**re-decodificando el resultado** para no publicar un icono vacío.

⚠️ **No uses `public/logo.svg`** como fuente: medido, su PNG embebido es un trazo
blanco muy fino (0,59% de píxeles con alpha > 8, alpha máximo 200) pensado para el
header sobre fondo oscuro; como icono de 32 px desaparece. Si el asset de marca
cambia, vuelve a correr `npm run desktop:icons`.

`assets/**` va en `build.files`, así que la ruta del código
(`path.join(__dirname, 'assets', …)`) vale igual en dev y empaquetado.

### Firma de código (pendiente)

Sin firmar, Windows muestra SmartScreen y macOS el aviso de "desarrollador no
identificado". Para quitarlos hacen falta:

- **macOS**: cuenta Apple Developer + `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y
  `APPLE_TEAM_ID` en el entorno (electron-builder firma y notariza solo).
- **Windows**: certificado de firma de código (EV o un servicio de firma en la
  nube) y `CSC_LINK`/`CSC_KEY_PASSWORD`.

En CI conviene compilar cada plataforma en su runner (GitHub Actions:
`windows-latest`, `macos-latest`, `ubuntu-latest`) y subir los artefactos con
`actions/upload-artifact` o una release.

### Publicar la descarga

1. Sube los instaladores a donde sirvas los binarios (por ejemplo
   `https://dl.foranly.space/desktop/`).
2. Rellena `DESKTOP_DOWNLOAD_BASE` en `src/assets/data/desktopApp.js` con esa base.
3. Comprueba que los nombres coinciden con `DESKTOP_DOWNLOADS` (están escritos en
   ese mismo archivo).

Hasta el paso 2, `/download` muestra cada tarjeta como **Próximamente** en vez de
enlazar a un archivo inexistente.

---

## 6.1 Orden de despliegue (importante)

La app carga la web **publicada**, así que el orden es:

1. **Desplegar la web** (`npm run build` → deploy). El bundle lleva dos cosas sin
   las que la app no puede oír la canción completa:
   - la detección del escritorio (`src/assets/services/desktopApp.js`), que manda
     `/api/music/*` al loopback;
   - la CSP que autoriza `http://127.0.0.1:5990` en `connect-src` y `media-src`
     (`plugins/cspPlugin.js`).
2. **Después** publicar/instalar la app de escritorio.

Con la web vieja, la app arranca, el servidor local responde… y aun así solo
suena el preview de 30 s: Chromium bloquea toda petición del documento a
`127.0.0.1` (`Refused to connect` / `violates ... media-src`) y el cliente
publicado ni sabe que existe la app. Medido con la web de producción antes de
desplegar esto:

| Escenario | fetch a `/api/music/health` del loopback | `<audio>` del loopback |
| --- | --- | --- |
| Página https sin CSP | 200 | carga ✓ |
| Web nueva servida por https (CSP con loopback) | 200 | carga ✓ |
| Web `app.foranly.space` **anterior** | `Refused to connect` (CSP) | `error code=4` |

---

## 7. Variables de entorno

| Variable | Defecto | Para qué |
| --- | --- | --- |
| `FORANLY_WEB_URL` | `https://app.foranly.space` | Qué web carga la ventana |
| `FORANLY_MUSIC_PORT` | `5990` | Puerto del servidor de música local |
| `FORANLY_DEBUG` | — | `1` imprime el puente visto por la web y sondea el audio local desde la página (health + `<audio>` + mensajes de CSP) |

⚠️ **No cambies el puerto sin tocar la CSP.** El navegador solo autoriza el
loopback en `plugins/cspPlugin.js` (`connect-src` y `media-src` incluyen
`http://127.0.0.1:5990` y `http://localhost:5990`). Con otro puerto, Chromium
bloquea el audio y todo cae al preview.

---

## 8. Problemas comunes

| Síntoma | Causa y solución |
| --- | --- |
| `[desktop] no se pudo arrancar el servidor de música: listen EADDRINUSE` | Ya hay algo en el 5990. Si es otra instancia de la app o `npm run music-api`, la app **lo reutiliza** (no es un error). Si es otro programa, ciérralo: con otro puerto la CSP lo bloquearía |
| `musicReady: false` en el puente | El server local no respondió. Mira la consola: error de permisos del puerto, falta `scripts/music-api-server.mjs` o un `api/**` al empaquetar |
| `MODULE_TYPELESS_PACKAGE_JSON` | Falta `resources/app/package.json`. Lo aporta `desktop/app-package.json` vía `extraResources`; si vuelve, revisa esa entrada |
| `Failed to launch: no DISPLAY` / falla al abrir la ventana | No hay servidor gráfico: usa el modo headless del punto 4 o `xvfb-run` |
| La canción suena solo 30 s dentro de la app | Lo primero: `FORANLY_DEBUG=1 npm run desktop` y mira `audio local visto por la página`. Si sale `health: 200` pero `audio` bloqueado, **la web desplegada no autoriza el loopback** → despliega la web nueva (ver 6.1). Si `musicReady: false`, el server local no arrancó |
| `[desktop] la web cargada no puede leer el servidor de música local` | Misma causa: web publicada anterior a la CSP con `127.0.0.1`. La app lo avisa sola en consola al arrancar |
| El segundo `npm run desktop` no hace nada | Ya hay una ventana abierta (instancia única): el lanzamiento la enfoca y termina. Lo avisa en consola |
| Cierro la ventana y la app sigue viva | Es el comportamiento intencional: se oculta en la **bandeja** para seguir en segundo plano. Salir del todo: clic derecho en el icono de la bandeja → *Salir* |
| No aparece el icono de la bandeja | `desktop/assets/tray.png` no se pudo leer (mira la consola: `no se pudo cargar el icono de bandeja`). En Linux necesita soporte de bandeja (libappindicator/AppIndicator) |
| `electron: command not found` | Falta `npm run desktop:install` |
| El primer `electron --version` tarda | Está descargando el binario de Electron |

---

## 9. Checklist antes de publicar

1. `npm run desktop:install` y `npm run desktop` funcionan en la máquina.
2. `curl -s http://127.0.0.1:5990/api/music/health` → `{"ok":true,…}` con la app abierta.
3. `FORANLY_DEBUG=1` muestra `musicReady: true`.
4. `npm run build` de la web ✓ (el bundle con la CSP y la página `/download`).
5. `npm run desktop:dist:<plataforma>` genera el instalador sin errores.
6. Instalador probado en una máquina limpia: abre la web, la canción del perfil
   suena entera y el aviso de descarga **no** aparece dentro de la app.
7. `DESKTOP_VERSION` y `DESKTOP_DOWNLOAD_BASE` actualizados, y los binarios subidos.
