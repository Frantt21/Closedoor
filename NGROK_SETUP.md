# 🚇 Probar OG Tags con ngrok (Windows)

Usa ngrok para exponer tu servidor local y que Discord/Twitter/Facebook puedan scrabear las Open Graph meta tags y mostrar un preview card del perfil.

---

## Requisitos

- Node.js instalado
- Tu proyecto FastChange funcionando
- Una cuenta gratuita en [ngrok.com](https://ngrok.com) (para el authtoken)

---

## Paso 1: Descargar ngrok para Windows

1. Ve a [ngrok.com/download](https://ngrok.com/download)
2. Descarga la versión **Windows** (64-bit)
3. Extrae `ngrok.exe` en una carpeta, por ejemplo: `C:\ngrok\ngrok.exe`
4. (Opcional) Agrega `C:\ngrok\` a tu PATH del sistema para poder ejecutar `ngrok` desde cualquier terminal

---

## Paso 2: Configurar el authtoken (una sola vez)

1. Regístrate gratis en [dashboard.ngrok.com/signup](https://dashboard.ngrok.com/signup)
2. Ve a [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
3. Copia tu token (ej: `2abc...`)
4. Abre **CMD o PowerShell** como administrador y ejecuta:

```bash
C:\ngrok\ngrok.exe config add-authtoken TU_TOKEN_AQUI
```

(Si agregaste ngrok al PATH, simplemente `ngrok config add-authtoken TU_TOKEN_AQUI`)

---

## Paso 3: Iniciar el servidor

Tienes **dos opciones** (ambas funcionan con OG tags ahora):

### Opción A — Dev mode (recomendado para testing)

```bash
# Terminal 1: Inicia Vite con las OG tags via plugin
npm run dev
```

Esto corre en `http://localhost:5173`

### Opción B — Build + Server (más realista)

```bash
npm run build
npm start
```

Esto corre en `http://localhost:3000`

---

## Paso 4: Iniciar ngrok

Abre una **segunda terminal** (CMD o PowerShell) y ejecuta:

```bash
C:\ngrok\ngrok.exe http 5173
```

(O `C:\ngrok\ngrok.exe http 3000` si elegiste la Opción B)

Deberías ver algo como:

```
Forwarding  https://a1b2c3d4.ngrok.io -> http://localhost:5173
```

Esa URL `https://a1b2c3d4.ngrok.io` es tu **URL pública temporal**.

---

## Paso 5: Probar en Discord

1. Copia la URL ngrok, por ejemplo: `https://a1b2c3d4.ngrok.io`
2. Agrégale `/profile/tuusuario`, ejemplo:

   ```
   https://a1b2c3d4.ngrok.io/profile/miusuario
   ```

3. Pégalo en Discord
4. ⏳ Espera unos segundos — Discord scrabeará la URL y mostrará el preview card con:
   - **Avatar o banner** del usuario
   - **Username** con @
   - **Bio** (descripción)
   - **Título** de la página

---

## Paso 6: Probar con otras herramientas

Si no ves el preview en Discord inmediatamente, puedes debuggear con:

- **[opengraph.xyz](https://www.opengraph.xyz/)** — Pega tu URL ngrok y ves exactamente cómo se ve el preview
- **[Twitter Card Validator](https://cards-dev.twitter.com/validator)** — Para verificar las twitter:card tags
- **[Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)** — Para verificar las og: tags

---

## Notas importantes

- ⚠️ La URL ngrok **cambia cada vez que reinicias ngrok** (a menos que tengas plan pago)
- ⚠️ Mientras ngrok esté corriendo, **cualquier persona con la URL puede acceder a tu servidor local**. Apágalo cuando termines (`Ctrl+C`)
- ✅ El plugin de Vite inyecta OG tags para rutas `/profile/:username` en **dev mode**
- ✅ El `server.js` hace lo mismo en **producción** (build + start)
- ❌ Discord **NO puede scrabear `localhost`** — ngrok o un deploy son necesarios para probar

---

## Troubleshooting

| Problema | Solución |
|----------|----------|
| `ngrok: command not found` | Usa la ruta completa `C:\ngrok\ngrok.exe` o agrega la carpeta al PATH |
| El preview no aparece | Espera unos segundos y recarga el mensaje en Discord |
| Solo se ve la URL plana | Verifica que ngrok esté corriendo y que la URL sea la correcta |
| Error de authtoken | Ejecuta `ngrok config add-authtoken TU_TOKEN` |
| El servidor no responde | Asegúrate de que `npm run dev` o `npm start` esté corriendo en la otra terminal |

---

## ¿Listo para producción?

Cuando quieras desplegar en **Vercel**, necesitarás adaptar el `server.js` a una serverless function (Vercel no soporta Express completo de forma nativa). Pídeme que te genere la guía de deploy cuando estés listo.
