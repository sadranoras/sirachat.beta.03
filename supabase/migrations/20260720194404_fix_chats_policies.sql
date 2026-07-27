/*
# Recreate chats RLS policies cleanly

1. Problem
- Stale `chats_update_members` policy still subqueried `chat_members` (recursion risk).
- `chats_insert_own` was created as FOR ALL instead of FOR INSERT.
- These leftover policies caused INSERT failures and potential recursion.

2. Fix
- Drop ALL existing policies on `chats`.
- Recreate 4 separate policies (SELECT/INSERT/UPDATE/DELETE) using the
  `is_chat_member` SECURITY DEFINER helper (no recursion) and `created_by = auth.uid()`.
*/

DROP POLICY IF EXISTS "chats_select_members" ON chats;
DROP POLICY IF EXISTS "chats_insert_own" ON chats;
DROP POLICY IF EXISTS "chats_update_owner" ON chats;
DROP POLICY IF EXISTS "chats_update_members" ON chats;
DROP POLICY IF EXISTS "chats_delete_owner" ON chats;

-- SELECT: members can read their chats (uses helper, no recursion)
CREATE POLICY "chats_select_members" ON chats FOR SELECT
  TO authenticated USING (public.is_chat_member(chats.id, auth.uid()));

-- INSERT: owner can create chats
CREATE POLICY "chats_insert_own" ON chats FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

-- UPDATE: owner can update their chats
CREATE POLICY "chats_update_owner" ON chats FOR UPDATE
  TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- DELETE: owner can delete their chats
CREATE POLICY "chats_delete_owner" ON chats FOR DELETE
  TO authenticated USING (created_by = auth.uid());
