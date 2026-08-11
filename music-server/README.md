# 🎧 Music Server (yt-dlp + ffmpeg)

Server de música standalone para Linux ARM64 (container). Búsqueda en Deezer + streaming completo vía yt-dlp.

## Requisitos

- Node.js 18+ (fetch global)
- Conexión a internet
- ~170MB para binarios (yt-dlp + ffmpeg + cloudflared + bgutil-pot)

## Setup (una sola vez)

```bash
chmod +x setup.sh && ./setup.sh
```

Esto descarga:
- `yt-dlp` (linux arm64) → `./bin/yt-dlp`
- `ffmpeg` (linux arm64 static) → `./bin/ffmpeg`
- `cloudflared` → `./bin/cloudflared` (túnel HTTPS para producción)
- `bgutil-pot` (PO Token provider, linux arm64) → `./bin/bgutil-pot`
- Plugin `bgutil-ytdlp-pot-provider` → `./bin/yt-dlp-plugins/`

## Iniciar

```bash
npm install   # solo si no hay node_modules (https-proxy-agent, socks-proxy-agent)
node music-server.js
```

El server escucha en `http://localhost:24633`.

## Endpoints

| Endpoint | Descripción |
|---|---|
| `GET /api/music/health` | Estado de yt-dlp/ffmpeg/POT + URL del túnel HTTPS (si hay) |
| `GET /api/music/search?q=...` | Búsqueda en Deezer |
| `GET /api/music/search?track=ID` | Preview fresco de Deezer |
| `GET /api/music/stream?artist=&title=&duration=` | Stream en vivo (proxy directo, primer byte inmediato) |
| `GET /api/music/download?artist=&title=&duration=` | Descarga completa con caché (memoria + disco) |
| `GET /api/music/resolve?artist=&title=&duration=` | Resuelve y cachea la URL sin servir audio |

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `24633` | Puerto del server |
| `YTDLP_BIN` | `./bin/yt-dlp` | Ruta a yt-dlp |
| `FFMPEG_BIN` | `./bin/ffmpeg` | Ruta a ffmpeg |
| `YTDLP_COOKIES_FILE` | (auto-detect) | Ruta a cookies.txt (anti-throttle + auth) |
| `YTDLP_PROXY` | (vacío) | Proxy residencial/ISP: `http://user:pass@host:port` o `socks5://user:pass@host:port`. Se aplica a yt-dlp (--proxy) Y al fetch del media (mismo proxy, obligatorio: la URL de googlevideo queda ligada a la IP que la resolvió). |
| `BGUTIL_POT_BASE_URL` | `http://127.0.0.1:4416` | URL del server POT (se relanza solo si cae) |

## Cookies (recomendado, anti-bot)

YouTube bloquea IPs de datacenter sin cookies/sesión. Para que el resolve no falle:

1. Instala la extensión "Get cookies.txt LOCALLY" en Chrome
2. Exporta las cookies de youtube.com (logged in)
3. Sube el archivo como `./cookies.txt` en esta carpeta

El server detecta automáticamente `./cookies.txt`. ⚠️ No commitees este archivo (está en `.gitignore`).

## PO Tokens (bgutil-pot) — IPs de datacenter

La IP del container suele estar marcada por YouTube (`Sign in to confirm you're not a bot`).
El server usa `bgutil-pot` para generar PO tokens:

- Provider **`bgutil:cli`**: genera el token por petición invocando el binario (sin server
  persistente) — robusto aunque el server HTTP muera. Configurado automáticamente si
  `bin/bgutil-pot` existe.
- Provider **`bgutil:http`**: usa el server en `BGUTIL_POT_BASE_URL` (rápido, cacheado).
  El server se lanza al arranque y se auto-repara (relanzamiento + kill de procesos colgados).

Los clients de resolución priorizan **mweb** y **web** (los únicos que solicitan PO tokens),
con `youtube:fetch_pot=always` para generarlo por adelantado en IPs marcadas.

Si aun con PO token falla el bot-check en TODOS los clients → la IP está bloqueada a nivel
de red; la solución es un **proxy residencial** (`YTDLP_PROXY`).

## Container (Pterodactyl/HidenCloud/etc)

El startup script ejecuta:

```bash
if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi
/usr/local/bin/node /home/container/music-server.js
```

Los binarios se descargan con `setup.sh` en `/home/container/bin/`.

## Proxy residencial AUTOMÁTICO (Termux + Tailscale) — SIN consola

Si el container no tiene `YTDLP_PROXY` ni `proxy.conf`, el server hace **todo**
solo al arrancar (vía `api/_tailscaleSetup.js`): descarga el binario estático
de Tailscale, arranca el daemon en userspace (sin root), **imprime el link de
login en los logs**, espera a que lo aceptes en el navegador (misma cuenta que
teléfono), detecta el peer `termux-phone` en la tailnet y escribe `proxy.conf`
solo. Incluye watchdog de reconexión. No se necesita la web console para nada.

Detalles y pasos: `TERMUX_PROXY.md`.

(El script `setup-container.sh` sigue disponible si algún día quieres hacerlo
en un comando a mano, pero es opcional.)

## ⚠️ Permisos de ejecución al subir por panel

Si subes la carpeta con el file manager/zip del panel, los binarios de `bin/`
pierden el bit `+x` → el server falla con `spawn ... EACCES` (NO es glibc).
El server ahora re-aplica `chmod 755` solo a yt-dlp, ffmpeg, bgutil-pot y
cloudflared al arrancar — pero si tu panel monta `bin/` con `noexec` o los
archivos quedan root-owned, ni el chmod lo salva: borra `bin/bgutil-pot` (o toda
la carpeta) y deja que el server lo re-descargue en el próximo arranque.

## Arquitectura

```
music-server.js          → HTTP server (CORS, rate-limit, routing, túnel cloudflared)
api/_music.js            → Búsqueda en Deezer API
api/_musicStream.js      → Stream completo (yt-dlp + ffmpeg + proxy + cache)
api/_tailscaleSetup.js   → Auto-setup de Tailscale del container (sin consola) + watchdog
setup.sh                 → Descarga binarios para linux arm64
setup-container.sh       → Tailscale del container + proxy.conf automático (opcional, manual)
bin/                     → Binarios (yt-dlp, ffmpeg, cloudflared, bgutil-pot, plugins)
cookies.txt              → Cookies de sesión de YouTube (NO commitear)
proxy.conf               → Proxy residencial (socks5://IP-del-teléfono:1080) — auto-generado
```
