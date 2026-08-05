import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';

/**
 * AppSurfaceTheme
 *
 * Hace que el sidebar (Header) use el MISMO tratamiento de superficie que
 * las cards de perfil cuando el usuario tiene el modo translúcido/glass
 * activo (accent_surface_glass) o un color de superficie personalizado
 * (accent_surface_color).
 *
 * Las cards (RightPanel / ProfileSidebar) definen las vars --accent-surface-*
 * inline en sí mismas; el sidebar no tiene dónde ponerlas, así que este
 * componente las aplica directamente sobre el elemento `.sidebar` vía
 * useEffect (mismo patrón que las cards, sin duplicar lógica).
 *
 * Si el usuario NO tiene glass/color de superficie activo, se quitan las
 * vars y el sidebar usa su fallback CSS translúcido (color-mix + blur),
 * así el blur se mantiene siempre.
 */
const SURFACE_VARS = [
  '--accent-surface-rgba',
  '--accent-surface-rgba-hover',
  '--accent-surface-blur',
  '--accent-surface-border',
];

export default function AppSurfaceTheme() {
  const { profile } = useAuth();
  const { showAccent } = useI18n();
  // Re-aplicar al navegar: si el nodo .sidebar se recreó (remount del Header),
  // las vars del glass se re-aplican al nodo nuevo (el efecto es barato).
  const location = useLocation();

  useEffect(() => {
    const el = document.querySelector('.sidebar');
    if (!el) return;

    const surfColor = profile?.accent_surface_color;
    const surfGlass = profile?.accent_surface_glass === true;
    const active = showAccent && (surfGlass || surfColor);

    if (active) {
      // Mismas reglas que RightPanel/ProfileSidebar (glass mode o color custom)
      el.style.setProperty(
        '--accent-surface-rgba',
        surfGlass ? 'rgba(255, 255, 255, 0.04)' : (surfColor || 'var(--color-surface, #1a1a1a)')
      );
      el.style.setProperty(
        '--accent-surface-rgba-hover',
        surfGlass ? 'rgba(255, 255, 255, 0.07)' : (surfColor ? `color-mix(in srgb, ${surfColor} 85%, #000)` : 'var(--color-surface-hover, #252525)')
      );
      el.style.setProperty('--accent-surface-blur', surfGlass ? 'blur(20px)' : 'none');
      el.style.setProperty('--accent-surface-border', 'none');
    } else {
      // Sin glass: quitar vars → el fallback CSS del sidebar (translúcido) aplica
      SURFACE_VARS.forEach((v) => el.style.removeProperty(v));
    }

    return () => {
      SURFACE_VARS.forEach((v) => el.style.removeProperty(v));
    };
  }, [profile, showAccent, location.pathname]);

  return null;
}
