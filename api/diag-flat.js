/**
 * SONDA TEMPORAL (borrar cuando el misterio esté cerrado).
 *
 * Hipótesis B: lo que rompe `/api/music/*` en produccion es el bloque
 * `export const config = { runtime: 'nodejs', … }`. Esta función vive en la RAIZ
 * de `api/` (como las cinco que sí responden) pero declara EXACTAMENTE el mismo
 * tipo de config que las tres que cuelgan.
 *
 * Uso: GET /api/diag-flat
 *   - 200 JSON  → el config no es el problema (la causa era la subcarpeta).
 *   - cuelga    → el config sí es el problema; las tres de api/music/* lo quitaban
 *                 en el mismo deploy, así que deberían responder ya.
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 10,
};

const PROBE = 'flat-with-config';

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
