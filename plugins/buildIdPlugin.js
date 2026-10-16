import { execSync } from 'node:child_process';

/**
 * Build ID Plugin — identifica de forma única cada build desplegado.
 *
 * Para qué: la app de escritorio carga la web PUBLICADA, así que cuando se
 * despliega un build nuevo queremos avisar al usuario ("hay una versión nueva →
 * recargar"). El cliente (src/assets/services/deployWatcher.js) compara el
 * `build-id` con el que sirve `/version.json` en el servidor.
 *
 * Qué hace, solo en el build de producción (`apply: 'build'`):
 *   1. Inyecta <meta name="build-id" content="…"> en el HTML.
 *   2. Emite `/version.json` con el mismo id en la raíz del bundle.
 *
 * El id se resuelve, por orden: env de CI (Vercel/GitHub) → `git rev-parse`
 * → marca de tiempo. Nunca rompe el build: ante cualquier fallo usa el timestamp.
 */

function resolveBuildId() {
  const fromEnv =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_REF ||
    '';
  if (fromEnv) return String(fromEnv).slice(0, 12);

  try {
    const sha = execSync('git rev-parse --short=12 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (sha) return sha;
  } catch {
    /* sin git (build desde un tarball): cae al timestamp */
  }

  return `t${Date.now().toString(36)}`;
}

export default function buildIdPlugin() {
  // Se resuelve una vez por build para que HTML y version.json coincidan.
  let buildId = null;
  const getId = () => (buildId ||= resolveBuildId());

  return {
    name: 'build-id',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { name: 'build-id', content: getId() },
          injectTo: 'head',
        },
      ];
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: getId(), builtAt: new Date().toISOString() }),
      });
    },
  };
}
