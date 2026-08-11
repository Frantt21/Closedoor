-- ==============================================
-- Migration 058: Communities system
-- ==============================================
-- Tablas para el sistema de comunidades:
-- - communities: la comunidad en sí (slug, nombre, banner, avatar, descripcion,
--   reglas, intereses, color acento, privacidad, owner)
-- - community_members: membresia + roles + estado (active | pending | banned)
--   El rol "owner" lo proclama el sistema al crear la comunidad.
-- - community_roles: roles custom creados por el owner con permisos
-- - community_invites: enlaces de invitacion (token unico)
-- - posts.community_id: los posts de la comunidad viven en la tabla posts
--   (reusan likes/comments/reposts/views del sistema existente)
-- ==============================================

-- ── 1. Communities ──
CREATE TABLE IF NOT EXISTS communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,              -- sintaxis c/slug (unico, lowercase)
  name TEXT NOT NULL,
  description TEXT,
  rules TEXT[],                           -- reglas de la comunidad
  interests TEXT[],                       -- intereses/temas
  avatar_url TEXT,
  banner_url TEXT,
  accent_color TEXT,                      -- extraido del banner (reusa colorExtractor)
  accent_color_secondary TEXT,
  is_private BOOLEAN NOT NULL DEFAULT false,
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  member_count INTEGER NOT NULL DEFAULT 0,
  post_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Community members ──
-- status:
--   active  → miembro con acceso total al contenido
--   pending → solicitud de union en espera (comunidades privadas)
--   banned  → expulsado (no puede volver a pedir union)
-- role:
--   owner / admin / moderator / member  (built-in)
--   o el nombre de un rol custom de community_roles
CREATE TABLE IF NOT EXISTS community_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(community_id, user_id)
);

-- ── 3. Community custom roles (creados por el owner) ──
-- permissions: array de strings: 'manage_posts', 'manage_members',
--              'manage_requests', 'manage_chat', 'manage_roles'
CREATE TABLE IF NOT EXISTS community_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(community_id, name)
);

-- ── 4. Community invites ──
CREATE TABLE IF NOT EXISTS community_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0
);

-- ── 5. Posts: columna community_id ──
ALTER TABLE posts ADD COLUMN IF NOT EXISTS community_id UUID REFERENCES communities(id) ON DELETE CASCADE;

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_communities_owner ON communities(owner_id);
CREATE INDEX IF NOT EXISTS idx_communities_created ON communities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_members_community ON community_members(community_id);
CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members(user_id);
CREATE INDEX IF NOT EXISTS idx_community_members_status ON community_members(community_id, status);
CREATE INDEX IF NOT EXISTS idx_community_roles_community ON community_roles(community_id);
CREATE INDEX IF NOT EXISTS idx_community_invites_token ON community_invites(token);
CREATE INDEX IF NOT EXISTS idx_community_invites_community ON community_invites(community_id);
CREATE INDEX IF NOT EXISTS idx_posts_community ON posts(community_id, created_at DESC);

-- ── RLS ──
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_invites ENABLE ROW LEVEL SECURITY;

-- ── GRANTs (patrón del repo: explícitos por tabla; las policies RLS filtran) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.communities TO authenticated;
GRANT SELECT ON public.communities TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_members TO authenticated;
GRANT SELECT ON public.community_members TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_roles TO authenticated;
GRANT SELECT ON public.community_roles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_invites TO authenticated;
GRANT SELECT ON public.community_invites TO anon;

-- ════════════════════════════════════════════════════════════
-- Funciones helper SECURITY DEFINER (evitan recursion RLS)
-- ════════════════════════════════════════════════════════════
-- ¿Es auth.uid() miembro ACTIVO de la comunidad?
CREATE OR REPLACE FUNCTION public.is_community_member(community_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM community_members
    WHERE community_id = $1 AND user_id = auth.uid() AND status = 'active'
  );
$$;

