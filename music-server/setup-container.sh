#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# music-server/setup-container.sh
# Container (HidenCloud/Pterodactyl) como nodo Tailscale + proxy.conf AUTOMÁTICO
#
# Automatiza TODO el lado container del túnel Termux→Tailscale:
#   1. Descarga el binario estático de Tailscale (formato REAL verificado:
#      tailscale_<ver>_<arch>.tgz — SIN "linux" en el nombre, eso daba 404).
#   2. Arranca tailscaled en userspace (--tun=userspace-networking, sin root).
#   3. Autentica con `tailscale up --hostname=hidencloud-music` (link interactivo).
#   4. DETECTA la IP del teléfono (peer termux-phone en la tailnet) y
#      escribe proxy.conf SOLO:  socks5://<IP-del-teléfono>:1080
#   5. Verifica el túnel con una petición HTTPS real a través del SOCKS5.
#
# Uso:  bash setup-container.sh     (idempotente — puede re-ejecutarse)
# ═══════════════════════════════════════════════════════════════
set -e

PINK='\033[1;35m'; CYAN='\033[1;36m'; GREEN='\033[1;32m'; YEL='\033[1;33m'; RED='\033[1;31m'; NC='\033[0m'
say()  { echo -e "${CYAN}[setup-container]${NC} $*"; }
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YEL}  ⚠ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}"; }

ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$ROOT/bin"
mkdir -p "$BIN_DIR"

# ── Arquitectura → sufijo del tarball ──
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64)  TS_ARCH="amd64" ;;
  aarch64|arm64) TS_ARCH="arm64" ;;
  armv7l|armhf)  TS_ARCH="arm"  ;;
  *) fail "Arquitectura no soportada: $ARCH"; exit 1 ;;
esac
# Versión de respaldo si la detección automática falla (verificada estable):
TS_FALLBACK_VERSION="1.102.2"

echo -e "${PINK}══════════════════════════════════════════════════════${NC}"
echo -e "  Container → nodo Tailscale + proxy.conf (${TS_ARCH})"
echo -e "${PINK}══════════════════════════════════════════════════════${NC}"

# ── 1) Binarios tailscale/tailscaled (bin/ o PATH) ──────────
TS_BIN="$BIN_DIR/tailscale"
TSD_BIN="$BIN_DIR/tailscaled"
[ -x "$TS_BIN" ]  || TS_BIN="$(command -v tailscale 2>/dev/null || echo '')"
[ -x "$TSD_BIN" ] || TSD_BIN="$(command -v tailscaled 2>/dev/null || echo '')"

if [ -z "$TS_BIN" ] || [ -z "$TSD_BIN" ]; then
  say "Descargando binario estático de Tailscale (${TS_ARCH})..."
  # Detección de la última versión desde la página estable (compatible con
  # grep -oE, sin sed -E: toybox/BSD no lo soportan). Formato REAL del tarball:
  # tailscale_<version>_<arch>.tgz — SIN "linux" (ese nombre da 404).
  # ⚠️ set -e: el pipeline puede devolver non-zero (sin red, página cambiada,
  # grep sin match) → abortaría el script antes del fallback. `|| true` lo
  # neutraliza y deja TS_VERSION vacío → el sanity check aplica el fallback.
  TS_VERSION="$(curl -fsSL --max-time 15 https://pkgs.tailscale.com/stable/ 2>/dev/null \
    | grep -oE "tailscale_[0-9.]+_${TS_ARCH}\.tgz" | sort -uV | tail -1 \
    | grep -oE '[0-9]+(\.[0-9]+){2}')" || true
  if ! echo "$TS_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    warn "versión no detectada → usando fallback $TS_FALLBACK_VERSION"
    TS_VERSION="$TS_FALLBACK_VERSION"
  fi
  URL="https://pkgs.tailscale.com/stable/tailscale_${TS_VERSION}_${TS_ARCH}.tgz"
  TMP="/tmp/tailscale-${TS_ARCH}.tgz"
  say "Descargando $URL ..."
  curl -fsSL --max-time 120 -o "$TMP" "$URL" || { fail "descarga falló ($URL)"; exit 1; }
  # Extraer SOLO tailscale + tailscaled (el tgz los trae en la raíz).
  tar -xzf "$TMP" -C "$BIN_DIR" tailscale tailscaled 2>/dev/null \
    || { warn "extracción selectiva falló → extrayendo todo"; tar -xzf "$TMP" -C "$BIN_DIR"; }
  rm -f "$TMP"
  chmod +x "$BIN_DIR/tailscale" "$BIN_DIR/tailscaled" 2>/dev/null || true
  TS_BIN="$BIN_DIR/tailscale"
  TSD_BIN="$BIN_DIR/tailscaled"
  ok "Tailscale $TS_VERSION instalado en $BIN_DIR"
else
  ok "Tailscale ya disponible: $TS_BIN"
fi
[ -x "$TS_BIN" ]  || { fail "tailscale no ejecutable: $TS_BIN"; exit 1; }
[ -x "$TSD_BIN" ] || { fail "tailscaled no ejecutable: $TSD_BIN"; exit 1; }

