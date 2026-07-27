-- Helper function: can a user view the full member list of a chat?
-- For channels: only owner/admin can see other members.
-- For groups/direct/saved: any member can see all members.
-- SECURITY DEFINER avoids RLS recursion on chat_members.
CREATE OR REPLACE FUNCTION public.can_view_chat_members(p_chat_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT EXISTS (
  SELECT 1 FROM public.chat_members cm
  WHERE cm.chat_id = p_chat_id AND cm.user_id = p_user_id
)
AND (
  (SELECT c.type FROM public.chats c WHERE c.id = p_chat_id) <> 'channel'
  OR EXISTS (
    SELECT 1 FROM public.chat_members cm2
    WHERE cm2.chat_id = p_chat_id
      AND cm2.user_id = p_user_id
      AND cm2.role IN ('owner', 'admin')
  )
);
$function$;

-- Replace the members_select policy so channel members are hidden from non-admins.
-- A user can always see their own membership row.
DROP POLICY IF EXISTS members_select ON public.chat_members;

CREATE POLICY "members_select" ON public.chat_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.can_view_chat_members(chat_id, auth.uid())
  );