-- ¿Tiene auth.uid() un rol de moderacion en la comunidad?
-- (owner, admin, moderator, o un rol custom con el permiso pedido)
CREATE OR REPLACE FUNCTION public.is_community_moderator(community_id uuid, permission text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM community_members m
    WHERE m.community_id = $1 AND m.user_id = auth.uid() AND m.status = 'active'
      AND (
        m.role IN ('owner', 'admin', 'moderator')
        OR (
          permission IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM community_roles r
            WHERE r.community_id = $1 AND r.name = m.role
              AND permission = ANY (r.permissions)
          )
        )
      )
  );
$$;

-- ¿Puede auth.uid() ver el contenido de esta comunidad?
-- (públicas: todos | privadas: solo miembros activos)
CREATE OR REPLACE FUNCTION public.can_view_community(community_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT c.is_private OR public.is_community_member($1)
  FROM communities c
  WHERE c.id = $1;
$$;

-- ════════════════════════════════════════════════
-- COMMUNITIES policies
-- ════════════════════════════════════════════════
-- SELECT: cualquier usuario puede ver la fila de la comunidad
-- (la privacidad oculta el CONTENIDO, no la existencia).
-- La descripcion/reglas de privadas se filtran a nivel de servicio.
DROP POLICY IF EXISTS "Anyone can view communities" ON communities;
CREATE POLICY "Anyone can view communities"
  ON communities FOR SELECT
  USING (true);

-- INSERT: solo autenticados (el servicio valida 100+ seguidores y slug)
DROP POLICY IF EXISTS "Authenticated users can create communities" ON communities;
CREATE POLICY "Authenticated users can create communities"
  ON communities FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- UPDATE/DELETE: solo el owner
DROP POLICY IF EXISTS "Owners can update communities" ON communities;
CREATE POLICY "Owners can update communities"
  ON communities FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Owners can delete communities" ON communities;
CREATE POLICY "Owners can delete communities"
  ON communities FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

-- ════════════════════════════════════════════════
-- COMMUNITY_MEMBERS policies
-- ════════════════════════════════════════════════
-- SELECT: miembros activos ven a todos los miembros.
-- Moderadores ven tambien las solicitudes pending.
-- Usuarios NO miembros solo pueden ver su propia fila (para saber si
-- ya pidieron union) + miembros de comunidades PUBLICAS.
DROP POLICY IF EXISTS "Members can view community members" ON community_members;
CREATE POLICY "Members can view community members"
  ON community_members FOR SELECT
  USING (
    public.is_community_member(community_id)
    OR public.is_community_moderator(community_id)
    OR user_id = auth.uid()
    OR (
      -- Comunidades publicas: cualquiera puede ver la lista de miembros
      NOT EXISTS (
        SELECT 1 FROM communities c WHERE c.id = community_id AND c.is_private = true
      )
      AND status = 'active'
    )
  );

-- INSERT: cualquier autenticado puede pedir union o unirse
-- (el servicio decide si crea la fila como active o pending)
DROP POLICY IF EXISTS "Authenticated users can join communities" ON community_members;
CREATE POLICY "Authenticated users can join communities"
  ON community_members FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- UPDATE: moderadores cambian roles/estado; el propio usuario puede
-- abandonar la comunidad (status active → delete, no update).
DROP POLICY IF EXISTS "Moderators can manage members" ON community_members;
CREATE POLICY "Moderators can manage members"
  ON community_members FOR UPDATE
  TO authenticated
  USING (public.is_community_moderator(community_id))
  WITH CHECK (public.is_community_moderator(community_id));

-- DELETE: el propio usuario puede salirse; moderadores expulsan.
DROP POLICY IF EXISTS "Users can leave communities" ON community_members;
CREATE POLICY "Users can leave communities"
  ON community_members FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_community_moderator(community_id)
  );

-- ════════════════════════════════════════════════
-- COMMUNITY_ROLES policies
-- ════════════════════════════════════════════════
-- SELECT: miembros activos pueden ver los roles.
DROP POLICY IF EXISTS "Members can view community roles" ON community_roles;
CREATE POLICY "Members can view community roles"
  ON community_roles FOR SELECT
  USING (public.is_community_member(community_id));

-- INSERT/UPDATE/DELETE: solo owner (o admin con permiso manage_roles)
DROP POLICY IF EXISTS "Moderators can manage community roles" ON community_roles;
CREATE POLICY "Moderators can manage community roles"
  ON community_roles FOR ALL
  TO authenticated
  USING (public.is_community_moderator(community_id, 'manage_roles'))
  WITH CHECK (public.is_community_moderator(community_id, 'manage_roles'));

-- ════════════════════════════════════════════════
-- COMMUNITY_INVITES policies
-- ════════════════════════════════════════════════
-- SELECT: moderadores ven los invites.
-- El canje por token se hace vía el RPC get_community_invite_by_token
-- (SECURITY DEFINER), que valida el token sin exponer la tabla.
DROP POLICY IF EXISTS "Moderators can view invites" ON community_invites;
CREATE POLICY "Moderators can view invites"
  ON community_invites FOR SELECT
  USING (public.is_community_moderator(community_id));

DROP POLICY IF EXISTS "Moderators can create invites" ON community_invites;
CREATE POLICY "Moderators can create invites"
  ON community_invites FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND public.is_community_moderator(community_id, 'manage_members')
  );

DROP POLICY IF EXISTS "Moderators can delete invites" ON community_invites;
CREATE POLICY "Moderators can delete invites"
  ON community_invites FOR DELETE
  TO authenticated
  USING (public.is_community_moderator(community_id, 'manage_members'));

-- ════════════════════════════════════════════════
-- POSTS policies: integrar community_id
-- ════════════════════════════════════════════════
-- Reemplazar la politica SELECT de posts no encriptados para exigir
-- visibilidad de la comunidad (públicas: todos; privadas: solo miembros).
DROP POLICY IF EXISTS "Anyone can view non-encrypted posts" ON posts;
CREATE POLICY "Anyone can view non-encrypted posts"
  ON posts FOR SELECT
  USING (
    is_encrypted IS DISTINCT FROM true
    AND (
      community_id IS NULL
      OR public.can_view_community(community_id)
    )
  );

-- Los posts encriptados de una comunidad siguen la misma regla de
-- comunidad + regla de encriptacion (autor o allowed_users).
DROP POLICY IF EXISTS "Authors and allowed users can view encrypted posts" ON posts;
CREATE POLICY "Authors and allowed users can view encrypted posts"
  ON posts FOR SELECT
  USING (
    is_encrypted = true
    AND (
      auth.uid() = user_id
      OR auth.uid() = ANY (COALESCE(allowed_users, '{}'))
    )
    AND (
      community_id IS NULL
      OR public.can_view_community(community_id)
    )
  );

-- INSERT: unificar TODAS las políticas de inserción de posts en una sola
-- (las policies RLS se combinan con OR; si existiera una política genérica
-- 'Users can create posts' creada fuera del repo, un no-miembro podría crear
-- posts con community_id arbitrario). Esta política exige: el autor es
-- auth.uid() Y, si publica en una comunidad, es miembro activo de ella.
DROP POLICY IF EXISTS "Users can create posts" ON posts;
DROP POLICY IF EXISTS "Users can insert own posts" ON posts;
DROP POLICY IF EXISTS "Users can create their own posts" ON posts;
DROP POLICY IF EXISTS "Community members can post" ON posts;
CREATE POLICY "Users can create posts (own or community member)"
  ON posts FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      community_id IS NULL
      OR public.is_community_member(community_id)
    )
  );

-- UPDATE: el autor puede editar; moderadores pueden borrar/editar posts
-- de la comunidad (para moderacion). Se unifica también aquí.
DROP POLICY IF EXISTS "Users can update own posts" ON posts;
DROP POLICY IF EXISTS "Users can edit own posts" ON posts;
DROP POLICY IF EXISTS "Users can update own posts or moderate community" ON posts;
CREATE POLICY "Users can update own posts or moderate community"
  ON posts FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (community_id IS NOT NULL AND public.is_community_moderator(community_id))
  )
  WITH CHECK (
    auth.uid() = user_id
    OR (community_id IS NOT NULL AND public.is_community_moderator(community_id))
  );

-- DELETE: el autor puede borrar; moderadores pueden borrar posts de su comunidad
DROP POLICY IF EXISTS "Users can delete own posts" ON posts;
DROP POLICY IF EXISTS "Users can remove own posts" ON posts;
DROP POLICY IF EXISTS "Users can delete own posts or moderate community" ON posts;
CREATE POLICY "Users can delete own posts or moderate community"
  ON posts FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (community_id IS NOT NULL AND public.is_community_moderator(community_id))
  );

