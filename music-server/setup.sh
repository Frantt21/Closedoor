#!/bin/bash
# ==============================================
# music-server/setup.sh — Setup automático
# ==============================================
# Auto-detecta arquitectura y descarga yt-dlp + ffmpeg.
# Ejecutar una sola vez antes de iniciar el server.
#
# Uso:
#   chmod +x setup.sh && ./setup.sh
# ==============================================

set -e

BIN_DIR="$(cd "$(dirname "$0")" && pwd)/bin"
mkdir -p "$BIN_DIR"

# ── Auto-detectar arquitectura ──
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

echo "🔧 Sistema detectado: $OS $ARCH"
echo "📁 Binarios en: $BIN_DIR"
echo ""

# Mapear arquitectura a nombres de archivo
case "$ARCH" in
  x86_64|amd64)
    YTDLP_ARCH="linux-amd64"
    FFMPEG_ARCH="amd64"
    FFMPEG_STATIC_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
    ;;
  aarch64|arm64)
    YTDLP_ARCH="linux-arm64"
    FFMPEG_ARCH="arm64"
    FFMPEG_STATIC_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz"
    ;;
  armv7l|armhf)
    YTDLP_ARCH="linux-armv7hf"
    FFMPEG_ARCH="armhf"
    FFMPEG_STATIC_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-armhf-static.tar.xz"
    ;;
  *)
    echo "❌ Arquitectura no soportada: $ARCH"
    echo "   Arquitecturas soportadas: x86_64, aarch64/arm64, armv7l"
    exit 1
    ;;
esac

# ── 1. yt-dlp ──
YTDLP_VERSION="2025.06.09"
YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp-${YTDLP_ARCH}"

echo "📦 Descargando yt-dlp ${YTDLP_VERSION} ($YTDLP_ARCH)..."
if curl -L -f -o "$BIN_DIR/yt-dlp" "$YTDLP_URL"; then
  chmod +x "$BIN_DIR/yt-dlp"
  echo "   ✅ yt-dlp instalado: $($BIN_DIR/yt-dlp --version 2>/dev/null || echo 'OK')"
else
  echo "   ❌ Error descargando yt-dlp desde: $YTDLP_URL"
  echo "   Intenta descargar manualmente desde: https://github.com/yt-dlp/yt-dlp/releases"
fi
echo ""

# ── 2. ffmpeg ──
echo "📦 Descargando ffmpeg ($FFMPEG_ARCH static)..."
FFMPEG_TMP="/tmp/ffmpeg-${FFMPEG_ARCH}.tar.xz"
if curl -L -f -o "$FFMPEG_TMP" "$FFMPEG_STATIC_URL"; then
  echo "   Extrayendo..."
  cd /tmp
  tar xf "$FFMPEG_TMP" 2>/dev/null
  # Buscar el binario ffmpeg en el tarball extraído
  FFMPEG_DIR=$(find . -maxdepth 1 -name "ffmpeg-*-static" -type d | head -1)
  if [ -n "$FFMPEG_DIR" ] && [ -f "$FFMPEG_DIR/ffmpeg" ]; then
    cp "$FFMPEG_DIR/ffmpeg" "$BIN_DIR/ffmpeg"
    cp "$FFMPEG_DIR/ffprobe" "$BIN_DIR/ffprobe" 2>/dev/null || true
    rm -rf "$FFMPEG_DIR"
  else
    echo "   ⚠️ No se encontró ffmpeg en el tarball, intentando extracción directa..."
    tar xf "$FFMPEG_TMP" --wildcards '*/ffmpeg' --strip-components=1 -C "$BIN_DIR/" 2>/dev/null || true
  fi
  rm -f "$FFMPEG_TMP"
  chmod +x "$BIN_DIR/ffmpeg" 2>/dev/null || true
  echo "   ✅ ffmpeg instalado: $($BIN_DIR/ffmpeg -version 2>&1 | head -1 || echo 'OK')"
else
  echo "   ❌ Error descargando ffmpeg desde: $FFMPEG_STATIC_URL"
  echo "   Intenta instalar ffmpeg manualmente: apt install ffmpeg"
fi
echo ""

# ── 3. Verificar ──
echo "═══════════════════════════════════════════════"
echo "  ✅ Instalación completa"
echo "═══════════════════════════════════════════════"
echo ""
echo "  Arquitectura: $ARCH"
echo "  yt-dlp:  $BIN_DIR/yt-dlp"
echo "  ffmpeg:  $BIN_DIR/ffmpeg"
echo ""

# Verificar que los binarios funcionan
if [ -x "$BIN_DIR/yt-dlp" ]; then
  echo "  yt-dlp version: $($BIN_DIR/yt-dlp --version 2>/dev/null || echo 'Error')"
else
  echo "  ⚠️ yt-dlp no es ejecutable"
fi

if [ -x "$BIN_DIR/ffmpeg" ]; then
  echo "  ffmpeg version: $($BIN_DIR/ffmpeg -version 2>&1 | head -1 || echo 'Error')"
else
  echo "  ⚠️ ffmpeg no es ejecutable"
fi

echo ""
echo "  Para iniciar el server:"
echo "    node music-server.js"
echo ""
