-- ==============================================
-- Migration 076: show_cards_glass como preferencia de cuenta
-- ==============================================
-- El toggle "Tarjetas transparentes" aplica el mismo tratamiento
-- translúcido/glass de las cards del perfil a las cards del resto del app
-- (posts, ajustes, notificaciones, chat...). Como el resto de preferencias
-- visuales, vive en profiles para sobrevivir a reloads y cambios de
-- dispositivo (localStorage puede perderse con IndexedDB).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_cards_glass BOOLEAN NOT NULL DEFAULT false;
