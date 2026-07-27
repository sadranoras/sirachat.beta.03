/*
# Allow group/channel admins to update member roles

## What changes
1. Replaces the `members_update` policy so that any member with role 'owner' or 'admin'
   can update other members' roles (promote/demote), not just the chat creator.

## Security
- Only authenticated users who are themselves an 'owner' or 'admin' of the chat can update.
- The check looks up the requester's own chat_members row for the same chat_id.
- Existing creator-based access is preserved (creator is typically the 'owner' role).

## Notes
1. Idempotent: drops the old policy first.
*/

DROP POLICY IF EXISTS "members_update" ON chat_members;
CREATE POLICY "members_update" ON chat_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_members cm
      WHERE cm.chat_id = chat_members.chat_id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_members cm
      WHERE cm.chat_id = chat_members.chat_id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('owner', 'admin')
    )
  );
