/*
# Fix infinite recursion in chat_members RLS policies

1. Problem
The `members_select_own_chats` policy on `chat_members` ran a subquery against
`chat_members` itself, which re-triggered the same policy → infinite recursion.
The `chats_select_members` policy also subqueried `chat_members`, compounding it.

2. Fix
- Create a SECURITY DEFINER function `is_chat_member(p_chat_id, p_user_id)` that
  bypasses RLS and returns true if the user is a member of the chat (or owns a
  'saved' chat). SECURITY DEFINER runs with the function owner's privileges and
  does NOT re-evaluate RLS, so no recursion.
- Rewrite all chat_members and chats policies to call this function instead of
  subquerying `chat_members` directly.
- Drop and recreate the affected policies.

3. Security
- The helper function is read-only and only exposes membership existence, not data.
- All ownership checks still use auth.uid().
*/

CREATE OR REPLACE FUNCTION public.is_chat_member(p_chat_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_members cm
    WHERE cm.chat_id = p_chat_id AND cm.user_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.chats c
    WHERE c.id = p_chat_id AND c.type = 'saved' AND c.created_by = p_user_id
  );
$$;

-- chats SELECT: members can read their chats
DROP POLICY IF EXISTS "chats_select_members" ON chats;
CREATE POLICY "chats_select_members" ON chats FOR SELECT
  TO authenticated USING (public.is_chat_member(chats.id, auth.uid()));

-- chat_members SELECT: a user can read membership rows for chats they belong to
DROP POLICY IF EXISTS "members_select_own_chats" ON chat_members;
CREATE POLICY "members_select_own_chats" ON chat_members FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR public.is_chat_member(chat_members.chat_id, auth.uid())
  );

-- chat_members INSERT: only chat owner can add members
DROP POLICY IF EXISTS "members_insert_owner" ON chat_members;
CREATE POLICY "members_insert_owner" ON chat_members FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = chat_members.chat_id AND c.created_by = auth.uid()
    )
  );

-- chat_members DELETE: owner or self can remove
DROP POLICY IF EXISTS "members_delete_owner_or_self" ON chat_members;
CREATE POLICY "members_delete_owner_or_self" ON chat_members FOR DELETE
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = chat_members.chat_id AND c.created_by = auth.uid()
    )
  );

-- messages SELECT: use helper to avoid chat_members recursion
DROP POLICY IF EXISTS "messages_select_members" ON messages;
CREATE POLICY "messages_select_members" ON messages FOR SELECT
  TO authenticated USING (public.is_chat_member(messages.chat_id, auth.uid()));

-- messages INSERT: use helper
DROP POLICY IF EXISTS "messages_insert_members" ON messages;
CREATE POLICY "messages_insert_members" ON messages FOR INSERT
  TO authenticated WITH CHECK (
    sender_id = auth.uid()
    AND public.is_chat_member(messages.chat_id, auth.uid())
  );