-- ════════════════════════════════════════════════
-- Vista posts_public: añadir community_id
-- ════════════════════════════════════════════════
DROP VIEW IF EXISTS public.posts_public CASCADE;

CREATE OR REPLACE VIEW public.posts_public AS
SELECT
  id,
  user_id,
  content,
  image_url,
  image_urls,
  video_url,
  mentions,
  is_pinned,
  pinned_at,
  likes_count,
  dislikes_count,
  comments_count,
  reposts_count,
  views_count,
  comments_allowed,
  is_encrypted,
  -- allowed_users — no expuesto (igual que 055)
  obfuscated_display,
  poll_data,
  scheduled_at,
  is_sensitive,
  community_id,
  created_at,
  updated_at
FROM posts;

ALTER VIEW public.posts_public SET (security_invoker = true);

GRANT SELECT ON public.posts_public TO anon, authenticated;

-- ════════════════════════════════════════════════
-- Triggers: contadores denormalizados
-- ════════════════════════════════════════════════
-- member_count en communities (se actualiza al insert/delete de members)
CREATE OR REPLACE FUNCTION update_community_member_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    UPDATE communities SET member_count = member_count + 1, updated_at = NOW()
    WHERE id = NEW.community_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'active' THEN
    UPDATE communities SET member_count = member_count + 1, updated_at = NOW()
    WHERE id = NEW.community_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status = 'banned' THEN
    UPDATE communities SET member_count = GREATEST(member_count - 1, 0), updated_at = NOW()
    WHERE id = NEW.community_id;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
    UPDATE communities SET member_count = GREATEST(member_count - 1, 0), updated_at = NOW()
    WHERE id = OLD.community_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_community_member_count ON community_members;
CREATE TRIGGER trg_community_member_count
  AFTER INSERT OR UPDATE OR DELETE ON community_members
  FOR EACH ROW
  EXECUTE FUNCTION update_community_member_count();

-- post_count en communities
CREATE OR REPLACE FUNCTION update_community_post_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.community_id IS NOT NULL THEN
    UPDATE communities SET post_count = post_count + 1, updated_at = NOW()
    WHERE id = NEW.community_id;
  ELSIF TG_OP = 'DELETE' AND OLD.community_id IS NOT NULL THEN
    UPDATE communities SET post_count = GREATEST(post_count - 1, 0), updated_at = NOW()
    WHERE id = OLD.community_id;
  ELSIF TG_OP = 'UPDATE'
        AND OLD.community_id IS DISTINCT FROM NEW.community_id
        AND NEW.community_id IS NOT NULL THEN
    UPDATE communities SET post_count = post_count + 1, updated_at = NOW()
    WHERE id = NEW.community_id;
  ELSIF TG_OP = 'UPDATE'
        AND OLD.community_id IS DISTINCT FROM NEW.community_id
        AND OLD.community_id IS NOT NULL THEN
    UPDATE communities SET post_count = GREATEST(post_count - 1, 0), updated_at = NOW()
    WHERE id = OLD.community_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_community_post_count ON posts;
CREATE TRIGGER trg_community_post_count
  AFTER INSERT OR UPDATE OR DELETE ON posts
  FOR EACH ROW
  EXECUTE FUNCTION update_community_post_count();

-- ════════════════════════════════════════════════
-- RPC: canjear un invite por token
-- ════════════════════════════════════════════════
-- Devuelve los datos del invite (sin exponer la tabla) para que el
-- servicio pueda validar expiración/usos y unir al usuario.
CREATE OR REPLACE FUNCTION public.get_community_invite_by_token(invite_token text)
RETURNS TABLE (id uuid, community_id uuid, expires_at timestamptz, max_uses integer, uses integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, community_id, expires_at, max_uses, uses
  FROM community_invites
  WHERE token = invite_token;
$$;

REVOKE ALL ON FUNCTION public.get_community_invite_by_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_community_invite_by_token(TEXT) TO authenticated;

-- ── Realtime ──
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE communities;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE community_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
