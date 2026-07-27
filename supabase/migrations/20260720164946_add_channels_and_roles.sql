/*
# Add channels + group support + member roles

1. Schema changes
- chats: expand type CHECK to include 'channel'.
- chat_members: add `role` column ('owner' | 'admin' | 'member') default 'member'.
- chat_members: add `joined_at` already exists.

2. Security (RLS)
- Update chat_members insert policy: a creator inserting OTHER members must be allowed (owner inserting members during creation). We allow insert where user_id = auth.uid() OR the inserter is the chat creator. Since RLS checks per-row, we relax insert to: user_id = auth.uid() OR EXISTS(chat created_by auth.uid()). This supports group/channel creation flow.
- Add policy: chat owner/admins can insert members into their chats.
- Add policy: chat owner can delete any member; members can delete themselves.
- Update messages insert policy: in channels, only owner/admin can post. In groups/direct, any member can post.

3. Notes
- Channels: only owner/admin can send messages (broadcast style).
- Groups: any member can send messages.
- Direct: both members can send.
*/

-- ============ Expand chat type ============
ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_type_check;
ALTER TABLE chats ADD CONSTRAINT chats_type_check CHECK (type IN ('direct','group','channel'));

-- ============ Add role to chat_members ============
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member'));

-- ============ chat_members insert policy ============
-- Allow: self-join, OR owner/admin of the chat adding members
DROP POLICY IF EXISTS "chat_members_insert_own" ON chat_members;
CREATE POLICY "chat_members_insert_own" ON chat_members FOR INSERT
  TO authenticated WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_id
      AND c.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = chat_members.chat_id
      AND cm.user_id = auth.uid()
      AND cm.role IN ('owner','admin')
    )
  );

-- ============ chat_members delete policy ============
-- Owner can remove anyone; members can leave
DROP POLICY IF EXISTS "chat_members_delete_own" ON chat_members;
CREATE POLICY "chat_members_delete_own" ON chat_members FOR DELETE
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM chats c WHERE c.id = chat_id AND c.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = chat_members.chat_id
      AND cm.user_id = auth.uid()
      AND cm.role IN ('owner','admin')
    )
  );

-- ============ chat_members update policy (for role changes) ============
DROP POLICY IF EXISTS "chat_members_update_admin" ON chat_members;
CREATE POLICY "chat_members_update_admin" ON chat_members FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = chat_members.chat_id
      AND cm.user_id = auth.uid()
      AND cm.role IN ('owner','admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = chat_members.chat_id
      AND cm.user_id = auth.uid()
      AND cm.role IN ('owner','admin')
    )
  );

-- ============ messages insert policy ============
-- Direct/group: any member can post. Channel: only owner/admin can post.
DROP POLICY IF EXISTS "messages_insert_members" ON messages;
CREATE POLICY "messages_insert_members" ON messages FOR INSERT
  TO authenticated WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = messages.chat_id
      AND cm.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = messages.chat_id
      AND (
        c.type IN ('direct','group')
        OR (c.type = 'channel' AND EXISTS (
          SELECT 1 FROM chat_members cm2
          WHERE cm2.chat_id = c.id AND cm2.user_id = auth.uid() AND cm2.role IN ('owner','admin')
        ))
      )
    )
  );

-- ============ Realtime for chat_members role changes ============
-- already in publication
