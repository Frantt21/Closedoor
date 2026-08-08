# 📱 Teléfono como IP residencial (Termux + Tailscale)

El music-server en HidenCloud tiene una **IP de datacenter** que googlevideo
bloquea a nivel TCP (`ETIMEDOUT`) o con bot-check (`Sign in to confirm you're
not a bot`). La solución de fondo: **todo el tráfico a YouTube sale por la IP
residencial del teléfono**, y HidenCloud hace el trabajo pesado (buscar,
elegir candidato, servir al cliente).

```
App (frontend) → HidenCloud (music-server) → SOCKS5 del teléfono → YouTube
                    │                            (yt-dlp: search + resolve)
                    │                            (media: fetch del audio)
                    └── sirve el stream al cliente
```

## Requisitos

- Teléfono Android con [Termux](https://f-droid.org/packages/com.termux/) + app **Termux:Boot** (autostart).
- Container de HidenCloud (linux arm64) — ya corre el music-server.
- Cuenta de [Tailscale](https://tailscale.com) (plan gratuito).

---

## 1) Teléfono (una vez)

```bash
# Copia el script al teléfono y ejecútalo:
bash setup-termux.sh
```

Instala `microsocks` (SOCKS5 local en `:1080`) + `tailscale`, los arranca y
deja el autostart en `~/.termux/boot/`.

### Autenticar Tailscale (la primera vez)

```bash
tailscale up --hostname=termux-phone
# → te da un link login.tailscale.com/...  Ábrelo y acepta.
tailscale ip -4
# → 100.x.y.z   (APUNTA este IP)
```

> 💡 **Termux:Boot**: al instalar la app, al reiniciar el teléfono el script
> `start-music-proxy.sh` re-arranca microsocks + tailscaled solo. Usa
> `termux-wake-lock` para que Android no mate el proceso (ya va en el script).

---

## 2) Container de HidenCloud (una vez)

Sube los archivos del `music-server/` actualizado (incluye la integración de
proxy y el health). Luego, **por la web console** (sin SSH):

```bash
# 1. Descarga el binario de Tailscale (arm64) y súbelo a bin/
#    (o descárgalo tú localmente y súbelo por FTP/panel):
#    https://pkgs.tailscale.com/stable/#static → tailscale_*.tgz (linux arm64)
#    Extrae tailscale + tailscaled y súbelos a /home/container/bin/
#    chmod +x /home/container/bin/tailscale*

# 2. Arranca tailscaled en userspace (sin TUN, sin root):
cd /home/container/bin
./tailscaled --state=/home/container/.tailscale.state --tun=userspace-networking &
sleep 3
./tailscale up --hostname=hidencloud-music
# → mismo flujo: link de login → acepta en el navegador

# 3. Crea el archivo de proxy del music-server:
echo 'socks5://100.x.y.z:1080' > /home/container/proxy.conf
#    (100.x.y.z = IP del TELÉFONO del paso 1)
```

> **¿No se puede ejecutar nada?** Los paneles tipo HidenCloud permiten subir
> archivos y setear variables. Puedes:
> - Poner `socks5://100.x.y.z:1080` en la variable `YTDLP_PROXY` del panel, **o**
> - subir el archivo `proxy.conf` junto a `music-server.js` (el server lo lee solo).

### 2b) Si el container NO puede correr tailscaled

El container solo hace **conexiones salientes**. Alternativa sin Tailscale en
el container: expón el SOCKS5 del teléfono con un túnel saliente del propio
teléfono hacia un relay intermedio:

```bash
# En el TELÉFONO: expón 0.0.0.0:1080 como túnel TCP público
npx localtunnel --port 1080   # → https://xxx.loca.lt  (frágil)
# O mejor: cloudflared quick tunnel TCP (requiere el binario en Termux)
```

y pon esa URL en `proxy.conf` (solo sirve si el relay soporta SOCKS5 puro;
Tailscale es **mucho** más fiable — recomendado).

---

## 3) Verificar

1. `GET /api/music/health` → debe aparecer `"proxy": { "configured": true, ... }`.
2. En los logs de arranque:
   ```
   proxy: socks5://100.x.y.z:1080 (socks5)
   proxy: ✅ alcanzable vía socks5://100.x.y.z:1080 → YouTube verá IP residencial
   ```
3. Haz un play: la resolución debe pasar **sin** `Sign in to confirm` y el
   fetch del media **sin** `ETIMEDOUT`/`403`.

---

## Fallos típicos

| Síntoma | Causa | Fix |
|---|---|---|
| `proxy: ⚠️ configurado pero NO responde` | Teléfono dormido / Tailscale caído / IP vieja en proxy.conf | Despierta el teléfono, `tailscale status` en ambos lados, actualiza proxy.conf |
| `ETIMEDOUT` persiste | proxy.conf apunta a IP equivocada | `tailscale ip -4` en el teléfono y actualiza |
| La app usa preview 30s | health no reporta proxy / server reiniciado sin proxy.conf | Revisa logs de arranque |

## Notas

- El audio fluye por el túnel del teléfono (~16-32 KB/s a 128-256 kbps): el
  WiFi/4G del teléfono sobra de sobra.
- Las URLs de googlevideo quedan ligadas a la IP que resuelve → **todo** debe
  salir por el mismo proxy (resolve + media) — el server ya lo garantiza con
  `--proxy` (yt-dlp) + `PROXY_AGENT` (fetch del media).
- Si el teléfono se queda sin batería, el server reintenta y **no** cae: la
  cadena de reintentos sigue funcionando (aunque con la IP del container).
