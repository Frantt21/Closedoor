/**
 * diag-innertube-ip.mjs — ¿qué cliente de innertube deja YouTube desde ESTA IP?
 *
 * POR QUÉ EXISTE: el 2026-10-16 el host 24/7 empezó a responder
 *   `no se pudo resolver el audio (ANDROID_VR: Sign in to confirm you're not a
 *   bot | IOS: … | ANDROID: …)`
 * con los 3 clientes que usa el resolver. Es el bloqueo de YouTube a IPs de
 * datacenter, es decir: no es un bug del código. La duda que decide todo es si
 * ALGÚN cliente se escapa desde esa IP; sin eso, mover el rewrite a ese host
 * sólo cambia 504 por 502.
 *
 * Sin imports del repo a propósito: se puede ejecutar en cualquier copia y
 * sobrevive a cambios en api/_innertube.js. No escribe nada, sólo pregunta.
 *
 * Uso (en la consola del panel, dentro de /home/container):
 *   node scripts/diag-innertube-ip.mjs
 *   DIAG_VIDEO_ID=dQw4w9WgXcQ node scripts/diag-innertube-ip.mjs   (otro vídeo)
 */

const VIDEO_ID = process.env.DIAG_VIDEO_ID || 'Irtc7pQPozY'; // Radiohead - Creep
const WEB_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const MOBILE_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
const IOS_KEY = 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** Los 3 que usa el resolver (api/_innertube.js) + los descartados en el sondeo. */
const CLIENTS = [
  ['ANDROID_VR', '1.60.19', MOBILE_KEY, 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip', { androidSdkVersion: 32 }],
  ['IOS', '20.10.4', IOS_KEY, 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5 like Mac OS X)', { deviceModel: 'iPhone16,2' }],
  ['ANDROID', '20.10.38', MOBILE_KEY, 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip', { androidSdkVersion: 34 }],
  ['ANDROID_TESTSUITE', '1.9.0', MOBILE_KEY, 'com.google.android.youtube/1.9.0 (Linux; U; Android 14) gzip', { androidSdkVersion: 34 }],
  ['IOS_MUSIC', '7.32.0', IOS_KEY, 'com.google.ios.youtubemusic/7.32.0 (iPhone16,2; U; CPU iOS 17_5 like Mac OS X)', { deviceModel: 'iPhone16,2' }],
  ['ANDROID_MUSIC', '7.32.0', MOBILE_KEY, 'com.google.android.apps.youtube.music/7.32.0 (Linux; U; Android 14) gzip', { androidSdkVersion: 34 }],
  ['WEB', '2.20260101.00.00', WEB_KEY, BROWSER_UA, {}],
  ['MWEB', '2.20260101.00.00', WEB_KEY, BROWSER_UA, {}],
  ['WEB_REMIX', '1.20260101.00.00', WEB_KEY, BROWSER_UA, {}],
  ['TVHTML5_SIMPLY_EMBEDDED_PLAYER', '2.0', WEB_KEY, BROWSER_UA, {}],
];

async function playerRequest(name, version, key, userAgent, extra) {
  const body = {
    context: { client: { clientName: name, clientVersion: version, hl: 'en', gl: 'US', ...extra } },
    videoId: VIDEO_ID,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    }
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* respuesta no-JSON */
  }
  const status = json?.playabilityStatus?.status || (res.ok ? 'sin playabilityStatus' : `HTTP ${res.status}`);
  const reason = (json?.playabilityStatus?.reason || '').replace(/\s+/g, ' ').slice(0, 60);
  const adaptive = json?.streamingData?.adaptiveFormats?.length || 0;
  const muxed = json?.streamingData?.formats?.length || 0;
  const itags = [
    ...(json?.streamingData?.adaptiveFormats || []),
    ...(json?.streamingData?.formats || []),
  ]
    .map((f) => f.itag)
    .filter(Boolean);
  return { status, reason, adaptive, muxed, itags };
}

async function main() {
  console.log(`sonda innertube · vídeo ${VIDEO_ID}`);
  try {
    const ip = await (await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) })).text();
    const uk = await (
      await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(8000) })
    ).json();
    console.log(`IP de salida: ${ip} · ${uk?.org || '?'} · ${uk?.city || '?'}/${uk?.country || '?'}\n`);
  } catch {
    console.log('IP de salida: (no se pudo consultar)\n');
  }

  const ok = [];
  for (const [name, version, key, ua, extra] of CLIENTS) {
    try {
      const r = await playerRequest(name, version, key, ua, extra);
      const playable = r.status === 'OK' && r.itags.length > 0;
      if (playable) ok.push(`${name} (itags ${[...new Set(r.itags)].join(',')})`);
      const tag = playable ? 'JUGABLE  ' : 'bloqueado';
      const detail = r.reason ? `"${r.reason}"` : `status=${r.status} adaptive=${r.adaptive} muxed=${r.muxed}`;
      console.log(`${tag} ${`${name} ${version}`.padEnd(44)}${detail}`);
    } catch (err) {
      console.log(`${'error    '.padEnd(9)} ${name} ${version}`.padEnd(58) + (err?.message || err));
    }
  }

  console.log('');
  console.log(ok.length ? `✅ clientes jugables desde esa IP: ${ok.join(' · ')}` : '❌ NINGÚN cliente jugable desde esa IP');
  console.log(
    ok.length
      ? '   → el resolver puede funcionar si se añade ese cliente a CLIENTS (api/_innertube.js).'
      : '   → el audio no se puede resolver desde esta IP: hace falta otra IP (túnel/residencial) o un PO token.'
  );
}

main().catch((err) => {
  console.error('sonda falló:', err?.message || err);
  process.exit(1);
});
