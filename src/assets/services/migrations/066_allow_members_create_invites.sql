-- 066: Fix community_invites RLS — allow any active member to create invites
-- The error 42501 (insufficient privilege) means the GRANT or RLS policy
-- wasn't applied correctly. This migration re-applies everything.

-- 1. Ensure RLS is enabled
ALTER TABLE community_invites ENABLE ROW LEVEL SECURITY;

-- 2. Ensure authenticated role has full access
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_invites TO authenticated;
GRANT SELECT ON public.community_invites TO anon;

-- 3. Drop old restrictive policy and create permissive one
DROP POLICY IF EXISTS "Moderators can create invites" ON community_invites;
DROP POLICY IF EXISTS "Members can create invites" ON community_invites;
CREATE POLICY "Members can create invites"
  ON community_invites FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND public.is_community_member(community_id)
  );

-- 4. Also fix SELECT and DELETE policies for consistency
DROP POLICY IF EXISTS "Moderators can view invites" ON community_invites;
CREATE POLICY "Members can view invites"
  ON community_invites FOR SELECT
  TO authenticated
  USING (public.is_community_member(community_id));

DROP POLICY IF EXISTS "Moderators can delete invites" ON community_invites;
CREATE POLICY "Members can delete invites"
  ON community_invites FOR DELETE
  TO authenticated
  USING (
    auth.uid() = created_by
    OR public.is_community_moderator(community_id)
  );
