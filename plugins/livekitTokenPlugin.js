import { loadEnv } from 'vite';
import { issueLiveKitToken } from '../api/_livekit.js';

/**
 * Vite dev plugin that serves POST /api/livekit-token.
 *
 * En desarrollo, `npm run dev` (vite) NO proxya /api hacia server.js,
 * así que sin este plugin el fetch('/api/livekit-token') del cliente
 * cae en el servidor Vite y devuelve HTML → "No se pudo iniciar la llamada".
 *
 * Este middleware delega en la lógica compartida api/_livekit.js (misma que
 * usan server.js y la función serverless de Vercel en producción).
 *
 * NOTA IMPORTANTE: las variables LIVEKIT_* NO tienen prefijo VITE_, por lo
 * que Vite no las expone en process.env para los plugins. Por eso se usan
 * loadEnv(config.mode, config.envDir, '') que carga TODAS las variables de
 * los .env (incluyendo .env.local y las que no tienen prefijo).
 */
export default function livekitTokenPlugin() {
  let env = null;

  function collectBody(req) {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        if (!raw) return resolve({});
        try { resolve(JSON.parse(raw)); } catch { resolve({}); }
      });
    });
  }

  return {
    name: 'livekit-token',

    configResolved(config) {
      // Cargar TODAS las env vars (con y sin prefijo VITE_)
      env = loadEnv(config.mode, config.envDir, '');
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST' || (req.url || '').split('?')[0] !== '/api/livekit-token') {
          next();
          return;
        }

        const authHeader = req.headers.authorization || '';
        const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        const body = await collectBody(req);

        const result = await issueLiveKitToken({
          supabaseUrl: env?.VITE_SUPABASE_URL || env?.VITE_SUPABASE_DATA_API_URL || '',
          supabaseKey: env?.VITE_SUPABASE_ANON_KEY || env?.VITE_SUPABASE_PUBLISHABLE_KEY || '',
          livekitUrl: env?.LIVEKIT_URL || '',
          livekitApiKey: env?.LIVEKIT_API_KEY || '',
          livekitApiSecret: env?.LIVEKIT_API_SECRET || '',
          accessToken,
          room: body?.room,
        });

        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json');
        if (result.ok) {
          res.end(JSON.stringify({ success: true, token: result.token, url: result.url }));
        } else {
          res.end(JSON.stringify({ success: false, error: result.error }));
        }
      });
    },
  };
}
