-- ==============================================
-- Migration 070: show_global_bg como preferencia de cuenta
-- ==============================================
-- El toggle "Fondo de perfil en todo el app" (GlobalProfileBg) vivía solo
-- en localStorage (fc_show_global_bg vía secureStorage). Como la master key
-- de secureStorage no es exportable, al perderse IndexedDB (limpiar datos,
-- otro dispositivo, modo privado) la preferencia se reseteaba.
--
-- Ahora vive en profiles: configuraciones a nivel de cuenta, sobrevive
-- reloads y dispositivos. El valor anterior NO se migra (era efímero).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_global_bg BOOLEAN NOT NULL DEFAULT false;
