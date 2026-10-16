# Documentacion de FastChange

Indice de toda la documentacion del proyecto. La guia principal de instalacion y uso esta en el [README de la raiz](../README.md).

---

## Base de datos

| Documento | Descripcion |
|---|---|
| [database/SUPABASE_REFERENCE.md](./database/SUPABASE_REFERENCE.md) | Referencia unificada de Supabase: configuracion, esquema de tablas, politicas RLS, funciones, triggers y realtime |
| [database/migracion-053-email.md](./database/migracion-053-email.md) | Migracion 053: proteccion de la columna `email` de la tabla `profiles` |

## Seguridad

| Documento | Descripcion |
|---|---|
| [security/AUDITORIA-SEGURIDAD.md](./security/AUDITORIA-SEGURIDAD.md) | Auditoria y endurecimiento: vulnerabilidades corregidas, CSP, RPCs y flujo completo de seguridad |
| [security/DB_SECURITY_TEST.md](./security/DB_SECURITY_TEST.md) | Pruebas manuales de RLS desde DevTools (lectura, escritura y modificacion no autorizada) |

## Musica

La cancion del perfil no necesita documentacion de infraestructura: el audio se
resuelve con la API innertube desde la propia app (`api/_innertube.js`, servido
por `/api/music/stream`). Ver la seccion "Cancion del perfil" del README raiz.

En el navegador YouTube solo sirve la cancion completa a IPs con buena
reputacion, asi que la via para oirla entera es la app de escritorio:

- [../desktop/README.md](../desktop/README.md) — envoltorio Electron, servidor de
  musica local en `127.0.0.1:5990` y piezas acopladas (CSP, puerto).
- [deployment/ELECTRON_BUILD.md](./deployment/ELECTRON_BUILD.md) — lanzar la app
  en desarrollo y generar los instaladores paso a paso.

## Deploy y redes

| Documento | Descripcion |
|---|---|
| [deployment/VERCEL_DEPLOYMENT.md](./deployment/VERCEL_DEPLOYMENT.md) | Deploy en Vercel con OG tags y serverless functions |
| [deployment/NGROK_SETUP.md](./deployment/NGROK_SETUP.md) | Probar OG tags localmente con tunel ngrok |
| [deployment/ELECTRON_BUILD.md](./deployment/ELECTRON_BUILD.md) | App de escritorio: requisitos, lanzarla en dev, probarla sin pantalla, generar instaladores y publicar la descarga |

## Otros componentes

- [src/hooks/AlphabetEncryption.md](../src/hooks/AlphabetEncryption.md) — detalle del sistema de encriptacion de publicaciones.

## Credenciales e infraestructura

- [INFRAESTRUCTURA.md](./INFRAESTRUCTURA.md) — ubicaciones y credenciales del servidor CDN. **No se sube a git** (ver `.gitignore`).
