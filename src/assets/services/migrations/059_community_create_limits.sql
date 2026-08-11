-- ==============================================
-- Migration 059: Community creation limits (DB-level)
-- ==============================================
-- Reglas de creación de comunidades (defensa en profundidad: además de la
-- validación del servicio, la DB lo exige vía policy):
--   - Usuarios con rol 'admin' (profiles.roles): pueden crear comunidades
--     sin el requisito de 100 seguidores y sin el límite de 3.
--   - Usuarios normales: necesitan >= 100 seguidores (follows accepted) y
--     menos de 3 comunidades propias (owner_id).
--
-- Patrón de seguridad igual que el resto del repo: función SECURITY DEFINER
-- con SET search_path + REVOKE de PUBLIC + GRANT solo a authenticated
-- (mismo patrón que get_community_invite_by_token en la migración 058).

-- ── Función de autorización ──
CREATE OR REPLACE FUNCTION public.can_create_community()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Admin: sin límite de 3 y sin requisito de followers
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND 'admin' = ANY(COALESCE(roles, '{}'))
    )
    OR (
      -- Usuario normal: 100+ followers (accepted) Y menos de 3 comunidades propias
      (SELECT COUNT(*) FROM follows
       WHERE following_id = auth.uid() AND status = 'accepted') >= 100
      AND (SELECT COUNT(*) FROM communities WHERE owner_id = auth.uid()) < 3
    );
$$;

REVOKE ALL ON FUNCTION public.can_create_community() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_create_community() TO authenticated;

-- ── Policy INSERT: exigir la regla en la propia DB ──
DROP POLICY IF EXISTS "Authenticated users can create communities" ON communities;
CREATE POLICY "Authenticated users can create communities"
  ON communities FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id AND public.can_create_community());
