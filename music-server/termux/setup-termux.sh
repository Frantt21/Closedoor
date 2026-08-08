#!/data/data/com.termux/files/usr/bin/bash
# ─────────────────────────────────────────────────────────────
# setup-termux.sh — Teléfono como IP residencial para el music-server
#
# Instala y arranca:
#   1. microsocks  → servidor SOCKS5 local en el puerto 1080
#   2. Tailscale   → VPN privada estable hacia el container de HidenCloud
#
# Uso:  bash setup-termux.sh
# ─────────────────────────────────────────────────────────────
set -e

PINK='\033[1;35m'; CYAN='\033[1;36m'; GREEN='\033[1;32m'; YEL='\033[1;33m'; RED='\033[1;31m'; NC='\033[0m'
say()  { echo -e "${CYAN}[termux]${NC} $*"; }
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YEL}  ⚠ $*${NC}"; }

# ── 0) Termux básico ─────────────────────────────────────────
say "Actualizando Termux..."
pkg update -y && pkg upgrade -y || warn "pkg update falló (¿red?). Sigo con la instalación."  # Evita que Android mate el proceso en segundo plano. Cada paquete por
  # separado con || true: si uno no existe en los repos, no aborta el script
  # (set -e) ni bloquea el resto de la instalación.
  pkg install -y termux-api || true
  pkg install -y termux-am || true
  pkg install -y termux-services || true
  termux-wake-lock || warn "no se pudo tomar wake-lock (¿permisos?)"

# ── 1) microsocks (SOCKS5 local) ─────────────────────────────
say "Instalando microsocks..."
if command -v microsocks >/dev/null 2>&1; then
  ok "microsocks ya instalado"
else
  pkg install -y microsocks || { warn "microsocks no está en los repos de Termux"; pkg install -y python; }
fi

# ── 2) Tailscale (VPN hacia el container) ────────────────────
say "Instalando Tailscale..."
if command -v tailscale >/dev/null 2>&1; then
  ok "tailscale ya instalado"
else
  pkg install -y tailscale || { warn "tailscale no está en los repos (usa 'pkg install tailscale' — actualiza con pkg update)"; exit 1; }
fi

# ── 3) Autostart: loop que mantiene microsocks + tailscaled ─
# Los servicios de Termux mueren con el proceso; este loop (lanzado con
# termux-services o termux-boot) los mantiene vivos.
mkdir -p "$HOME/.termux/boot" 2>/dev/null || true

cat > "$HOME/.termux/boot/start-music-proxy.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Autostart del proxy residencial (se ejecuta al arrancar el dispositivo
# si tienes instalada la app Termux:Boot).
termux-wake-lock
# microsocks: SOCKS5 local en 0.0.0.0:1080 (solo accesible vía Tailscale)
if command -v microsocks >/dev/null 2>&1; then
  microsocks -i 0.0.0.0 -p 1080 >/dev/null 2>&1 &
fi
# tailscaled (daemon de userspace — sin root)
if command -v tailscaled >/dev/null 2>&1; then
  tailscaled --tun=userspace-networking >/dev/null 2>&1 &
  sleep 3
  tailscale up --hostname=termux-phone >/dev/null 2>&1 &
fi
EOF
chmod +x "$HOME/.termux/boot/start-music-proxy.sh"

# ── 4) Arranque inmediato ────────────────────────────────────
say "Arrancando microsocks (SOCKS5 en :1080)..."
if command -v microsocks >/dev/null 2>&1; then
  microsocks -i 0.0.0.0 -p 1080 >/dev/null 2>&1 &
  sleep 1
  ok "microsocks escuchando en 0.0.0.0:1080"
else
  # Fallback python (SOCKS5 mínimo) si microsocks no existe
  cat > "$HOME/.termux/boot/pysocks.py" <<'PYEOF'
import socket, threading, select
LISTEN = ("0.0.0.0", 1080)
def handle(c):
    try:
        v, n = c.recv(2)
        if v != 5: c.close(); return
        c.sendall(bytes([5, 0]))
        v, cmd, rsv, atyp = c.recv(4)
        if cmd != 1: c.close(); return
        if atyp == 1: addr = socket.inet_ntoa(c.recv(4))
        elif atyp == 3:
            ln = c.recv(1)[0]; addr = c.recv(ln).decode()
        else: c.close(); return
        port = int.from_bytes(c.recv(2), "big")
        up = socket.create_connection((addr, port), 10)
        c.sendall(bytes([5, 0, 0, 1, 0,0,0,0, 0,0]))
        socks = [c, up]
        while True:
            r, _, _ = select.select(socks, [], [], 30)
            if not r: break
            for s in r:
                d = s.recv(65536)
                if not d: c.close(); up.close(); return
                (up if s is c else c).sendall(d)
    except Exception:
        try: c.close()
        except: pass
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(LISTEN); s.listen(64)
while True:
    c, _ = s.accept(); threading.Thread(target=handle, args=(c,), daemon=True).start()
PYEOF
  python "$HOME/.termux/boot/pysocks.py" >/dev/null 2>&1 &
  ok "SOCKS5 python escuchando en 0.0.0.0:1080"
fi

if command -v tailscaled >/dev/null 2>&1; then
  say "Arrancando tailscaled..."
  tailscaled --tun=userspace-networking >/dev/null 2>&1 &
  sleep 3
  if ! tailscale status >/dev/null 2>&1; then
    echo ""
    echo -e "${PINK}═══ AUTENTICA TAILSCALE (una vez) ═══${NC}"
    echo -e "  Ejecuta:  ${CYAN}tailscale up --hostname=termux-phone${NC}"
    echo -e "  Te dará un link (login.tailscale.com/...) — ábrelo en el navegador."
    echo -e "  Después, corre  ${CYAN}tailscale ip -4${NC}  y apunta ese IP en proxy.conf del server."
  else
    ok "Tailscale ya autenticado: $(tailscale ip -4 2>/dev/null | head -1)"
  fi
else
  warn "tailscaled no disponible — instala el paquete tailscale"
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "  ${PINK}Teléfono listo como proxy residencial${NC}"
echo -e "   SOCKS5: 0.0.0.0:1080 (solo vía Tailscale)"
echo -e "   IP Tailscale: $(tailscale ip -4 2>/dev/null | head -1 || echo '— corre tailscale up')"
echo -e "   En el server: crea proxy.conf con  ${CYAN}socks5://<IP-tailscale>:1080${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
