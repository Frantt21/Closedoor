/**
 * activityService.js — actividad local del usuario (música / vídeo / juegos).
 *
 * CONTEXTO: la web no puede leer sesiones multimedia ni procesos del sistema.
 * La app de escritorio sí (desktop/activity.js) y la publica por IPC
 * (window.electron.activity, ver desktop/preload.js). Este módulo se encarga de
 * la parte de DATOS:
 *
 *   1. Normalizar lo que llega del bridge a un shape estable y acotado.
 *   2. Decidir si un registro guardado en `profiles.activity` sigue siendo
 *      válido (si no, se oculta como si no hubiera actividad).
 *   3. Escribirlo en la fila del usuario, con dedupe.
 *
 * El shape guardado es el mismo que devuelve el detector, sin `detectedAt` (esa
 * marca es local; lo que caduca el registro es `activity_updated_at`, que pone
 * la base de datos al escribir).
 *
 * Requiere la migración services/migrations/079_profiles_activity.sql (columnas
 * `activity` / `activity_updated_at`). No hace falta GRANT: la 071 dejó los
 * privilegios de `profiles` a nivel tabla.
 */

import { supabase } from './supabaseclient';

/**
 * Cuánto vale una actividad guardada. Si el equipo se apagó, la app crasheó o
 * el usuario cerró sesión sin limpiar, el registro se queda huérfano; pasado
 * este tiempo se ignora en vez de mostrar algo que ya no está pasando.
 */
export const ACTIVITY_TTL_MS = 1000 * 60 * 15;

/** Límites de longitud: lo que se guarda se pinta a otros usuarios. */
const MAX_TITLE = 160;
const MAX_SUBTITLE = 160;
const MAX_ALBUM = 160;
const MAX_APP = 60;
const MAX_URL = 500;

const KINDS = new Set(['music', 'video', 'game']);

function clip(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

/**
 * Normaliza una actividad (del bridge o de la fila de la DB).
 *
 * Acepta cualquier cosa: si falta `kind` o `title`, o el kind no es conocido,
 * devuelve `null`. Así un dato corrupto en la fila no rompe la card.
 *
 * @returns {null | {kind: 'music'|'video'|'game', title: string, subtitle: string|null, album: string|null, app: string|null, url: string|null}}
 */
export function normalizeActivity(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = typeof raw.kind === 'string' ? raw.kind.toLowerCase() : '';
  if (!KINDS.has(kind)) return null;
  const title = clip(raw.title, MAX_TITLE);
  if (!title) return null;
  return {
    kind,
    title,
    subtitle: clip(raw.subtitle, MAX_SUBTITLE),
    album: clip(raw.album, MAX_ALBUM),
    app: clip(raw.app, MAX_APP),
    url: clip(raw.url, MAX_URL),
  };
}

/**
 * ¿El registro guardado sigue siendo actual?
 *
 * Sin `updatedAt` se considera caducado: mejor no mostrar nada que mostrar algo
 * de hace días.
 */
export function isActivityFresh(activity, updatedAt, now = Date.now()) {
  if (!activity) return false;
  if (!updatedAt) return false;
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  // Tolerancia de 1 min hacia el futuro por desajustes de reloj del cliente.
  return now - ts < ACTIVITY_TTL_MS && ts - now < 60 * 1000;
}

/**
 * Actividad de un perfil leído de la DB, ya validada y caducada si toca.
 *
 * @param {{activity?: object|null, activity_updated_at?: string|null}} profile
 * @returns {null | {kind: string, title: string, ...}}
 */
export function activityFromProfile(profile) {
  if (!profile) return null;
  const activity = normalizeActivity(profile.activity);
  if (!activity) return null;
  return isActivityFresh(activity, profile.activity_updated_at) ? activity : null;
}

/** Firma de una actividad normalizada — para detectar cambios sin comparar objetos. */
export function activitySignature(activity) {
  if (!activity) return '';
  return [activity.kind, activity.title, activity.subtitle || '', activity.album || '', activity.app || '', activity.url || ''].join('\u0001');
}

// Última escritura confirmada. Vive a nivel de módulo para que navegar entre
// perfiles (que desmonta y remonta la card) no repita el mismo UPDATE.
let lastWrittenKey = null;

/**
 * Guarda la actividad en la fila del usuario (o la limpia con `null`).
 *
 * Dedupe: si el valor es idéntico al último escrito con éxito no se vuelve a
 * escribir. El detector sondea cada 10 s, pero solo avisa cuando cambia, así que
 * en la práctica esto es una escritura por cambio real de canción/juego.
 *
 * @param {string} userId
 * @param {null | object} rawActivity
 * @returns {Promise<boolean>} true si se escribió, false si no había nada que hacer
 */
export async function persistActivity(userId, rawActivity) {
  if (!userId) return false;

  const activity = normalizeActivity(rawActivity);
  const key = `${userId}:${activitySignature(activity)}`;
  if (key === lastWrittenKey) return false;

  const { error } = await supabase
    .from('profiles')
    .update({
      activity,
      activity_updated_at: activity ? new Date().toISOString() : null,
    })
    .eq('id', userId);

  if (error) {
    // Sin marca de "escrito" para que el siguiente cambio (o reintento) sí lo intente.
    lastWrittenKey = null;
    throw error;
  }

  lastWrittenKey = key;
  return true;
}
