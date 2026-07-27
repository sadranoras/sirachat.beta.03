/*
# Clean up ALL duplicate policies on chats and chat_members

Old policies from the original migration were never dropped and coexist
with the new ones, causing conflicts and recursion.
*/

-- Drop ALL policies on chats
DROP POLICY IF EXISTS "chats_select_members" ON chats;
DROP POLICY IF EXISTS "chats_insert_own" ON chats;
DROP POLICY IF EXISTS "chats_update_owner" ON chats;
DROP POLICY IF EXISTS "chats_update_members" ON chats;
DROP POLICY IF EXISTS "chats_delete_owner" ON chats;

-- Drop ALL policies on chat_members (old + new duplicates)
DROP POLICY IF EXISTS "chat_members_select_own" ON chat_members;
DROP POLICY IF EXISTS "chat_members_insert_own" ON chat_members;
DROP POLICY IF EXISTS "chat_members_delete_own" ON chat_members;
DROP POLICY IF EXISTS "chat_members_update_admin" ON chat_members;
DROP POLICY IF EXISTS "members_select_own_chats" ON chat_members;
DROP POLICY IF EXISTS "members_insert_owner" ON chat_members;
DROP POLICY IF EXISTS "members_delete_owner_or_self" ON chat_members;

-- Recreate chats policies (4 separate, one per verb)
CREATE POLICY "chats_select_member" ON chats FOR SELECT
  TO authenticated USING (public.is_chat_member(chats.id, auth.uid()));

CREATE POLICY "chats_insert_own" ON chats FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "chats_update_owner" ON chats FOR UPDATE
  TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

CREATE POLICY "chats_delete_owner" ON chats FOR DELETE
  TO authenticated USING (created_by = auth.uid());

-- Recreate chat_members policies (4 separate, one per verb, no self-reference)
CREATE POLICY "members_select" ON chat_members FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR public.is_chat_member(chat_members.chat_id, auth.uid())
  );

CREATE POLICY "members_insert" ON chat_members FOR INSERT
  TO authenticated WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = chat_members.chat_id AND c.created_by = auth.uid()
    )
  );

CREATE POLICY "members_update" ON chat_members FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = chat_members.chat_id AND c.created_by = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = chat_members.chat_id AND c.created_by = auth.uid()
    )
  );

CREATE POLICY "members_delete" ON chat_members FOR DELETE
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = chat_members.chat_id AND c.created_by = auth.uid()
    )
  );
