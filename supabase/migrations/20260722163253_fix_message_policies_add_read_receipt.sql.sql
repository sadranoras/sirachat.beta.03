-- Add read_at column for read receipts (double tick)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS read_at timestamp with time zone;

-- Drop restrictive UPDATE policies that only allow sender to update
DROP POLICY IF EXISTS "messages_update_own" ON public.messages;
DROP POLICY IF EXISTS "messages_update_sender" ON public.messages;

-- Create new UPDATE policy: allow chat members to update messages
-- (sender can edit/delete/pin their own, any member can mark read_at)
CREATE POLICY "messages_update_members" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    is_chat_member(chat_id, auth.uid())
  )
  WITH CHECK (
    is_chat_member(chat_id, auth.uid())
  );

-- Drop restrictive DELETE policies
DROP POLICY IF EXISTS "messages_delete_own" ON public.messages;
DROP POLICY IF EXISTS "messages_delete_sender" ON public.messages;
DROP POLICY IF EXISTS "messages_delete_admin" ON public.messages;

-- Create new DELETE policy: sender or admin can delete
CREATE POLICY "messages_delete_sender_or_admin" ON public.messages
  FOR DELETE TO authenticated
  USING (
    sender_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );
