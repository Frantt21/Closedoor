/**
 * SONDA TEMPORAL (borrar cuando el misterio esté cerrado).
 *
 * Hipótesis A: lo que rompe `/api/music/*` en produccion es vivir en la
 * SUBCARPETA `api/music/`. Esta función es idéntica en forma a las otras tres
 * (misma ruta anidada) pero SIN `export const config`.
 *
 * Uso: GET /api/music/diag-nested
 *   - 200 JSON  → la subcarpeta no es el problema (la causa era el config).
 *   - cuelga    → la subcarpeta sí es el problema; hay que aplanar las funciones.
 */
const PROBE = 'nested-no-config';

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
