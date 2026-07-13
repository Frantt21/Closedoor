# ▲ Deploy a Vercel — FastChange con OG Tags

Guía para desplegar la app en [Vercel](https://vercel.com) con Open Graph meta tags
funcionando para previews en Discord, Twitter, Facebook, WhatsApp, etc.

---

## Requisitos

- Cuenta en [vercel.com](https://vercel.com) (gratis)
- Tu proyecto en GitHub (o conectas directo desde Vercel)
- Las variables de entorno de Supabase listas

---

## Archivos necesarios

### 1. `api/og-profile.js` (ya creado)

Serverless function que intercepta `/profile/:username`, fetchea datos de Supabase
e inyecta las OG meta tags en el HTML antes de servirlo.

### 2. `vercel.json` — Configuración de Vercel

Necesitas crear este archivo en la raíz del proyecto:

```json
{
  "functions": {
    "api/og-profile.js": {
      "maxDuration": 10
    }
  },
  "rewrites": [
    {
      "source": "/profile/:username",
      "destination": "/api/og-profile"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

Esto hace que:
- Las rutas `/profile/:username` sean manejadas por la serverless function
- El resto de rutas sigan siendo SPA (React Router)

---

## Step 1: Build local

```bash
npm run build
```

Esto genera la carpeta `dist/` con los archivos estáticos.

---

## Step 2: Subir a GitHub

```bash
git add .
git commit -m "Add Vercel OG tags and config"
git push
```

---

## Step 3: Importar en Vercel

1. Ve a [vercel.com/new](https://vercel.com/new)
2. Conecta tu repositorio de GitHub
3. **Framework Preset:** Vite
4. **Build Command:** `npm run build`
5. **Output Directory:** `dist`
6. **Environment Variables** (sumamente importante):
   - `VITE_SUPABASE_URL` → tu URL de Supabase
   - `VITE_SUPABASE_ANON_KEY` → tu anon key de Supabase
7. Haz clic en **Deploy**

---

## Step 4: Probar

Una vez desplegado, Vercel te dará una URL como:

```
https://fastchange.vercel.app
```

Pruébala en Discord:

```
https://fastchange.vercel.app/profile/fran
```

Discord scrabeará la URL, la serverless function (`api/og-profile.js`) inyectará
las OG tags con los datos reales del usuario, y se mostrará el preview card.

También puedes probar con:
- **[opengraph.xyz](https://www.opengraph.xyz/)** — Pega la URL y ves el preview
- **[Twitter Card Validator](https://cards-dev.twitter.com/validator)**

---

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Error 404 en profile | Verifica que `vercel.json` tenga el rewrite correcto |
| Las OG tags no aparecen | Revisa que las env vars estén configuradas en Vercel |
| Error de Supabase | Confirma que `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` son correctas |
| Build falla | Asegúrate de haber ejecutado `npm run build` localmente antes del push |

---

## Notas importantes

- La serverless function **lee el `index.html` de `dist/`** que se generó en el build
- Las env vars deben configurarse en el dashboard de Vercel (Project Settings → Environment Variables)
- Vercel cachea las serverless functions, los primeros requests pueden ser lentos (cold start)
- Los crawlers de Discord/Twitter no tienen problemas de CORS ni nada — solo leen el HTML
