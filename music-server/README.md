# 🎧 Music Server (yt-dlp + ffmpeg)

Server de música standalone para Linux ARM64 (container). Búsqueda en Deezer + streaming completo vía yt-dlp.

## Requisitos

- Node.js 18+ (fetch global)
- Conexión a internet
- ~100MB para binarios (yt-dlp + ffmpeg)

## Setup (una sola vez)

```bash
chmod +x setup.sh && ./setup.sh
```

Esto descarga:
- `yt-dlp` (linux arm64) → `./bin/yt-dlp`
- `ffmpeg` (linux arm64 static) → `./bin/ffmpeg`

## Iniciar

```bash
node music-server.js
```

El server escucha en `http://localhost:3000`.

## Endpoints

| Endpoint | Descripción |
|---|---|
| `GET /api/music/health` | Estado de yt-dlp/ffmpeg |
| `GET /api/music/search?q=...` | Búsqueda en Deezer |
| `GET /api/music/search?track=ID` | Preview fresco de Deezer |
| `GET /api/music/stream?artist=&title=` | Stream completo (yt-dlp) |

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto del server |
| `YTDLP_BIN` | `./bin/yt-dlp` | Ruta a yt-dlp |
| `FFMPEG_BIN` | `./bin/ffmpeg` | Ruta a ffmpeg |
| `YTDLP_COOKIES_FILE` | (auto-detect) | Ruta a cookies.txt (anti-throttle) |

## Cookies (opcional, anti-throttle)

YouTube limita streams sin sesión válida. Para velocidad completa:

1. Instala la extensión "Get cookies.txt LOCALLY" en Chrome
2. Exporta las cookies de YouTube
3. Sube el archivo como `./cookies.txt` en esta carpeta

El server detecta automáticamente `./cookies.txt`.

## Container (Pterodactyl/etc)

El startup script ejecuta:

```bash
if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi
/usr/local/bin/node /home/container/music-server.js
```

Los binarios se descargan con `setup.sh` en `/home/container/bin/`.

## Arquitectura

```
music-server.js          → HTTP server (CORS, rate-limit, routing)
api/_music.js            → Búsqueda en Deezer API
api/_musicStream.js      → Stream completo (yt-dlp + ffmpeg)
setup.sh                 → Descarga binarios para linux arm64
bin/                     → Binarios descargados (yt-dlp, ffmpeg)
```
