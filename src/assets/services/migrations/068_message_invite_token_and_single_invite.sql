-- 068: Invitaciones por chat funcionales + 1 invitación por usuario
--
-- 1. messages.shared_invite_token: guarda el token junto al mensaje-tarjeta
--    para que el receptor canjee la invitación (?invite=token al navegar).
--    RLS de messages ya limita la lectura a participantes, así que el token
--    no se expone a terceros.
-- 2. Índice único (community_id, created_by): cualquier miembro (user, mod,
--    admin u owner) solo puede tener UNA invitación activa por comunidad,
--    sin importar su rol.

-- 1. Token de invitación en mensajes compartidos
ALTER TABLE messages ADD COLUMN IF NOT EXISTS shared_invite_token TEXT;

-- 2. Limpiar duplicados previos (conservar la más reciente de cada usuario)
DELETE FROM community_invites a
  USING community_invites b
  WHERE a.community_id = b.community_id
    AND a.created_by = b.created_by
    AND (a.created_at < b.created_at
         OR (a.created_at = b.created_at AND a.id < b.id));

-- 3. Regla dura: máximo 1 invitación activa por creador y comunidad.
--    Al borrarla puede regenerarla (útil si el link se filtra).
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_invites_one_per_user
  ON community_invites(community_id, created_by);
