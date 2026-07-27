-- Drop the existing select policy on chats
DROP POLICY IF EXISTS chats_select_member ON public.chats;

-- Recreate: allow if user is a member OR is the creator
CREATE POLICY chats_select_member ON public.chats
  FOR SELECT TO authenticated
  USING (
    is_chat_member(id, auth.uid())
    OR created_by = auth.uid()
  );
