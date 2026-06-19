-- Migration 011: Bloquear reposts de perfiles privados
-- Evita que usuarios puedan repostear posts de perfiles privados
-- El dueño del perfil privado aún puede repostear sus propios posts (y los de otros)

-- 1. Función helper: verificar si el post pertenece a un perfil privado
--    y si el usuario actual NO es el dueño
CREATE OR REPLACE FUNCTION can_repost_post(p_user_id UUID, p_post_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  post_owner_is_private BOOLEAN;
  post_owner_id UUID;
BEGIN
  SELECT p.user_id, pr.is_private INTO post_owner_id, post_owner_is_private
  FROM posts p
  JOIN profiles pr ON pr.id = p.user_id
  WHERE p.id = p_post_id;

  -- Si el post no existe, permitir que otra validación lo rechace
  IF post_owner_id IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Si el perfil es privado y quien repostea NO es el dueño → bloquear
  IF post_owner_is_private AND p_user_id != post_owner_id THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Actualizar la política de INSERT en reposts
--    La política existente "Users can create reposts" ya checkea auth.uid() = user_id.
--    Agregamos el check adicional de perfil privado.
DROP POLICY IF EXISTS "Users can create reposts" ON reposts;
CREATE POLICY "Users can create reposts" ON reposts
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND can_repost_post(user_id, post_id)
  );

-----
-- EJEMPLOS:
--   El dueño de un perfil privado (user_id = X) puede repostear:
--     - Sus propios posts → can_repost_post(X, post_de_X) = TRUE
--     - Posts de otros → can_repost_post(X, post_de_Y) = TRUE (Y no es privado)
--   Un seguidor (user_id = Z) NO puede repostear posts del perfil privado:
--     - can_repost_post(Z, post_de_X) = FALSE
-----