# ── 2) Daemon tailscaled (userspace, sin root) ───────────────
STATE="$HOME/.tailscale/tailscaled.state"
SOCK="$HOME/.tailscale/tailscaled.sock"
mkdir -p "$(dirname "$STATE")"
if ! pgrep -f tailscaled >/dev/null 2>&1; then
  say "Arrancando daemon tailscaled (userspace)..."
  "$TSD_BIN" --state="$STATE" --socket="$SOCK" --tun=userspace-networking \
    --socks5-server=localhost:1055 >/dev/null 2>&1 &
  sleep 4
fi
if "$TS_BIN" --socket="$SOCK" status >/dev/null 2>&1; then
  ok "Tailscale ya conectado: $($TS_BIN --socket="$SOCK" ip -4 2>/dev/null | head -1)"
else
  echo ""
  echo -e "${PINK}═══ AUTENTICA TAILSCALE (una vez) ═══${NC}"
  echo -e "  Se abre el login en el navegador — ábrelo y acepta."
  "$TS_BIN" --socket="$SOCK" up --hostname=hidencloud-music \
    || "$TS_BIN" up --hostname=hidencloud-music \
    || { fail "no se pudo autenticar — prueba: $TS_BIN up --hostname=hidencloud-music"; exit 1; }
  sleep 2
fi
"$TS_BIN" --socket="$SOCK" status >/dev/null 2>&1 \
  || { fail "daemon no responde (revisa: $TSD_BIN --state=$STATE --socket=$SOCK --tun=userspace-networking &)"; exit 1; }

# ── 3) DETECTAR la IP del teléfono (peer termux-phone) ───────
# `tailscale status --json` lista los peers; se busca el del teléfono:
#   1º hostname que contenga termux/phone, 2º cualquier peer que no sea self.
STATUS_JSON="$("$TS_BIN" --socket="$SOCK" status --json 2>/dev/null || echo '')"
PHONE_IP=""
if [ -n "$STATUS_JSON" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PHONE_IP="$(echo "$STATUS_JSON" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
self_id = (d.get("Self") or {}).get("ID")
self_host = str((d.get("Self") or {}).get("HostName") or "").lower()
peers = list((d.get("Peer") or {}).values())
def v4(p):
    for ip in (p.get("TailscaleIPs") or []):
        if ip.startswith("100."):
            return ip
    return None
# 1) hostname del teléfono (termux/phone)
for p in peers:
    h = str(p.get("HostName") or p.get("DNSName") or "").lower()
    if ("termux" in h or "phone" in h) and v4(p):
        print(v4(p)); sys.exit(0)
# 2) cualquier peer que no sea self ni el propio container
for p in peers:
    if p.get("ID") == self_id:
        continue
    h = str(p.get("HostName") or "").lower()
    if h == self_host or h.endswith(".ts.net") and h.rsplit(".", 2)[0] == self_host:
        continue
    if v4(p):
        print(v4(p)); sys.exit(0)
')"
  else
    # Fallback sin python: parsear la tabla humana de `tailscale status`.
    PHONE_IP="$("$TS_BIN" --socket="$SOCK" status 2>/dev/null \
      | awk '$1 ~ /^100\./ && $0 ~ /termux|phone/ { print $1; exit }')"
  fi
fi

# ── 4) Escribir proxy.conf ──
if [ -n "$PHONE_IP" ]; then
  PROXY_URL="socks5://${PHONE_IP}:1080"
  if [ "$(cat "$ROOT/proxy.conf" 2>/dev/null | head -1 | tr -d '\r')" != "$PROXY_URL" ]; then
    echo "$PROXY_URL" > "$ROOT/proxy.conf"
    ok "proxy.conf actualizado: $PROXY_URL"
  else
    ok "proxy.conf ya correcto: $PROXY_URL"
  fi
else
  warn "no se detectó el teléfono en la tailnet"
  warn "  → ¿el teléfono hizo 'tailscale up --hostname=termux-phone' y está online?"
  warn "  → revisa: $TS_BIN --socket=$SOCK status"
fi

# ── 5) Verificación real del túnel ──
if [ -n "$PHONE_IP" ]; then
  say "Verificando túnel a través del SOCKS5 del teléfono..."
  CODE="$(curl -s --max-time 10 -x "socks5h://${PHONE_IP}:1080" -o /dev/null \
    -w '%{http_code}' https://www.google.com/generate_204 2>/dev/null || echo '000')"
  if [ "$CODE" = "204" ] || [ "$CODE" = "200" ]; then
    ok "proxy alcanzable: YouTube verá la IP residencial del teléfono"
  else
    warn "el túnel no responde (HTTP $CODE) — el server reintentará igualmente"
  fi
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "  ${PINK}Container listo como nodo Tailscale${NC}"
if [ -n "$PHONE_IP" ]; then
  echo -e "   proxy.conf: ${CYAN}socks5://$PHONE_IP:1080${NC}"
  echo -e "   Reinicia el music-server:  ${CYAN}node music-server.js${NC}"
else
  echo -e "   📱 Revisa que el teléfono esté autenticado (termux-phone) y"
  echo -e "      re-ejecuta:  ${CYAN}bash setup-container.sh${NC}"
fi
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
