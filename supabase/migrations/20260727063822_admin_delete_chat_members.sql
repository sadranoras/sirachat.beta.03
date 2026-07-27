/*
# Allow admins to delete chat_members rows (moderation)

## What changes
1. Adds a DELETE policy on `chat_members` so admins can remove any membership row.
   This is needed when an admin deletes an entire chat — the chat_members rows must
   be cleared first (FK constraint), and only the owner or the member themselves can
   currently delete. Without this, an admin cannot fully remove a chat they don't own.

## Security
- Only users where `is_admin(auth.uid()) = true` can delete others' memberships.
- No change to existing owner/self delete policies.

## Notes
1. The `is_admin()` helper function already exists from a prior migration.
2. Idempotent: drops the policy first if it already exists.
*/

DROP POLICY IF EXISTS "admin_delete_chat_members" ON chat_members;
CREATE POLICY "admin_delete_chat_members" ON chat_members
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));
