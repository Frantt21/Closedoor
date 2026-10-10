/**
 * SONDA TEMPORAL (borrar cuando el misterio esté cerrado).
 *
 * Es la casilla que faltaba: PLANA, SIN `export const config` y NUEVA. Las otras
 * dos sondas mezclan factores:
 *   - api/music/diag-nested.js  → anidada, sin config      → cuelga
 *   - api/diag-flat.js          → plana, con config        → cuelga (respeta su maxDuration)
 *   - api/music-search.js       → plana, sin config, VIEJA → funciona
 *
 * Uso: GET /api/diag-plain
 *   - 200 JSON  → el problema es la SUBCARPETA (o el config): aplanar api/music/*
 *                 y sacar las URLs a /api/music-* resuelve la música en Vercel.
 *   - cuelga    → el problema es que la función es NUEVA/MODIFICADA en el deploy:
 *                 el pipeline de funciones del proyecto está roto para todo lo
 *                 que cambia, y aplanar no arreglaría nada. Toca servir la música
 *                 fuera de Vercel (rewrite a un host propio) o rehacer el proyecto.
 */
const PROBE = 'flat-new-no-config';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      probe: PROBE,
      runtime: process.version,
      now: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}
